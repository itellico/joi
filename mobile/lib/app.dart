import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

import 'core/theme/joi_colors.dart';
import 'core/theme/joi_theme.dart';
import 'features/chat/chat_screen.dart';
import 'features/conversations/conversations_screen.dart';
import 'features/settings/settings_screen.dart';
import 'services/platform/macos_panel_controller.dart';

class JoiApp extends ConsumerStatefulWidget {
  const JoiApp({super.key});

  @override
  ConsumerState<JoiApp> createState() => _JoiAppState();
}

class _JoiAppState extends ConsumerState<JoiApp> {
  MacOsPanelController? _panelController;

  @override
  void initState() {
    super.initState();
    if (Platform.isMacOS) {
      _initMacOs();
    }
  }

  Future<void> _initMacOs() async {
    // Phase 1: Just set up tray icon and basic window.
    // Full panel controller will be wired up after basic UI is verified.
    try {
      _panelController = MacOsPanelController();
      _panelController!.onQuit = () => exit(0);
      await _panelController!.init();
      await _panelController!.showPanel();
    } catch (e, st) {
      debugPrint('MacOS panel init error: $e\n$st');
    }
  }

  @override
  void dispose() {
    _panelController?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'JOI',
      debugShowCheckedModeBanner: false,
      theme: JoiTheme.dark(),
      home: Platform.isMacOS ? const MacOsShell() : const IosShell(),
    );
  }
}

// ─── macOS: Simple tab-based navigation inside the panel ───

enum MacOsView { chat, conversations, settings }

class MacOsShell extends StatefulWidget {
  const MacOsShell({super.key});

  @override
  State<MacOsShell> createState() => _MacOsShellState();
}

class _MacOsShellState extends State<MacOsShell> {
  var _currentView = MacOsView.chat;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: JoiColors.background,
      body: ClipRRect(
        borderRadius: BorderRadius.circular(12),
        child: Container(
          decoration: BoxDecoration(
            color: JoiColors.background,
            border: Border.all(color: JoiColors.border, width: 0.5),
            borderRadius: BorderRadius.circular(12),
          ),
          child: Column(
            children: [
              Expanded(
                child: IndexedStack(
                  index: _currentView.index,
                  children: [
                    const ChatScreen(),
                    ConversationsScreen(
                      onSelectConversation: () {
                        setState(() => _currentView = MacOsView.chat);
                      },
                    ),
                    const SettingsScreen(),
                  ],
                ),
              ),
              // Bottom nav
              Container(
                padding: const EdgeInsets.symmetric(vertical: 6),
                decoration: const BoxDecoration(
                  color: JoiColors.surface,
                  border: Border(
                    top: BorderSide(color: JoiColors.borderSubtle),
                  ),
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceAround,
                  children: [
                    _NavButton(
                      icon: PhosphorIconsRegular.chatCircle,
                      activeIcon: PhosphorIconsFill.chatCircle,
                      label: 'Chat',
                      isActive: _currentView == MacOsView.chat,
                      onTap: () =>
                          setState(() => _currentView = MacOsView.chat),
                    ),
                    _NavButton(
                      icon: PhosphorIconsRegular.chats,
                      activeIcon: PhosphorIconsFill.chats,
                      label: 'History',
                      isActive: _currentView == MacOsView.conversations,
                      onTap: () => setState(
                          () => _currentView = MacOsView.conversations),
                    ),
                    _NavButton(
                      icon: PhosphorIconsRegular.gear,
                      activeIcon: PhosphorIconsFill.gear,
                      label: 'Settings',
                      isActive: _currentView == MacOsView.settings,
                      onTap: () =>
                          setState(() => _currentView = MacOsView.settings),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _NavButton extends StatelessWidget {
  final IconData icon;
  final IconData activeIcon;
  final String label;
  final bool isActive;
  final VoidCallback onTap;

  const _NavButton({
    required this.icon,
    required this.activeIcon,
    required this.label,
    required this.isActive,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 4),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              isActive ? activeIcon : icon,
              color: isActive ? JoiColors.primary : JoiColors.textTertiary,
              size: 22,
            ),
            const SizedBox(height: 2),
            Text(
              label,
              style: TextStyle(
                color: isActive ? JoiColors.primary : JoiColors.textTertiary,
                fontSize: 10,
                fontWeight: isActive ? FontWeight.w600 : FontWeight.w400,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ─── iOS: Placeholder (Phase 2) ───

class IosShell extends StatelessWidget {
  const IosShell({super.key});

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      backgroundColor: JoiColors.background,
      body: ChatScreen(),
    );
  }
}
