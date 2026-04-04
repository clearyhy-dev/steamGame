import 'dart:io' show Platform;

import 'package:flutter/foundation.dart';

/// AdMob 单元 ID（与 [MobileAds.instance.initialize] 配合使用）。
class AdConfig {
  AdConfig._();

  /// Explore 信息流 Native（你提供的正式单元）。
  static const String exploreNativeAndroid = 'ca-app-pub-7015260886566088/7676954893';

  /// iOS 需在 AdMob 为同一应用创建原生单元后替换；未配置前用 Google 测试 ID。
  static const String exploreNativeIos = 'ca-app-pub-3940256099942544/3986624511';

  static String get exploreNativeAdUnitId =>
      Platform.isAndroid ? exploreNativeAndroid : exploreNativeIos;

  /// 插屏：未单独提供单元时使用 Google 测试 ID；上线请替换为正式插屏单元。
  static const String interstitialAndroidTest = 'ca-app-pub-3940256099942544/1033173712';
  static const String interstitialIosTest = 'ca-app-pub-3940256099942544/4411468910';

  static String get interstitialAdUnitId =>
      Platform.isAndroid ? interstitialAndroidTest : interstitialIosTest;

  /// 预留：远程开关可置 false。
  static bool get adsEnabledByPolicy => true;
}
