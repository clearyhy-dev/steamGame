/// 当前在线人数缓存：详情页/发现页拉取后写入，供 AI 评分公式读取
/// 键为 steamAppID，值为 Steam API GetNumberOfCurrentPlayers 返回的人数
class CurrentPlayersCache {
  CurrentPlayersCache._();

  static final Map<String, int> _map = {};

  static int? get(String steamAppID) {
    if (steamAppID.isEmpty) return null;
    return _map[steamAppID];
  }

  static void set(String steamAppID, int count) {
    if (steamAppID.isEmpty) return;
    _map[steamAppID] = count;
  }

  static void clear() => _map.clear();
}
