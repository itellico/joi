import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme/joi_colors.dart';
import '../../providers/chat_provider.dart';
import '../../providers/connection_provider.dart';
import '../../services/websocket/ws_service.dart';
import '../../shared/widgets/connection_banner.dart';
import '../../shared/widgets/connection_status_pill.dart';
import 'widgets/chat_input.dart';
import 'widgets/message_bubble.dart';

class ChatScreen extends ConsumerStatefulWidget {
  const ChatScreen({super.key});

  @override
  ConsumerState<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends ConsumerState<ChatScreen> {
  final _scrollController = ScrollController();

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollController.hasClients) {
        _scrollController.animateTo(
          _scrollController.position.maxScrollExtent,
          duration: const Duration(milliseconds: 200),
          curve: Curves.easeOut,
        );
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final messages = ref.watch(chatNotifierProvider);
    final connectionState = ref.watch(connectionStateProvider);

    // Scroll to bottom when messages change
    ref.listen(chatNotifierProvider, (prev, next) {
      if (next.length != (prev?.length ?? 0) ||
          (next.isNotEmpty && next.last.isStreaming)) {
        _scrollToBottom();
      }
    });

    final connState =
        connectionState.valueOrNull ?? WsConnectionState.connecting;

    return Column(
      children: [
        // Header
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          decoration: const BoxDecoration(
            color: JoiColors.surface,
            border: Border(bottom: BorderSide(color: JoiColors.borderSubtle)),
          ),
          child: Row(
            children: [
              const Text(
                'JOI',
                style: TextStyle(
                  color: JoiColors.primary,
                  fontSize: 18,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 1,
                ),
              ),
              const Spacer(),
              ConnectionStatusPill(state: connState),
            ],
          ),
        ),

        // Connection banner
        ConnectionBanner(state: connState),

        // Messages
        Expanded(
          child: messages.isEmpty
              ? const _EmptyState()
              : ListView.builder(
                  controller: _scrollController,
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  itemCount: messages.length,
                  itemBuilder: (context, index) {
                    final msg = messages[index];
                    return MessageBubble(
                      text: msg.content,
                      isUser: msg.role == 'user',
                      isError: msg.role == 'error',
                      timestamp: msg.createdAt,
                      isStreaming: msg.isStreaming,
                    );
                  },
                ),
        ),

        // Input
        ChatInput(
          enabled: connState == WsConnectionState.connected,
          onSend: (text) {
            ref.read(chatNotifierProvider.notifier).sendMessage(text);
          },
        ),
      ],
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState();

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 64,
            height: 64,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              gradient: RadialGradient(
                colors: [
                  JoiColors.primary.withValues(alpha: 0.3),
                  JoiColors.primary.withValues(alpha: 0.05),
                ],
              ),
            ),
            child: const Icon(
              Icons.chat_bubble_outline_rounded,
              color: JoiColors.primary,
              size: 28,
            ),
          ),
          const SizedBox(height: 16),
          const Text(
            'Start a conversation',
            style: TextStyle(color: JoiColors.textSecondary, fontSize: 15),
          ),
        ],
      ),
    );
  }
}
