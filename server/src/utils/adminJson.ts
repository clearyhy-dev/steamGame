import type { Response } from 'express';

export type AdminOk<T> = { ok: true; data: T; message: string | null };
export type AdminFail = { ok: false; data: null; message: string };

export function sendAdminOk<T>(res: Response, data: T, message?: string | null, status = 200) {
  const body: AdminOk<T> = { ok: true, data, message: message ?? null };
  res.status(status).json(body);
}

export function sendAdminFail(res: Response, status: number, message: string) {
  const body: AdminFail = { ok: false, data: null, message };
  res.status(status).json(body);
}
