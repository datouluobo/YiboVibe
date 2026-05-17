import 'package:flutter/material.dart';

/// YiboVibe Mobile 白色主题 — 干净、专业，无 AI 味
class AppTheme {
  // 品牌色 — 纯净蓝
  static const Color brand = Color(0xFF2563EB);       // blue-600
  static const Color brandLight = Color(0xFF60A5FA);   // blue-400
  static const Color brandDark = Color(0xFF1D4ED8);    // blue-700

  // 背景层级
  static const Color bgPrimary = Color(0xFFFFFFFF);    // 纯白
  static const Color bgSecondary = Color(0xFFF8F9FA);  // 卡片/面板
  static const Color bgTertiary = Color(0xFFF1F3F5);   // 输入区/高亮
  static const Color bgHover = Color(0xFFE9ECEF);      // hover

  // 文字
  static const Color textPrimary = Color(0xFF212529);
  static const Color textSecondary = Color(0xFF6C757D);
  static const Color textTertiary = Color(0xFFADB5BD);

  // 语义色 — session 状态
  static const Color statusGreen = Color(0xFF22C55E);
  static const Color statusYellow = Color(0xFFEAB308);
  static const Color statusRed = Color(0xFFEF4444);
  static const Color statusGray = Color(0xFF9CA3AF);

  // 边框
  static const Color borderColor = Color(0xFFDEE2E6);
  static const Color borderFocus = Color(0xFF2563EB);

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
        backgroundColor: bgSecondary,
        elevation: 0,
        centerTitle: false,
        titleTextStyle: TextStyle(
          color: textPrimary,
          fontSize: 16,
          fontWeight: FontWeight.w600,
        ),
      ),
      cardTheme: CardThemeData(
        color: bgSecondary,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(10),
          side: const BorderSide(color: borderColor),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: bgTertiary,
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: const BorderSide(color: borderColor),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: const BorderSide(color: borderColor),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
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
            borderRadius: BorderRadius.circular(8),
          ),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: textSecondary,
        ),
      ),
      dialogTheme: DialogThemeData(
        backgroundColor: bgPrimary,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
          side: const BorderSide(color: borderColor),
        ),
      ),
      snackBarTheme: SnackBarThemeData(
        backgroundColor: bgTertiary,
        contentTextStyle: const TextStyle(color: textPrimary),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
        behavior: SnackBarBehavior.floating,
      ),
      bottomSheetTheme: const BottomSheetThemeData(
        backgroundColor: bgPrimary,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
        ),
      ),
      dividerColor: borderColor,
      fontFamily: 'Roboto',
    );
  }
}
