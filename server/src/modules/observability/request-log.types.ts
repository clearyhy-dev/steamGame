export type ApiRequestLogDoc = {
  logId?: string;
  requestId: string;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  userId?: string;
  ip?: string;
  userAgent?: string;
  referer?: string;
  query?: Record<string, string>;
  bodyKeys?: string[];
  errorCode?: string;
  createdAt: Date;
};

export type ListRequestLogsInput = {
  userId?: string;
  pathPrefix?: string;
  method?: string;
  statusCode?: number;
  fromMs?: number;
  toMs?: number;
  limit?: number;
};
