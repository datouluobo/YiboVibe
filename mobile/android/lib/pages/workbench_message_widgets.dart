import 'dart:convert';

import 'package:flutter/material.dart';

import '../models/ai_workbench.dart';
import '../theme/app_theme.dart';

class TerminalSessionBody extends StatelessWidget {
  const TerminalSessionBody({
    super.key,
    required this.session,
    required this.messages,
  });

  final AiWorkbenchConversation session;
  final List<AiWorkbenchMessage> messages;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      color: const Color(0xFF121212),
      child: WorkbenchAutoScrollMessageList(
        sessionKey: session.id,
        padding: const EdgeInsets.fromLTRB(14, 16, 14, 18),
        itemCount: messages.length,
        separatorHeight: 8,
        itemBuilder: (context, index) {
          final message = messages[index];
          return SelectableText(
            message.text,
            style: const TextStyle(
              color: Color(0xFFE5E7EB),
              fontFamily: 'monospace',
              fontSize: 12,
              height: 1.42,
            ),
          );
        },
      ),
    );
  }
}

class CodexSessionBody extends StatelessWidget {
  const CodexSessionBody({
    super.key,
    required this.session,
    required this.messages,
  });

  final AiWorkbenchConversation session;
  final List<AiWorkbenchMessage> messages;

  @override
  Widget build(BuildContext context) {
    if (messages.isEmpty) {
      return const Center(
        child: Text(
          '没有更多线程',
          style: TextStyle(color: AppTheme.textSecondary, fontSize: 16),
        ),
      );
    }

    return WorkbenchAutoScrollMessageList(
      sessionKey: session.id,
      padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
      itemCount: messages.length + 2,
      separatorHeight: 14,
      itemBuilder: (context, index) {
        if (index == 0) {
          return _ConversationDigestCard(session: session, messages: messages);
        }
        if (index == 1) {
          return Text(
            '前 ${messages.length} 条消息 ›',
            style: const TextStyle(
              color: AppTheme.textSecondary,
              fontSize: 16,
              fontWeight: FontWeight.w500,
            ),
          );
        }
        return WorkbenchMessageBlock(message: messages[index - 2]);
      },
    );
  }
}

class WorkbenchAutoScrollMessageList extends StatefulWidget {
  const WorkbenchAutoScrollMessageList({
    super.key,
    required this.sessionKey,
    required this.padding,
    required this.itemCount,
    required this.itemBuilder,
    this.separatorHeight = 0,
  });

  final String sessionKey;
  final EdgeInsets padding;
  final int itemCount;
  final IndexedWidgetBuilder itemBuilder;
  final double separatorHeight;

  @override
  State<WorkbenchAutoScrollMessageList> createState() =>
      _WorkbenchAutoScrollMessageListState();
}

class _WorkbenchAutoScrollMessageListState
    extends State<WorkbenchAutoScrollMessageList> {
  late final ScrollController _controller;
  bool _stickToBottom = true;

  @override
  void initState() {
    super.initState();
    _controller = ScrollController()..addListener(_handleScroll);
    WidgetsBinding.instance.addPostFrameCallback((_) => _jumpToBottom());
  }

  @override
  void didUpdateWidget(covariant WorkbenchAutoScrollMessageList oldWidget) {
    super.didUpdateWidget(oldWidget);
    final sessionChanged = oldWidget.sessionKey != widget.sessionKey;
    final grew = widget.itemCount > oldWidget.itemCount;
    if (sessionChanged || (grew && _stickToBottom)) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _jumpToBottom());
    }
  }

  void _handleScroll() {
    if (!_controller.hasClients) {
      return;
    }
    final max = _controller.position.maxScrollExtent;
    final offset = _controller.offset;
    _stickToBottom = (max - offset).abs() < 48;
  }

  void _jumpToBottom() {
    if (!_controller.hasClients) {
      return;
    }
    _controller.jumpTo(_controller.position.maxScrollExtent);
  }

  @override
  void dispose() {
    _controller
      ..removeListener(_handleScroll)
      ..dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ListView.separated(
      controller: _controller,
      padding: widget.padding,
      itemCount: widget.itemCount,
      separatorBuilder: (context, index) =>
          SizedBox(height: widget.separatorHeight),
      itemBuilder: widget.itemBuilder,
    );
  }
}

