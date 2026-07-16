import 'package:flutter/material.dart';

/// YiboVibe Mobile 白色主题 — 干净、专业，无 AI 味
class AppTheme {
  // 品牌色保持克制，避免喧宾夺主
  static const Color brand = Color(0xFF111111);
  static const Color brandLight = Color(0xFF5F6368);
  static const Color brandDark = Color(0xFF000000);

  // 背景层级
  static const Color bgPrimary = Color(0xFFFFFFFF);
  static const Color bgSecondary = Color(0xFFFFFFFF);
  static const Color bgTertiary = Color(0xFFF5F5F5);
  static const Color bgHover = Color(0xFFF0F0F0);

  // 文字
  static const Color textPrimary = Color(0xFF161616);
  static const Color textSecondary = Color(0xFF737373);
  static const Color textTertiary = Color(0xFFB3B3B3);

  // 语义色 — session 状态
  static const Color statusGreen = Color(0xFF22C55E);
  static const Color statusYellow = Color(0xFFD97706);
  static const Color statusRed = Color(0xFFEF4444);
  static const Color statusGray = Color(0xFF9CA3AF);

  // 边框
  static const Color borderColor = Color(0xFFEAEAEA);
  static const Color borderFocus = Color(0xFF111111);
  static const Color shadowColor = Color(0x0D000000);

  /// Session 状态颜色映射
  static Color sessionStatusColor(String status) {
    switch (status) {
      case 'running':
        return statusGreen;
      case 'paused':
      case 'waiting_input':
        return statusYellow;
      case 'crashed':
        return statusRed;
      case 'stale':
        return statusGray;
      case 'stopped':
      default:
        return statusGray;
    }
  }

  static ThemeData get lightTheme {
    return ThemeData(
      brightness: Brightness.light,
      scaffoldBackgroundColor: bgPrimary,
      colorScheme: const ColorScheme.light(
        primary: brand,
        secondary: brandLight,
        surface: bgSecondary,
        error: statusRed,
      ),
      appBarTheme: const AppBarTheme(
        backgroundColor: bgPrimary,
        elevation: 0,
        centerTitle: true,
        titleTextStyle: TextStyle(
          color: textPrimary,
          fontSize: 17,
          fontWeight: FontWeight.w700,
        ),
      ),
      cardTheme: CardThemeData(
        color: bgSecondary,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(24),
          side: const BorderSide(color: borderColor),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: bgSecondary,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 14,
          vertical: 12,
        ),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(24),
          borderSide: const BorderSide(color: borderColor),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(24),
          borderSide: const BorderSide(color: borderColor),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(24),
          borderSide: const BorderSide(color: borderFocus, width: 1.5),
        ),
        labelStyle: const TextStyle(color: textSecondary, fontSize: 14),
        hintStyle: const TextStyle(color: textTertiary, fontSize: 14),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: brand,
          foregroundColor: Colors.white,
          elevation: 0,
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(24),
          ),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(foregroundColor: textSecondary),
      ),
      dialogTheme: DialogThemeData(
        backgroundColor: bgPrimary,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(28),
          side: const BorderSide(color: borderColor),
        ),
      ),
      snackBarTheme: SnackBarThemeData(
        backgroundColor: bgSecondary,
        contentTextStyle: const TextStyle(color: textPrimary),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(22)),
        behavior: SnackBarBehavior.floating,
      ),
      bottomSheetTheme: const BottomSheetThemeData(
        backgroundColor: bgPrimary,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(32)),
        ),
      ),
      dividerColor: borderColor,
      fontFamily: 'Roboto',
    );
  }
}
