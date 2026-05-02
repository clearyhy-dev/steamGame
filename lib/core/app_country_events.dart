import 'dart:async';

import 'package:flutter/foundation.dart';

import 'app_country_resolver.dart';

class AppCountryEvents {
  AppCountryEvents._();
  static final AppCountryEvents instance = AppCountryEvents._();

  final ValueNotifier<int> changed = ValueNotifier<int>(0);
  final StreamController<AppCountryContext> _controller =
      StreamController<AppCountryContext>.broadcast();

  Stream<AppCountryContext> get stream => _controller.stream;

  void notifyChanged(AppCountryContext context) {
    changed.value = changed.value + 1;
    _controller.add(context);
  }
}
