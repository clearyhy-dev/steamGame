import type { Timestamp } from 'firebase-admin/firestore';

export type SourceType = 'youtube' | 'steam' | 'manual';
export type IngestMode = 'embed' | 'process';
export type VideoStatus =
  | 'queued'
  | 'downloading'
  | 'processing'
  | 'ready'
  | 'failed'
  | 'disabled';
export type Visibility = 'draft' | 'public' | 'private';
export type DeliveryType = 'embed' | 'processed';

export type VideoVariant = {
  name: string;
  storagePath?: string;
  signedUrl?: string;
};

export interface VideoSourceDoc {
  sourceId: string;
  gameId: string;
  steamAppId?: string;
  sourceType: SourceType;
  title: string;
  sourceUrl?: string;
  ingestMode: IngestMode;
  enabled: boolean;
  priority: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface VideoDoc {
  videoId: string;
  sourceId: string;
  gameId: string;
  steamAppId?: string;
  sourceType: SourceType;
  title: string;
  status: VideoStatus;
  visibility: Visibility;
  durationSec?: number;
  deliveryType: DeliveryType;
  thumbnailUrl?: string;
  playbackUrl?: string;
  signedPlaybackUrl?: string;
  signedPlaybackExpiresAt?: Timestamp;
  storagePath?: string;
  variants?: VideoVariant[];
  tags?: string[];
  errorMessage?: string;
  gameName?: string;
  publishedBy?: string;
  publishedAt?: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type JobType = 'ingest' | 'reprocess';
export type JobStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface VideoJobDoc {
  jobId: string;
  videoId: string;
  jobType: JobType;
  status: JobStatus;
  attempt: number;
  startedAt?: Timestamp;
  finishedAt?: Timestamp;
  errorMessage?: string;
  createdAt: Timestamp;
}

/** JSON shapes returned to admin / public API */
export type VideoSourceJson = Omit<VideoSourceDoc, 'createdAt' | 'updatedAt'> & {
  createdAt: string | null;
  updatedAt: string | null;
};

export type VideoJson = Omit<
  VideoDoc,
  'createdAt' | 'updatedAt' | 'signedPlaybackExpiresAt'
> & {
  createdAt: string | null;
  updatedAt: string | null;
  signedPlaybackExpiresAt?: string | null;
};

export type VideoJobJson = Omit<VideoJobDoc, 'createdAt' | 'startedAt' | 'finishedAt'> & {
  createdAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
};
