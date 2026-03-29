export type StatsSummaryResponse = {
  steamLinked: boolean;
  ownedCount: number;
  totalPlaytimeMinutes: number;
  unplayedRatio: number;
  recentGames: { appid: string; name: string }[];
  topPlayed: { appid: string; name: string; playtimeMinutes: number }[];
  favoriteGenres: string[];
};

export type ShareCardResponse = {
  title: string;
  subtitle: string;
  stats: {
    totalGames: number;
    hoursPlayed: number;
    favoriteGenre: string;
    collectionNote: string;
  };
};
