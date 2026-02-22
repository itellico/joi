import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

import '../../core/theme/joi_colors.dart';
import '../../providers/chat_provider.dart';
import '../../providers/conversations_provider.dart';

class ConversationsScreen extends ConsumerStatefulWidget {
  final VoidCallback onSelectConversation;

  const ConversationsScreen({super.key, required this.onSelectConversation});

  @override
  ConsumerState<ConversationsScreen> createState() =>
      _ConversationsScreenState();
}

class _ConversationsScreenState extends ConsumerState<ConversationsScreen> {
  @override
  void initState() {
    super.initState();
    // Refresh conversations from gateway
    Future.microtask(() {
      ref.read(conversationsProvider.notifier).refresh();
    });
  }

  @override
  Widget build(BuildContext context) {
    final conversations = ref.watch(conversationsProvider);

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
          child: Row(
            children: [
              const Text(
                'Conversations',
                style: TextStyle(
                  color: JoiColors.textPrimary,
                  fontSize: 18,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const Spacer(),
              IconButton(
                icon: Icon(
                  PhosphorIconsRegular.plus,
                  color: JoiColors.primary,
                  size: 22,
                ),
                onPressed: () {
                  ref.read(chatNotifierProvider.notifier).newConversation();
                  widget.onSelectConversation();
                },
                padding: EdgeInsets.zero,
                constraints: const BoxConstraints(minWidth: 36, minHeight: 36),
              ),
            ],
          ),
        ),

        // List
        Expanded(
          child: conversations.isEmpty
              ? const Center(
                  child: Text(
                    'No conversations yet',
                    style: TextStyle(color: JoiColors.textTertiary),
                  ),
                )
              : ListView.builder(
                  itemCount: conversations.length,
                  itemBuilder: (context, index) {
                    final conv = conversations[index];
                    return _ConversationTile(
                      title: conv.title ?? 'Untitled',
                      lastMessage: conv.lastMessage,
                      updatedAt: conv.updatedAt,
                      onTap: () {
                        ref
                            .read(chatNotifierProvider.notifier)
                            .loadConversation(conv.id);
                        widget.onSelectConversation();
                      },
                    );
                  },
                ),
        ),
      ],
    );
  }
}

class _ConversationTile extends StatelessWidget {
  final String title;
  final String? lastMessage;
  final DateTime updatedAt;
  final VoidCallback onTap;

  const _ConversationTile({
    required this.title,
    this.lastMessage,
    required this.updatedAt,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        decoration: const BoxDecoration(
          border: Border(
            bottom: BorderSide(color: JoiColors.borderSubtle, width: 0.5),
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    title,
                    style: const TextStyle(
                      color: JoiColors.textPrimary,
                      fontSize: 14,
                      fontWeight: FontWeight.w500,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                Text(
                  _formatDate(updatedAt),
                  style: const TextStyle(
                    color: JoiColors.textTertiary,
                    fontSize: 11,
                  ),
                ),
              ],
            ),
            if (lastMessage != null) ...[
              const SizedBox(height: 4),
              Text(
                lastMessage!,
                style: const TextStyle(
                  color: JoiColors.textSecondary,
                  fontSize: 13,
                ),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
            ],
          ],
        ),
      ),
    );
  }

  String _formatDate(DateTime dt) {
    final now = DateTime.now();
    final diff = now.difference(dt);
    if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
    if (diff.inHours < 24) return '${diff.inHours}h ago';
    if (diff.inDays < 7) return '${diff.inDays}d ago';
    return '${dt.day}.${dt.month}.${dt.year}';
  }
}
