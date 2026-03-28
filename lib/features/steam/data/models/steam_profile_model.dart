class SteamProfileModel {
  final String steamId;
  final String personaName;
  final String avatar;
  final String profileUrl;

  const SteamProfileModel({
    required this.steamId,
    required this.personaName,
    required this.avatar,
    required this.profileUrl,
  });

  factory SteamProfileModel.fromJson(Map<String, dynamic> json) {
    return SteamProfileModel(
      steamId: json['steamId']?.toString() ?? '',
      personaName: json['personaName']?.toString() ?? '',
      avatar: json['avatar']?.toString() ?? '',
      profileUrl: json['profileUrl']?.toString() ?? '',
    );
  }
}

