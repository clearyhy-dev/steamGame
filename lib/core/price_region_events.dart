import 'package:flutter/foundation.dart';
import 'dart:async';
import 'app_country_events.dart';
import 'app_country_resolver.dart';

class PriceRegionEvents {
  PriceRegionEvents._();
  static final PriceRegionEvents instance = PriceRegionEvents._();

  ValueNotifier<int> get changed => AppCountryEvents.instance.changed;
  final StreamController<int> _controller = StreamController<int>.broadcast();
  Stream<int> get stream => _controller.stream;

  void notifyChanged() {
    final context = AppCountryResolver.resolveSync();
    AppCountryEvents.instance.notifyChanged(context);
    _controller.add(changed.value);
  }
}
