import type { Response } from 'express';

export type ApiSuccess<T> = {
  success: true;
  data: T;
};

export type ApiFailure = {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

export function sendSuccess<T>(res: Response, data: T) {
  res.status(200).json({ success: true, data } satisfies ApiSuccess<T>);
}

