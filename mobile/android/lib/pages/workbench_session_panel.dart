import 'package:flutter/material.dart';

import '../models/ai_workbench.dart';
import '../theme/app_theme.dart';

class WorkbenchSessionRow extends StatelessWidget {
  const WorkbenchSessionRow({
    super.key,
    required this.session,
    required this.selected,
    required this.onTap,
    this.compact = false,
    this.indent = 0,
  });

  final AiWorkbenchConversation session;
  final bool selected;
  final VoidCallback onTap;
  final bool compact;
  final double indent;

  @override
  Widget build(BuildContext context) {
    final color = workbenchStatusColor(session.status);
    final subtype = _sessionSubtype(session);
    final statusLabel =
        session.sessionSummary?.statusLabel?.trim().isNotEmpty == true
        ? session.sessionSummary!.statusLabel!.trim()
        : workbenchMobileStatus(session.status);
    final observation = workbenchSessionObservationLabel(session);
    final horizontalPadding = compact ? 9.0 : 12.0;

    return Padding(
      padding: EdgeInsets.only(left: indent),
      child: Material(
        color: selected ? AppTheme.bgHover : AppTheme.bgSecondary,
        borderRadius: BorderRadius.circular(8),
        child: InkWell(
          borderRadius: BorderRadius.circular(8),
          onTap: onTap,
          child: Container(
            padding: EdgeInsets.all(horizontalPadding),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(8),
              border: Border.all(
                color: selected
                    ? AppTheme.brand.withAlpha(80)
                    : AppTheme.borderColor,
              ),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Container(
                      width: 7,
                      height: 7,
                      decoration: BoxDecoration(
                        color: color,
                        shape: BoxShape.circle,
                      ),
                    ),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text(
                        session.title,
                        maxLines: compact ? 2 : 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: selected
                              ? AppTheme.brandDark
                              : AppTheme.textPrimary,
                          fontSize: compact ? 12 : 13,
                          fontWeight: FontWeight.w700,
                          height: 1.2,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 7),
                if (subtype.isNotEmpty)
                  _SessionMiniBadge(label: subtype)
                else
                  Text(
                    statusLabel,
                    style: const TextStyle(
                      color: AppTheme.textSecondary,
                      fontSize: 10,
                    ),
                  ),
                const SizedBox(height: 6),
                Text(
                  session.preview ?? session.cwd ?? '暂无摘要',
                  maxLines: compact ? 2 : 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: AppTheme.textTertiary,
                    fontSize: 10,
                    height: 1.25,
                  ),
                ),
                if (observation.isNotEmpty) ...[
                  const SizedBox(height: 6),
                  Text(
                    observation,
                    maxLines: compact ? 2 : 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: AppTheme.textSecondary,
                      fontSize: 10,
                      height: 1.25,
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }

  String _sessionSubtype(AiWorkbenchConversation session) {
    if (session.providerId != 'terminal') return '';
    return session.source ?? '';
  }
}

class _SessionMiniBadge extends StatelessWidget {
  const _SessionMiniBadge({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
      decoration: BoxDecoration(
        color: AppTheme.bgTertiary,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: AppTheme.borderColor),
      ),
      child: Text(
        label,
        style: const TextStyle(color: AppTheme.textSecondary, fontSize: 10),
      ),
    );
  }
}

Color workbenchStatusColor(String status) {
  return switch (status) {
    'running' => AppTheme.statusGreen,
    'waitingApproval' => AppTheme.statusYellow,
    'failed' || 'error' || 'crashed' => AppTheme.statusRed,
    _ => AppTheme.statusGray,
  };
}

String workbenchMobileStatus(String status) {
  return switch (status) {
    'running' => '运行中',
    'waitingApproval' => '需确认',
    'failed' || 'error' || 'crashed' => '失败',
    'offline' => '未连接',
    'waiting_input' => '等待输入',
    'idle' => '空闲',
    _ => '空闲',
  };
}

String workbenchSessionObservationLabel(AiWorkbenchConversation session) {
  final summary = session.sessionSummary;
  if (summary == null) {
    return '';
  }
  final pieces = <String>[];
  if (summary.lastOutputAt != null) {
    pieces.add('最后输出 ${workbenchRelativeTimeLabel(summary.lastOutputAt)}');
  }
  if (summary.waitingForInput) {
    pieces.add('等待输入');
  }
  if (summary.hasError) {
    pieces.add('存在错误');
  }
  if (summary.unreadCount > 0) {
    pieces.add('未读 ${summary.unreadCount}');
  }
  if ((summary.runningForSeconds ?? 0) > 0) {
    pieces.add('已运行 ${workbenchDurationLabel(summary.runningForSeconds!)}');
  }
  return pieces.join(' · ');
}

String workbenchDurationLabel(int seconds) {
  if (seconds < 60) {
    return '${seconds}s';
  }
  final minutes = seconds ~/ 60;
  if (minutes < 60) {
    return '${minutes}m';
  }
  final hours = minutes ~/ 60;
  final remainingMinutes = minutes % 60;
  if (hours < 24) {
    return remainingMinutes == 0
        ? '${hours}h'
        : '${hours}h${remainingMinutes}m';
  }
  final days = hours ~/ 24;
  final remainingHours = hours % 24;
  return remainingHours == 0 ? '${days}d' : '${days}d${remainingHours}h';
}

String workbenchRelativeTimeLabel(int? timestamp) {
  if (timestamp == null || timestamp <= 0) {
    return '刚刚';
  }
  final normalizedTimestamp = timestamp < 1000000000000
      ? timestamp * 1000
      : timestamp;
  final time = DateTime.fromMillisecondsSinceEpoch(normalizedTimestamp);
  final now = DateTime.now();
  if (time.isAfter(now)) {
    return '刚刚';
  }
  final diff = now.difference(time);
  if (diff.inMinutes < 1) {
    return '刚刚';
  }
  if (diff.inHours < 1) {
    return '${diff.inMinutes}分';
  }
  if (diff.inDays < 1) {
    return '${diff.inHours}小时';
  }
  if (diff.inDays < 30) {
    return '${diff.inDays}天';
  }
  final months = (diff.inDays / 30).floor();
  if (months < 12) {
    return '$months月';
  }
  return '${(diff.inDays / 365).floor()}年';
}