class WorkbenchMessageBlock extends StatefulWidget {
  const WorkbenchMessageBlock({super.key, required this.message});

  final AiWorkbenchMessage message;

  @override
  State<WorkbenchMessageBlock> createState() => _WorkbenchMessageBlockState();
}

class _WorkbenchMessageBlockState extends State<WorkbenchMessageBlock> {
  bool _expanded = false;

  @override
  Widget build(BuildContext context) {
    final message = widget.message;
    final user = message.role == 'user';
    final technical = message.rawType == 'tool' || message.rawType == 'command';
    final pending = message.status == 'pending';
    final queued = message.status == 'queued';
    final running = message.status == 'running';
    final completed = message.status == 'completed';
    final failed = message.status == 'failed';
    final maxWidth = MediaQuery.of(context).size.width * (user ? 0.84 : 0.9);
    final previewText = message.previewText?.trimRight();
    final hasExpandablePreview =
        previewText != null &&
        previewText.isNotEmpty &&
        previewText != message.text.trimRight();
    final displayText = _expanded || !hasExpandablePreview
        ? message.text
        : previewText;
    final imageUrls = message.imageUrls;
    final truncated = message.isTruncated == true;
    final hiddenCharCount = truncated && message.fullTextCharCount != null
        ? message.fullTextCharCount! - message.text.runes.length
        : 0;
    final hasDisplayText = displayText.trim().isNotEmpty;
    final textSummary = _messageSummary(message);

    final roleLabel = pending
        ? '发送中'
        : queued
        ? '桌面已接收'
        : running
        ? '桌面执行中'
        : completed
        ? '回流完成'
        : failed
        ? '发送失败'
        : technical
        ? '技术事件'
        : user
        ? '你'
        : message.title;
    final containerColor = user
        ? const Color(0xFFF5F5F5)
        : technical
        ? const Color(0xFFFFFBEB)
        : Colors.transparent;
    final borderColor = failed
        ? AppTheme.statusRed.withAlpha(90)
        : pending || queued
        ? AppTheme.borderColor
        : running
        ? AppTheme.brand.withAlpha(70)
        : completed
        ? AppTheme.statusGreen.withAlpha(90)
        : technical
        ? AppTheme.statusYellow.withAlpha(80)
        : user
        ? AppTheme.borderColor
        : Colors.transparent;

    return Align(
      alignment: user ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        constraints: BoxConstraints(
          maxWidth: user ? maxWidth : double.infinity,
        ),
        padding: user
            ? const EdgeInsets.fromLTRB(18, 14, 18, 14)
            : const EdgeInsets.fromLTRB(0, 2, 0, 2),
        decoration: BoxDecoration(
          color: containerColor,
          borderRadius: BorderRadius.circular(user || technical ? 28 : 0),
          border: Border.all(color: borderColor),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (!user ||
                technical ||
                pending ||
                queued ||
                running ||
                completed ||
                failed)
              Padding(
                padding: EdgeInsets.only(
                  left: user ? 0 : 2,
                  right: 0,
                  bottom: hasDisplayText || imageUrls.isNotEmpty ? 8 : 0,
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Flexible(
                      child: Text(
                        roleLabel,
                        style: TextStyle(
                          color: failed
                              ? AppTheme.statusRed
                              : running
                              ? AppTheme.brandDark
                              : completed
                              ? AppTheme.statusGreen
                              : user
                              ? AppTheme.textSecondary
                              : technical
                              ? const Color(0xFF9A6700)
                              : const Color(0xFF22C55E),
                          fontSize: 12,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                    if (pending || running) ...[
                      const SizedBox(width: 6),
                      SizedBox(
                        width: 10,
                        height: 10,
                        child: CircularProgressIndicator(
                          strokeWidth: 1.8,
                          color: AppTheme.brand,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            if (textSummary != null) ...[
              _MessageSummaryPill(label: textSummary),
              if (hasDisplayText || imageUrls.isNotEmpty)
                const SizedBox(height: 8),
            ],
            if (imageUrls.isNotEmpty) ...[
              for (final imageUrl in imageUrls) ...[
                WorkbenchInlineMessageImage(imageUrl: imageUrl),
                if (imageUrl != imageUrls.last) const SizedBox(height: 8),
              ],
              if (hasDisplayText) const SizedBox(height: 8),
            ],
            if (hasDisplayText)
              SelectableText(
                displayText,
                style: TextStyle(
                  color: AppTheme.textPrimary,
                  fontSize: user ? 15 : 15.5,
                  height: user ? 1.55 : 1.68,
                  fontWeight: user ? FontWeight.w500 : FontWeight.w400,
                ),
              ),
            if (!hasDisplayText && imageUrls.isEmpty)
              const Text(
                '(empty)',
                style: TextStyle(
                  color: AppTheme.textTertiary,
                  fontSize: 13,
                  fontStyle: FontStyle.italic,
                ),
              ),
            if (hasExpandablePreview || truncated) ...[
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                runSpacing: 6,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  if (hasExpandablePreview)
                    InkWell(
                      onTap: () => setState(() => _expanded = !_expanded),
                      borderRadius: BorderRadius.circular(999),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 2,
                          vertical: 2,
                        ),
                        child: Text(
                          _expanded ? '收起' : '展开全文',
                          style: const TextStyle(
                            color: AppTheme.textSecondary,
                            fontSize: 12,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                    ),
                  if (truncated)
                    Text(
                      hiddenCharCount > 0
                          ? '仍有约 $hiddenCharCount 字未同步到移动端'
                          : '完整内容仍以桌面端为准',
                      style: const TextStyle(
                        color: AppTheme.textTertiary,
                        fontSize: 11,
                        height: 1.35,
                      ),
                    ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class WorkbenchInlineMessageImage extends StatelessWidget {
  const WorkbenchInlineMessageImage({super.key, required this.imageUrl});

  final String imageUrl;

  @override
  Widget build(BuildContext context) {
    final provider = workbenchImageProviderFor(imageUrl);
    if (provider == null) {
      return Container(
        width: double.infinity,
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(
          color: AppTheme.bgPrimary,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: AppTheme.borderColor),
        ),
        child: SelectableText(
          imageUrl,
          style: const TextStyle(
            color: AppTheme.textSecondary,
            fontSize: 12,
            height: 1.4,
          ),
        ),
      );
    }

    return ClipRRect(
      borderRadius: BorderRadius.circular(12),
      child: Container(
        constraints: const BoxConstraints(maxHeight: 280),
        decoration: BoxDecoration(
          color: AppTheme.bgPrimary,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: AppTheme.borderColor),
        ),
        child: Image(
          image: provider,
          fit: BoxFit.cover,
          errorBuilder: (context, error, stackTrace) => Container(
            width: double.infinity,
            padding: const EdgeInsets.all(12),
            color: AppTheme.bgPrimary,
            child: const Text(
              '图片加载失败',
              style: TextStyle(color: AppTheme.textSecondary, fontSize: 12),
            ),
          ),
        ),
      ),
    );
  }
}

ImageProvider<Object>? workbenchImageProviderFor(String imageUrl) {
  final trimmed = imageUrl.trim();
  if (trimmed.isEmpty) {
    return null;
  }
  if (trimmed.startsWith('data:image/')) {
    try {
      final data = UriData.parse(trimmed);
      return MemoryImage(data.contentAsBytes());
    } catch (_) {
      final marker = trimmed.indexOf('base64,');
      if (marker <= 0) return null;
      try {
        return MemoryImage(base64Decode(trimmed.substring(marker + 7)));
      } catch (_) {
        return null;
      }
    }
  }
  final uri = Uri.tryParse(trimmed);
  if (uri == null || !uri.hasScheme) {
    return null;
  }
  return NetworkImage(trimmed);
}

class _ConversationDigestCard extends StatelessWidget {
  const _ConversationDigestCard({
    required this.session,
    required this.messages,
  });

  final AiWorkbenchConversation session;
  final List<AiWorkbenchMessage> messages;

  @override
  Widget build(BuildContext context) {
    final latestAssistant = messages.reversed.firstWhere(
      (item) => item.role == 'assistant' && item.text.trim().isNotEmpty,
      orElse: () => const AiWorkbenchMessage(
        id: '',
        providerId: 'codex',
        role: 'assistant',
        title: '',
        text: '',
      ),
    );
    final latestTechnical = messages.reversed.firstWhere(
      (item) =>
          (item.rawType == 'tool' || item.rawType == 'command') &&
          item.text.trim().isNotEmpty,
      orElse: () => const AiWorkbenchMessage(
        id: '',
        providerId: 'codex',
        role: 'system',
        title: '',
        text: '',
      ),
    );
    final summaryLines = <String>[
      if ((session.preview ?? '').trim().isNotEmpty) session.preview!.trim(),
      if (session.pendingApproval != null)
        '当前等待确认: ${session.pendingApproval!.title}',
      if (latestTechnical.text.trim().isNotEmpty)
        '最近技术事件: ${_singleLine(latestTechnical.text)}',
      if (session.sessionSummary?.hasError == true) '检测到桌面侧错误，请优先看最近输出。',
      if (latestAssistant.text.trim().isNotEmpty)
        '最近回复: ${_singleLine(latestAssistant.text)}',
    ];

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
      decoration: BoxDecoration(
        color: AppTheme.bgSecondary,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: AppTheme.borderColor),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              _MessageSummaryPill(label: _sessionStatusLabel(session)),
              if (session.pendingApproval != null)
                const _MessageSummaryPill(
                  label: '等待确认',
                  tone: _MessageSummaryTone.warning,
                ),
              if (session.sessionSummary?.hasError == true)
                const _MessageSummaryPill(
                  label: '存在错误',
                  tone: _MessageSummaryTone.danger,
                ),
            ],
          ),
          if (summaryLines.isNotEmpty) ...[
            const SizedBox(height: 10),
            for (final line in summaryLines.take(4)) ...[
              Text(
                line,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: AppTheme.textSecondary,
                  fontSize: 12.5,
                  height: 1.45,
                ),
              ),
              if (line != summaryLines.take(4).last) const SizedBox(height: 6),
            ],
          ],
        ],
      ),
    );
  }
}

enum _MessageSummaryTone { neutral, success, warning, danger }

class _MessageSummaryPill extends StatelessWidget {
  const _MessageSummaryPill({
    required this.label,
    this.tone = _MessageSummaryTone.neutral,
  });

  final String label;
  final _MessageSummaryTone tone;

  @override
  Widget build(BuildContext context) {
    final color = switch (tone) {
      _MessageSummaryTone.success => AppTheme.statusGreen,
      _MessageSummaryTone.warning => AppTheme.statusYellow,
      _MessageSummaryTone.danger => AppTheme.statusRed,
      _MessageSummaryTone.neutral => AppTheme.textSecondary,
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: color.withAlpha(18),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: color.withAlpha(72)),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: color,
          fontSize: 11,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }
}

String? _messageSummary(AiWorkbenchMessage message) {
  if (message.rawType == 'tool') {
    return '工具结果';
  }
  if (message.rawType == 'command') {
    return '命令输出';
  }
  final text = message.text.trimLeft();
  if (text.toLowerCase().contains('error') || text.contains('失败')) {
    return '错误摘要';
  }
  if (message.role == 'assistant' && text.length > 140) {
    return '结果摘要';
  }
  return null;
}

String _sessionStatusLabel(AiWorkbenchConversation session) {
  final statusLabel = session.sessionSummary?.statusLabel?.trim();
  if (statusLabel != null && statusLabel.isNotEmpty) {
    return statusLabel;
  }
  return switch (session.status) {
    'running' => '桌面执行中',
    'waitingApproval' => '等待确认',
    'failed' || 'error' => '执行失败',
    'offline' => '桌面未在线',
    _ => '等待下一步',
  };
}

String _singleLine(String value) {
  return value.replaceAll(RegExp(r'\s+'), ' ').trim();
}
