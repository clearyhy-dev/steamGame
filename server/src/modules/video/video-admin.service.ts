import admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import type { Env } from '../../config/env';
import { VideoSourceRepository } from './video-source.repository';
import { VideoRepository } from './video.repository';
import { VideoJobRepository } from './video-job.repository';
import { extractYoutubeVideoId, youtubeEmbedUrl } from './youtube.util';
import { fetchSteamTrailerMp4 } from './steam-trailer.util';
import { runVideoPipeline } from './video.pipeline.service';
import type { VideoSourceDoc, VideoStatus } from './video.types';
import { getFirestore } from '../../config/firebase';

export class VideoAdminService {
  constructor(
    private env: Env,
    private sources = new VideoSourceRepository(),
    private videos = new VideoRepository(),
    private jobs = new VideoJobRepository(),
  ) {}

  async dashboardStats() {
    const db = getFirestore();

    const [
      totalVideos,
      readyVideos,
      failedVideos,
      publicVideos,
      pendingJobs,
      runningJobs,
    ] = await Promise.all([
      db.collection('videos').count().get(),
      db.collection('videos').where('status', '==', 'ready').count().get(),
      db.collection('videos').where('status', '==', 'failed').count().get(),
      db.collection('videos').where('visibility', '==', 'public').count().get(),
      db.collection('video_jobs').where('status', '==', 'pending').count().get(),
      db.collection('video_jobs').where('status', '==', 'running').count().get(),
    ]);

    return {
      totalVideos: totalVideos.data().count,
      readyVideos: readyVideos.data().count,
      failedVideos: failedVideos.data().count,
      publicVideos: publicVideos.data().count,
      pendingJobs: pendingJobs.data().count,
      runningJobs: runningJobs.data().count,
    };
  }

  async ingestFromSource(sourceId: string): Promise<{ videoId: string; jobId?: string }> {
    const source = await this.sources.findById(sourceId);
    if (!source) throw new Error('Source not found');
    if (!source.enabled) throw new Error('Source is disabled');

    if (source.ingestMode === 'embed') {
      const videoId = await this.createEmbedVideo(source as VideoSourceDoc);
      return { videoId };
    }

    const videoId = await this.videos.create({
      sourceId,
      gameId: source.gameId,
      steamAppId: source.steamAppId,
      sourceType: source.sourceType,
      title: source.title,
      status: 'queued',
      visibility: 'draft',
      deliveryType: 'processed',
      tags: [],
    });

    const jobId = await this.jobs.create({
      videoId,
      jobType: 'ingest',
      status: 'pending',
      attempt: 0,
    });

    return { videoId, jobId };
  }

  private async createEmbedVideo(source: VideoSourceDoc): Promise<string> {
    let playbackUrl = '';
    let title = source.title;

    if (source.sourceType === 'youtube') {
      const id = extractYoutubeVideoId(source.sourceUrl ?? '');
      if (!id) throw new Error('Invalid YouTube URL');
      playbackUrl = youtubeEmbedUrl(id);
    } else if (source.sourceType === 'steam') {
      if (!source.steamAppId) throw new Error('steamAppId required');
      const t = await fetchSteamTrailerMp4(this.env, source.steamAppId);
      playbackUrl = t.mp4Url;
      title = source.title || t.title;
    } else if (source.sourceType === 'manual') {
      playbackUrl = source.sourceUrl?.trim() ?? '';
      if (!playbackUrl) throw new Error('manual embed requires sourceUrl');
    } else {
      throw new Error('Unsupported embed source type');
    }

    return this.videos.create({
      sourceId: source.sourceId,
      gameId: source.gameId,
      steamAppId: source.steamAppId,
      sourceType: source.sourceType,
      title,
      status: 'ready',
      visibility: 'draft',
      deliveryType: 'embed',
      playbackUrl,
      tags: [],
    });
  }

