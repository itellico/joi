import 'dart:ui';

abstract final class JoiColors {
  // Core backgrounds
  static const background = Color(0xFF0A0A0F);
  static const surface = Color(0xFF12121A);
  static const surfaceVariant = Color(0xFF1A1A25);
  static const surfaceHigh = Color(0xFF222230);

  // Accent — Cyan
  static const primary = Color(0xFF00E5FF);
  static const primaryMuted = Color(0xFF0097A7);
  static const primaryGlow = Color(0x3300E5FF);

  // Accent — Amber
  static const secondary = Color(0xFFFFAB40);
  static const secondaryMuted = Color(0xFFC77800);
  static const secondaryGlow = Color(0x33FFAB40);

  // Accent — Violet
  static const tertiary = Color(0xFFB388FF);
  static const tertiaryMuted = Color(0xFF7C4DFF);

  // Semantic
  static const error = Color(0xFFFF5252);
  static const success = Color(0xFF69F0AE);
  static const warning = Color(0xFFFFD740);
  static const info = Color(0xFF40C4FF);

  // Text
  static const textPrimary = Color(0xFFF5F5F7);
  static const textSecondary = Color(0xFFB0B0C0);
  static const textTertiary = Color(0xFF6B6B80);
  static const textOnPrimary = Color(0xFF0A0A0F);

  // Borders & dividers
  static const border = Color(0xFF2A2A3A);
  static const borderSubtle = Color(0xFF1E1E2E);
  static const divider = Color(0xFF1A1A25);
}
