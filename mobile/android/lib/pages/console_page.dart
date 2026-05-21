import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../app_version.dart';
import '../../models/session.dart';
import '../../providers/auth_provider.dart';
import '../../providers/session_provider.dart';
import '../../theme/app_theme.dart';
import '../../widgets/terminal_view.dart';
import '../../widgets/dialog_view.dart';
import '../../widgets/bottom_input_area.dart';

/// 远程控制台 — 移动端主力工作页面
/// 布局: [AppBar] [SessionBar] [主视图区(最大化)] [底部输入区]
class ConsolePage extends StatefulWidget {
  const ConsolePage({super.key});

  @override
  State<ConsolePage> createState() => _ConsolePageState();
}

class _ConsolePageState extends State<ConsolePage> {
  final GlobalKey<ScaffoldState> _scaffoldKey = GlobalKey<ScaffoldState>();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final sp = context.read<SessionProvider>();
      sp.initWithAuth();
      // 显示连接错误（如果有）
      if (sp.error != null) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          _showError(context, sp.error!);
        });
      }
    });
  }

  void _showError(BuildContext context, String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          msg,
          style: const TextStyle(fontSize: 12, color: AppTheme.textPrimary),
        ),
        backgroundColor: AppTheme.statusRed.withAlpha(200),
        duration: const Duration(seconds: 6),
        action: SnackBarAction(
          label: '重试',
          textColor: AppTheme.textPrimary,
          onPressed: () {
            final sp = context.read<SessionProvider>();
            sp.loadDevicesAndSessions();
          },
        ),
      ),
    );
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
          key: _scaffoldKey,
          backgroundColor: AppTheme.bgPrimary,
          drawer: _SessionDrawer(provider: provider),
          body: Column(
            children: [
              _buildSessionBar(
                context,
                provider,
                session,
                connected,
                statusColor,
              ),
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

  /// 极简 Session Bar
  Widget _buildSessionBar(
    BuildContext context,
    SessionProvider provider,
    Session? session,
    bool connected,
    Color statusColor,
  ) {
    return Container(
      padding: const EdgeInsets.fromLTRB(8, 4, 8, 6),
      decoration: BoxDecoration(
        color: AppTheme.bgSecondary,
        border: Border(bottom: BorderSide(color: AppTheme.borderColor)),
      ),
      child: SafeArea(
        bottom: false,
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            SizedBox(
              height: 34,
              child: Row(
                children: [
                  Builder(
                    builder: (innerContext) => GestureDetector(
                      onTap: () => _scaffoldKey.currentState?.openDrawer(),
                      child: const Padding(
                        padding: EdgeInsets.all(6),
                        child: Icon(
                          Icons.dns_outlined,
                          size: 18,
                          color: AppTheme.textSecondary,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 6),
                  GestureDetector(
                    onTap: () {
                      if (!connected) {
                        provider.loadDevicesAndSessions();
                        provider.initWithAuth();
                      }
                    },
                    child: Tooltip(
                      message: connected
                          ? '已连接'
                          : (provider.error ?? '未连接，点击重试'),
                      child: Container(
                        width: 8,
                        height: 8,
                        decoration: BoxDecoration(
                          color: connected
                              ? AppTheme.statusGreen
                              : AppTheme.statusRed,
                          shape: BoxShape.circle,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: GestureDetector(
                      onTap: () => provider.loadDevicesAndSessions(),
                      child: Text(
                        session != null
                            ? '${provider.sessionDisplayTitle(session)}  ·  ${_statusLabel(session.status)}'
                            : '无活跃 Session',
                        style: const TextStyle(
                          color: AppTheme.textPrimary,
                          fontSize: 13,
                          fontWeight: FontWeight.w500,
                        ),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ),
                  Container(
                    margin: const EdgeInsets.only(right: 6),
                    padding: const EdgeInsets.symmetric(
                      horizontal: 6,
                      vertical: 2,
                    ),
                    decoration: BoxDecoration(
                      color: AppTheme.bgTertiary,
                      borderRadius: BorderRadius.circular(4),
                      border: Border.all(color: AppTheme.borderColor),
                    ),
                    child: Text(
                      mobileAppVersion,
                      style: const TextStyle(
                        color: AppTheme.textTertiary,
                        fontSize: 10,
                        fontFamily: 'monospace',
                      ),
                    ),
                  ),
                  GestureDetector(
                    onTap: () => _showNewSessionDialog(context, provider),
                    child: const Padding(
                      padding: EdgeInsets.all(6),
                      child: Icon(
                        Icons.add,
                        size: 18,
                        color: AppTheme.textSecondary,
                      ),
                    ),
                  ),
                  const SizedBox(width: 4),
                  GestureDetector(
                    onTap: () => _logout(context),
                    child: const Padding(
                      padding: EdgeInsets.all(6),
                      child: Icon(
                        Icons.logout,
                        size: 16,
                        color: AppTheme.textTertiary,
                      ),
                    ),
                  ),
                ],
              ),
            ),
            if (provider.sessions.length > 1)
              SizedBox(
                height: 26,
                child: _buildSessionChips(provider, session),
              ),
          ],
        ),
      ),
    );
  }

  /// 顶部横向 Session 快切栏
  Widget _buildSessionChips(SessionProvider provider, Session? active) {
    final chips = provider.sessions.map((s) {
      final isActive = s.sessionId == active?.sessionId;
      final sc = AppTheme.sessionStatusColor(s.status);
      final displayTitle = provider.sessionDisplayTitle(s);
      return Padding(
        padding: const EdgeInsets.only(right: 6),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 140),
          curve: Curves.easeOut,
          decoration: BoxDecoration(
            color: isActive
                ? AppTheme.brand.withAlpha(18)
                : AppTheme.bgPrimary,
            borderRadius: BorderRadius.circular(999),
            border: Border.all(
              color: isActive
                  ? AppTheme.brand.withAlpha(70)
                  : AppTheme.borderColor,
            ),
          ),
          child: Material(
            color: Colors.transparent,
            child: InkWell(
              borderRadius: BorderRadius.circular(999),
              onTap: () => provider.selectSession(s),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Container(
                      width: 6,
                      height: 6,
                      decoration: BoxDecoration(color: sc, shape: BoxShape.circle),
                    ),
                    const SizedBox(width: 6),
                    Text(
                      displayTitle,
                      style: TextStyle(
                        color: isActive
                            ? AppTheme.brandDark
                            : AppTheme.textSecondary,
                        fontSize: 11,
                        fontWeight: isActive ? FontWeight.w600 : FontWeight.w500,
                      ),
                    ),
                    const SizedBox(width: 4),
                    SizedBox(
                      width: 22,
                      height: 22,
                      child: IconButton(
                        padding: EdgeInsets.zero,
                        splashRadius: 12,
                        onPressed: () => provider.closeSession(s),
                        icon: Container(
                          width: 14,
                          height: 14,
                          decoration: BoxDecoration(
                            color: isActive
                                ? AppTheme.brand.withAlpha(18)
                                : AppTheme.bgTertiary,
                            shape: BoxShape.circle,
                          ),
                          child: Icon(
                            Icons.close,
                            size: 10,
                            color: isActive
                                ? AppTheme.brandDark
                                : AppTheme.textTertiary,
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      );
    }).toList();

    return ListView(
      scrollDirection: Axis.horizontal,
      padding: EdgeInsets.zero,
      children: chips,
    );
  }

  String _statusLabel(String status) {
    switch (status) {
      case 'running':
        return '运行中';
      case 'paused':
        return '已暂停';
      case 'waiting_input':
        return '等待输入';
      case 'stale':
        return '已离线';
      case 'stopped':
        return '已停止';
      case 'crashed':
        return '崩溃';
      default:
        return status;
    }
  }

  void _showNewSessionDialog(BuildContext context, SessionProvider provider) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppTheme.bgPrimary,
        title: const Text(
          '新建 Session',
          style: TextStyle(color: AppTheme.textPrimary, fontSize: 15),
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            shellOption(Icons.terminal, 'PowerShell (pwsh)', () {
              provider.createSession('pwsh');
              Navigator.pop(ctx);
            }),
            const SizedBox(height: 6),
            shellOption(Icons.terminal, 'CMD', () {
              provider.createSession('cmd');
              Navigator.pop(ctx);
            }),
            const SizedBox(height: 6),
            shellOption(Icons.code, 'WSL (Bash)', () {
              provider.createSession('wsl');
              Navigator.pop(ctx);
            }),
          ],
        ),
      ),
    );
  }

  void _logout(BuildContext context) async {
    await context.read<AuthProvider>().logout();
    if (context.mounted) {
      Navigator.of(context).popUntil((route) => route.isFirst);
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
          Icon(icon, size: 18, color: AppTheme.brand),
          const SizedBox(width: 10),
          Text(
            label,
            style: const TextStyle(color: AppTheme.textPrimary, fontSize: 13),
          ),
        ],
      ),
    ),
  );
}

// ═══════════════════════════════════════════════════════════════
// Session 侧边栏 — 按设备分组树状展示
// ═══════════════════════════════════════════════════════════════
class _SessionDrawer extends StatefulWidget {
  final SessionProvider provider;
  const _SessionDrawer({required this.provider});

  @override
  State<_SessionDrawer> createState() => _SessionDrawerState();
}

class _SessionDrawerState extends State<_SessionDrawer> {
  // 记录每台设备的展开/折叠状态
  final Set<int> _expandedDevices = {};

  @override
  void initState() {
    super.initState();
    // 默认全部展开
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final provider = widget.provider;
      setState(() {
        _expandedDevices.addAll(provider.sessionsByDevice.keys);
      });
    });
  }

  @override
  Widget build(BuildContext context) {
    final provider = widget.provider;
    final byDevice = provider.sessionsByDevice;

    return Drawer(
      backgroundColor: AppTheme.bgPrimary,
      width: 280,
      child: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // 顶部：标题 + 刷新按钮
            _buildHeader(provider),
            const Divider(height: 1, color: AppTheme.borderColor),
            // 设备树
            Expanded(
              child: byDevice.isEmpty
                  ? const Center(
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            Icons.dns_outlined,
                            size: 32,
                            color: AppTheme.textTertiary,
                          ),
                          SizedBox(height: 8),
                          Text(
                            '暂无 Session',
                            style: TextStyle(
                              color: AppTheme.textTertiary,
                              fontSize: 12,
                            ),
                          ),
                        ],
                      ),
                    )
                  : ListView(
                      padding: const EdgeInsets.only(top: 4),
                      children: byDevice.entries.map((entry) {
                        final deviceId = entry.key;
                        final sessions = entry.value;
                        final isExpanded = _expandedDevices.contains(deviceId);
                        final isOnline = provider.onlineDeviceIds.contains(
                          deviceId,
                        );
                        final deviceName = provider.deviceName(deviceId);

                        return _DeviceGroup(
                          deviceId: deviceId,
                          deviceName: deviceName,
                          isOnline: isOnline,
                          isExpanded: isExpanded,
                          sessions: sessions,
                          provider: provider,
                          onToggle: () {
                            setState(() {
                              if (isExpanded) {
                                _expandedDevices.remove(deviceId);
                              } else {
                                _expandedDevices.add(deviceId);
                              }
                            });
                          },
                        );
                      }).toList(),
                    ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildHeader(SessionProvider provider) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
      child: Row(
        children: [
          Container(
            width: 8,
            height: 8,
            decoration: BoxDecoration(
              color: provider.isConnected
                  ? AppTheme.statusGreen
                  : AppTheme.statusGray,
              shape: BoxShape.circle,
            ),
          ),
          const SizedBox(width: 8),
          const Text(
            'Sessions',
            style: TextStyle(
              color: AppTheme.textPrimary,
              fontSize: 14,
              fontWeight: FontWeight.w600,
            ),
          ),
          const Spacer(),
          GestureDetector(
            onTap: () => provider.loadDevicesAndSessions(),
            child: const Icon(
              Icons.refresh,
              size: 16,
              color: AppTheme.textTertiary,
            ),
          ),
        ],
      ),
    );
  }
}

/// 单台设备组：设备名 + 在线状态 + 下属session列表
class _DeviceGroup extends StatelessWidget {
  final int deviceId;
  final String deviceName;
  final bool isOnline;
  final bool isExpanded;
  final List<Session> sessions;
  final SessionProvider provider;
  final VoidCallback onToggle;

  const _DeviceGroup({
    required this.deviceId,
    required this.deviceName,
    required this.isOnline,
    required this.isExpanded,
    required this.sessions,
    required this.provider,
    required this.onToggle,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // 设备标题栏
        InkWell(
          onTap: onToggle,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            color: AppTheme.bgSecondary.withAlpha(180),
            child: Row(
              children: [
                Icon(
                  isExpanded ? Icons.expand_more : Icons.chevron_right,
                  size: 16,
                  color: AppTheme.textSecondary,
                ),
                const SizedBox(width: 4),
                Icon(
                  Icons.computer,
                  size: 14,
                  color: isOnline
                      ? AppTheme.statusGreen
                      : AppTheme.textTertiary,
                ),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    deviceName,
                    style: TextStyle(
                      color: AppTheme.textPrimary,
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                    ),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                Container(
                  width: 6,
                  height: 6,
                  decoration: BoxDecoration(
                    color: isOnline
                        ? AppTheme.statusGreen
                        : AppTheme.statusGray,
                    shape: BoxShape.circle,
                  ),
                ),
                const SizedBox(width: 4),
                Text(
                  isOnline ? '在线' : '离线',
                  style: TextStyle(
                    color: isOnline
                        ? AppTheme.statusGreen
                        : AppTheme.textTertiary,
                    fontSize: 10,
                  ),
                ),
                const SizedBox(width: 4),
                Text(
                  '(${sessions.length})',
                  style: const TextStyle(
                    color: AppTheme.textTertiary,
                    fontSize: 10,
                  ),
                ),
              ],
            ),
          ),
        ),
        // Session列表
        if (isExpanded)
          ...sessions.map(
            (s) => _SessionRow(
              displayTitle: provider.sessionDisplayTitle(s),
              session: s,
              isActive: provider.activeSession?.sessionId == s.sessionId,
              onTap: () {
                provider.selectSession(s);
                // 关闭drawer在调用方处理
              },
              onStop: () => provider.stopSession(s),
              onClose: () => provider.closeSession(s),
            ),
          ),
      ],
    );
  }
}

/// 单条 Session 行
class _SessionRow extends StatelessWidget {
  final String displayTitle;
  final Session session;
  final bool isActive;
  final VoidCallback onTap;
  final VoidCallback onStop;
  final VoidCallback onClose;

  const _SessionRow({
    required this.displayTitle,
    required this.session,
    required this.isActive,
    required this.onTap,
    required this.onStop,
    required this.onClose,
  });

  @override
  Widget build(BuildContext context) {
    final sc = AppTheme.sessionStatusColor(session.status);
    final cwdLeaf = _cwdLeaf(session.cwd);
    final meta = cwdLeaf.isNotEmpty
        ? '${session.shellKind}  ·  $cwdLeaf  ·  ${_sessionStatusLabel(session.status)}'
        : '${session.shellKind}  ·  ${_sessionStatusLabel(session.status)}';

    return InkWell(
      onTap: onTap,
      child: Container(
        color: isActive ? AppTheme.brand.withAlpha(10) : null,
        padding: const EdgeInsets.only(left: 40, right: 16, top: 6, bottom: 6),
        child: Row(
          children: [
            Container(
              width: 8,
              height: 8,
              decoration: BoxDecoration(color: sc, shape: BoxShape.circle),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    displayTitle,
                    style: TextStyle(
                      color: isActive ? AppTheme.brand : AppTheme.textPrimary,
                      fontSize: 13,
                      fontWeight: isActive ? FontWeight.w600 : FontWeight.w400,
                    ),
                    overflow: TextOverflow.ellipsis,
                  ),
                  Text(
                    meta,
                    style: const TextStyle(
                      color: AppTheme.textTertiary,
                      fontSize: 10,
                    ),
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            ),
            PopupMenuButton<String>(
              icon: const Icon(
                Icons.more_vert,
                size: 16,
                color: AppTheme.textTertiary,
              ),
              color: AppTheme.bgPrimary,
              onSelected: (v) {
                if (v == 'stop') onStop();
                if (v == 'close') onClose();
              },
              itemBuilder: (_) => [
                const PopupMenuItem(
                  value: 'stop',
                  child: Text('停止', style: TextStyle(fontSize: 12)),
                ),
                const PopupMenuItem(
                  value: 'close',
                  child: Text('关闭', style: TextStyle(fontSize: 12)),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  String _sessionStatusLabel(String s) {
    switch (s) {
      case 'running':
        return '运行中';
      case 'paused':
        return '已暂停';
      case 'waiting_input':
        return '等待输入';
      case 'stale':
        return '已离线';
      case 'stopped':
        return '已停止';
      case 'crashed':
        return '崩溃';
      default:
        return s;
    }
  }

  String _cwdLeaf(String cwd) {
    final normalized = cwd.replaceAll('\\', '/');
    final parts = normalized
        .split('/')
        .where((part) => part.trim().isNotEmpty)
        .toList();
    return parts.isEmpty ? '' : parts.last;
  }
}
