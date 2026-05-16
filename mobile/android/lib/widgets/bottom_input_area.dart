import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../providers/session_provider.dart';
import '../../theme/app_theme.dart';

/// 底部输入区 — Warp 风格: 单行输入 + 紧凑工具图标
/// 主入口: [mode-icon] [input-field] [send]
/// 工具行: 5 个关键图标 + more ↔ 隐藏在抽屉
class BottomInputArea extends StatefulWidget {
  const BottomInputArea({super.key});

  @override
  State<BottomInputArea> createState() => _BottomInputAreaState();
}

class _BottomInputAreaState extends State<BottomInputArea> {
  final _ctrl = TextEditingController();
  final _focus = FocusNode();

  @override
  void dispose() {
    _ctrl.dispose();
    _focus.dispose();
    super.dispose();
  }

  void _send() {
    final t = _ctrl.text.trim();
    if (t.isEmpty) return;
    context.read<SessionProvider>().sendInput(t);
    _ctrl.clear();
    _focus.requestFocus();
  }

  @override
  Widget build(BuildContext context) {
    return Consumer<SessionProvider>(
      builder: (context, p, _) {
        final running = p.activeSession?.isRunning ?? false;

        return Container(
          decoration: BoxDecoration(
            color: AppTheme.bgSecondary,
            border: Border(top: BorderSide(color: AppTheme.borderColor.withAlpha(60))),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              // 输入行
              Padding(
                padding: const EdgeInsets.fromLTRB(6, 4, 6, 2),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    // 模式指示 (终端/对话)
                    _ModeToggle(p: p),
                    const SizedBox(width: 4),
                    // 输入框
                    Expanded(
                      child: TextField(
                        controller: _ctrl,
                        focusNode: _focus,
                        enabled: running,
                        maxLines: 1,
                        style: const TextStyle(
                          color: AppTheme.textPrimary,
                          fontSize: 13,
                          fontFamily: 'monospace',
                          height: 1.3,
                        ),
                        decoration: InputDecoration(
                          isDense: true,
                          contentPadding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                          hintText: running ? '输入命令…' : 'Session 未运行',
                          hintStyle: const TextStyle(
                            color: AppTheme.textTertiary,
                            fontSize: 13,
                            fontFamily: 'monospace',
                          ),
                          filled: true,
                          fillColor: AppTheme.bgTertiary,
                          border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(6),
                            borderSide: BorderSide.none,
                          ),
                          suffixIcon: _ctrl.text.isNotEmpty
                              ? GestureDetector(
                                  onTap: () => _ctrl.clear(),
                                  child: const Padding(
                                    padding: EdgeInsets.all(6),
                                    child: Icon(Icons.close, size: 14, color: AppTheme.textTertiary),
                                  ),
                                )
                              : null,
                        ),
                        onChanged: (_) => setState(() {}),
                        onSubmitted: (_) => _send(),
                      ),
                    ),
                    const SizedBox(width: 4),
                    // 发送
                    GestureDetector(
                      onTap: running && _ctrl.text.trim().isNotEmpty ? _send : null,
                      child: Container(
                        width: 36,
                        height: 36,
                        decoration: BoxDecoration(
                          color: running && _ctrl.text.trim().isNotEmpty
                              ? AppTheme.brandPurple
                              : AppTheme.bgTertiary,
                          borderRadius: BorderRadius.circular(6),
                        ),
                        child: Icon(
                          Icons.arrow_upward_rounded,
                          size: 16,
                          color: running && _ctrl.text.trim().isNotEmpty
                              ? AppTheme.textPrimary
                              : AppTheme.textTertiary,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              // 工具行 — 关键操作
              Padding(
                padding: const EdgeInsets.fromLTRB(4, 0, 4, 4),
                child: Row(
                  children: [
                    _ToolBtn(Icons.dns_outlined, 'Sessions', () => Scaffold.of(context).openDrawer()),
                    _ToolBtn(Icons.bolt, 'FlowMind', () => _openFlowMind(context)),
                    _ToolBtn(Icons.flash_on, '快捷', () => _openActions(context, p)),
                    _ToolBtn(Icons.folder_outlined, '文件', () => _comingSoon(context)),
                    _ToolBtn(Icons.image_outlined, '图片', () => _comingSoon(context)),
                    const Spacer(),
                    _ToolBtn(Icons.more_horiz, '更多', () => _openMore(context, p)),
                  ],
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  void _openFlowMind(BuildContext ctx) {
    showModalBottomSheet(
      context: ctx,
      backgroundColor: AppTheme.bgSecondary,
      builder: (_) => _FlowMindPanel(provider: context.read<SessionProvider>()),
    );
  }

  void _openActions(BuildContext ctx, SessionProvider p) {
    showModalBottomSheet(
      context: ctx,
      backgroundColor: AppTheme.bgSecondary,
      builder: (_) => Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('快捷动作', style: TextStyle(color: AppTheme.textPrimary, fontSize: 14, fontWeight: FontWeight.w600)),
            const SizedBox(height: 10),
            Wrap(
              spacing: 6, runSpacing: 6,
              children: [
                _quickBtn('Enter', Icons.keyboard_return, '\n', p),
                _quickBtn('Ctrl+C', Icons.cancel, '\x03', p),
                _quickBtn('y', Icons.check, 'y\n', p),
                _quickBtn('n', Icons.close, 'n\n', p),
                _quickBtn('重试', Icons.refresh, '', p),
                _quickBtn('总结', Icons.summarize, '', p),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _quickBtn(String label, IconData icon, String text, SessionProvider p) {
    return GestureDetector(
      onTap: text.isNotEmpty ? () { p.sendInput(text); Navigator.pop(context); } : null,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(
          color: AppTheme.bgTertiary,
          borderRadius: BorderRadius.circular(6),
          border: Border.all(color: AppTheme.borderColor),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 14, color: AppTheme.brandPurpleLight),
            const SizedBox(width: 4),
            Text(label, style: const TextStyle(color: AppTheme.textPrimary, fontSize: 12)),
          ],
        ),
      ),
    );
  }

  void _openMore(BuildContext ctx, SessionProvider p) {
    showModalBottomSheet(
      context: ctx,
      backgroundColor: AppTheme.bgSecondary,
      builder: (_) => Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('更多', style: TextStyle(color: AppTheme.textPrimary, fontSize: 14, fontWeight: FontWeight.w600)),
            const SizedBox(height: 10),
            _moreItem(Icons.cleaning_services, '清空视图', () { p.clearEvents(); Navigator.pop(ctx); }),
            _moreItem(Icons.info_outline, '设备详情', () { Navigator.pop(ctx); }),
            _moreItem(Icons.link_off, '断开连接', () { Navigator.pop(ctx); }),
          ],
        ),
      ),
    );
  }

  Widget _moreItem(IconData icon, String label, VoidCallback onTap) {
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 10),
        child: Row(
          children: [
            Icon(icon, size: 18, color: AppTheme.textSecondary),
            const SizedBox(width: 10),
            Text(label, style: const TextStyle(color: AppTheme.textPrimary, fontSize: 13)),
          ],
        ),
      ),
    );
  }

  void _comingSoon(BuildContext ctx) {
    ScaffoldMessenger.of(ctx).showSnackBar(const SnackBar(
      content: Text('即将推出', style: TextStyle(fontSize: 12)),
      duration: Duration(seconds: 1),
    ));
  }
}

// ═══════════════════════════════════════════════════════════════
// 模式切换按钮
// ═══════════════════════════════════════════════════════════════
class _ModeToggle extends StatelessWidget {
  final SessionProvider p;
  const _ModeToggle({required this.p});

  @override
  Widget build(BuildContext context) {
    final isDialog = p.isDialogMode;
    return GestureDetector(
      onTap: p.toggleViewMode,
      child: Container(
        width: 36,
        height: 36,
        decoration: BoxDecoration(
          color: AppTheme.bgTertiary,
          borderRadius: BorderRadius.circular(6),
        ),
        child: Icon(
          isDialog ? Icons.chat_bubble_outline : Icons.terminal,
          size: 16,
          color: AppTheme.brandPurpleLight,
        ),
      ),
    );
  }
}

// ═══════════════════════════════════════════════════════════════
// 工具按钮
// ═══════════════════════════════════════════════════════════════
class _ToolBtn extends StatelessWidget {
  final IconData icon;
  final String label;
  final VoidCallback onTap;
  const _ToolBtn(this.icon, this.label, this.onTap);

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 2),
      child: GestureDetector(
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(4),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 14, color: AppTheme.textSecondary),
              const SizedBox(width: 3),
              Text(label, style: const TextStyle(color: AppTheme.textTertiary, fontSize: 10)),
            ],
          ),
        ),
      ),
    );
  }
}