  async publish(videoId: string, publisherName: string): Promise<void> {
    const v = await this.videos.findById(videoId);
    if (!v) throw new Error('Video not found');
    if (v.status !== 'ready') throw new Error('Only ready videos can be published');
    await this.videos.update(videoId, {
      visibility: 'public',
      publishedBy: publisherName,
      publishedAt: admin.firestore.Timestamp.now(),
    });
  }

  async unpublish(videoId: string): Promise<void> {
    await this.videos.update(videoId, {
      visibility: 'draft',
      publishedBy: FieldValue.delete() as unknown as undefined,
      publishedAt: FieldValue.delete() as unknown as undefined,
    });
  }

  async reprocess(videoId: string): Promise<{ jobId: string }> {
    const v = await this.videos.findById(videoId);
    if (!v) throw new Error('Video not found');
    if (v.deliveryType !== 'processed') throw new Error('Only processed videos support reprocess pipeline');

    await this.videos.update(videoId, {
      status: 'queued' as VideoStatus,
      errorMessage: FieldValue.delete() as unknown as undefined,
    });

    const jobId = await this.jobs.create({
      videoId,
      jobType: 'reprocess',
      status: 'pending',
      attempt: 0,
    });
    return { jobId };
  }

  async retryJob(jobId: string): Promise<void> {
    const job = await this.jobs.findById(jobId);
    if (!job) throw new Error('Job not found');
    if (job.status !== 'failed') throw new Error('Only failed jobs can be retried');

    await this.jobs.update(jobId, {
      status: 'pending',
      errorMessage: FieldValue.delete() as unknown as undefined,
      finishedAt: FieldValue.delete() as unknown as undefined,
      attempt: job.attempt + 1,
    });

    await this.videos.update(job.videoId, {
      status: 'queued',
      errorMessage: FieldValue.delete() as unknown as undefined,
    });
  }

  /** Execute one pipeline job (called from worker). */
  async executeJob(jobId: string): Promise<void> {
    const job = await this.jobs.findById(jobId);
    if (!job || job.status !== 'running') return;

    const video = await this.videos.findById(job.videoId);
    if (!video) throw new Error('Video missing');

    const source = await this.sources.findById(video.sourceId);
    if (!source) throw new Error('Source missing');

    try {
      await this.videos.update(video.videoId, { status: 'downloading', errorMessage: undefined });

      let input: Parameters<typeof runVideoPipeline>[2];
      if (source.sourceType === 'youtube' || source.sourceType === 'manual') {
        if (!source.sourceUrl) throw new Error('sourceUrl missing');
        input = { kind: 'youtube', pageUrl: source.sourceUrl };
      } else if (source.sourceType === 'steam') {
        if (!source.steamAppId) throw new Error('steamAppId missing');
        const { mp4Url } = await fetchSteamTrailerMp4(this.env, source.steamAppId);
        input = { kind: 'steam', mp4Url };
      } else {
        throw new Error(`Unsupported sourceType for pipeline: ${source.sourceType}`);
      }

      await this.videos.update(video.videoId, { status: 'processing' });

      const result = await runVideoPipeline(this.env, video.videoId, input);

      await this.videos.update(video.videoId, {
        status: 'ready',
        durationSec: result.durationSec,
        deliveryType: 'processed',
        thumbnailUrl: result.thumbnailSignedUrl,
        playbackUrl: result.masterSignedUrl,
        signedPlaybackUrl: result.masterSignedUrl,
        signedPlaybackExpiresAt: result.signedPlaybackExpiresAt,
        storagePath: result.storagePrefix,
        variants: result.variants,
        errorMessage: FieldValue.delete() as unknown as undefined,
      });

      await this.jobs.update(jobId, {
        status: 'completed',
        finishedAt: admin.firestore.Timestamp.now(),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.videos.update(video.videoId, {
        status: 'failed',
        errorMessage: msg,
      });
      await this.jobs.update(jobId, {
        status: 'failed',
        finishedAt: admin.firestore.Timestamp.now(),
        errorMessage: msg,
      });
      throw err;
    }
  }
}
