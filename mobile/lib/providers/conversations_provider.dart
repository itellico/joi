import 'dart:async';

import 'package:drift/drift.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/constants/frame_types.dart';
import '../data/local/database.dart';
import '../data/models/frame.dart';
import 'connection_provider.dart';
import 'database_provider.dart';

final conversationsProvider =
    StateNotifierProvider<ConversationsNotifier, List<Conversation>>((ref) {
  return ConversationsNotifier(ref);
});

class ConversationsNotifier extends StateNotifier<List<Conversation>> {
  final Ref _ref;
  StreamSubscription<Map<String, dynamic>>? _sessionSub;
  StreamSubscription<List<Conversation>>? _dbSub;

  ConversationsNotifier(this._ref) : super([]) {
    _init();
  }

  AppDatabase get _db => _ref.read(databaseProvider);

  void _init() {
    // Watch local DB for changes
    _dbSub = _db.watchAllConversations().listen((convos) {
      state = convos;
    });

    // Listen for session data from gateway
    final handler = _ref.read(frameHandlerProvider);
    _sessionSub = handler.sessionData.listen((data) {
      if (data.containsKey('sessions')) {
        final sessions = (data['sessions'] as List<dynamic>)
            .map((s) => SessionInfo.fromJson(s as Map<String, dynamic>))
            .toList();

        // Upsert each session into local DB
        for (final s in sessions) {
          _db.upsertConversation(ConversationsCompanion(
            id: Value(s.id),
            title: Value(s.title),
            agentId: Value(s.agentId),
            messageCount: Value(s.messageCount),
            lastMessage: Value(s.lastMessage),
            updatedAt: Value(DateTime.parse(s.updatedAt)),
          ));
        }
      }
    });
  }

  void refresh() {
    final ws = _ref.read(wsServiceProvider);
    ws.sendRaw(FrameTypes.sessionList);
  }

  @override
  void dispose() {
    _sessionSub?.cancel();
    _dbSub?.cancel();
    super.dispose();
  }
}

final agentsProvider =
    StateNotifierProvider<AgentsNotifier, List<AgentInfo>>((ref) {
  return AgentsNotifier(ref);
});

class AgentsNotifier extends StateNotifier<List<AgentInfo>> {
  final Ref _ref;
  StreamSubscription<List<AgentInfo>>? _sub;

  AgentsNotifier(this._ref) : super([]) {
    final handler = _ref.read(frameHandlerProvider);
    _sub = handler.agentData.listen((agents) {
      state = agents;
    });
  }

  void refresh() {
    final ws = _ref.read(wsServiceProvider);
    ws.sendRaw(FrameTypes.agentList);
  }

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }
}
