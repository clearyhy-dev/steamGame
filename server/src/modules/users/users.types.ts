export type AuthProvider = 'google' | 'steam';

export type UserDoc = {
  id: string;
  email?: string;
  passwordHash?: string;
  displayName?: string;
  avatarUrl?: string;
  authProviders: AuthProvider[];

  steamId?: string;
  steamPersonaName?: string;
  steamAvatar?: string;
  steamProfileUrl?: string;

  createdAt: FirebaseTimestampLike;
  updatedAt: FirebaseTimestampLike;
};

// Firestore Timestamp or ISO string. We normalize to Date in services where needed.
export type FirebaseTimestampLike = any;

