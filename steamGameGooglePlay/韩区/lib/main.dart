import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';

import 'app.dart';
import 'services/storage_service.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  try {
    await Firebase.initializeApp();
  } catch (_) {
    // 未配置 Firebase 时仍可运行，uid 将使用本地 UUID
  }
  await StorageService.init();
  runApp(const MatchMuseApp());
}
