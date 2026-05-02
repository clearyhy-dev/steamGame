import 'package:flutter/material.dart';
import '../../core/navigation/game_detail_navigation.dart';
import 'game_detail_page.dart';
import '../../models/game_model.dart';

/// 详情页：大封面、价格、评论（详情内）、Banner
class DetailPage extends StatelessWidget {
  final String appId;
  final GameModel? initialGame;

  const DetailPage({super.key, required this.appId, this.initialGame});

  @override
  Widget build(BuildContext context) {
    if (initialGame != null) {
      return GameDetailPage(game: initialGame!);
    }
    return GameDetailPage(game: buildStubGameForDetail(appId));
  }
}
