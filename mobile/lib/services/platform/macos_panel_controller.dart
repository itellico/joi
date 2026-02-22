import 'dart:async';
import 'dart:ui';

import 'package:tray_manager/tray_manager.dart';
import 'package:window_manager/window_manager.dart';

class MacOsPanelController with TrayListener, WindowListener {
  bool _isVisible = false;
  bool _ignoreBlur = false; // Prevents blur from firing right after show
  VoidCallback? onTogglePanel;
  VoidCallback? onQuit;
  VoidCallback? onSettings;

  bool get isVisible => _isVisible;

  Future<void> init() async {
    await windowManager.ensureInitialized();

    final windowOptions = WindowOptions(
      size: const Size(400, 600),
      minimumSize: const Size(360, 400),
      skipTaskbar: true,
      titleBarStyle: TitleBarStyle.hidden,
      backgroundColor: const Color(0xFF0A0A0F),
      alwaysOnTop: true,
    );

    await windowManager.waitUntilReadyToShow(windowOptions, () async {
      await windowManager.setHasShadow(true);
      await windowManager.setMovable(false);
      await windowManager.setResizable(false);
    });

    windowManager.addListener(this);

    // Set up tray icon (loaded from Flutter assets via rootBundle)
    await trayManager.setIcon(
      'assets/icons/tray_icon.png',
      isTemplate: true,
    );
    await trayManager.setToolTip('JOI');

    final menu = Menu(items: [
      MenuItem(label: 'Settings', onClick: (_) => onSettings?.call()),
      MenuItem.separator(),
      MenuItem(label: 'Quit JOI', onClick: (_) => onQuit?.call()),
    ]);
    await trayManager.setContextMenu(menu);

    trayManager.addListener(this);
  }

  @override
  void onTrayIconMouseDown() {
    togglePanel();
  }

  @override
  void onTrayIconRightMouseDown() {
    trayManager.popUpContextMenu();
  }

  Future<void> togglePanel() async {
    if (_isVisible) {
      await hidePanel();
    } else {
      await showPanel();
    }
    onTogglePanel?.call();
  }

  Future<void> showPanel() async {
    _ignoreBlur = true;

    // Position below the tray icon area
    final trayBounds = await trayManager.getBounds();

    if (trayBounds != null && trayBounds.left > 0 && trayBounds.top < 100) {
      final x = trayBounds.left - 180;
      final y = trayBounds.bottom + 4;
      await windowManager.setPosition(Offset(x, y));
    } else {
      await windowManager.center();
    }

    await windowManager.show();
    await windowManager.focus();
    _isVisible = true;

    // Allow blur events after a short delay
    Timer(const Duration(milliseconds: 500), () {
      _ignoreBlur = false;
    });
  }

  Future<void> hidePanel() async {
    await windowManager.hide();
    _isVisible = false;
  }

  @override
  void onWindowBlur() {
    if (_isVisible && !_ignoreBlur) {
      hidePanel();
    }
  }

  void dispose() {
    trayManager.removeListener(this);
    windowManager.removeListener(this);
  }
}
