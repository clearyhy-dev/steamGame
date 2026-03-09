import '../locale/locale_service.dart';

/// 多语言文案：en / ja / ko / zh，按系统地区自动选用。
class AppStrings {
  AppStrings._();

  static String _str(String key) {
    final lang = LocaleService.getLanguageCode();
    final map = _strings[lang] ?? _strings['en']!;
    return map[key] ?? _strings['en']![key] ?? key;
  }

  static const Map<String, Map<String, String>> _strings = {
    'en': {
      'homeTitle': 'AI Feminine Presence Studio',
      'homeSubtitle': 'Refine. Elevate. Attract.',
      'uploadPhoto': 'Upload Photo',
      'featureSoftLighting': 'Presence Report',
      'featureElegantBg': 'Elegant Background Studio',
      'featurePresenceReport': 'Attraction Presence Report',
      'uploadTitle': 'Select Your Best Photos',
      'uploadHint': 'Choose 3 to 5 photos',
      'analyze': 'Analyze',
      'paywallHeadline': 'Elevate Your Presence Instantly',
      'paywallSubtext': 'AI-Powered Feminine Image Optimization',
      'paywallFreeTitle': 'Free',
      'paywallProTitle': 'Elegant Mode',
      'paywallFreeBasic': '✓ Basic analysis',
      'paywallFreeNoPsych': '✗ No full report',
      'paywallFreeNoEnhance': '✗ No HD enhancement',
      'paywallFreeNoStrategy': '✗ Watermark on export',
      'paywallProBg': '✓ Premium Background Studio',
      'paywallProHD': '✓ HD Export',
      'paywallProReport': '✓ Full Attraction Report',
      'paywallProStyles': '✓ 3 Style Variations',
      'paywallProNoWatermark': '✓ No Watermark',
      'paywallAnchorLine': '~~\$49~~',
      'paywallOurPrice': 'Today Only \$19.99',
      'paywallPriceNote': 'Private. Secure. No subscription.',
      'paywallCta': 'Unlock Elegant Mode',
      'paywallFooter': 'Designed for modern women who value presence.',
      'trust1': 'Your photos are not shared',
      'trust2': 'Secure payment via Google Play',
      'trust3': 'Instant results',
      'resultScore': 'Feminine Presence Score',
      'resultPsychology': 'Photo Presence Breakdown',
      'resultEnhancement': 'Presence Report',
      'resultEnhanceHint': 'Skin tone, lighting & composition only. No face or body changes.',
      'resultBio': 'Elegant Bio Generator',
      'resultStrategy': 'Presence Strategy Report',
      'onboardingTitle': 'AI Feminine Presence Studio',
      'onboardingSubtitle': 'Get personalized photo insights and presence tips in minutes.',
      'getStarted': 'Get Started',
      'loadingResults': 'Loading your results...',
      'yourPresenceReport': 'Your Presence Report',
      'unlockPro': 'Unlock Pro',
      'unlockSkinToneHint': 'Unlock skin tone, lighting & composition optimization',
      'enhancedVersionError': 'Enhanced version could not be loaded. Check network or API.',
      'sceneTransformation': 'Scene Transformation — Change background',
      'luxuryHeadpiece': 'Luxury Headpiece — Add crown, halo, hat',
      'styleLabel': 'Style: ',
      'reApply': 'Re-apply',
      'overallAttractiveness': 'Overall Attractiveness',
      'warmth': 'Warmth',
      'confidence': 'Confidence',
      'approachability': 'Approachability',
      'premiumMatchPotential': 'Premium Match Potential',
      'resultPhotoLabel': 'Photo',
      'confidenceImpact': 'Confidence Impact',
      'swipePotential': 'Swipe Potential',
      'improvement': 'Improvement',
      'before': 'Before',
      'after': 'After',
      'whyItWorks': 'Why it works',
      'bestPhotoOrder': 'Best photo order',
      'personalBrandKeywords': 'Personal brand keywords',
      'attractiveTo': 'Attractive to',
      'stylesToAvoid': 'Styles to avoid',
      'yourAttractionScore': 'Your Attraction Score',
      'unlockScoreHint': 'Warmth, confidence, approachability & more — unlock Pro for the full breakdown.',
      'unlockScoreCta': 'Unlock full score breakdown',
      'unlockPsychologyCta': 'Unlock psychology breakdown & swipe potential',
      'unlockBioHint': 'Unlock 5 bio versions with "Why it works"',
      'unlockStrategyHint': 'Unlock best photo order, brand keywords & who you attract',
      'playful': 'Playful',
      'confident': 'Confident',
      'elegant': 'Elegant',
      'noSuitableFace': 'No suitable face detected. Try a clearer, closer photo.',
      'headwearTitle': 'Luxury Headpiece',
      'selectPhoto': 'Select Photo',
      'applyHeadpiece': 'Apply Headpiece',
      'noPhotoSelected': 'No photo selected',
      'goToResultsHint': 'Go to Results and tap "Change background" on your best photo first.',
      'backToResults': 'Back to Results',
      'yourPhotoTap': 'Your photo (tap a background below to replace)',
      'chooseBackground': 'Choose a background',
      'result': 'Result',
      'positionAndSize': 'Position & Size',
      'dragFrameHint': 'Drag the frame to move · Pinch or slider to resize',
      'size': 'Size',
      'replacing': 'Replacing…',
      'replaceAndSave': 'Replace & Save',
      'back': 'Back',
      'sceneTransformationTitle': 'Scene Transformation',
      'storeNotAvailable': 'Store not available',
      'style_portrait': 'Portrait',
      'style_natural_glow': 'Natural Glow',
      'style_luxury_studio': 'Luxury Studio',
      'style_soft_feminine': 'Soft Feminine',
      'style_flower_crown': 'Flower Crown',
      'style_princess_tiara': 'Princess Tiara',
      'style_butterfly_aura': 'Butterfly Aura',
      'style_sparkle_light': 'Sparkle Light',
      'style_pastel_anime': 'Pastel Anime',
      'style_ai': 'AI Enhance',
    },
    'ja': {
      'homeTitle': 'AI フェミニン・プレゼンススタジオ',
      'homeSubtitle': '磨く。高める。惹きつける。',
      'uploadPhoto': '写真をアップロード',
      'featureSoftLighting': '気質レポート',
      'featureElegantBg': '上品な背景スタジオ',
      'featurePresenceReport': '魅力プレゼンスレポート',
      'uploadTitle': 'ベストな写真を選んでください',
      'uploadHint': '3〜5枚選んでください',
      'analyze': '分析する',
      'paywallHeadline': '今すぐプレゼンスを高める',
      'paywallSubtext': 'AI 女性向け画像最適化',
      'paywallFreeTitle': '無料',
      'paywallProTitle': 'エレガントモード',
      'paywallFreeBasic': '✓ 基本分析',
      'paywallFreeNoPsych': '✗ 詳細レポートなし',
      'paywallFreeNoEnhance': '✗ HD 補正なし',
      'paywallFreeNoStrategy': '✗ 書き出しにウォーターマーク',
      'paywallProBg': '✓ プレミアム背景スタジオ',
      'paywallProHD': '✓ HD 書き出し',
      'paywallProReport': '✓ 魅力レポート',
      'paywallProStyles': '✓ 3スタイル',
      'paywallProNoWatermark': '✓ ウォーターマークなし',
      'paywallAnchorLine': '~~\$49~~',
      'paywallOurPrice': '本日のみ \$19.99',
      'paywallPriceNote': '安全・非公開・買い切り',
      'paywallCta': 'エレガントモードを解除',
      'paywallFooter': 'プレゼンスを大切にする女性のため',
      'trust1': '写真は共有されません',
      'trust2': 'Google Play で安全決済',
      'trust3': '即時結果',
      'resultScore': 'フェミニン・プレゼンススコア',
      'resultPsychology': '写真プレゼンス分析',
      'resultEnhancement': '気質レポート',
      'resultEnhanceHint': '肌色・照明・構図のみ。顔や体型は変更しません。',
      'resultBio': 'エレガントバイオ生成',
      'resultStrategy': 'プレゼンス戦略レポート',
      'onboardingTitle': 'AI フェミニン・プレゼンススタジオ',
      'onboardingSubtitle': '数分で写真の洞察とプレゼンスのヒントを。',
      'getStarted': '始める',
      'loadingResults': '結果を読み込み中...',
      'yourPresenceReport': 'プレゼンスレポート',
      'unlockPro': 'Pro を解除',
      'unlockSkinToneHint': '肌色・照明・構図の最適化を解除',
      'enhancedVersionError': '補正画像を読み込めません。ネットワークまたはAPIを確認してください。',
      'sceneTransformation': 'シーン変換 — 背景を変更',
      'luxuryHeadpiece': 'ラグジュアリーヘッドピース — 王冠・ハロー・帽子',
      'styleLabel': 'スタイル: ',
      'reApply': '再適用',
      'overallAttractiveness': '総合魅力',
      'warmth': '温かみ',
      'confidence': '自信',
      'approachability': '親しみやすさ',
      'premiumMatchPotential': 'プレミアムマッチ可能性',
      'resultPhotoLabel': '写真',
      'confidenceImpact': '自信への影響',
      'swipePotential': 'スワイプされやすさ',
      'improvement': '改善ポイント',
      'before': 'Before',
      'after': 'After',
      'whyItWorks': 'なぜ効くか',
      'bestPhotoOrder': 'ベストな写真の順番',
      'personalBrandKeywords': 'パーソナルブランドキーワード',
      'attractiveTo': '惹かれるタイプ',
      'stylesToAvoid': '避けるスタイル',
      'yourAttractionScore': 'あなたの魅力スコア',
      'unlockScoreHint': '温かみ・自信・親しみやすさなど — Proで全項目を表示。',
      'unlockScoreCta': 'スコア内訳を解除',
      'unlockPsychologyCta': '心理分析とスワイプ可能性を解除',
      'unlockBioHint': '「なぜ効くか」付き5種類のバイオを解除',
      'unlockStrategyHint': 'ベスト順・キーワード・惹かれる相手を解除',
      'playful': 'プレイフル',
      'confident': 'コンフィデント',
      'elegant': 'エレガント',
      'noSuitableFace': '検出できる顔がありません。よりはっきりした近影をお試しください。',
      'headwearTitle': 'ラグジュアリーヘッドピース',
      'selectPhoto': '写真を選択',
      'applyHeadpiece': 'ヘッドピースを適用',
      'noPhotoSelected': '写真が選択されていません',
      'goToResultsHint': '結果画面で「背景を変更」をタップしてからお試しください。',
      'backToResults': '結果に戻る',
      'yourPhotoTap': 'あなたの写真（下の背景をタップで置き換え）',
      'chooseBackground': '背景を選ぶ',
      'result': '結果',
      'positionAndSize': '位置とサイズ',
      'dragFrameHint': 'ドラッグで移動・ピンチまたはスライダーでサイズ変更',
      'size': 'サイズ',
      'replacing': '置き換え中…',
      'replaceAndSave': '置き換えて保存',
      'back': '戻る',
      'sceneTransformationTitle': 'シーン変換',
      'storeNotAvailable': 'ストアを利用できません',
      'style_portrait': 'ポートレート',
      'style_natural_glow': 'ナチュラルグロー',
      'style_luxury_studio': 'ラグジュアリースタジオ',
      'style_soft_feminine': 'ソフトフェミニン',
      'style_flower_crown': 'フラワークラウン',
      'style_princess_tiara': 'プリンセスティアラ',
      'style_butterfly_aura': 'バタフライオーラ',
      'style_sparkle_light': 'スパークルライト',
      'style_pastel_anime': 'パステルアニメ',
      'style_ai': 'AI 美化',
    },
    'ko': {
      'homeTitle': 'AI 페미닌 프레젠스 스튜디오',
      'homeSubtitle': '다듬고. 높이고. 끌어당기고.',
      'uploadPhoto': '사진 업로드',
      'featureSoftLighting': '기질 리포트',
      'featureElegantBg': '엘레강트 배경 스튜디오',
      'featurePresenceReport': '매력 프레젠스 리포트',
      'uploadTitle': '최고의 사진을 선택하세요',
      'uploadHint': '3~5장 선택',
      'analyze': '분석',
      'paywallHeadline': '프레젠스를 즉시 높이세요',
      'paywallSubtext': 'AI 페미닌 이미지 최적화',
      'paywallFreeTitle': '무료',
      'paywallProTitle': '엘레강트 모드',
      'paywallFreeBasic': '✓ 기본 분석',
      'paywallFreeNoPsych': '✗ 전체 리포트 없음',
      'paywallFreeNoEnhance': '✗ HD 보정 없음',
      'paywallFreeNoStrategy': '✗ 내보내기 워터마크',
      'paywallProBg': '✓ 프리미엄 배경 스튜디오',
      'paywallProHD': '✓ HD 내보내기',
      'paywallProReport': '✓ 전체 매력 리포트',
      'paywallProStyles': '✓ 3가지 스타일',
      'paywallProNoWatermark': '✓ 워터마크 없음',
      'paywallAnchorLine': '~~\$49~~',
      'paywallOurPrice': '오늘만 \$19.99',
      'paywallPriceNote': '비공개·안전·구독 없음',
      'paywallCta': '엘레강트 모드 잠금 해제',
      'paywallFooter': '프레젠스를 소중히 하는 여성을 위해',
      'trust1': '사진은 공유되지 않습니다',
      'trust2': 'Google Play 안전 결제',
      'trust3': '즉시 결과',
      'resultScore': '페미닌 프레젠스 점수',
      'resultPsychology': '사진 프레젠스 분석',
      'resultEnhancement': '기질 리포트',
      'resultEnhanceHint': '피부톤·조명·구도만. 얼굴·체형 변경 없음.',
      'resultBio': '엘레강트 바이오 생성',
      'resultStrategy': '프레젠스 전략 리포트',
      'onboardingTitle': 'AI 페미닌 프레젠스 스튜디오',
      'onboardingSubtitle': '몇 분 만에 사진 인사이트와 프레젠스 팁을 받아보세요.',
      'getStarted': '시작하기',
      'loadingResults': '결과를 불러오는 중...',
      'yourPresenceReport': '프레젠스 리포트',
      'unlockPro': 'Pro 잠금 해제',
      'unlockSkinToneHint': '피부톤·조명·구도 최적화 잠금 해제',
      'enhancedVersionError': '보정 이미지를 불러올 수 없습니다. 네트워크 또는 API를 확인하세요.',
      'sceneTransformation': '씬 변환 — 배경 변경',
      'luxuryHeadpiece': '럭셔리 헤드피스 — 왕관·헤일로·모자',
      'styleLabel': '스타일: ',
      'reApply': '다시 적용',
      'overallAttractiveness': '종합 매력도',
      'warmth': '따뜻함',
      'confidence': '자신감',
      'approachability': '다가가기 쉬움',
      'premiumMatchPotential': '프리미엄 매칭 가능성',
      'resultPhotoLabel': '사진',
      'confidenceImpact': '자신감 영향',
      'swipePotential': '스와이프 가능성',
      'improvement': '개선 포인트',
      'before': 'Before',
      'after': 'After',
      'whyItWorks': '왜 효과 있는지',
      'bestPhotoOrder': '최적 사진 순서',
      'personalBrandKeywords': '퍼스널 브랜드 키워드',
      'attractiveTo': '끌리는 타입',
      'stylesToAvoid': '피할 스타일',
      'yourAttractionScore': '당신의 매력 점수',
      'unlockScoreHint': '따뜻함·자신감·다가가기 등 — Pro에서 전체 항목 확인.',
      'unlockScoreCta': '점수 항목 잠금 해제',
      'unlockPsychologyCta': '심리 분석 및 스와이프 가능성 잠금 해제',
      'unlockBioHint': '"왜 효과 있는지" 5종 바이오 잠금 해제',
      'unlockStrategyHint': '최적 순서·키워드·끌리는 상대 잠금 해제',
      'playful': '플레이풀',
      'confident': '컨피던트',
      'elegant': '엘레강트',
      'noSuitableFace': '적합한 얼굴이 감지되지 않았습니다. 더 선명하고 가까운 사진을 사용해 보세요.',
      'headwearTitle': '럭셔리 헤드피스',
      'selectPhoto': '사진 선택',
      'applyHeadpiece': '헤드피스 적용',
      'noPhotoSelected': '선택된 사진 없음',
      'goToResultsHint': '결과 화면에서 "배경 변경"을 탭한 후 이용하세요.',
      'backToResults': '결과로 돌아가기',
      'yourPhotoTap': '사진 (아래 배경을 탭하여 교체)',
      'chooseBackground': '배경 선택',
      'result': '결과',
      'positionAndSize': '위치 및 크기',
      'dragFrameHint': '드래그로 이동 · 핀치 또는 슬라이더로 크기 조절',
      'size': '크기',
      'replacing': '교체 중…',
      'replaceAndSave': '교체 후 저장',
      'back': '뒤로',
      'sceneTransformationTitle': '씬 변환',
      'storeNotAvailable': '스토어를 사용할 수 없습니다',
      'style_portrait': '포트레이트',
      'style_natural_glow': '내추럴 글로우',
      'style_luxury_studio': '럭셔리 스튜디오',
      'style_soft_feminine': '소프트 페미닌',
      'style_flower_crown': '플라워 크라운',
      'style_princess_tiara': '프린세스 티아라',
      'style_butterfly_aura': '버터플라이 오라',
      'style_sparkle_light': '스파클 라이트',
      'style_pastel_anime': '파스텔 애니메',
      'style_ai': 'AI 보정',
    },
    'zh': {
      'homeTitle': 'AI 女性气质工作室',
      'homeSubtitle': '雕琢。提升。吸引。',
      'uploadPhoto': '上传照片',
      'featureSoftLighting': '气质报告',
      'featureElegantBg': '优雅背景工作室',
      'featurePresenceReport': '魅力气质报告',
      'uploadTitle': '选择你的最佳照片',
      'uploadHint': '选择 3～5 张照片',
      'analyze': '分析',
      'paywallHeadline': '即刻提升你的气质',
      'paywallSubtext': 'AI 女性形象优化',
      'paywallFreeTitle': '免费',
      'paywallProTitle': '优雅模式',
      'paywallFreeBasic': '✓ 基础分析',
      'paywallFreeNoPsych': '✗ 无完整报告',
      'paywallFreeNoEnhance': '✗ 无高清增强',
      'paywallFreeNoStrategy': '✗ 导出带水印',
      'paywallProBg': '✓ 高级背景工作室',
      'paywallProHD': '✓ 高清导出',
      'paywallProReport': '✓ 完整魅力报告',
      'paywallProStyles': '✓ 3 种风格',
      'paywallProNoWatermark': '✓ 无水印',
      'paywallAnchorLine': '~~\$49~~',
      'paywallOurPrice': '今日仅需 \$19.99',
      'paywallPriceNote': '私密·安全·买断制',
      'paywallCta': '解锁优雅模式',
      'paywallFooter': '为重视气质的现代女性设计',
      'trust1': '照片不会外泄',
      'trust2': '通过 Google Play 安全支付',
      'trust3': '即时出结果',
      'resultScore': '女性气质分数',
      'resultPsychology': '照片气质分析',
      'resultEnhancement': '气质报告',
      'resultEnhanceHint': '仅调整肤色、光线与构图，不改变五官与体型。',
      'resultBio': '优雅简介生成',
      'resultStrategy': '气质策略报告',
      'onboardingTitle': 'AI 女性气质工作室',
      'onboardingSubtitle': '几分钟内获得照片洞察与气质建议。',
      'getStarted': '开始使用',
      'loadingResults': '正在加载结果...',
      'yourPresenceReport': '气质报告',
      'unlockPro': '解锁 Pro',
      'unlockSkinToneHint': '解锁肤色、光线与构图优化',
      'enhancedVersionError': '无法加载增强图，请检查网络或 API。',
      'sceneTransformation': '场景变换 — 更换背景',
      'luxuryHeadpiece': '奢华头饰 — 皇冠、光环、帽子',
      'styleLabel': '风格：',
      'reApply': '重新应用',
      'overallAttractiveness': '综合魅力',
      'warmth': '亲和力',
      'confidence': '自信',
      'approachability': '易接近度',
      'premiumMatchPotential': '优质匹配潜力',
      'resultPhotoLabel': '照片',
      'confidenceImpact': '自信影响',
      'swipePotential': '右滑潜力',
      'improvement': '改进建议',
      'before': 'Before',
      'after': 'After',
      'whyItWorks': '为什么有效',
      'bestPhotoOrder': '最佳照片顺序',
      'personalBrandKeywords': '个人品牌关键词',
      'attractiveTo': '吸引对象',
      'stylesToAvoid': '应避免的风格',
      'yourAttractionScore': '你的魅力分数',
      'unlockScoreHint': '亲和力、自信、易接近度等 — 解锁 Pro 查看完整项。',
      'unlockScoreCta': '解锁完整分数项',
      'unlockPsychologyCta': '解锁心理分析与右滑潜力',
      'unlockBioHint': '解锁 5 种「为什么有效」简介',
      'unlockStrategyHint': '解锁最佳顺序、关键词与吸引对象',
      'playful': '活泼',
      'confident': '自信',
      'elegant': '优雅',
      'noSuitableFace': '未检测到合适人脸，请使用更清晰、更近的照片。',
      'headwearTitle': '奢华头饰',
      'selectPhoto': '选择照片',
      'applyHeadpiece': '应用头饰',
      'noPhotoSelected': '未选择照片',
      'goToResultsHint': '请先在结果页对最佳照片点击「更换背景」。',
      'backToResults': '返回结果',
      'yourPhotoTap': '你的照片（点击下方背景进行替换）',
      'chooseBackground': '选择背景',
      'result': '结果',
      'positionAndSize': '位置与大小',
      'dragFrameHint': '拖动移动 · 双指或滑块调整大小',
      'size': '大小',
      'replacing': '替换中…',
      'replaceAndSave': '替换并保存',
      'back': '返回',
      'sceneTransformationTitle': '场景变换',
      'storeNotAvailable': '商店不可用',
      'style_portrait': '人像',
      'style_natural_glow': '自然光晕',
      'style_luxury_studio': '奢华影棚',
      'style_soft_feminine': '柔和女性',
      'style_flower_crown': '花环',
      'style_princess_tiara': '公主头冠',
      'style_butterfly_aura': '蝴蝶光晕',
      'style_sparkle_light': '闪亮光效',
      'style_pastel_anime': '粉彩动漫',
      'style_ai': 'AI 美化（推荐）',
    },
  };

