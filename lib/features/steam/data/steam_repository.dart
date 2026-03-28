import '../../../core/network/api_client.dart';
import 'models/steam_friend_model.dart';
import 'models/steam_game_model.dart';
import 'models/steam_profile_model.dart';
import 'steam_api.dart';

class SteamRepository {
  SteamRepository({ApiClient? client}) : _api = SteamApi(client ?? ApiClient());
  final SteamApi _api;

  Future<SteamProfileModel> getProfile() async {
    final data = await _api.steamProfile();
    return SteamProfileModel.fromJson(data);
  }

  Future<List<SteamFriendModel>> getFriendsStatus() async {
    final data = await _api.steamFriendsStatus();
    final list = (data['friends'] as List? ?? []);
    return list.whereType<Map>().map((e) => SteamFriendModel.fromJson(e.cast<String, dynamic>())).toList();
  }

  Future<List<SteamGameModel>> getOwnedGames() async {
    final data = await _api.steamOwnedGames();
    final list = (data['games'] as List? ?? []);
    return list
        .whereType<Map>()
        .map((e) => SteamGameModel.fromJson(e.cast<String, dynamic>(), source: 'owned'))
        .toList();
  }

  Future<List<SteamGameModel>> getRecentGames() async {
    final data = await _api.steamRecentGames();
    final list = (data['games'] as List? ?? []);
    return list
        .whereType<Map>()
        .map((e) => SteamGameModel.fromJson(e.cast<String, dynamic>(), source: 'recent'))
        .toList();
  }

  Future<List<SteamGameModel>> getFavorites() async {
    final data = await _api.favorites();
    final list = (data['favorites'] as List? ?? []);
    return list
        .whereType<Map>()
        .map((e) => SteamGameModel(
              appid: e['appid']?.toString() ?? '',
              name: e['name']?.toString() ?? '',
              headerImage: e['headerImage']?.toString() ?? '',
              source: e['source']?.toString() ?? 'manual',
            ))
        .toList();
  }

  Future<void> addFavorite(SteamGameModel game) async {
    await _api.addFavorite({
      'appid': game.appid,
      'name': game.name,
      'headerImage': game.headerImage,
      'source': game.source,
    });
  }

  Future<void> removeFavorite(String appid) async {
    await _api.removeFavorite(appid);
  }

  Future<void> sync() async {
    await _api.steamSync();
  }
}

