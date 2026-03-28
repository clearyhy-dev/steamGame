export type FavoriteSource = 'owned' | 'recent' | 'manual';

export type FavoriteGame = {
  appid: string;
  name: string;
  headerImage?: string;
  source: FavoriteSource;
  createdAt?: FirebaseTimestampLike;
};

export type FirebaseTimestampLike = any;

