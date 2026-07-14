import type { Env } from '../../config/env';
import { FavoritesRepository } from './favorites.repository';
import type { FavoriteGame } from './favorites.types';
import { ApiError } from '../../utils/apiError';
import { FavoritesBaselineService } from './favorites-baseline.service';
import { UsersRepository } from '../users/users.repository';

export class FavoritesService {
  private repo = new FavoritesRepository();
  private baseline: FavoritesBaselineService;
  private users = new UsersRepository();

  constructor(private env: Env) {
    this.baseline = new FavoritesBaselineService(env);
  }

  async list(userId: string): Promise<FavoriteGame[]> {
    return this.repo.listFavorites(userId);
  }

  async add(userId: string, input: Omit<FavoriteGame, 'createdAt'>): Promise<void> {
    const appid = String(input.appid ?? '').trim();
    const name = String(input.name ?? '').trim();
    if (!appid) throw new ApiError(400, 'BAD_REQUEST', 'Missing appid');
    if (!name) throw new ApiError(400, 'BAD_REQUEST', 'Missing name');
    if (!input.source) throw new ApiError(400, 'BAD_REQUEST', 'Missing source');

    const user = await this.users.findById(userId);
    const cc = String(user?.countryCode ?? 'US').trim().toUpperCase();
    const baselinePrices =
      input.baselinePrices ?? (await this.baseline.captureForApp(cc, appid)) ?? undefined;

    await this.repo.addFavorite(userId, {
      appid,
      name,
      headerImage: input.headerImage ?? '',
      source: input.source,
      baselinePrices,
      emailAlertsEnabled: input.emailAlertsEnabled ?? true,
    });
  }

  async remove(userId: string, appid: string): Promise<void> {
    const id = String(appid ?? '').trim();
    if (!id) throw new ApiError(400, 'BAD_REQUEST', 'Missing appid');
    await this.repo.deleteFavorite(userId, id);
  }

  async migrateBatch(
    userId: string,
    items: Array<{ appid: string; name: string; headerImage?: string; source?: FavoriteGame['source'] }>,
  ): Promise<{ added: number; skipped: number }> {
    const existing = await this.repo.listFavorites(userId);
    const existingSet = new Set(existing.map((f) => f.appid));
    const user = await this.users.findById(userId);
    const cc = String(user?.countryCode ?? 'US').trim().toUpperCase();
    let added = 0;
    let skipped = 0;
    for (const item of items.slice(0, 500)) {
      const appid = String(item.appid ?? '').trim();
      const name = String(item.name ?? '').trim();
      if (!appid || !name) {
        skipped++;
        continue;
      }
      if (existingSet.has(appid)) {
        skipped++;
        continue;
      }
      const baselinePrices = await this.baseline.captureForApp(cc, appid);
      await this.repo.addFavorite(userId, {
        appid,
        name,
        headerImage: item.headerImage ?? '',
        source: item.source ?? 'manual',
        baselinePrices: baselinePrices ?? undefined,
        emailAlertsEnabled: true,
      });
      existingSet.add(appid);
      added++;
    }
    return { added, skipped };
  }
}

