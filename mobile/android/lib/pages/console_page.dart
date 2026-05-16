import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../models/session.dart';
import '../../providers/auth_provider.dart';
import '../../providers/session_provider.dart';
import '../../theme/app_theme.dart';
import '../../widgets/terminal_view.dart';
import '../../widgets/dialog_view.dart';
import '../../widgets/bottom_input_area.dart';
import 'login_page.dart';

/// 远程控制台 — 移动端主力工作页面
/// 布局: [AppBar] [SessionBar] [主视图区(最大化)] [底部输入区]
class ConsolePage extends StatefulWidget {
  const ConsolePage({super.key});

  @override
  State<ConsolePage> createState() => _ConsolePageState();
}

class _ConsolePageState extends State<ConsolePage> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final sp = context.read<SessionProvider>();
      sp.initWithAuth();
      sp.loadDevicesAndSessions();
    });
  }

  @override
  Widget build(BuildContext context) {
    return Consumer<SessionProvider>(
      builder: (context, provider, _) {
        final session = provider.activeSession;
        final connected = provider.isConnected;
        final statusColor = session != null
            ? AppTheme.sessionStatusColor(session.status)
            : AppTheme.statusGray;

        return Scaffold(
          backgroundColor: AppTheme.bgPrimary,
          drawer: _SessionDrawer(provider: provider),
          appBar: PreferredSize(
            preferredSize: const Size.fromHeight(34),
            child: _buildSessionBar(context, provider, session, connected, statusColor),
          ),
          body: Column(
            children: [
              // 主视图区 — 最大化
              Expanded(
                child: provider.isDialogMode
                    ? const DialogView()
                    : const TerminalView(),
              ),
              // 底部输入区
              const BottomInputArea(),
            ],
          ),
        );
      },
    );
  }

  /// 极简 Session Bar — 替代 AppBar + TopStatusBar + SessionChipBar
  Widget _buildSessionBar(
    BuildContext context,
    SessionProvider provider,
    Session? session,
    bool connected,
    Color statusColor,
  ) {
    return Container(
      height: 34,
      padding: const EdgeInsets.symmetric(horizontal: 8),
      decoration: BoxDecoration(
        color: AppTheme.bgSecondary,
        border: Border(bottom: BorderSide(color: AppTheme.borderColor.withAlpha(60))),
      ),
      child: Row(
        children: [
          // 左侧: 菜单按钮 (打开 drawer)
          GestureDetector(
            onTap: () => Scaffold.of(context).openDrawer(),
            child: const Padding(
              padding: EdgeInsets.all(6),
              child: Icon(Icons.dns_outlined, size: 16, color: AppTheme.textSecondary),
            ),
          ),
          const SizedBox(width: 4),
          // 连接状态 + 设备名
          Container(
            width: 6,
            height: 6,
            decoration: BoxDecoration(
              color: connected ? AppTheme.statusGreen : AppTheme.statusGray,
              shape: BoxShape.circle,
            ),
          ),
          const SizedBox(width: 6),
          // Session 名 / 状态
          Expanded(
            child: GestureDetector(
              onTap: () => provider.loadDevicesAndSessions(),
              child: Text(
                session != null
                    ? '${session.title}  ·  ${_statusLabel(session.status)}'
                    : '无活跃 Session',
                style: const TextStyle(
                  color: AppTheme.textPrimary,
                  fontSize: 12,
                  fontWeight: FontWeight.w500,
                ),
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ),
          // 活跃 Session 标签 (可点击切换)
          if (provider.sessions.length > 1)
            ..._buildSessionChips(provider, session),
          // 右侧操作
          GestureDetector(
            onTap: () => _showNewSessionDialog(context, provider),
            child: const Padding(
              padding: EdgeInsets.all(6),
              child: Icon(Icons.add, size: 16, color: AppTheme.textSecondary),
            ),
          ),
          const SizedBox(width: 2),
          GestureDetector(
            onTap: () => _logout(context),
            child: const Padding(
              padding: EdgeInsets.all(6),
              child: Icon(Icons.logout, size: 14, color: AppTheme.textTertiary),
            ),
          ),
        ],
      ),
    );
  }

  /// 内联 Session 快切按钮 (最多2个, 其余在drawer)
  List<Widget> _buildSessionChips(SessionProvider provider, Session? active) {
    final chips = provider.sessions.take(2).map((s) {
      final isActive = s.sessionId == active?.sessionId;
      final sc = AppTheme.sessionStatusColor(s.status);
      return Padding(
        padding: const EdgeInsets.only(right: 4),
        child: GestureDetector(
          onTap: () => provider.selectSession(s),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
            decoration: BoxDecoration(
              color: isActive ? AppTheme.brandPurple.withAlpha(25) : Colors.transparent,
              borderRadius: BorderRadius.circular(4),
              border: Border.all(
                color: isActive
                    ? AppTheme.brandPurple.withAlpha(80)
                    : Colors.transparent,
              ),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: 4, height: 4,
                  decoration: BoxDecoration(color: sc, shape: BoxShape.circle),
                ),
                const SizedBox(width: 4),
                Text(
                  s.title.length > 6 ? '${s.title.substring(0, 6)}…' : s.title,
                  style: TextStyle(
                    color: isActive ? AppTheme.brandPurpleLight : AppTheme.textTertiary,
                    fontSize: 10,
                    fontWeight: isActive ? FontWeight.w600 : FontWeight.w400,
                  ),
                ),
              ],
            ),
          ),
        ),
      );
    }).toList();
    return chips;
  }

  String _statusLabel(String status) {
    switch (status) {
      case 'running': return '运行中';
      case 'paused': return '已暂停';
      case 'waiting_input': return '等待输入';
      case 'stopped': return '已停止';
      case 'crashed': return '崩溃';
      default: return status;
    }
  }

  void _showNewSessionDialog(BuildContext context, SessionProvider provider) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppTheme.bgSecondary,
        title: const Text('新建 Session',
            style: TextStyle(color: AppTheme.textPrimary, fontSize: 15)),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            shellOption(Icons.terminal, 'PowerShell (pwsh)',
                () { provider.createSession('pwsh'); Navigator.pop(ctx); }),
            const SizedBox(height: 6),
            shellOption(Icons.terminal, 'CMD',
                () { provider.createSession('cmd'); Navigator.pop(ctx); }),
            const SizedBox(height: 6),
            shellOption(Icons.code, 'WSL (Bash)',
                () { provider.createSession('wsl'); Navigator.pop(ctx); }),
          ],
        ),
      ),
    );
  }

  void _logout(BuildContext context) async {
    await context.read<AuthProvider>().logout();
    if (context.mounted) {
      Navigator.pushReplacement(
        context, MaterialPageRoute(builder: (_) => const LoginPage()));
    }
  }
}

