import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import 'joi_colors.dart';

class JoiTheme {
  static ThemeData dark() {
    final inter = GoogleFonts.interTextTheme(ThemeData.dark().textTheme);

    return ThemeData(
      useMaterial3: true,
      brightness: Brightness.dark,
      scaffoldBackgroundColor: JoiColors.background,
      colorScheme: const ColorScheme.dark(
        primary: JoiColors.primary,
        secondary: JoiColors.secondary,
        tertiary: JoiColors.tertiary,
        error: JoiColors.error,
        surface: JoiColors.surface,
      ),
      textTheme: inter.copyWith(
        headlineLarge: inter.headlineLarge?.copyWith(
          color: JoiColors.textPrimary,
          fontWeight: FontWeight.w600,
        ),
        bodyLarge: inter.bodyLarge?.copyWith(
          color: JoiColors.textPrimary,
        ),
        bodyMedium: inter.bodyMedium?.copyWith(
          color: JoiColors.textSecondary,
        ),
        labelLarge: inter.labelLarge?.copyWith(
          color: JoiColors.textPrimary,
          fontWeight: FontWeight.w600,
        ),
      ),
      dividerColor: JoiColors.divider,
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: JoiColors.surfaceVariant,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: JoiColors.border),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: JoiColors.border),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: JoiColors.primary),
        ),
        hintStyle: const TextStyle(color: JoiColors.textTertiary),
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: JoiColors.primary,
          foregroundColor: JoiColors.textOnPrimary,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
        ),
      ),
    );
  }
}