// ═══════════════════════════════════════════════════════════════
// FlowMind 面板
// ═══════════════════════════════════════════════════════════════
class _FlowMindPanel extends StatelessWidget {
  final SessionProvider provider;
  const _FlowMindPanel({required this.provider});

  @override
  Widget build(BuildContext context) {
    final cmds = <List<String>>[
      ['git status', 'Git'], ['git diff', 'Git'], ['git log --oneline -5', 'Git'],
      ['cargo build', 'Rust'], ['cargo test', 'Rust'],
      ['npm run build', 'Node'], ['npm test', 'Node'],
      ['docker ps', 'Docker'], ['ls -la', 'Shell'], ['pwd', 'Shell'],
    ];
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('FlowMind · 命令模板',
              style: TextStyle(color: AppTheme.textPrimary, fontSize: 14, fontWeight: FontWeight.w600)),
          const SizedBox(height: 10),
          Wrap(spacing: 6, runSpacing: 6,
            children: cmds.map((c) {
              final cmd = c[0];
              return GestureDetector(
              onTap: () { provider.sendInput('$cmd\n'); Navigator.pop(context); },
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                decoration: BoxDecoration(
                  color: AppTheme.bgTertiary, borderRadius: BorderRadius.circular(6),
                  border: Border.all(color: AppTheme.borderColor),
                ),
                child: Text(cmd,
                    style: const TextStyle(color: AppTheme.textPrimary, fontSize: 12, fontFamily: 'monospace')),
              ),
            );}).toList(),
          ),
        ],
      ),
    );
  }
}
