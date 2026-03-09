import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../core/constants/api_constants.dart';
import '../models/analysis_result_model.dart';

class ApiService {
  ApiService({http.Client? client}) : _client = client ?? http.Client();

  final http.Client _client;

  /// FastAPI 错误格式: {"detail": "message"}
  String _parseError(http.Response response) {
    try {
      final map = jsonDecode(response.body) as Map<String, dynamic>?;
      final detail = map?[ApiConstants.errorDetailKey];
      if (detail != null) {
        return detail is String ? detail : detail.toString();
      }
    } catch (_) {}
    return 'Request failed: ${response.statusCode}';
  }

  Future<AnalysisResultModel> analyze({
    required String uid,
    required List<String> photosBase64,
    String? lang,
  }) async {
    final uri = Uri.parse('${ApiConstants.baseUrl}${ApiConstants.analyzePath}');
    final body = jsonEncode({
      'uid': uid,
      'photos': photosBase64,
      if (lang != null && lang.isNotEmpty) 'lang': lang,
    });
    final response = await _client
        .post(
          uri,
          headers: {'Content-Type': 'application/json'},
          body: body,
        )
        .timeout(ApiConstants.receiveTimeout, onTimeout: () {
      throw ApiException('Request timeout');
    });
    if (response.statusCode != 200) {
      throw ApiException(_parseError(response));
    }
    final map = jsonDecode(response.body) as Map<String, dynamic>;
    return AnalysisResultModel.fromJson(map);
  }

  /// 图像美化。promptStyle 可选：portrait | natural_glow | luxury_studio | soft_feminine | fashion |
  /// flower_crown | princess_tiara | butterfly_aura | sparkle_light | pastel_anime | anime_flower
  Future<String> enhance({
    required String uid,
    required String bestPhotoBase64,
    String? promptStyle,
  }) async {
    final uri = Uri.parse('${ApiConstants.baseUrl}${ApiConstants.enhancePath}');
    final body = jsonEncode({
      'uid': uid,
      'photo': bestPhotoBase64,
      if (promptStyle != null && promptStyle.isNotEmpty) 'prompt_style': promptStyle,
    });
    final response = await _client
        .post(
          uri,
          headers: {'Content-Type': 'application/json'},
          body: body,
        )
        .timeout(ApiConstants.receiveTimeout, onTimeout: () {
      throw ApiException('Request timeout');
    });
    if (response.statusCode != 200) {
      throw ApiException(_parseError(response));
    }
    final map = jsonDecode(response.body) as Map<String, dynamic>;
    final url = map['enhancedImageUrl'] as String?;
    if (url == null || url.isEmpty) throw ApiException('No enhanced image URL');
    return url;
  }

  Future<bool> verifyPurchase({
    required String uid,
    required String purchaseToken,
    required String productId,
  }) async {
    final uri =
        Uri.parse('${ApiConstants.baseUrl}${ApiConstants.verifyPurchasePath}');
    final body = jsonEncode({
      'uid': uid,
      'purchaseToken': purchaseToken,
      'productId': productId,
    });
    final response = await _client
        .post(
          uri,
          headers: {'Content-Type': 'application/json'},
          body: body,
        )
        .timeout(ApiConstants.connectTimeout, onTimeout: () {
      throw ApiException('Request timeout');
    });
    return response.statusCode == 200;
  }

  /// 预设背景列表：{ id, name, premium }
  Future<List<Map<String, dynamic>>> listBackgrounds() async {
    final uri = Uri.parse('${ApiConstants.baseUrl}${ApiConstants.backgroundsPath}');
    final response = await _client.get(uri).timeout(
          ApiConstants.connectTimeout,
          onTimeout: () => throw ApiException('Request timeout'),
        );
    if (response.statusCode != 200) throw ApiException(_parseError(response));
    final map = jsonDecode(response.body) as Map<String, dynamic>;
    final list = map['backgrounds'] as List<dynamic>? ?? [];
    return list.map((e) => e as Map<String, dynamic>).toList();
  }

  /// 背景替换，返回合成图 URL
  /// scale: 0.3~1.0, positionX/positionY: 0~1（用户调整时传入）
  /// bgPrompt: 可选，传则后端用 SDXL inpainting 重绘背景（商业级方案）
  Future<String> replaceBackground({
    required String uid,
    required String photoBase64,
    required String backgroundId,
    double? scale,
    double? positionX,
    double? positionY,
    String? bgPrompt,
  }) async {
    final uri = Uri.parse('${ApiConstants.baseUrl}${ApiConstants.backgroundReplacePath}');
    final body = jsonEncode({
      'uid': uid,
      'photo': photoBase64,
      'background_id': backgroundId,
      if (scale != null) 'scale': scale,
      if (positionX != null) 'position_x': positionX,
      if (positionY != null) 'position_y': positionY,
      if (bgPrompt != null && bgPrompt.isNotEmpty) 'bg_prompt': bgPrompt,
    });
    final response = await _client
        .post(
          uri,
          headers: {'Content-Type': 'application/json'},
          body: body,
        )
        .timeout(ApiConstants.backgroundReplaceTimeout, onTimeout: () {
      throw ApiException('Request timeout');
    });
    if (response.statusCode != 200) {
      throw ApiException(_parseError(response));
    }
    final map = jsonDecode(response.body) as Map<String, dynamic>;
    final url = map['resultUrl'] as String?;
    if (url == null || url.isEmpty) throw ApiException('No result URL');
    return url;
  }

  /// 服务配置（是否启用 Replicate 等），用于排查
  Future<Map<String, dynamic>> getConfig() async {
    final uri = Uri.parse('${ApiConstants.baseUrl}${ApiConstants.configPath}');
    final response = await _client.get(uri).timeout(
          ApiConstants.connectTimeout,
          onTimeout: () => throw ApiException('Request timeout'),
        );
    if (response.statusCode != 200) throw ApiException(_parseError(response));
    final map = jsonDecode(response.body) as Map<String, dynamic>;
    return map;
  }
}

class ApiException implements Exception {
  final String message;
  ApiException(this.message);
  @override
  String toString() => message;
}
