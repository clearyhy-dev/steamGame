import 'package:flutter/material.dart';

import '../../core/models/game.dart';
import '../../features/detail/game_detail_page.dart';

GameModel buildStubGameForDetail(String appid) {
  final id = appid.trim();
  return GameModel(
    appId: id,
    steamAppID: id,
    name: 'Game #$id',
    image: '',
    price: 0,
    originalPrice: 0,
    discount: 0,
  );
}

Route<void> gameDetailRouteByAppId(String appid) {
  final game = buildStubGameForDetail(appid);
  return MaterialPageRoute<void>(builder: (_) => GameDetailPage(game: game));
}
