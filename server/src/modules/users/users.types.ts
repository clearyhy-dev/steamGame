export type AuthProvider = 'google' | 'steam';

export type CountrySource = 'manual' | 'locale' | 'steam' | 'cdn';

export type UserDoc = {
  id: string;
  email?: string;
  passwordHash?: string;
  displayName?: string;
  avatarUrl?: string;
  authProviders: AuthProvider[];
  adminNote?: string;
  disabled?: boolean;

  steamId?: string;
  steamPersonaName?: string;
  steamAvatar?: string;
  steamProfileUrl?: string;
  googleSub?: string;
  countryCode?: string;
  countrySource?: CountrySource;
  countryUpdatedAt?: FirebaseTimestampLike;
  /** 用户未手动切换前的默认国家（手动切换后保留） */
  defaultCountryCode?: string;

  registeredAt?: FirebaseTimestampLike;

  /** Pro subscription valid until (epoch ms); synced from app IAP / share reward. */
  proUntilMs?: number;

  createdAt: FirebaseTimestampLike;
  updatedAt: FirebaseTimestampLike;
};

// Firestore Timestamp or ISO string. We normalize to Date in services where needed.
export type FirebaseTimestampLike = any;

