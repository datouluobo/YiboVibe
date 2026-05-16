import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import '../../models/event_message.dart';
import '../../providers/session_provider.dart';
import '../../theme/app_theme.dart';

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

    final filteredEvents = events
        .where((e) => e.type != EventType.systemNotice || _showTimestamps)
        .toList();

    if (filteredEvents.isEmpty) {
      return const Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.terminal, size: 48, color: AppTheme.textTertiary),
            SizedBox(height: 12),
            Text('等待输出…',
                style: TextStyle(color: AppTheme.textTertiary, fontSize: 14)),
          ],
        ),
      );
    }

    return Stack(
      children: [
        ListView.builder(
          controller: _scrollController,
          padding: const EdgeInsets.all(12),
          itemCount: filteredEvents.length,
          itemBuilder: (context, index) {
            final event = filteredEvents[index];
            return _TerminalLine(event: event, showTimestamp: _showTimestamps);
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
                icon:
                    _showTimestamps ? Icons.schedule : Icons.schedule_outlined,
                label: _showTimestamps ? '隐藏时间' : '显示时间',
                onTap: () => setState(() => _showTimestamps = !_showTimestamps),
              ),
            ],
          ),
        ),
      ],
    );
  }
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
        color: AppTheme.bgHover.withAlpha(200),
        borderRadius: BorderRadius.circular(6),
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
  final EventMessage event;
  final bool showTimestamp;

  const _TerminalLine({required this.event, required this.showTimestamp});

  @override
  Widget build(BuildContext context) {
    Color textColor;
    String prefix;

    if (event.isUserMessage) {
      textColor = AppTheme.brandPurpleLight;
      prefix = '> ';
    } else if (event.stream == OutputStream.stderr) {
      textColor = AppTheme.statusRed;
      prefix = '';
    } else if (event.type == EventType.systemNotice) {
      textColor = AppTheme.statusYellow;
      prefix = '[SYS] ';
    } else {
      textColor = AppTheme.textPrimary;
      prefix = '';
    }

    return Padding(
      padding: const EdgeInsets.only(bottom: 2),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (showTimestamp) ...[
            Text(
              DateFormat('HH:mm:ss').format(event.ts),
              style: const TextStyle(
                color: AppTheme.textTertiary,
                fontSize: 10,
                fontFamily: 'monospace',
              ),
            ),
            const SizedBox(width: 8),
          ],
          Expanded(
            child: Text(
              '$prefix${event.text}',
              style: TextStyle(
                color: textColor,
                fontSize: 13,
                fontFamily: 'monospace',
                height: 1.4,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
