import type { Env } from '../../config/env';
import { FavoritesRepository } from './favorites.repository';
import type { FavoriteGame } from './favorites.types';
import { ApiError } from '../../utils/apiError';

export class FavoritesService {
  private repo = new FavoritesRepository();

  constructor(_env: Env) {}

  async list(userId: string): Promise<FavoriteGame[]> {
    return this.repo.listFavorites(userId);
  }

  async add(userId: string, input: Omit<FavoriteGame, 'createdAt'>): Promise<void> {
    const appid = String(input.appid ?? '').trim();
    const name = String(input.name ?? '').trim();
    if (!appid) throw new ApiError(400, 'BAD_REQUEST', 'Missing appid');
    if (!name) throw new ApiError(400, 'BAD_REQUEST', 'Missing name');
    if (!input.source) throw new ApiError(400, 'BAD_REQUEST', 'Missing source');

    await this.repo.addFavorite(userId, {
      appid,
      name,
      headerImage: input.headerImage ?? '',
      source: input.source,
    });
  }

  async remove(userId: string, appid: string): Promise<void> {
    const id = String(appid ?? '').trim();
    if (!id) throw new ApiError(400, 'BAD_REQUEST', 'Missing appid');
    await this.repo.deleteFavorite(userId, id);
  }
}

