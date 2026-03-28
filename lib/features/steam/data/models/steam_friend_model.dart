class SteamFriendModel {
  final String steamId;
  final String personaName;
  final String avatar;
  final String personaLabel;
  final String currentGame;

  const SteamFriendModel({
    required this.steamId,
    required this.personaName,
    required this.avatar,
    required this.personaLabel,
    required this.currentGame,
  });

  factory SteamFriendModel.fromJson(Map<String, dynamic> json) {
    return SteamFriendModel(
      steamId: json['steamId']?.toString() ?? '',
      personaName: json['personaName']?.toString() ?? '',
      avatar: json['avatar']?.toString() ?? '',
      personaLabel: json['personaLabel']?.toString() ?? '',
      currentGame: json['gameExtrainfo']?.toString() ?? '',
    );
  }
}

