import 'dart:convert';

import 'package:http/http.dart' as http;

import '../app_remote_config.dart';
import '../constants/api_constants.dart';

/// 不带 JWT：由边缘/代理注入头推断的请求国别 guess（服务端 [PublicConfigController.getClientRegion]）。
class ClientRegionClient {
  ClientRegionClient._();

  static Future<String?> fetchGuess() async {
    try {
      final base = AppRemoteConfig.instance
          .resolveApiBase(ApiConstants.baseUrl)
          .trim();
      final root = base.endsWith('/') ? base.substring(0, base.length - 1) : base;
      final uri = Uri.parse('$root/v1/config/client-region');
      final res = await http
          .get(uri)
          .timeout(const Duration(seconds: 6));
      if (res.statusCode != 200) return null;
      final map = jsonDecode(res.body) as Map<String, dynamic>?;
      if (map == null) return null;
      dynamic data = map['data'];
      if (data is Map) data = Map<String, dynamic>.from(data);
      if (data is! Map<String, dynamic>) return null;
      final cc =
          (data['countryCode'] ?? data['country'] ?? '').toString().trim();
      if (cc.length != 2) return null;
      return cc.toUpperCase();
    } catch (_) {
      return null;
    }
  }
}
