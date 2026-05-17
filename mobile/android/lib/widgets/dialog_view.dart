import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import '../../models/event_message.dart';
import '../../providers/session_provider.dart';
import '../../theme/app_theme.dart';

/// 对话模式视图 — 气泡式，区分用户输入/终端输出/系统事件
class DialogView extends StatelessWidget {
  const DialogView({super.key});

  @override
  Widget build(BuildContext context) {
    final events = context.watch<SessionProvider>().activeSessionEvents;
    final grouped = _groupEvents(events);

    if (grouped.isEmpty) {
      return const Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.chat_bubble_outline,
                size: 48, color: AppTheme.textTertiary),
            SizedBox(height: 12),
            Text('暂无消息',
                style: TextStyle(color: AppTheme.textTertiary, fontSize: 14)),
          ],
        ),
      );
    }

    return ListView.builder(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      itemCount: grouped.length,
      itemBuilder: (context, index) {
        final block = grouped[index];
        return _MessageBlockWidget(block: block);
      },
    );
  }

  /// 事件聚合：同类输出在短时间窗口内合并，错误独立成块
  List<_MessageBlock> _groupEvents(List<EventMessage> events) {
    final blocks = <_MessageBlock>[];
    const windowMs = 500; // 500ms 内合并

    for (final event in events) {
      if (event.isUserMessage) {
        blocks.add(_MessageBlock(
          type: BlockType.userInput,
          text: event.text,
          ts: event.ts,
        ));
      } else if (event.isError) {
        blocks.add(_MessageBlock(
          type: BlockType.error,
          text: event.text,
          ts: event.ts,
        ));
      } else if (event.type == EventType.systemNotice) {
        blocks.add(_MessageBlock(
          type: BlockType.system,
          text: event.text,
          ts: event.ts,
        ));
      } else {
        // terminal output — 合并
        if (blocks.isNotEmpty &&
            blocks.last.type == BlockType.terminalOutput &&
            event.ts.difference(blocks.last.ts).inMilliseconds < windowMs) {
          blocks.last.text += '\n${event.text}';
          blocks.last.ts = event.ts;
        } else {
          blocks.add(_MessageBlock(
            type: BlockType.terminalOutput,
            text: event.text,
            ts: event.ts,
          ));
        }
      }
    }

    return blocks;
  }
}

enum BlockType { userInput, terminalOutput, system, error }

class _MessageBlock {
  final BlockType type;
  String text;
  DateTime ts;

  _MessageBlock({required this.type, required this.text, required this.ts});
}

class _MessageBlockWidget extends StatelessWidget {
  final _MessageBlock block;

  const _MessageBlockWidget({required this.block});

  @override
  Widget build(BuildContext context) {
    switch (block.type) {
      case BlockType.userInput:
        return _UserBubble(text: block.text, ts: block.ts);
      case BlockType.terminalOutput:
        return _TerminalBubble(text: block.text, ts: block.ts);
      case BlockType.system:
        return _SystemCard(text: block.text, ts: block.ts);
      case BlockType.error:
        return _ErrorBubble(text: block.text, ts: block.ts);
    }
  }
}

class _UserBubble extends StatelessWidget {
  final String text;
  final DateTime ts;

  const _UserBubble({required this.text, required this.ts});

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: Alignment.centerRight,
      child: Container(
        constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.75),
        margin: const EdgeInsets.only(bottom: 6),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        decoration: BoxDecoration(
          color: AppTheme.brand.withAlpha(40),
          borderRadius: const BorderRadius.only(
            topLeft: Radius.circular(16),
            topRight: Radius.circular(4),
            bottomLeft: Radius.circular(16),
            bottomRight: Radius.circular(16),
          ),
          border: Border.all(
              color: AppTheme.brand.withAlpha(60)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Text(text,
                style: const TextStyle(
                    color: AppTheme.textPrimary, fontSize: 14)),
            const SizedBox(height: 4),
            Text(DateFormat('HH:mm').format(ts),
                style: const TextStyle(
                    color: AppTheme.textTertiary, fontSize: 10)),
          ],
        ),
      ),
    );
  }
}

class _TerminalBubble extends StatelessWidget {
  final String text;
  final DateTime ts;

  const _TerminalBubble({required this.text, required this.ts});

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: Alignment.centerLeft,
      child: Container(
        constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.8),
        margin: const EdgeInsets.only(bottom: 6),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        decoration: BoxDecoration(
          color: AppTheme.bgTertiary,
          borderRadius: const BorderRadius.only(
            topLeft: Radius.circular(4),
            topRight: Radius.circular(16),
            bottomLeft: Radius.circular(16),
            bottomRight: Radius.circular(16),
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(text,
                style: const TextStyle(
                    color: AppTheme.textSecondary,
                    fontSize: 13,
                    fontFamily: 'monospace')),
            const SizedBox(height: 4),
            Text(DateFormat('HH:mm').format(ts),
                style: const TextStyle(
                    color: AppTheme.textTertiary, fontSize: 10)),
          ],
        ),
      ),
    );
  }
}

class _SystemCard extends StatelessWidget {
  final String text;
  final DateTime ts;

  const _SystemCard({required this.text, required this.ts});

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: AppTheme.statusYellow.withAlpha(15),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppTheme.statusYellow.withAlpha(40)),
      ),
      child: Row(
        children: [
          const Icon(Icons.info_outline, size: 14, color: AppTheme.statusYellow),
          const SizedBox(width: 8),
          Expanded(
            child: Text(text,
                style: const TextStyle(
                    color: AppTheme.statusYellow, fontSize: 12)),
          ),
          Text(DateFormat('HH:mm').format(ts),
              style: const TextStyle(
                  color: AppTheme.textTertiary, fontSize: 10)),
        ],
      ),
    );
  }
}

class _ErrorBubble extends StatelessWidget {
  final String text;
  final DateTime ts;

  const _ErrorBubble({required this.text, required this.ts});

  @override
  Widget build(BuildContext context) {
    return Container(
      constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.8),
      margin: const EdgeInsets.only(bottom: 6),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: AppTheme.statusRed.withAlpha(15),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppTheme.statusRed.withAlpha(40)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(text,
              style: const TextStyle(
                  color: AppTheme.statusRed,
                  fontSize: 13,
                  fontFamily: 'monospace')),
          const SizedBox(height: 4),
          Text(DateFormat('HH:mm').format(ts),
              style: const TextStyle(
                  color: AppTheme.textTertiary, fontSize: 10)),
        ],
      ),
    );
  }
}
