import 'package:flutter/material.dart';

/// YiboVibe Mobile 暗色主题 — Linear/Vercel 风格，极简暗色
class AppTheme {
  // 品牌色
  static const Color brandPurple = Color(0xFF7C3AED); // 主色调
  static const Color brandPurpleLight = Color(0xFFA78BFA);
  static const Color brandPurpleDark = Color(0xFF5B21B6);

  // 背景层级
  static const Color bgPrimary = Color(0xFF0A0A0B); // 最深背景
  static const Color bgSecondary = Color(0xFF141416); // 卡片/面板
  static const Color bgTertiary = Color(0xFF1C1C1F); // 输入区/高亮
  static const Color bgHover = Color(0xFF252529);

  // 文字
  static const Color textPrimary = Color(0xFFF5F5F6);
  static const Color textSecondary = Color(0xFFA1A1AA);
  static const Color textTertiary = Color(0xFF71717A);

  // 语义色 — session 状态
  static const Color statusGreen = Color(0xFF22C55E);
  static const Color statusYellow = Color(0xFFEAB308);
  static const Color statusRed = Color(0xFFEF4444);
  static const Color statusGray = Color(0xFF52525B);

  // 边框
  static const Color borderColor = Color(0xFF27272A);
  static const Color borderFocus = Color(0xFF7C3AED);

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
      case 'stopped':
      default:
        return statusGray;
    }
  }

  static ThemeData get darkTheme {
    return ThemeData(
      brightness: Brightness.dark,
      scaffoldBackgroundColor: bgPrimary,
      colorScheme: const ColorScheme.dark(
        primary: brandPurple,
        secondary: brandPurpleLight,
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
            const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
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
        hintStyle: const TextStyle(color: textTertiary, fontSize: 14),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: brandPurple,
          foregroundColor: textPrimary,
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
        backgroundColor: bgSecondary,
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
        backgroundColor: bgSecondary,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
        ),
      ),
      dividerColor: borderColor,
      fontFamily: 'Roboto',
    );
  }
}
