import 'dart:async';
import 'dart:convert';

import 'package:web_socket_client/web_socket_client.dart';

import '../../data/models/frame.dart';

enum WsConnectionState { connecting, connected, disconnected, reconnecting }

class WsService {
  final Uri _url;
  WebSocket? _ws;
  Timer? _heartbeatTimer;
  Timer? _pongTimer;

  final _connectionStateController =
      StreamController<WsConnectionState>.broadcast();
  final _frameController = StreamController<Frame>.broadcast();

  Stream<WsConnectionState> get connectionState =>
      _connectionStateController.stream;
  Stream<Frame> get frames => _frameController.stream;

  WsConnectionState _currentState = WsConnectionState.disconnected;
  WsConnectionState get currentState => _currentState;

  WsService(String url) : _url = Uri.parse(url);

  void connect() {
    _updateState(WsConnectionState.connecting);

    _ws = WebSocket(
      _url,
      backoff: BinaryExponentialBackoff(
        initial: const Duration(milliseconds: 500),
        maximumStep: 5,
      ),
    );

    _ws!.connection.listen((state) {
      if (state is Connected || state is Reconnected) {
        _updateState(WsConnectionState.connected);
        _startHeartbeat();
      } else if (state is Reconnecting) {
        _updateState(WsConnectionState.reconnecting);
        _stopHeartbeat();
      } else if (state is Disconnected) {
        _updateState(WsConnectionState.disconnected);
        _stopHeartbeat();
      }
    });

    _ws!.messages.listen((raw) {
      try {
        final json = jsonDecode(raw as String) as Map<String, dynamic>;
        if (json['type'] is! String) return;
        final frame = Frame.fromJson(json);
        _frameController.add(frame);
      } catch (_) {
        // Skip malformed frames
      }
    });
  }

  void send(Frame frame) {
    if (_ws == null) return;
    _ws!.send(jsonEncode(frame.toJson()));
  }

  void sendRaw(String type, {Map<String, dynamic>? data, String? id}) {
    final map = <String, dynamic>{'type': type};
    if (data != null) map['data'] = data;
    if (id != null) map['id'] = id;
    _ws?.send(jsonEncode(map));
  }

  void _startHeartbeat() {
    _stopHeartbeat();
    _heartbeatTimer = Timer.periodic(const Duration(seconds: 30), (_) {
      sendRaw('system.ping');
      _pongTimer = Timer(const Duration(seconds: 5), () {
        // Pong timeout — connection might be dead
        // web_socket_client handles reconnection automatically
      });
    });
  }

  void _stopHeartbeat() {
    _heartbeatTimer?.cancel();
    _heartbeatTimer = null;
    _pongTimer?.cancel();
    _pongTimer = null;
  }

  void cancelPongTimer() {
    _pongTimer?.cancel();
    _pongTimer = null;
  }

  void _updateState(WsConnectionState state) {
    _currentState = state;
    _connectionStateController.add(state);
  }

  void dispose() {
    _stopHeartbeat();
    _ws?.close();
    _connectionStateController.close();
    _frameController.close();
  }
}
