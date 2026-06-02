/**

 * 将已有详情的 game_catalog 预告片（含封面）回填到 videos / video_sources。

 *

 * 用法（在 server 目录）:

 *   npx ts-node scripts/backfill-steam-trailers-to-videos.ts

 *   npx ts-node scripts/backfill-steam-trailers-to-videos.ts --limit 500 --offset 0

 *   npx ts-node scripts/backfill-steam-trailers-to-videos.ts --fetch-steam

 *

 * 需要 server/.env：DATA_STORE=vultr_sqlite、SQLITE_API_URL、SQLITE_API_SECRET、STEAM_API_KEY（可选）

 */

import 'dotenv/config';

import { loadEnv } from '../src/config/env';

import { GameCatalogRepository } from '../src/modules/game/game-catalog.repository';

import { VideoRepository } from '../src/modules/video/video.repository';

import { VideoSourceRepository } from '../src/modules/video/video-source.repository';

import {

  extractTrailerClipsFromCatalog,

  upsertSteamTrailersAsVideos,

} from '../src/modules/video/sync-steam-trailers-to-videos.service';

import { fetchSteamTrailerMp4 } from '../src/modules/video/steam-trailer.util';

import { SteamStoreService } from '../src/modules/steam/steam-store.service';

import { mergeTrailerClips, type SteamTrailerClip } from '../src/modules/steam/steam-trailers.parse';

import { sqlAll } from '../src/storage/sqlite/sql-client';



function argFlag(name: string): boolean {

  return process.argv.includes(`--${name}`);

}



function argNum(name: string, fallback: number): number {

  const i = process.argv.indexOf(`--${name}`);

  if (i < 0 || i + 1 >= process.argv.length) return fallback;

  const n = Number(process.argv[i + 1]);

  return Number.isFinite(n) ? n : fallback;

}



async function mergeTrailerClipsForApp(

  env: ReturnType<typeof loadEnv>,

  store: SteamStoreService,

  appid: string,

  storeClips: SteamTrailerClip[],

  fetchSteam: boolean,

): Promise<SteamTrailerClip[]> {

  let clips = [...storeClips];

  if (fetchSteam || clips.length === 0) {

    try {

      const fresh = await store.fetchAppDetails(appid);

      if (fresh?.trailerClips?.length) {

        clips = mergeTrailerClips([...fresh.trailerClips, ...clips]);

      } else if (fresh?.trailerUrls?.length) {

        const thumbs = fresh.trailerThumbnailUrls ?? [];

        clips = mergeTrailerClips([

          ...fresh.trailerUrls.map((url, i) => ({ url, thumbnailUrl: thumbs[i] || undefined })),

          ...clips,

        ]);

      }

    } catch {

      /* ignore */

    }

    if (clips.length === 0) {

      try {

        const t = await fetchSteamTrailerMp4(env, appid);

        if (t.mp4Url) clips = [{ url: t.mp4Url, thumbnailUrl: t.thumbnailUrl }];

      } catch {

        /* no trailer on store */

      }

    }

  }

  return mergeTrailerClips(clips);

}



async function main(): Promise<void> {

  const env = loadEnv();

  if (env.dataStore !== 'vultr_sqlite') {

    console.error('DATA_STORE must be vultr_sqlite');

    process.exit(1);

  }



  const limit = Math.max(1, argNum('limit', 50_000));

  const offset = Math.max(0, argNum('offset', 0));

  const batchSize = Math.max(1, Math.min(argNum('batch', 50), 200));

  const fetchSteam = argFlag('fetch-steam');

  const onlyWithUrls = !argFlag('fetch-all');

  const delayMs = Math.max(0, argNum('delay-ms', 120));



  const catalog = new GameCatalogRepository();

  const store = new SteamStoreService(env);

  const videos = new VideoRepository();

  const sources = new VideoSourceRepository();



  const urlFilter = onlyWithUrls

    ? ` AND (data_json LIKE '%/movie/%' OR data_json LIKE '%.mp4%' OR data_json LIKE '%.webm%')`

    : '';



  const rows = await sqlAll<{ appid: string; name: string; data_json: string }>(

    `SELECT appid, name, data_json FROM game_catalog

     WHERE (detail_synced = 1 OR last_detail_sync_at_ms > 0)

       AND (json_extract(data_json, '$.detailUnavailable') IS NULL OR json_extract(data_json, '$.detailUnavailable') = 0)${urlFilter}

     ORDER BY CAST(appid AS INTEGER) ASC

     LIMIT ? OFFSET ?`,

    [limit, offset],

  );



  console.log(`Candidates: ${rows.length} (offset=${offset} limit=${limit} fetchSteam=${fetchSteam})`);



  let processed = 0;

  let videosCreated = 0;

  let noUrls = 0;

  let errors = 0;



  for (let i = 0; i < rows.length; i += batchSize) {

    const chunk = rows.slice(i, i + batchSize);

    for (const row of chunk) {

      const appid = String(row.appid ?? '').trim();

      if (!appid) continue;

      try {

        const doc = await catalog.getByAppid(appid);

        const name = doc?.name ?? row.name ?? `App ${appid}`;

        let clips = extractTrailerClipsFromCatalog(doc, row.data_json);

        if (!onlyWithUrls || clips.length === 0) {

          clips = await mergeTrailerClipsForApp(env, store, appid, clips, fetchSteam && !onlyWithUrls);

        }

        if (clips.length === 0) {

          noUrls++;

          processed++;

          continue;

        }

        const n = await upsertSteamTrailersAsVideos(videos, sources, appid, name, clips, {

          headerImageFallback: doc?.headerImage,

        });

        videosCreated += n;

        processed++;

        if (n > 0) console.log(`  appid=${appid} +${n} video(s)`);

      } catch (e) {

        errors++;

        console.warn(`  appid=${appid} err=${e instanceof Error ? e.message : String(e)}`);

      }

      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));

    }

    console.log(`Progress ${Math.min(i + batchSize, rows.length)}/${rows.length} videosCreated=${videosCreated}`);

  }



  const countRow = await sqlAll<{ n: number }>('SELECT COUNT(*) AS n FROM videos', []);

  console.log(

    `\nDone processed=${processed} videosCreated=${videosCreated} noUrls=${noUrls} errors=${errors} videos_table=${countRow[0]?.n ?? '?'}`,

  );

}



main().catch((e) => {

  console.error(e);

  process.exit(1);

});


