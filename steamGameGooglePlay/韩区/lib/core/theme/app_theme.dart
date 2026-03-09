import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

// 欧美女性专版：奶油白、米金色、淡灰 + Playfair Display
const Color appSurfaceDark = Color(0xFF121212);
const Color appSurfaceCard = Color(0xFF1E1E1E);
const Color appCreamGold = Color(0xFFE8CFA1);
const Color appCreamGoldMuted = Color(0xFFD4BC8A);
const Color appCreamWhite = Color(0xFFFAF8F5);
const Color appLightGray = Color(0xFF9E9E9E);

// 兼容旧引用
const Color appGoldPrimary = appCreamGold;
const Color appGoldMuted = appCreamGoldMuted;

final ThemeData appTheme = ThemeData(
  useMaterial3: true,
  brightness: Brightness.dark,
  scaffoldBackgroundColor: appSurfaceDark,
  colorScheme: ColorScheme.dark(
    primary: appCreamGold,
    secondary: appCreamGoldMuted,
    surface: appSurfaceDark,
    onPrimary: Colors.black,
    onSurface: appCreamWhite,
    onSurfaceVariant: appLightGray,
  ),
  appBarTheme: AppBarTheme(
    backgroundColor: appSurfaceDark,
    foregroundColor: appCreamWhite,
    elevation: 0,
    centerTitle: true,
    titleTextStyle: GoogleFonts.playfairDisplay(
      fontSize: 18,
      fontWeight: FontWeight.w600,
      color: appCreamWhite,
    ),
  ),
  textTheme: GoogleFonts.playfairDisplayTextTheme(
    ThemeData.dark().textTheme.copyWith(
          bodyLarge: GoogleFonts.inter(color: appLightGray, fontSize: 16),
          bodyMedium: GoogleFonts.inter(color: appLightGray, fontSize: 14),
          headlineLarge: GoogleFonts.playfairDisplay(
            fontSize: 28,
            fontWeight: FontWeight.bold,
            color: appCreamWhite,
          ),
          headlineMedium: GoogleFonts.playfairDisplay(
            fontSize: 22,
            fontWeight: FontWeight.bold,
            color: appCreamWhite,
          ),
          headlineSmall: GoogleFonts.playfairDisplay(
            fontSize: 18,
            fontWeight: FontWeight.w600,
            color: appCreamWhite,
          ),
        ),
  ),
  elevatedButtonTheme: ElevatedButtonThemeData(
    style: ElevatedButton.styleFrom(
      backgroundColor: appCreamGold,
      foregroundColor: Colors.black,
      padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 18),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
      elevation: 0,
    ),
  ),
  cardTheme: CardThemeData(
    color: appSurfaceCard,
    elevation: 0,
    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
  ),
);
