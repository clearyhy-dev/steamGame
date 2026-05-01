import type {
  VideoDoc,
  VideoJobDoc,
  VideoJson,
  VideoJobJson,
  VideoSourceDoc,
  VideoSourceJson,
} from './video.types';
import { tsToIso } from './firestoreSerialize';

export function serializeVideoSource(doc: VideoSourceDoc): VideoSourceJson {
  return {
    ...doc,
    createdAt: tsToIso(doc.createdAt),
    updatedAt: tsToIso(doc.updatedAt),
  };
}

export function serializeVideo(doc: VideoDoc): VideoJson {
  return {
    ...doc,
    createdAt: tsToIso(doc.createdAt),
    updatedAt: tsToIso(doc.updatedAt),
    signedPlaybackExpiresAt: tsToIso(doc.signedPlaybackExpiresAt ?? null),
  };
}

export function serializeVideoJob(doc: VideoJobDoc): VideoJobJson {
  return {
    ...doc,
    createdAt: tsToIso(doc.createdAt),
    startedAt: tsToIso(doc.startedAt ?? null),
    finishedAt: tsToIso(doc.finishedAt ?? null),
  };
}

export function publicVideoSummary(doc: VideoDoc): Pick<
  VideoJson,
  | 'videoId'
  | 'title'
  | 'gameId'
  | 'thumbnailUrl'
  | 'durationSec'
  | 'visibility'
  | 'deliveryType'
  | 'createdAt'
> {
  const v = serializeVideo(doc);
  return {
    videoId: v.videoId,
    title: v.title,
    gameId: v.gameId,
    thumbnailUrl: v.thumbnailUrl,
    durationSec: v.durationSec,
    visibility: v.visibility,
    deliveryType: v.deliveryType,
    createdAt: v.createdAt,
  };
}
