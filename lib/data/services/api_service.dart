import '../../models/game_model.dart';
import '../../services/steam_api_service.dart';

/// 数据层：只负责接口，页面不直接调 SteamApiService
class ApiService {
  static final _api = SteamApiService();

  static Future<List<GameModel>> fetchDeals(
      {int pageSize = 60, int pageNumber = 0, String? country}) async {
    return _api.fetchDeals(
        pageSize: pageSize, pageNumber: pageNumber, country: country);
  }

  static Future<GameModel> fetchGameById(String dealId,
      {String? country}) async {
    return _api.fetchGameById(dealId, country: country);
  }

  static Future<List<GameModel>> searchGames(String title,
      {int pageSize = 20, String? country}) async {
    return _api.searchGames(title, pageSize: pageSize, country: country);
  }
}
