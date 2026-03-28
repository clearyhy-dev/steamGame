import '../../../core/network/api_client.dart';

class SteamApi {
  SteamApi(this._client);
  final ApiClient _client;

  Future<Map<String, dynamic>> me() => _client.get('/api/me');
  Future<Map<String, dynamic>> steamProfile() => _client.get('/api/me/steam-profile');
  Future<Map<String, dynamic>> steamFriendsStatus() => _client.get('/api/steam/friends/status');
  Future<Map<String, dynamic>> steamOwnedGames() => _client.get('/api/steam/games/owned');
  Future<Map<String, dynamic>> steamRecentGames() => _client.get('/api/steam/games/recent');
  Future<Map<String, dynamic>> steamSync() => _client.post('/api/steam/sync');

  Future<Map<String, dynamic>> favorites() => _client.get('/api/favorites');
  Future<Map<String, dynamic>> addFavorite(Map<String, dynamic> body) => _client.post('/api/favorites', body: body);
  Future<Map<String, dynamic>> removeFavorite(String appid) => _client.delete('/api/favorites/$appid');
}

