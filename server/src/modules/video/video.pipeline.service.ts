import fs from 'fs/promises';
import path from 'path';
import axios from 'axios';
import admin from 'firebase-admin';
import type { Env } from '../../config/env';
import { runCmd } from './exec.util';
import { getSignedReadUrl, gsUri, uploadLocalFile } from './gcs.service';
import type { VideoVariant } from './video.types';

export type PipelineInput =
  | { kind: 'youtube'; pageUrl: string }
  | { kind: 'steam'; mp4Url: string };

export type PipelineResult = {
  durationSec: number;
  masterSignedUrl: string;
  thumbnailSignedUrl: string;
  verticalSignedUrl: string;
  storagePrefix: string;
  variants: VideoVariant[];
  signedPlaybackExpiresAt: admin.firestore.Timestamp;
};

async function probeDurationSec(env: Env, filePath: string): Promise<number> {
  const { stdout } = await runCmd(env.ffprobePath, [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    filePath,
  ]);
  const n = Number.parseFloat(stdout.trim());
  if (!Number.isFinite(n)) throw new Error('Could not read media duration');
  return n;
}

async function downloadSteamMp4(url: string, dest: string, timeoutMs: number): Promise<void> {
  const res = await axios.get<ArrayBuffer>(url, { responseType: 'arraybuffer', timeout: timeoutMs });
  await fs.writeFile(dest, Buffer.from(res.data));
}

async function downloadYoutube(env: Env, url: string, outDir: string): Promise<string> {
  const outTemplate = path.join(outDir, 'src.%(ext)s');
  await runCmd(
    env.ytDlpPath,
    ['-f', 'bv*+ba/b', '--merge-output-format', 'mp4', '-o', outTemplate, url],
    { maxBuffer: 1024 * 1024 * 120 },
  );
  const files = await fs.readdir(outDir);
  const src = files.find((f) => f.startsWith('src.') && !f.endsWith('.part'));
  if (!src) throw new Error('yt-dlp did not produce output file (install yt-dlp / check URL)');
  return path.join(outDir, src);
}

async function transcode(env: Env, srcPath: string, workDir: string): Promise<{
  masterPath: string;
  verticalPath: string;
  thumbPath: string;
  durationUsed: number;
}> {
  const duration = await probeDurationSec(env, srcPath);
  if (duration > env.videoMaxDurationSec) {
    throw new Error(`Source duration ${duration.toFixed(1)}s exceeds limit ${env.videoMaxDurationSec}s`);
  }

  const trim = Math.min(env.videoTrimSec, duration);
  const masterPath = path.join(workDir, 'master.mp4');
  const verticalPath = path.join(workDir, 'vertical_9_16.mp4');
  const thumbPath = path.join(workDir, 'thumbnail.jpg');

  await runCmd(env.ffmpegPath, [
    '-y',
    '-i',
    srcPath,
    '-t',
    String(trim),
    '-c:v',
    'libx264',
    '-preset',
    'fast',
    '-crf',
    '23',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-movflags',
    '+faststart',
    masterPath,
  ]);

  await runCmd(env.ffmpegPath, [
    '-y',
    '-i',
    masterPath,
    '-vf',
    'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920',
    '-c:v',
    'libx264',
    '-preset',
    'fast',
    '-crf',
    '23',
    '-c:a',
    'copy',
    verticalPath,
  ]);

  await runCmd(env.ffmpegPath, ['-y', '-i', masterPath, '-ss', '00:00:01', '-vframes', '1', thumbPath]);

  return { masterPath, verticalPath, thumbPath, durationUsed: trim };
}

export async function runVideoPipeline(
  env: Env,
  videoId: string,
  input: PipelineInput,
): Promise<PipelineResult> {
  const bucket = env.videoGcsBucket;
  if (!bucket) throw new Error('VIDEO_GCS_BUCKET is not configured');

  const workDir = path.join(env.videoTempDir, `video_${videoId}_${Date.now()}`);
  await fs.mkdir(workDir, { recursive: true });

  try {
    let srcPath: string;
    if (input.kind === 'youtube') {
      srcPath = await downloadYoutube(env, input.pageUrl, workDir);
    } else {
      srcPath = path.join(workDir, 'steam_src.mp4');
      await downloadSteamMp4(input.mp4Url, srcPath, env.steamHttpTimeoutMs);
    }

    const { masterPath, verticalPath, thumbPath, durationUsed } = await transcode(env, srcPath, workDir);

    const prefix = `videos/${videoId}`;
    const masterDest = `${prefix}/master.mp4`;
    const verticalDest = `${prefix}/vertical_9_16.mp4`;
    const thumbDest = `${prefix}/thumbnail.jpg`;

    await uploadLocalFile(env, masterPath, masterDest);
    await uploadLocalFile(env, verticalPath, verticalDest);
    await uploadLocalFile(env, thumbPath, thumbDest);

    const [masterSignedUrl, verticalSignedUrl, thumbnailSignedUrl] = await Promise.all([
      getSignedReadUrl(env, masterDest),
      getSignedReadUrl(env, verticalDest),
      getSignedReadUrl(env, thumbDest),
    ]);

    const expiresMs = Date.now() + env.videoSignedUrlMinutes * 60 * 1000;
    const signedPlaybackExpiresAt = admin.firestore.Timestamp.fromMillis(expiresMs);

    const variants: VideoVariant[] = [
      { name: 'master', storagePath: gsUri(bucket, masterDest), signedUrl: masterSignedUrl },
      { name: 'vertical_9_16', storagePath: gsUri(bucket, verticalDest), signedUrl: verticalSignedUrl },
      { name: 'thumbnail', storagePath: gsUri(bucket, thumbDest), signedUrl: thumbnailSignedUrl },
    ];

    return {
      durationSec: durationUsed,
      masterSignedUrl,
      thumbnailSignedUrl,
      verticalSignedUrl,
      storagePrefix: gsUri(bucket, prefix),
      variants,
      signedPlaybackExpiresAt,
    };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
