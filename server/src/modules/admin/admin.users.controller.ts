import type { Request, Response } from 'express';
import type { Env } from '../../config/env';
import { sendAdminFail, sendAdminOk } from '../../utils/adminJson';
import { UsersRepository } from '../users/users.repository';
import type { UserDoc } from '../users/users.types';

function toIso(v: any): string | null {
  if (!v) return null;
  try {
    if (typeof v.toDate === 'function') return v.toDate().toISOString();
    if (v instanceof Date) return v.toISOString();
    if (typeof v === 'string') return v;
  } catch (_) {}
  return null;
}

function serializeUser(u: UserDoc) {
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
    registeredAt: toIso((u as any).registeredAt) ?? toIso((u as any).createdAt),
    createdAt: toIso((u as any).createdAt),
    updatedAt: toIso((u as any).updatedAt),
  };
}

export class AdminUsersController {
  constructor(
    private _env: Env,
    private users = new UsersRepository(),
  ) {}

  list = async (req: Request, res: Response): Promise<void> => {
    const providerRaw = String(req.query.provider ?? '').trim();
    const provider = providerRaw === 'google' || providerRaw === 'steam' ? providerRaw : undefined;
    const keyword = String(req.query.keyword ?? '').trim() || undefined;
    const rows = await this.users.listUsers({ provider, keyword });
    sendAdminOk(res, rows.map(serializeUser));
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
      patch.registeredAt = d as any;
    }

    if (Object.keys(patch).length === 0) {
      sendAdminFail(res, 400, 'No patch fields');
      return;
    }

    await this.users.updateUser(userId, patch);
    sendAdminOk(res, { userId });
  };
}

