import 'package:flutter/material.dart';

import '../../core/theme/joi_colors.dart';
import '../../services/websocket/ws_service.dart';

class ConnectionBanner extends StatelessWidget {
  final WsConnectionState state;

  const ConnectionBanner({super.key, required this.state});

  @override
  Widget build(BuildContext context) {
    if (state == WsConnectionState.connected) return const SizedBox.shrink();

    final (color, label) = switch (state) {
      WsConnectionState.connecting => (JoiColors.warning, 'Connecting...'),
      WsConnectionState.reconnecting => (JoiColors.warning, 'Reconnecting...'),
      WsConnectionState.disconnected => (JoiColors.error, 'Disconnected'),
      WsConnectionState.connected => (JoiColors.success, 'Connected'),
    };

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(vertical: 6),
      color: color.withValues(alpha: 0.15),
      child: Text(
        label,
        textAlign: TextAlign.center,
        style: TextStyle(color: color, fontSize: 12, fontWeight: FontWeight.w500),
      ),
    );
  }
}
