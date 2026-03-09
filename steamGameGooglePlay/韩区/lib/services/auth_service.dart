import 'package:firebase_auth/firebase_auth.dart';
import 'package:google_sign_in/google_sign_in.dart';

import '../core/constants/firebase_constants.dart';

/// 使用 Firebase Auth + Google Sign-In 获取 uid；未登录时由上层 fallback 到 UUID。
class AuthService {
  AuthService._();

  static final FirebaseAuth _auth = FirebaseAuth.instance;
  static final GoogleSignIn _googleSignIn = GoogleSignIn(
    scopes: <String>['email'],
    serverClientId: kGoogleSignInWebClientId.isEmpty ? null : kGoogleSignInWebClientId,
  );

  static User? get currentUser => _auth.currentUser;

  static Stream<User?> get authStateChanges => _auth.authStateChanges();

  /// 使用 Google 登录，返回当前 Firebase User；失败抛异常。
  static Future<User?> signInWithGoogle() async {
    final googleUser = await _googleSignIn.signIn();
    if (googleUser == null) return _auth.currentUser;

    final googleAuth = await googleUser.authentication;
    final idToken = googleAuth.idToken;
    final accessToken = googleAuth.accessToken;
    if (idToken == null || idToken.isEmpty) {
      throw Exception(
        '未获取到 idToken，请确认已配置 Web Client ID 且 Firebase 已启用 Google 登录',
      );
    }
    final credential = GoogleAuthProvider.credential(
      accessToken: accessToken,
      idToken: idToken,
    );
    final userCred = await _auth.signInWithCredential(credential);
    return userCred.user;
  }

  /// 登出 Firebase 与 Google。
  static Future<void> signOut() async {
    await _auth.signOut();
    await _googleSignIn.signOut();
  }

  /// 获取当前 idToken（用于后端 /auth/verify 可选）。
  static Future<String?> getIdToken(bool forceRefresh) async {
    return _auth.currentUser?.getIdToken(forceRefresh);
  }
}
