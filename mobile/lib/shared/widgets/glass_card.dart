import 'dart:ui';

import 'package:flutter/material.dart';

class GlassCard extends StatelessWidget {
  final Widget child;
  final double blurSigma;
  final double backgroundOpacity;
  final double borderOpacity;
  final double borderRadius;
  final EdgeInsetsGeometry? padding;
  final Color? tintColor;

  const GlassCard({
    super.key,
    required this.child,
    this.blurSigma = 24,
    this.backgroundOpacity = 0.06,
    this.borderOpacity = 0.08,
    this.borderRadius = 16,
    this.padding,
    this.tintColor,
  });

  @override
  Widget build(BuildContext context) {
    final tint = tintColor ?? Colors.white;

    return ClipRRect(
      borderRadius: BorderRadius.circular(borderRadius),
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: blurSigma, sigmaY: blurSigma),
        child: Container(
          padding: padding ?? const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: tint.withValues(alpha: backgroundOpacity),
            borderRadius: BorderRadius.circular(borderRadius),
            border: Border.all(
              color: tint.withValues(alpha: borderOpacity),
              width: 1,
            ),
          ),
          child: child,
        ),
      ),
    );
  }
}
