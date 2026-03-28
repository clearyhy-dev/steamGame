class SteamGameModel {
  final String appid;
  final String name;
  final String headerImage;
  final String source;

  const SteamGameModel({
    required this.appid,
    required this.name,
    required this.headerImage,
    required this.source,
  });

  factory SteamGameModel.fromJson(Map<String, dynamic> json, {required String source}) {
    return SteamGameModel(
      appid: json['appid']?.toString() ?? '',
      name: json['name']?.toString() ?? '',
      headerImage: json['headerImage']?.toString() ?? '',
      source: source,
    );
  }
}

