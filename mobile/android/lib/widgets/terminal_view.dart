import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import '../../models/event_message.dart';
import '../../providers/session_provider.dart';
import '../../theme/app_theme.dart';
import '../../utils/terminal_text_formatter.dart';

/// 终端模式视图 — 等宽字体，日志流风格，原生终端体验
class TerminalView extends StatefulWidget {
  const TerminalView({super.key});

  @override
  State<TerminalView> createState() => _TerminalViewState();
}

class _TerminalViewState extends State<TerminalView> {
  final ScrollController _scrollController = ScrollController();
  bool _autoScroll = true;
  bool _showTimestamps = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final provider = context.read<SessionProvider>();
    // 新事件到达时自动滚到底部
    if (_autoScroll && provider.activeSessionEvents.isNotEmpty) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (_scrollController.hasClients) {
          _scrollController.jumpTo(_scrollController.position.maxScrollExtent);
        }
      });
    }
  }

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final events = context.watch<SessionProvider>().activeSessionEvents;
    final terminalBlocks = _buildBlocks(events);

    if (terminalBlocks.isEmpty) {
      return const Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.terminal, size: 48, color: AppTheme.textTertiary),
            SizedBox(height: 12),
            Text(
              '等待输出…',
              style: TextStyle(color: AppTheme.textTertiary, fontSize: 14),
            ),
          ],
        ),
      );
    }

    return Stack(
      children: [
        ListView.builder(
          controller: _scrollController,
          padding: const EdgeInsets.fromLTRB(10, 8, 10, 8),
          itemCount: terminalBlocks.length,
          itemBuilder: (context, index) {
            final block = terminalBlocks[index];
            return _TerminalLine(block: block, showTimestamp: _showTimestamps);
          },
        ),
        // 浮动控制按钮
        Positioned(
          right: 8,
          bottom: 8,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              _MiniButton(
                icon: _autoScroll ? Icons.lock : Icons.lock_open,
                label: _autoScroll ? '自动滚动' : '暂停滚动',
                onTap: () => setState(() => _autoScroll = !_autoScroll),
              ),
              const SizedBox(height: 4),
              _MiniButton(
                icon: _showTimestamps
                    ? Icons.schedule
                    : Icons.schedule_outlined,
                label: _showTimestamps ? '隐藏时间' : '显示时间',
                onTap: () => setState(() => _showTimestamps = !_showTimestamps),
              ),
            ],
          ),
        ),
      ],
    );
  }

  List<_TerminalBlock> _buildBlocks(List<EventMessage> events) {
    final blocks = <_TerminalBlock>[];

    for (final event in events) {
      if (event.type == EventType.systemNotice && !_showTimestamps) {
        continue;
      }

      final displayText = TerminalTextFormatter.displayText(event.text);
      if (displayText.isEmpty) continue;

      final lines = displayText
          .split('\n')
          .map((line) => line.trimRight())
          .where((line) => line.trim().isNotEmpty)
          .toList();
      final promptLines = TerminalTextFormatter.extractPromptLines(event.text)
          .map((line) => line.trimRight())
          .toSet();

      if (event.isUserMessage) {
        blocks.add(
          _TerminalBlock(
            type: _TerminalBlockType.userInput,
            text: displayText,
            ts: event.ts,
          ),
        );
        continue;
      }

      if (event.type == EventType.systemNotice) {
        blocks.add(
          _TerminalBlock(
            type: _TerminalBlockType.system,
            text: displayText,
            ts: event.ts,
          ),
        );
        continue;
      }

      if (event.stream == OutputStream.stderr) {
        blocks.add(
          _TerminalBlock(
            type: _TerminalBlockType.stderr,
            text: displayText,
            ts: event.ts,
          ),
        );
        continue;
      }

      for (final line in lines) {
        if (promptLines.contains(line)) {
          continue;
        }
        blocks.add(
          _TerminalBlock(
            type: _TerminalBlockType.output,
            text: line,
            ts: event.ts,
          ),
        );
      }
    }

    return blocks;
  }
}

enum _TerminalBlockType { userInput, output, system, stderr }

class _TerminalBlock {
  final _TerminalBlockType type;
  final String text;
  final DateTime ts;

  const _TerminalBlock({
    required this.type,
    required this.text,
    required this.ts,
  });
}

class _MiniButton extends StatelessWidget {
  final IconData icon;
  final String label;
  final VoidCallback onTap;

  const _MiniButton({
    required this.icon,
    required this.label,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: label,
      child: Material(
        color: AppTheme.bgPrimary,
        borderRadius: BorderRadius.circular(6),
        elevation: 1,
        child: InkWell(
          borderRadius: BorderRadius.circular(6),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(6),
            child: Icon(icon, size: 16, color: AppTheme.textSecondary),
          ),
        ),
      ),
    );
  }
}

class _TerminalLine extends StatelessWidget {
  final _TerminalBlock block;
  final bool showTimestamp;

  const _TerminalLine({required this.block, required this.showTimestamp});

  @override
  Widget build(BuildContext context) {
    Color textColor;
    String prefix;

    if (block.type == _TerminalBlockType.userInput) {
      textColor = AppTheme.brand;
      prefix = '> ';
    } else if (block.type == _TerminalBlockType.stderr) {
      textColor = AppTheme.statusRed;
      prefix = '';
    } else if (block.type == _TerminalBlockType.system) {
      textColor = AppTheme.statusYellow;
      prefix = '[SYS] ';
    } else {
      textColor = AppTheme.textPrimary;
      prefix = '';
    }

    return Padding(
      padding: const EdgeInsets.only(bottom: 1),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (showTimestamp) ...[
            Text(
              DateFormat('HH:mm:ss').format(block.ts),
              style: const TextStyle(
                color: AppTheme.textTertiary,
                fontSize: 10,
                fontFamily: 'monospace',
              ),
            ),
            const SizedBox(width: 8),
          ],
          Expanded(
            child: SelectableText.rich(
              TextSpan(
                children: [
                  TextSpan(
                    text: prefix,
                    style: TextStyle(
                      color: textColor,
                      fontSize: 12,
                      fontFamily: 'monospace',
                      height: 1.24,
                    ),
                  ),
                  TerminalTextFormatter.buildStyledText(
                    block.text,
                    TextStyle(
                      color: textColor,
                      fontSize: 12,
                      fontFamily: 'monospace',
                      height: 1.24,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
