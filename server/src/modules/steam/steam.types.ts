export type PersonaState = {
  state: number;
  label: string;
};

export type SteamPlayerSummary = {
  steamId: string;
  personaName: string;
  avatar: string;
  avatarFull: string;
  profileUrl: string;
  countryCode?: string;
  personaState?: number;
  gameId?: string;
  gameExtrainfo?: string;
};

export type SteamFriendStatus = {
  steamId: string;
  personaName: string;
  avatar: string;
  profileUrl?: string;
  personaState: number;
  personaLabel: string;
  gameId?: string;
  gameExtrainfo?: string;
};

export type SteamGame = {
  appid: string;
  name: string;
  headerImage?: string;
  source?: 'owned' | 'recent';
  /** GetOwnedGames: playtime_forever，单位：分钟 */
  playtimeForever?: number;
};

export type SteamOwnedGamesCache = {
  ownerSteamId: string;
  games: SteamGame[];
  gameCount: number;
  lastFetchedAt: FirebaseTimestampLike;
};

export type SteamRecentGamesCache = {
  ownerSteamId: string;
  games: SteamGame[];
  totalCount: number;
  lastFetchedAt: FirebaseTimestampLike;
};

export type SteamFriendsCache = {
  ownerSteamId: string;
  friends: SteamFriendStatus[];
  lastFetchedAt: FirebaseTimestampLike;
};

export type SteamProfileDoc = {
  steamId: string;
  personaName: string;
  realName?: string;
  avatar?: string;
  avatarFull?: string;
  profileUrl?: string;
  countryCode?: string;
  timeCreated?: number;
  lastFetchedAt: FirebaseTimestampLike;
  linkedUserId?: string;
};

export type FirebaseTimestampLike = any;

