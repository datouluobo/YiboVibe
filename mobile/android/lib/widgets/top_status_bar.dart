import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../providers/session_provider.dart';
import '../../theme/app_theme.dart';

/// 顶部状态栏 — 显示连接状态、设备、Session、告警入口
class TopStatusBar extends StatelessWidget {
  const TopStatusBar({super.key});

  @override
  Widget build(BuildContext context) {
    return Consumer<SessionProvider>(
      builder: (context, provider, _) {
        final session = provider.activeSession;
        final device = provider.devices.isNotEmpty ? provider.devices.first : null;

        return Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
          decoration: const BoxDecoration(
            color: AppTheme.bgSecondary,
            border: Border(bottom: BorderSide(color: AppTheme.borderColor)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // 第一行：连接状态 + 设备名
              Row(
                children: [
                  _StatusDot(connected: provider.isConnected),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      device?.deviceName ?? '未连接设备',
                      style: const TextStyle(
                        color: AppTheme.textPrimary,
                        fontSize: 13,
                        fontWeight: FontWeight.w500,
                      ),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  // 告警指示器
                  if (session?.hasError == true)
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 6, vertical: 2),
                      decoration: BoxDecoration(
                        color: AppTheme.statusRed.withAlpha(30),
                        borderRadius: BorderRadius.circular(4),
                      ),
                      child: const Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(Icons.warning_amber_rounded,
                              size: 12, color: AppTheme.statusRed),
                          SizedBox(width: 4),
                          Text('ERR',
                              style: TextStyle(
                                  fontSize: 10, color: AppTheme.statusRed)),
                        ],
                      ),
                    ),
                ],
              ),
              const SizedBox(height: 4),
              // 第二行：Session 信息
              if (session != null)
                Row(
                  children: [
                    // Session 状态点
                    Container(
                      width: 6,
                      height: 6,
                      decoration: BoxDecoration(
                        color: AppTheme.sessionStatusColor(session.status),
                        shape: BoxShape.circle,
                      ),
                    ),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text(
                        '${session.title}  ·  ${session.shellKind}  ·  ${session.cwd.isNotEmpty ? session.cwd : "~"}',
                        style: const TextStyle(
                          color: AppTheme.textSecondary,
                          fontSize: 11,
                        ),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    Text(
                      session.status.toUpperCase(),
                      style: TextStyle(
                        color: AppTheme.sessionStatusColor(session.status),
                        fontSize: 10,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
            ],
          ),
        );
      },
    );
  }
}

/// 连接状态小圆点（带脉冲动画）
class _StatusDot extends StatelessWidget {
  final bool connected;
  const _StatusDot({required this.connected});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 8,
      height: 8,
      decoration: BoxDecoration(
        color: connected ? AppTheme.statusGreen : AppTheme.statusGray,
        shape: BoxShape.circle,
        boxShadow: connected
            ? [
                BoxShadow(
                  color: AppTheme.statusGreen.withAlpha(80),
                  blurRadius: 6,
                  spreadRadius: 1,
                )
              ]
            : null,
      ),
    );
  }
}
