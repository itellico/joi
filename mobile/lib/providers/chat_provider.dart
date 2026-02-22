import 'dart:async';

import 'package:drift/drift.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uuid/uuid.dart';

import '../core/constants/frame_types.dart';
import '../data/local/database.dart';
import '../data/models/frame.dart';
import 'connection_provider.dart';
import 'database_provider.dart';

const _uuid = Uuid();

// Holds the currently active conversation id
final activeConversationProvider = StateProvider<String?>((ref) => null);

// Chat message for UI display
class ChatMessage {
  final String id;
  final String role;
  final String content;
  final String? model;
  final DateTime createdAt;
  final bool isStreaming;

  const ChatMessage({
    required this.id,
    required this.role,
    required this.content,
    this.model,
    required this.createdAt,
    this.isStreaming = false,
  });

  ChatMessage copyWith({String? content, bool? isStreaming, String? model}) =>
      ChatMessage(
        id: id,
        role: role,
        content: content ?? this.content,
        model: model ?? this.model,
        createdAt: createdAt,
        isStreaming: isStreaming ?? this.isStreaming,
      );
}

// Chat notifier — manages messages for the active conversation
final chatNotifierProvider =
    StateNotifierProvider<ChatNotifier, List<ChatMessage>>((ref) {
  return ChatNotifier(ref);
});

class ChatNotifier extends StateNotifier<List<ChatMessage>> {
  final Ref _ref;
  StreamSubscription<ChatStreamData>? _streamSub;
  StreamSubscription<ChatDoneData>? _doneSub;
  StreamSubscription<String>? _errorSub;

  ChatNotifier(this._ref) : super([]) {
    _listenToFrames();
  }

  AppDatabase get _db => _ref.read(databaseProvider);

  void _listenToFrames() {
    final handler = _ref.read(frameHandlerProvider);

    _streamSub = handler.chatStream.listen((data) {
      final idx = state.indexWhere((m) => m.id == data.messageId);
      if (idx >= 0) {
        final existing = state[idx];
        final updated = existing.copyWith(
          content: existing.content + data.delta,
        );
        state = [...state]..[idx] = updated;
      } else {
        state = [
          ...state,
          ChatMessage(
            id: data.messageId,
            role: 'assistant',
            content: data.delta,
            model: data.model,
            createdAt: DateTime.now(),
            isStreaming: true,
          ),
        ];
      }
    });

    _doneSub = handler.chatDone.listen((data) {
      final idx = state.indexWhere((m) => m.id == data.messageId);
      if (idx >= 0) {
        final updated = state[idx].copyWith(
          content: data.content,
          isStreaming: false,
          model: data.model,
        );
        state = [...state]..[idx] = updated;
      }

      // Update active conversation
      _ref.read(activeConversationProvider.notifier).state =
          data.conversationId;

      // Save to Drift
      _db.upsertMessage(MessagesCompanion.insert(
        id: data.messageId,
        conversationId: data.conversationId,
        role: 'assistant',
        content: Value(data.content),
        model: Value(data.model),
        inputTokens: Value(data.usage?.inputTokens),
        outputTokens: Value(data.usage?.outputTokens),
      ));

      // Update conversation
      _db.upsertConversation(ConversationsCompanion(
        id: Value(data.conversationId),
        agentId: const Value('personal'),
        lastMessage: Value(
          data.content.length > 100
              ? '${data.content.substring(0, 100)}...'
              : data.content,
        ),
        updatedAt: Value(DateTime.now()),
      ));
    });

    _errorSub = handler.chatError.listen((error) {
      // Add error as a system message
      state = [
        ...state,
        ChatMessage(
          id: _uuid.v4(),
          role: 'error',
          content: error,
          createdAt: DateTime.now(),
        ),
      ];
    });
  }

  Future<void> sendMessage(String content, {String? agentId}) async {
    final conversationId = _ref.read(activeConversationProvider);
    final messageId = _uuid.v4();

    // Add user message to UI immediately
    state = [
      ...state,
      ChatMessage(
        id: messageId,
        role: 'user',
        content: content,
        createdAt: DateTime.now(),
      ),
    ];

    // Send frame to gateway
    final ws = _ref.read(wsServiceProvider);
    ws.sendRaw(FrameTypes.chatSend, data: {
      if (conversationId != null) 'conversationId': conversationId,
      'agentId': agentId ?? 'personal',
      'content': content,
      'mode': 'api',
    });

    // Save user message to Drift (use conversationId if we have one)
    if (conversationId != null) {
      await _db.upsertMessage(MessagesCompanion.insert(
        id: messageId,
        conversationId: conversationId,
        role: 'user',
        content: Value(content),
      ));
    }
  }

  Future<void> loadConversation(String conversationId) async {
    _ref.read(activeConversationProvider.notifier).state = conversationId;

    // Load from local DB first
    final localMessages =
        await _db.getMessagesForConversation(conversationId);
    state = localMessages
        .map((m) => ChatMessage(
              id: m.id,
              role: m.role,
              content: m.content ?? '',
              model: m.model,
              createdAt: m.createdAt,
            ))
        .toList();

    // Also request from gateway to get the latest
    final ws = _ref.read(wsServiceProvider);
    ws.sendRaw(FrameTypes.sessionLoad, data: {
      'conversationId': conversationId,
    });
  }

  void newConversation() {
    _ref.read(activeConversationProvider.notifier).state = null;
    state = [];
  }

  @override
  void dispose() {
    _streamSub?.cancel();
    _doneSub?.cancel();
    _errorSub?.cancel();
    super.dispose();
  }
}
