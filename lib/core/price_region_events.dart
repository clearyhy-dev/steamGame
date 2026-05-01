import 'package:flutter/foundation.dart';

class PriceRegionEvents {
  PriceRegionEvents._();
  static final PriceRegionEvents instance = PriceRegionEvents._();

  final ValueNotifier<int> changed = ValueNotifier<int>(0);

  void notifyChanged() {
    changed.value = changed.value + 1;
  }
}
