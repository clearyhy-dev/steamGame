import type { RequestHandler } from 'express';

export function asyncHandler(fn: (args: any, res: any, next: any) => Promise<any>): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

