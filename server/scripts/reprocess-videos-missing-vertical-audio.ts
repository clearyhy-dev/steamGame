/**
 * Queue reprocess jobs for videos whose vertical variant lacks audio but master has audio.
 *
 *   npx tsx server/scripts/reprocess-videos-missing-vertical-audio.ts [--limit=10]
 */
import { loadEnv } from '../src/config/env';
import { VideoRepository } from '../src/modules/video/video.repository';
import { VideoJobRepository } from '../src/modules/video/video-job.repository';

async function main() {
  loadEnv();
  const limitArg = process.argv.find((a) => a.startsWith('--limit='));
  const limit = Math.max(1, Math.min(Number(limitArg?.split('=')[1] ?? 10), 100));

  const videos = new VideoRepository();
  const jobs = new VideoJobRepository();
  const all = await videos.listPublicReady(500);
  let queued = 0;

  for (const v of all) {
    if (queued >= limit) break;
    if (v.status !== 'ready' || v.deliveryType !== 'processed') continue;
    const vertical = (v.variants ?? []).find((x) => x.name === 'vertical_9_16');
    if (!vertical?.storagePath) continue;
    const masterHasAudio = v.audioPresent === true;
    const verticalHasAudio =
      v.verticalHasAudio === true ||
      vertical.hasAudio === true ||
      (v.verticalHasAudio == null && vertical.hasAudio == null && v.audioPresent !== false);
    if (verticalHasAudio || !masterHasAudio) continue;

    await jobs.create({ videoId: v.videoId, jobType: 'reprocess', status: 'pending', attempt: 0 });
    queued += 1;
    console.log(`[reprocess-audio] queued videoId=${v.videoId}`);
  }

  console.log(`[reprocess-audio] done queued=${queued}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
