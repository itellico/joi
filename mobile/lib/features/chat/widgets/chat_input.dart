import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';

import '../../../core/theme/joi_colors.dart';

class ChatInput extends StatefulWidget {
  final bool enabled;
  final ValueChanged<String> onSend;

  const ChatInput({
    super.key,
    required this.enabled,
    required this.onSend,
  });

  @override
  State<ChatInput> createState() => _ChatInputState();
}

class _ChatInputState extends State<ChatInput> {
  final _controller = TextEditingController();
  final _focusNode = FocusNode();
  bool _hasText = false;

  @override
  void initState() {
    super.initState();
    _controller.addListener(() {
      final hasText = _controller.text.trim().isNotEmpty;
      if (hasText != _hasText) {
        setState(() => _hasText = hasText);
      }
    });
  }

  void _send() {
    final text = _controller.text.trim();
    if (text.isEmpty || !widget.enabled) return;
    widget.onSend(text);
    _controller.clear();
    _focusNode.requestFocus();
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 12),
      decoration: const BoxDecoration(
        color: JoiColors.surface,
        border: Border(
          top: BorderSide(color: JoiColors.borderSubtle),
        ),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          // Mic button placeholder
          IconButton(
            icon: Icon(
              PhosphorIconsRegular.microphone,
              color: JoiColors.textTertiary,
              size: 22,
            ),
            onPressed: null, // Phase 2
            padding: EdgeInsets.zero,
            constraints: const BoxConstraints(minWidth: 36, minHeight: 36),
          ),
          const SizedBox(width: 4),

          // Text field
          Expanded(
            child: KeyboardListener(
              focusNode: FocusNode(),
              onKeyEvent: (event) {
                // Enter to send, Shift+Enter for newline
                if (event is KeyDownEvent &&
                    event.logicalKey == LogicalKeyboardKey.enter &&
                    !HardwareKeyboard.instance.isShiftPressed) {
                  _send();
                }
              },
              child: TextField(
                controller: _controller,
                focusNode: _focusNode,
                enabled: widget.enabled,
                maxLines: 4,
                minLines: 1,
                style: const TextStyle(
                  color: JoiColors.textPrimary,
                  fontSize: 14,
                ),
                decoration: InputDecoration(
                  hintText: widget.enabled ? 'Message JOI...' : 'Connecting...',
                  hintStyle: const TextStyle(color: JoiColors.textTertiary),
                  filled: true,
                  fillColor: JoiColors.surfaceVariant,
                  contentPadding: const EdgeInsets.symmetric(
                    horizontal: 14,
                    vertical: 10,
                  ),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(20),
                    borderSide: const BorderSide(color: JoiColors.border),
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(20),
                    borderSide: const BorderSide(color: JoiColors.border),
                  ),
                  focusedBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(20),
                    borderSide: const BorderSide(color: JoiColors.primary, width: 1),
                  ),
                ),
              ),
            ),
          ),
          const SizedBox(width: 4),

          // Send button
          AnimatedOpacity(
            opacity: _hasText && widget.enabled ? 1.0 : 0.3,
            duration: const Duration(milliseconds: 150),
            child: IconButton(
              icon: Icon(
                PhosphorIconsFill.paperPlaneRight,
                color: JoiColors.primary,
                size: 22,
              ),
              onPressed: _hasText && widget.enabled ? _send : null,
              padding: EdgeInsets.zero,
              constraints: const BoxConstraints(minWidth: 36, minHeight: 36),
            ),
          ),
        ],
      ),
    );
  }

  @override
  void dispose() {
    _controller.dispose();
    _focusNode.dispose();
    super.dispose();
  }
}