Widget shellOption(IconData icon, String label, VoidCallback onTap) {
  return InkWell(
    onTap: onTap,
    borderRadius: BorderRadius.circular(6),
    child: Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: AppTheme.bgTertiary,
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: AppTheme.borderColor),
      ),
      child: Row(
        children: [
          Icon(icon, size: 18, color: AppTheme.brandPurpleLight),
          const SizedBox(width: 10),
          Text(label, style: const TextStyle(color: AppTheme.textPrimary, fontSize: 13)),
        ],
      ),
    ),
  );
}

// ═══════════════════════════════════════════════════════════════
// Session 侧边栏
// ═══════════════════════════════════════════════════════════════
class _SessionDrawer extends StatelessWidget {
  final SessionProvider provider;
  const _SessionDrawer({required this.provider});

  @override
  Widget build(BuildContext context) {
    return Drawer(
      backgroundColor: AppTheme.bgSecondary,
      width: 280,
      child: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
              child: Row(
                children: [
                  Container(
                    width: 6, height: 6,
                    decoration: BoxDecoration(
                      color: provider.isConnected ? AppTheme.statusGreen : AppTheme.statusGray,
                      shape: BoxShape.circle,
                    ),
                  ),
                  const SizedBox(width: 8),
                  const Text('Sessions',
                      style: TextStyle(color: AppTheme.textPrimary, fontSize: 14, fontWeight: FontWeight.w600)),
                  const Spacer(),
                  GestureDetector(
                    onTap: () => provider.loadDevicesAndSessions(),
                    child: const Icon(Icons.refresh, size: 16, color: AppTheme.textTertiary),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 8),
            const Divider(height: 1, color: AppTheme.borderColor),
            Expanded(
              child: provider.sessions.isEmpty
                  ? const Center(child: Text('暂无 Session', style: TextStyle(color: AppTheme.textTertiary, fontSize: 12)))
                  : ListView.separated(
                      padding: const EdgeInsets.symmetric(vertical: 4),
                      itemCount: provider.sessions.length,
                      separatorBuilder: (_, __) => const SizedBox(height: 2),
                      itemBuilder: (context, i) {
                        final s = provider.sessions[i];
                        final isActive = provider.activeSession?.sessionId == s.sessionId;
                        final sc = AppTheme.sessionStatusColor(s.status);
                        return InkWell(
                          onTap: () { provider.selectSession(s); Navigator.pop(context); },
                          child: Container(
                            color: isActive ? AppTheme.brandPurple.withAlpha(10) : null,
                            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                            child: Row(
                              children: [
                                Container(width: 6, height: 6,
                                    decoration: BoxDecoration(color: sc, shape: BoxShape.circle)),
                                const SizedBox(width: 10),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Text(s.title,
                                          style: TextStyle(
                                            color: isActive ? AppTheme.brandPurpleLight : AppTheme.textPrimary,
                                            fontSize: 13,
                                            fontWeight: isActive ? FontWeight.w600 : FontWeight.w400,
                                          )),
                                      Text('${s.shellKind}  ·  ${_stateLabel(s.status)}',
                                          style: const TextStyle(color: AppTheme.textTertiary, fontSize: 10)),
                                    ],
                                  ),
                                ),
                                PopupMenuButton<String>(
                                  icon: const Icon(Icons.more_vert, size: 16, color: AppTheme.textTertiary),
                                  color: AppTheme.bgTertiary,
                                  onSelected: (v) {
                                    if (v == 'stop') provider.stopSession(s);
                                    if (v == 'close') provider.closeSession(s);
                                  },
                                  itemBuilder: (_) => [
                                    const PopupMenuItem(value: 'stop', child: Text('停止', style: TextStyle(fontSize: 12))),
                                    const PopupMenuItem(value: 'close', child: Text('关闭', style: TextStyle(fontSize: 12))),
                                  ],
                                ),
                              ],
                            ),
                          ),
                        );
                      },
                    ),
            ),
          ],
        ),
      ),
    );
  }

  String _stateLabel(String s) {
    switch (s) {
      case 'running': return '运行中';
      case 'paused': return '已暂停';
      case 'waiting_input': return '等待输入';
      case 'stopped': return '已停止';
      case 'crashed': return '崩溃';
      default: return s;
    }
  }
}
