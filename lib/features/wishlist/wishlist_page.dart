import 'package:flutter/material.dart';
import '../../screens/wishlist_screen.dart';

/// 愿望单页
class WishlistPage extends StatelessWidget {
  final int currentTabIndex;

  const WishlistPage({super.key, this.currentTabIndex = 3});

  @override
  Widget build(BuildContext context) {
    return WishlistScreen(currentTabIndex: currentTabIndex);
  }
}
