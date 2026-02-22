import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/local/database.dart';
import 'database_provider.dart';

const _defaultGatewayUrl = 'ws://localhost:3100/ws';

final gatewayUrlProvider =
    StateNotifierProvider<GatewayUrlNotifier, String>((ref) {
  return GatewayUrlNotifier(ref.watch(databaseProvider));
});

class GatewayUrlNotifier extends StateNotifier<String> {
  final AppDatabase _db;

  GatewayUrlNotifier(this._db) : super(_defaultGatewayUrl) {
    _load();
  }

  Future<void> _load() async {
    final url = await _db.getSetting('gateway_url');
    if (url != null && url.isNotEmpty) {
      state = url;
    }
  }

  Future<void> update(String url) async {
    state = url;
    await _db.setSetting('gateway_url', url);
  }
}
