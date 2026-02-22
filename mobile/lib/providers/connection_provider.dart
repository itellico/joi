import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../services/websocket/frame_handler.dart';
import '../services/websocket/ws_service.dart';
import 'settings_provider.dart';

final wsServiceProvider = Provider<WsService>((ref) {
  final url = ref.watch(gatewayUrlProvider);
  final ws = WsService(url);
  ws.connect();
  ref.onDispose(() => ws.dispose());
  return ws;
});

final frameHandlerProvider = Provider<FrameHandler>((ref) {
  final ws = ref.watch(wsServiceProvider);
  final handler = FrameHandler(ws);
  ref.onDispose(() => handler.dispose());
  return handler;
});

final connectionStateProvider =
    StreamProvider<WsConnectionState>((ref) {
  final ws = ref.watch(wsServiceProvider);
  return ws.connectionState;
});