  // Getters（按当前语言返回）
  static String get homeTitle => _str('homeTitle');
  static String get homeSubtitle => _str('homeSubtitle');
  static String get uploadPhoto => _str('uploadPhoto');
  static String get featureSoftLighting => _str('featureSoftLighting');
  static String get featureElegantBg => _str('featureElegantBg');
  static String get featurePresenceReport => _str('featurePresenceReport');
  static String get uploadTitle => _str('uploadTitle');
  static String get uploadHint => _str('uploadHint');
  static String get analyze => _str('analyze');
  static String get paywallHeadline => _str('paywallHeadline');
  static String get paywallSubtext => _str('paywallSubtext');
  static String get paywallFreeTitle => _str('paywallFreeTitle');
  static String get paywallProTitle => _str('paywallProTitle');
  static String get paywallFreeBasic => _str('paywallFreeBasic');
  static String get paywallFreeNoPsych => _str('paywallFreeNoPsych');
  static String get paywallFreeNoEnhance => _str('paywallFreeNoEnhance');
  static String get paywallFreeNoStrategy => _str('paywallFreeNoStrategy');
  static String get paywallProBg => _str('paywallProBg');
  static String get paywallProHD => _str('paywallProHD');
  static String get paywallProReport => _str('paywallProReport');
  static String get paywallProStyles => _str('paywallProStyles');
  static String get paywallProNoWatermark => _str('paywallProNoWatermark');
  static String get paywallAnchorLine => _str('paywallAnchorLine');
  static String get paywallOurPrice => _str('paywallOurPrice');
  static String get paywallPriceNote => _str('paywallPriceNote');
  static String get paywallCta => _str('paywallCta');
  static String get paywallFooter => _str('paywallFooter');
  static String get trust1 => _str('trust1');
  static String get trust2 => _str('trust2');
  static String get trust3 => _str('trust3');
  static String get resultScore => _str('resultScore');
  static String get resultPsychology => _str('resultPsychology');
  static String get resultEnhancement => _str('resultEnhancement');
  static String get resultEnhanceHint => _str('resultEnhanceHint');
  static String get resultBio => _str('resultBio');
  static String get resultStrategy => _str('resultStrategy');
  static String get onboardingTitle => _str('onboardingTitle');
  static String get onboardingSubtitle => _str('onboardingSubtitle');
  static String get getStarted => _str('getStarted');
  static String get loadingResults => _str('loadingResults');
  static String get yourPresenceReport => _str('yourPresenceReport');
  static String get unlockPro => _str('unlockPro');
  static String get unlockSkinToneHint => _str('unlockSkinToneHint');
  static String get enhancedVersionError => _str('enhancedVersionError');
  static String get sceneTransformation => _str('sceneTransformation');
  static String get luxuryHeadpiece => _str('luxuryHeadpiece');
  static String get styleLabel => _str('styleLabel');
  static String get reApply => _str('reApply');
  static String get overallAttractiveness => _str('overallAttractiveness');
  static String get warmth => _str('warmth');
  static String get confidence => _str('confidence');
  static String get approachability => _str('approachability');
  static String get premiumMatchPotential => _str('premiumMatchPotential');
  static String get resultPhotoLabel => _str('resultPhotoLabel');
  static String get confidenceImpact => _str('confidenceImpact');
  static String get swipePotential => _str('swipePotential');
  static String get improvement => _str('improvement');
  static String get before => _str('before');
  static String get after => _str('after');
  static String get whyItWorks => _str('whyItWorks');
  static String get bestPhotoOrder => _str('bestPhotoOrder');
  static String get personalBrandKeywords => _str('personalBrandKeywords');
  static String get attractiveTo => _str('attractiveTo');
  static String get stylesToAvoid => _str('stylesToAvoid');
  static String get yourAttractionScore => _str('yourAttractionScore');
  static String get unlockScoreHint => _str('unlockScoreHint');
  static String get unlockScoreCta => _str('unlockScoreCta');
  static String get unlockPsychologyCta => _str('unlockPsychologyCta');
  static String get unlockBioHint => _str('unlockBioHint');
  static String get unlockStrategyHint => _str('unlockStrategyHint');
  static String get playful => _str('playful');
  static String get confident => _str('confident');
  static String get elegant => _str('elegant');
  static String get noSuitableFace => _str('noSuitableFace');
  static String get noPhotoSelected => _str('noPhotoSelected');
  static String get goToResultsHint => _str('goToResultsHint');
  static String get backToResults => _str('backToResults');
  static String get yourPhotoTap => _str('yourPhotoTap');
  static String get chooseBackground => _str('chooseBackground');
  static String get result => _str('result');
  static String get positionAndSize => _str('positionAndSize');
  static String get dragFrameHint => _str('dragFrameHint');
  static String get size => _str('size');
  static String get replacing => _str('replacing');
  static String get replaceAndSave => _str('replaceAndSave');
  static String get back => _str('back');
  static String get sceneTransformationTitle => _str('sceneTransformationTitle');
  static String get storeNotAvailable => _str('storeNotAvailable');
  static String get headwearTitle => _str('headwearTitle');
  static String get selectPhoto => _str('selectPhoto');
  static String get applyHeadpiece => _str('applyHeadpiece');

  static String styleName(String styleKey) {
    return _str('style_$styleKey');
  }
}
