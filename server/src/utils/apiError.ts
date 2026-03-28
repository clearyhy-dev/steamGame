export type ApiErrorCode =
  | 'UNAUTHORIZED'
  | 'STEAM_NOT_BOUND'
  | 'STEAM_LOGIN_FAILED'
  | 'STEAM_ALREADY_BOUND'
  | 'STEAM_FRIENDS_PRIVATE'
  | 'STEAM_OWNED_UNAVAILABLE'
  | 'STEAM_API_TIMEOUT'
  | 'JWT_INVALID'
  | 'FIRESTORE_WRITE_FAILED'
  | 'BAD_REQUEST'
  | 'INTERNAL_ERROR';

export class ApiError extends Error {
  statusCode: number;
  code: ApiErrorCode;
  details?: unknown;

  constructor(statusCode: number, code: ApiErrorCode, message: string, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

