/// Google 登录（Android）必须的 Web Client ID，否则拿不到 idToken，登录不生效。
/// 获取：Google Cloud 控制台 https://console.cloud.google.com/apis/credentials
///       → 项目选 dating-ai-project → 创建凭据 → OAuth 2.0 客户端 ID → 类型「Web 应用」
///       → 创建后复制「客户端 ID」（形如 xxx.apps.googleusercontent.com）填到下面。
/// 留空则依赖 google-services.json 的 oauth_client（当前项目该字段为空，需填写此项）。
const String kGoogleSignInWebClientId = '882947662924-v86go5cj75fpbrtaikp46pl2tcm6pse6.apps.googleusercontent.com';
