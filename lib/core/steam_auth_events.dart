import 'dart:async';

class SteamAuthSuccessPayload {
  final String token;
  final String steamId;
  final String personaName;
  final String avatar;
  final String profileUrl;

  const SteamAuthSuccessPayload({
    required this.token,
    required this.steamId,
    required this.personaName,
    required this.avatar,
    required this.profileUrl,
  });
}

/// 用于在深链路回跳后通知前端刷新 Steam 绑定状态。
class SteamAuthEvents {
  SteamAuthEvents._();

  static final SteamAuthEvents instance = SteamAuthEvents._();

  final _controller = StreamController<SteamAuthSuccessPayload>.broadcast();

  Stream<SteamAuthSuccessPayload> get stream => _controller.stream;

  void emitSuccess(SteamAuthSuccessPayload payload) => _controller.add(payload);
}

