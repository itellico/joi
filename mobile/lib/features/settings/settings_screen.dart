import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

import '../../core/theme/joi_colors.dart';
import '../../providers/settings_provider.dart';

class SettingsScreen extends ConsumerStatefulWidget {
  const SettingsScreen({super.key});

  @override
  ConsumerState<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends ConsumerState<SettingsScreen> {
  late TextEditingController _urlController;

  @override
  void initState() {
    super.initState();
    _urlController =
        TextEditingController(text: ref.read(gatewayUrlProvider));
  }

  @override
  Widget build(BuildContext context) {
    final currentUrl = ref.watch(gatewayUrlProvider);

    return Column(
      children: [
        // Header
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          decoration: const BoxDecoration(
            color: JoiColors.surface,
            border: Border(
              bottom: BorderSide(color: JoiColors.borderSubtle),
            ),
          ),
          child: const Row(
            children: [
              Text(
                'Settings',
                style: TextStyle(
                  color: JoiColors.textPrimary,
                  fontSize: 18,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
        ),

        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              // Gateway URL
              const Text(
                'GATEWAY',
                style: TextStyle(
                  color: JoiColors.textTertiary,
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                  letterSpacing: 1.2,
                ),
              ),
              const SizedBox(height: 8),
              _SettingsTile(
                icon: PhosphorIconsRegular.plugs,
                title: 'Gateway URL',
                subtitle: currentUrl,
                onTap: () => _showUrlDialog(context),
              ),

              const SizedBox(height: 24),
              const Text(
                'ABOUT',
                style: TextStyle(
                  color: JoiColors.textTertiary,
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                  letterSpacing: 1.2,
                ),
              ),
              const SizedBox(height: 8),
              _SettingsTile(
                icon: PhosphorIconsRegular.info,
                title: 'Version',
                subtitle: '0.1.0',
              ),
            ],
          ),
        ),
      ],
    );
  }

  void _showUrlDialog(BuildContext context) {
    _urlController.text = ref.read(gatewayUrlProvider);
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: JoiColors.surfaceHigh,
        title: const Text('Gateway URL',
            style: TextStyle(color: JoiColors.textPrimary)),
        content: TextField(
          controller: _urlController,
          style: const TextStyle(color: JoiColors.textPrimary, fontSize: 14),
          decoration: const InputDecoration(
            hintText: 'ws://localhost:3100/ws',
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child:
                const Text('Cancel', style: TextStyle(color: JoiColors.textSecondary)),
          ),
          FilledButton(
            onPressed: () {
              ref
                  .read(gatewayUrlProvider.notifier)
                  .update(_urlController.text.trim());
              Navigator.pop(ctx);
            },
            child: const Text('Save'),
          ),
        ],
      ),
    );
  }

  @override
  void dispose() {
    _urlController.dispose();
    super.dispose();
  }
}

class _SettingsTile extends StatelessWidget {
  final IconData icon;
  final String title;
  final String? subtitle;
  final VoidCallback? onTap;

  const _SettingsTile({
    required this.icon,
    required this.title,
    this.subtitle,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        decoration: BoxDecoration(
          color: JoiColors.surfaceVariant,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: JoiColors.border, width: 0.5),
        ),
        child: Row(
          children: [
            Container(
              width: 34,
              height: 34,
              decoration: BoxDecoration(
                color: JoiColors.primary.withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(9),
              ),
              child: Icon(icon, color: JoiColors.primary, size: 18),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: const TextStyle(
                      color: JoiColors.textPrimary,
                      fontSize: 14,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                  if (subtitle != null) ...[
                    const SizedBox(height: 2),
                    Text(
                      subtitle!,
                      style: const TextStyle(
                        color: JoiColors.textTertiary,
                        fontSize: 12,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ],
              ),
            ),
            if (onTap != null)
              Icon(
                PhosphorIconsRegular.caretRight,
                color: JoiColors.textTertiary,
                size: 18,
              ),
          ],
        ),
      ),
    );
  }
}
