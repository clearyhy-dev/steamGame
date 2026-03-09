/// 背景重绘（SDXL inpainting）用 prompt，与后端 prompts.background_prompt 一致。
/// API 预设若返回 bg_prompt 则优先用 API 值；否则用本映射。
class BackgroundPrompts {
  BackgroundPrompts._();

  static const Map<String, String> _idToPrompt = {
    'paris_street': 'elegant Paris street, autumn leaves, luxury fashion backdrop, shallow depth of field, golden hour',
    'beach_sunset': 'luxury beach at sunset, soft waves, golden light, premium travel photography',
    'luxury_cafe': 'luxury café interior, morning light, soft bokeh, premium lifestyle',
    'beach_sunset_calm': 'luxury beach at sunset, soft waves, golden light, premium travel photography',
    'minimalist_apartment': 'minimalist apartment interior, clean lines, soft natural light, premium lifestyle',
    'rooftop_golden': 'rooftop at golden hour, city skyline, warm light, premium photography',
    'luxury_hotel': 'luxury hotel lobby, elegant interior, soft lighting, premium travel',
    'soft_studio': 'clean white studio background, soft shadows, professional portrait',
    'modern_office': 'modern office interior, professional, soft natural light',
    'cozy_home': 'cozy home interior, warm atmosphere, soft lighting, lifestyle',
    'fine_dining': 'fine dining restaurant, elegant evening, soft ambient light',
  };

  /// 返回 background_id 对应的 inpainting prompt；无则 null（走预设图合成）。
  static String? forId(String backgroundId) {
    return _idToPrompt[backgroundId];
  }
}
