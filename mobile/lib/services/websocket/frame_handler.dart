import 'dart:async';

import '../../core/constants/frame_types.dart';
import '../../data/models/frame.dart';
import 'ws_service.dart';

class FrameHandler {
  final WsService _ws;
  late final StreamSubscription<Frame> _sub;

  final _chatStream = StreamController<ChatStreamData>.broadcast();
  final _chatDone = StreamController<ChatDoneData>.broadcast();
  final _chatError = StreamController<String>.broadcast();
  final _chatToolUse = StreamController<ChatToolUseData>.broadcast();
  final _chatToolResult = StreamController<ChatToolResultData>.broadcast();
  final _sessionData = StreamController<Map<String, dynamic>>.broadcast();
  final _agentData = StreamController<List<AgentInfo>>.broadcast();

  Stream<ChatStreamData> get chatStream => _chatStream.stream;
  Stream<ChatDoneData> get chatDone => _chatDone.stream;
  Stream<String> get chatError => _chatError.stream;
  Stream<ChatToolUseData> get chatToolUse => _chatToolUse.stream;
  Stream<ChatToolResultData> get chatToolResult => _chatToolResult.stream;
  Stream<Map<String, dynamic>> get sessionData => _sessionData.stream;
  Stream<List<AgentInfo>> get agentData => _agentData.stream;

  FrameHandler(this._ws) {
    _sub = _ws.frames.listen(_handleFrame);
  }

  void _handleFrame(Frame frame) {
    final data = frame.data;

    switch (frame.type) {
      case FrameTypes.chatStream:
        if (data != null) {
          _chatStream.add(ChatStreamData.fromJson(data));
        }

      case FrameTypes.chatDone:
        if (data != null) {
          _chatDone.add(ChatDoneData.fromJson(data));
        }

      case FrameTypes.chatError:
        _chatError.add(frame.error ?? data?['error'] as String? ?? 'Unknown error');

      case FrameTypes.chatToolUse:
        if (data != null) {
          _chatToolUse.add(ChatToolUseData.fromJson(data));
        }

      case FrameTypes.chatToolResult:
        if (data != null) {
          _chatToolResult.add(ChatToolResultData.fromJson(data));
        }

      case FrameTypes.sessionData:
        if (data != null) {
          _sessionData.add(data);
        }

      case FrameTypes.agentData:
        if (data != null) {
          final agents = (data['agents'] as List<dynamic>?)
                  ?.map((a) => AgentInfo.fromJson(a as Map<String, dynamic>))
                  .toList() ??
              [];
          _agentData.add(agents);
        }

      case FrameTypes.systemPong:
        _ws.cancelPongTimer();

      case FrameTypes.systemStatus:
        // Welcome frame — connection confirmed
        break;
    }
  }

  void dispose() {
    _sub.cancel();
    _chatStream.close();
    _chatDone.close();
    _chatError.close();
    _chatToolUse.close();
    _chatToolResult.close();
    _sessionData.close();
    _agentData.close();
  }
}
