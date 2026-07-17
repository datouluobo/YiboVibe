import 'package:flutter/material.dart';

import '../models/ai_workbench.dart';
import '../theme/app_theme.dart';
import 'workbench_session_panel.dart' as wsp;

class WorkbenchToolCard extends StatelessWidget {
  const WorkbenchToolCard({
    super.key,
    required this.tool,
    required this.projects,
    required this.sessions,
    required this.selected,
    required this.onTap,
  });

  final AiWorkbenchProvider tool;
  final List<AiWorkbenchProject> projects;
  final List<AiWorkbenchConversation> sessions;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final running = sessions.any((item) => item.status == 'running');
    final waiting = sessions.any((item) => item.status == 'waitingApproval');
    final status = waiting ? '需确认' : (running ? '运行中' : '空闲');
    final statusColor = waiting
        ? AppTheme.statusYellow
        : (running ? AppTheme.statusGreen : AppTheme.statusGray);

    return Material(
      color: selected ? AppTheme.brand.withAlpha(12) : AppTheme.bgSecondary,
      borderRadius: BorderRadius.circular(8),
      child: InkWell(
        borderRadius: BorderRadius.circular(8),
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(8),
            border: Border.all(
              color: selected
                  ? AppTheme.brand.withAlpha(90)
                  : AppTheme.borderColor,
            ),
          ),
          child: Row(
            children: [
              _ToolIcon(toolId: tool.id),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            tool.name,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: AppTheme.textPrimary,
                              fontSize: 16,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                        _StatusPill(label: status, color: statusColor),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Text(
                      '${projects.length} 个项目 · ${sessions.length} 个会话 · 刚刚更新',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppTheme.textSecondary,
                        fontSize: 12,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      _toolSummary(tool.id, running, waiting),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppTheme.textTertiary,
                        fontSize: 11,
                      ),
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

  String _toolSummary(String toolId, bool running, bool waiting) {
    if (toolId == 'terminal') {
      return running ? '远程终端正在输出' : '终端通道可用';
    }
    if (waiting) return '有会话等待远程确认';
    return '消息通道已同步';
  }
}

class WorkbenchProjectCard extends StatelessWidget {
  const WorkbenchProjectCard({
    super.key,
    required this.project,
    required this.sessions,
    required this.selected,
    this.compact = false,
    required this.onTap,
  });

  final AiWorkbenchProject project;
  final List<AiWorkbenchConversation> sessions;
  final bool selected;
  final bool compact;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final running = sessions.where((item) => item.status == 'running').length;
    final status = running > 0 ? '运行中' : '空闲';

    return SizedBox(
      width: compact ? 298 : 238,
      child: Material(
        color: selected ? AppTheme.brand.withAlpha(12) : AppTheme.bgSecondary,
        borderRadius: BorderRadius.circular(8),
        child: InkWell(
          borderRadius: BorderRadius.circular(8),
          onTap: onTap,
          child: Container(
            padding: EdgeInsets.all(compact ? 14 : 12),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(8),
              border: Border.all(
                color: selected
                    ? AppTheme.brand.withAlpha(90)
                    : AppTheme.borderColor,
              ),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        project.name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: AppTheme.textPrimary,
                          fontSize: compact ? 16 : 14,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                    Text(
                      status,
                      style: TextStyle(
                        color: AppTheme.textSecondary,
                        fontSize: compact ? 12 : 11,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                Text(
                  project.path,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: AppTheme.textSecondary,
                    fontSize: compact ? 12 : 11,
                  ),
                ),
                const SizedBox(height: 7),
                Text(
                  '${project.branches.firstOrNull ?? '无分支'} · ${sessions.length} 个会话',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: AppTheme.textTertiary,
                    fontSize: compact ? 11 : 10,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class WorkbenchProjectRow extends StatelessWidget {
  const WorkbenchProjectRow({
    super.key,
    required this.project,
    required this.selected,
    required this.toolId,
    required this.onTap,
  });

  final AiWorkbenchProject project;
  final bool selected;
  final String toolId;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(18),
      child: Row(
        children: [
          Icon(
            selected ? Icons.chat_bubble_outline : Icons.folder_outlined,
            size: 24,
            color: AppTheme.brand,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              project.name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: AppTheme.textPrimary,
                fontSize: 16,
                fontWeight: FontWeight.w500,
              ),
            ),
          ),
          const SizedBox(width: 10),
          _ToolChip(toolId: toolId),
        ],
      ),
    );
  }
}

class WorkbenchRecentRow extends StatelessWidget {
  const WorkbenchRecentRow({
    super.key,
    required this.session,
    required this.selected,
    required this.onTap,
  });

  final AiWorkbenchConversation session;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(18),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Row(
          children: [
            Expanded(
              child: Text(
                session.title,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  color: selected ? AppTheme.brand : AppTheme.textPrimary,
                  fontSize: 14.5,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ),
            const SizedBox(width: 8),
            _ToolChip(toolId: session.providerId, source: session.source),
            const SizedBox(width: 8),
            Text(
              wsp.workbenchRelativeTimeLabel(session.updatedAt),
              style: const TextStyle(
                color: AppTheme.textSecondary,
                fontSize: 12,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class WorkbenchEmptyHint extends StatelessWidget {
  const WorkbenchEmptyHint({super.key, required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 14),
      child: Text(
        label,
        style: const TextStyle(color: AppTheme.textSecondary, fontSize: 13),
      ),
    );
  }
}

class _ToolIcon extends StatelessWidget {
  const _ToolIcon({required this.toolId});

  final String toolId;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 42,
      height: 42,
      decoration: BoxDecoration(
        color: AppTheme.bgPrimary,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppTheme.borderColor),
      ),
      child: Icon(_toolGlyph(toolId, null), color: AppTheme.brand, size: 20),
    );
  }
}

class _ToolChip extends StatelessWidget {
  const _ToolChip({required this.toolId, this.source});

  final String toolId;
  final String? source;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 34,
      height: 34,
      decoration: BoxDecoration(
        color: AppTheme.bgSecondary,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppTheme.borderColor),
      ),
      child: Icon(
        _toolGlyph(toolId, source),
        color: AppTheme.textSecondary,
        size: 17,
      ),
    );
  }
}

class _StatusPill extends StatelessWidget {
  const _StatusPill({required this.label, required this.color});

  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
      decoration: BoxDecoration(
        color: color.withAlpha(18),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: color.withAlpha(90)),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: color,
          fontSize: 10,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }
}

IconData _toolGlyph(String toolId, String? source) {
  final normalized = '${toolId.toLowerCase()} ${source?.toLowerCase() ?? ''}';
  if (normalized.contains('terminal') ||
      normalized.contains('powershell') ||
      normalized.contains('bash') ||
      normalized.contains('zsh') ||
      normalized.contains('cmd')) {
    return Icons.terminal;
  }
  if (normalized.contains('claude')) {
    return Icons.psychology_outlined;
  }
  if (normalized.contains('gemini')) {
    return Icons.auto_awesome_outlined;
  }
  if (normalized.contains('aider')) {
    return Icons.assistant_outlined;
  }
  if (normalized.contains('cursor')) {
    return Icons.change_history_outlined;
  }
  if (normalized.contains('vscode') || normalized.contains('visual studio')) {
    return Icons.code;
  }
  if (normalized.contains('windsurf')) {
    return Icons.air_rounded;
  }
  if (normalized.contains('zed')) {
    return Icons.bolt_outlined;
  }
  if (normalized.contains('jetbrains') ||
      normalized.contains('idea') ||
      normalized.contains('android studio')) {
    return Icons.developer_mode_outlined;
  }
  if (normalized.contains('xcode')) {
    return Icons.phone_iphone_outlined;
  }
  if (normalized.contains('codex')) {
    return Icons.smart_toy_outlined;
  }
  return Icons.extension_outlined;
}
