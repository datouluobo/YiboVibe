import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../models/session.dart';
import '../../providers/session_provider.dart';
import '../../theme/app_theme.dart';

/// Session 快切 Chip 列表 — 横向滚动，快速切换 session
class SessionChipBar extends StatelessWidget {
  const SessionChipBar({super.key});

  @override
  Widget build(BuildContext context) {
    return Consumer<SessionProvider>(
      builder: (context, provider, _) {
        if (provider.sessions.isEmpty) {
          return const SizedBox(
            height: 36,
            child: Center(
              child: Text('暂无 Session',
                  style: TextStyle(color: AppTheme.textTertiary, fontSize: 12)),
            ),
          );
        }

        return SizedBox(
          height: 40,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
            itemCount: provider.sessions.length,
            separatorBuilder: (_, _) => const SizedBox(width: 6),
            itemBuilder: (context, index) {
              final session = provider.sessions[index];
              final isActive = provider.activeSession?.sessionId ==
                  session.sessionId;
              return _SessionChip(
                session: session,
                isActive: isActive,
                onTap: () => provider.selectSession(session),
                onLongPress: () => _showSessionActions(context, session, provider),
              );
            },
          ),
        );
      },
    );
  }

  void _showSessionActions(
      BuildContext context, Session session, SessionProvider provider) {
    showModalBottomSheet(
      context: context,
      backgroundColor: AppTheme.bgSecondary,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) => _SessionActionSheet(
        session: session,
        provider: provider,
      ),
    );
  }
}

class _SessionChip extends StatelessWidget {
  final Session session;
  final bool isActive;
  final VoidCallback onTap;
  final VoidCallback onLongPress;

  const _SessionChip({
    required this.session,
    required this.isActive,
    required this.onTap,
    required this.onLongPress,
  });

  @override
  Widget build(BuildContext context) {
    final statusColor = AppTheme.sessionStatusColor(session.status);

    return GestureDetector(
      onTap: onTap,
      onLongPress: onLongPress,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        decoration: BoxDecoration(
          color: isActive ? AppTheme.brandPurple.withAlpha(30) : AppTheme.bgTertiary,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(
            color: isActive ? AppTheme.brandPurple : AppTheme.borderColor,
            width: isActive ? 1.5 : 1,
          ),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            // 状态点
            Container(
              width: 6,
              height: 6,
              decoration: BoxDecoration(
                color: statusColor,
                shape: BoxShape.circle,
              ),
            ),
            const SizedBox(width: 6),
            // Session 名
            Text(
              session.title.length > 12
                  ? '${session.title.substring(0, 12)}…'
                  : session.title,
              style: TextStyle(
                color: isActive ? AppTheme.brandPurpleLight : AppTheme.textSecondary,
                fontSize: 12,
                fontWeight: isActive ? FontWeight.w600 : FontWeight.w400,
              ),
            ),
            // 未读计数
            if (session.unreadCount > 0) ...[
              const SizedBox(width: 4),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
                decoration: BoxDecoration(
                  color: AppTheme.brandPurple,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  '${session.unreadCount}',
                  style: const TextStyle(
                    color: AppTheme.textPrimary,
                    fontSize: 9,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// Session 操作底部面板
class _SessionActionSheet extends StatelessWidget {
  final Session session;
  final SessionProvider provider;

  const _SessionActionSheet({
    required this.session,
    required this.provider,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(20),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Center(
            child: Container(
              width: 36,
              height: 4,
              decoration: BoxDecoration(
                color: AppTheme.textTertiary,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),
          const SizedBox(height: 16),
          Text(session.title,
              style: const TextStyle(
                  color: AppTheme.textPrimary,
                  fontSize: 16,
                  fontWeight: FontWeight.w600)),
          const SizedBox(height: 4),
          Text('${session.shellKind}  ·  ${session.cwd}',
              style: const TextStyle(
                  color: AppTheme.textSecondary, fontSize: 12)),
          const SizedBox(height: 16),
          _ActionButton(
            icon: Icons.play_arrow,
            label: '启动',
            color: AppTheme.statusGreen,
            onTap: () {
              provider.startSession(session);
              Navigator.pop(context);
            },
          ),
          _ActionButton(
            icon: Icons.pause,
            label: '暂停',
            color: AppTheme.statusYellow,
            onTap: () {
              provider.pauseSession(session);
              Navigator.pop(context);
            },
          ),
          _ActionButton(
            icon: Icons.refresh,
            label: '恢复',
            color: AppTheme.brandPurpleLight,
            onTap: () {
              provider.resumeSession(session);
              Navigator.pop(context);
            },
          ),
          const Divider(color: AppTheme.borderColor),
          _ActionButton(
            icon: Icons.stop,
            label: '停止',
            color: AppTheme.statusRed,
            isDanger: true,
            onTap: () => _confirmStop(context),
          ),
          _ActionButton(
            icon: Icons.close,
            label: '关闭',
            color: AppTheme.statusGray,
            onTap: () {
              provider.closeSession(session);
              Navigator.pop(context);
            },
          ),
        ],
      ),
    );
  }

  void _confirmStop(BuildContext context) {
    Navigator.pop(context); // 先关闭底部面板
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('确认停止'),
        content: Text('确定要停止 "${session.title}" 吗？\n设备ID: ${session.ownerDevice}'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('取消'),
          ),
          TextButton(
            onPressed: () {
              provider.stopSession(session);
              Navigator.pop(ctx);
            },
            style: TextButton.styleFrom(foregroundColor: AppTheme.statusRed),
            child: const Text('停止'),
          ),
        ],
      ),
    );
  }
}

class _ActionButton extends StatelessWidget {
  final IconData icon;
  final String label;
  final Color color;
  final VoidCallback onTap;
  final bool isDanger;

  const _ActionButton({
    required this.icon,
    required this.label,
    required this.color,
    required this.onTap,
    this.isDanger = false,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(8),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 10),
        child: Row(
          children: [
            Icon(icon, size: 20, color: color),
            const SizedBox(width: 12),
            Text(label,
                style: TextStyle(
                    color: isDanger ? color : AppTheme.textPrimary,
                    fontSize: 14)),
          ],
        ),
      ),
    );
  }
}
