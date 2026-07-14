import type { Request, Response } from 'express';
import type { Env } from '../../config/env';
import { sendAdminFail, sendAdminOk } from '../../utils/adminJson';
import { UsersRepository } from '../users/users.repository';
import type { UserDoc } from '../users/users.types';
import { FavoritesPricesService } from '../favorites/favorites-prices.service';
import { FavoritesRepository } from '../favorites/favorites.repository';

function toIso(v: unknown): string | null {
  if (!v) return null;
  try {
    if (typeof (v as { toDate?: () => Date }).toDate === 'function') {
      return (v as { toDate: () => Date }).toDate().toISOString();
    }
    if (v instanceof Date) return v.toISOString();
    if (typeof v === 'string') return v;
  } catch {
    /* ignore */
  }
  return null;
}

function countryLabels(u: UserDoc): {
  countryCode: string | null;
  defaultCountryCode: string | null;
  effectiveCountryCode: string | null;
  countrySource: string | null;
  countrySwitched: boolean;
  countryUpdatedAt: string | null;
} {
  const current = u.countryCode?.trim().toUpperCase() || null;
  const defaultCc =
    u.defaultCountryCode?.trim().toUpperCase() ||
    (u.countrySource !== 'manual' ? current : null);
  const switched = u.countrySource === 'manual' && !!current && !!defaultCc && current !== defaultCc;
  return {
    countryCode: current,
    defaultCountryCode: defaultCc,
    effectiveCountryCode: current ?? defaultCc,
    countrySource: u.countrySource ?? null,
    countrySwitched: switched || (u.countrySource === 'manual' && !!current && !defaultCc),
    countryUpdatedAt: toIso(u.countryUpdatedAt),
  };
}

function serializeUser(u: UserDoc) {
  const country = countryLabels(u);
  return {
    id: u.id,
    email: u.email ?? '',
    displayName: u.displayName ?? '',
    avatarUrl: u.avatarUrl ?? '',
    authProviders: u.authProviders ?? [],
    steamId: u.steamId ?? null,
    steamPersonaName: u.steamPersonaName ?? null,
    steamAvatar: u.steamAvatar ?? null,
    steamProfileUrl: u.steamProfileUrl ?? null,
    adminNote: u.adminNote ?? '',
    disabled: !!u.disabled,
    registeredAt: toIso(u.registeredAt) ?? toIso(u.createdAt),
    createdAt: toIso(u.createdAt),
    updatedAt: toIso(u.updatedAt),
    ...country,
  };
}

export class AdminUsersController {
  private favoritesPrices: FavoritesPricesService;
  private favorites = new FavoritesRepository();

  constructor(
    private _env: Env,
    private users = new UsersRepository(),
  ) {
    this.favoritesPrices = new FavoritesPricesService(_env);
  }

  list = async (req: Request, res: Response): Promise<void> => {
    const providerRaw = String(req.query.provider ?? '').trim();
    const provider = providerRaw === 'google' || providerRaw === 'steam' ? providerRaw : undefined;
    const keyword = String(req.query.keyword ?? '').trim() || undefined;
    const rows = await this.users.listUsers({ provider, keyword });
    sendAdminOk(res, rows.map(serializeUser));
  };

  getFavorites = async (req: Request, res: Response): Promise<void> => {
    const userId = String(req.params.userId ?? '').trim();
    if (!userId) {
      sendAdminFail(res, 400, 'userId required');
      return;
    }
    const user = await this.users.findById(userId);
    if (!user) {
      sendAdminFail(res, 404, 'User not found');
      return;
    }
    const countryRaw = String(req.query.country ?? '').trim().toUpperCase();
    const country = countryRaw.length === 2 ? countryRaw : user.countryCode;
    const favs = await this.favorites.listFavorites(userId);
    let priced: Awaited<ReturnType<FavoritesPricesService['listPrices']>> | null = null;
    try {
      priced = await this.favoritesPrices.listPrices(userId, country);
    } catch {
      priced = null;
    }
    const priceByAppid = new Map((priced?.items ?? []).map((x) => [x.appid, x]));
    sendAdminOk(res, {
      userId,
      countryCode: priced?.countryCode ?? country ?? null,
      currency: priced?.currency ?? null,
      country: countryLabels(user),
      items: favs.map((f) => {
        const p = priceByAppid.get(String(f.appid));
        return {
          appid: f.appid,
          name: p?.name ?? f.name ?? f.appid,
          headerImage: f.headerImage ?? '',
          source: f.source,
          createdAt: toIso(f.createdAt),
          discountPercent: p?.discountPercent ?? null,
          currency: p?.currency ?? priced?.currency ?? null,
          priceSummary: p?.priceSummary ?? null,
          priceSyncedAtMs: p?.syncedAt ?? null,
        };
      }),
    });
  };

  patch = async (req: Request, res: Response): Promise<void> => {
    const userId = String(req.params.userId ?? '').trim();
    if (!userId) {
      sendAdminFail(res, 400, 'userId required');
      return;
    }
    const existing = await this.users.findById(userId);
    if (!existing) {
      sendAdminFail(res, 404, 'User not found');
      return;
    }

    const b = req.body ?? {};
    const patch: Partial<UserDoc> = {};
    if (typeof b.displayName === 'string') patch.displayName = b.displayName.trim();
    if (typeof b.email === 'string') patch.email = b.email.trim();
    if (typeof b.adminNote === 'string') patch.adminNote = b.adminNote.trim();
    if (typeof b.disabled === 'boolean') patch.disabled = b.disabled;

    if (typeof b.unbindSteam === 'boolean' && b.unbindSteam) {
      patch.steamId = '';
      patch.steamPersonaName = '';
      patch.steamAvatar = '';
      patch.steamProfileUrl = '';
      patch.authProviders = (existing.authProviders ?? []).filter((p) => p !== 'steam');
    }

    if (typeof b.registeredAt === 'string') {
      const raw = b.registeredAt.trim();
      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) {
        sendAdminFail(res, 400, 'registeredAt must be a valid datetime string');
        return;
      }
      patch.registeredAt = d as UserDoc['registeredAt'];
    }

    if (Object.keys(patch).length === 0) {
      sendAdminFail(res, 400, 'No patch fields');
      return;
    }

    await this.users.updateUser(userId, patch);
    sendAdminOk(res, { userId });
  };
}
