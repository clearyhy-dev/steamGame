import 'package:flutter/foundation.dart';
import 'dart:async';

class PriceRegionEvents {
  PriceRegionEvents._();
  static final PriceRegionEvents instance = PriceRegionEvents._();

  final ValueNotifier<int> changed = ValueNotifier<int>(0);
  final StreamController<int> _controller = StreamController<int>.broadcast();
  Stream<int> get stream => _controller.stream;

  void notifyChanged() {
    changed.value = changed.value + 1;
    _controller.add(changed.value);
  }
}
