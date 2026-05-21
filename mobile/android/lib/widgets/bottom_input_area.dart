import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../providers/session_provider.dart';
import '../../theme/app_theme.dart';
import '../../utils/terminal_text_formatter.dart';

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
    context.read<SessionProvider>().sendInput('$t\n');
    _ctrl.clear();
    _focus.requestFocus();
  }

  @override
  Widget build(BuildContext context) {
    return Consumer<SessionProvider>(
      builder: (context, p, _) {
        final running = p.activeSession?.isRunning ?? false;
        final interactive = p.isInteractiveSession;
        final prompt = p.currentPrompt;
        final promptText = prompt == null
            ? null
            : TerminalTextFormatter.displayBody(
                prompt,
                preserveBlankLines: true,
              );

        return Container(
          decoration: BoxDecoration(
            color: AppTheme.bgPrimary,
            border: Border(top: BorderSide(color: AppTheme.borderColor)),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (promptText != null && promptText.isNotEmpty)
                Container(
                  width: double.infinity,
                  margin: const EdgeInsets.fromLTRB(8, 8, 8, 0),
                  padding: const EdgeInsets.fromLTRB(10, 7, 10, 6),
                  alignment: Alignment.centerLeft,
                  decoration: BoxDecoration(
                    color: AppTheme.bgSecondary,
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(
                      color: AppTheme.borderColor.withAlpha(140),
                    ),
                  ),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Padding(
                        padding: EdgeInsets.only(top: 1, right: 8),
                        child: Icon(
                          Icons.subdirectory_arrow_right_rounded,
                          size: 14,
                          color: AppTheme.textTertiary,
                        ),
                      ),
                      Expanded(
                        child: SelectableText.rich(
                          TerminalTextFormatter.buildStyledText(
                            promptText,
                            const TextStyle(
                              color: AppTheme.textSecondary,
                              fontSize: 11.5,
                              fontFamily: 'monospace',
                              height: 1.28,
                            ),
                          ),
                          textWidthBasis: TextWidthBasis.parent,
                        ),
                      ),
                    ],
                  ),
                ),
              // 输入行 — 统一 36px 高度
              Padding(
                padding: const EdgeInsets.fromLTRB(6, 6, 6, 2),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.center,
                  children: [
                    // 模式指示 (终端/对话)
                    _ModeToggle(p: p, disabled: interactive),
                    const SizedBox(width: 6),
                    // 输入框
                    Expanded(
                      child: SizedBox(
                        height: 36,
                        child: TextField(
                          controller: _ctrl,
                          focusNode: _focus,
                          enabled: running,
                          maxLines: 1,
                          style: const TextStyle(
                            color: AppTheme.textPrimary,
                            fontSize: 13,
                            fontFamily: 'monospace',
                            height: 1.2,
                          ),
                          decoration: InputDecoration(
                            isDense: false,
                            contentPadding: const EdgeInsets.symmetric(
                              horizontal: 10,
                              vertical: 9,
                            ),
                            hintText: running ? '输入命令…' : 'Session 未运行',
                            hintStyle: const TextStyle(
                              color: AppTheme.textTertiary,
                              fontSize: 13,
                              fontFamily: 'monospace',
                            ),
                            filled: true,
                            fillColor: AppTheme.bgTertiary,
                            border: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(8),
                              borderSide: BorderSide.none,
                            ),
                            suffixIcon: _ctrl.text.isNotEmpty
                                ? GestureDetector(
                                    onTap: () => _ctrl.clear(),
                                    child: const Padding(
                                      padding: EdgeInsets.all(8),
                                      child: Icon(
                                        Icons.close,
                                        size: 14,
                                        color: AppTheme.textTertiary,
                                      ),
                                    ),
                                  )
                                : null,
                          ),
                          onChanged: (_) => setState(() {}),
                          onSubmitted: (_) => _send(),
                        ),
                      ),
                    ),
                    const SizedBox(width: 6),
                    // 发送按钮 — 36x36
                    GestureDetector(
                      onTap: running && _ctrl.text.trim().isNotEmpty
                          ? _send
                          : null,
                      child: Container(
                        width: 36,
                        height: 36,
                        decoration: BoxDecoration(
                          color: running && _ctrl.text.trim().isNotEmpty
                              ? AppTheme.brand
                              : AppTheme.bgTertiary,
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Icon(
                          Icons.arrow_upward_rounded,
                          size: 18,
                          color: running && _ctrl.text.trim().isNotEmpty
                              ? Colors.white
                              : AppTheme.textTertiary,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              // 工具行 — 关键操作
              Padding(
                padding: const EdgeInsets.fromLTRB(4, 0, 4, 6),
                child: Row(
                  children: [
                    Builder(
                      builder: (innerContext) => _ToolBtn(
                        Icons.dns_outlined,
                        'Sessions',
                        () => Scaffold.maybeOf(innerContext)?.openDrawer(),
                      ),
                    ),
                    _ToolBtn(
                      Icons.bolt,
                      'FlowMind',
                      () => _openFlowMind(context),
                    ),
                    _ToolBtn(
                      Icons.flash_on,
                      '快捷',
                      () => _openActions(context, p),
                    ),
                    _ToolBtn(
                      Icons.folder_outlined,
                      '文件',
                      () => _comingSoon(context),
                    ),
                    _ToolBtn(
                      Icons.image_outlined,
                      '图片',
                      () => _comingSoon(context),
                    ),
                    const Spacer(),
                    _ToolBtn(
                      Icons.more_horiz,
                      '更多',
                      () => _openMore(context, p),
                    ),
                  ],
                ),
              ),
              if (interactive)
                Padding(
                  padding: const EdgeInsets.fromLTRB(8, 0, 8, 8),
                  child: _InteractiveToolbar(provider: p),
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
      backgroundColor: AppTheme.bgPrimary,
      builder: (_) => _FlowMindPanel(provider: context.read<SessionProvider>()),
    );
  }

  void _openActions(BuildContext ctx, SessionProvider p) {
    showModalBottomSheet(
      context: ctx,
      backgroundColor: AppTheme.bgPrimary,
      builder: (_) => Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              '快捷动作',
              style: TextStyle(
                color: AppTheme.textPrimary,
                fontSize: 14,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 10),
            Wrap(
              spacing: 6,
              runSpacing: 6,
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

  Widget _quickBtn(
    String label,
    IconData icon,
    String text,
    SessionProvider p,
  ) {
    return GestureDetector(
      onTap: text.isNotEmpty
          ? () {
              p.sendInput(text);
              Navigator.pop(context);
            }
          : null,
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
            Icon(icon, size: 14, color: AppTheme.brand),
            const SizedBox(width: 4),
            Text(
              label,
              style: const TextStyle(color: AppTheme.textPrimary, fontSize: 12),
            ),
          ],
        ),
      ),
    );
  }

  void _openMore(BuildContext ctx, SessionProvider p) {
    showModalBottomSheet(
      context: ctx,
      backgroundColor: AppTheme.bgPrimary,
      builder: (_) => Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              '更多',
              style: TextStyle(
                color: AppTheme.textPrimary,
                fontSize: 14,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 10),
            _moreItem(Icons.cleaning_services, '清空视图', () {
              p.clearEvents();
              Navigator.pop(ctx);
            }),
            _moreItem(Icons.info_outline, '设备详情', () {
              Navigator.pop(ctx);
            }),
            _moreItem(Icons.link_off, '断开连接', () {
              Navigator.pop(ctx);
            }),
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
            Text(
              label,
              style: const TextStyle(color: AppTheme.textPrimary, fontSize: 13),
            ),
          ],
        ),
      ),
    );
  }

  void _comingSoon(BuildContext ctx) {
    ScaffoldMessenger.of(ctx).showSnackBar(
      const SnackBar(
        content: Text('即将推出', style: TextStyle(fontSize: 12)),
        duration: Duration(seconds: 1),
      ),
    );
  }
}

// ═══════════════════════════════════════════════════════════════
// 模式切换按钮
// ═══════════════════════════════════════════════════════════════
class _ModeToggle extends StatelessWidget {
  final SessionProvider p;
  final bool disabled;
  const _ModeToggle({required this.p, this.disabled = false});

  @override
  Widget build(BuildContext context) {
    final isDialog = p.isDialogMode;
    return GestureDetector(
      onTap: disabled ? null : p.toggleViewMode,
      child: Container(
        width: 36,
        height: 36,
        decoration: BoxDecoration(
          color: AppTheme.bgTertiary,
          borderRadius: BorderRadius.circular(8),
          border: disabled
              ? Border.all(color: AppTheme.borderColor.withAlpha(140))
              : null,
        ),
        child: Icon(
          isDialog ? Icons.chat_bubble_outline : Icons.terminal,
          size: 18,
          color: disabled ? AppTheme.textTertiary : AppTheme.brand,
        ),
      ),
    );
  }
}

class _InteractiveToolbar extends StatelessWidget {
  final SessionProvider provider;

  const _InteractiveToolbar({required this.provider});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
      decoration: BoxDecoration(
        color: AppTheme.bgSecondary,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppTheme.borderColor),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            '交互模式',
            style: TextStyle(
              color: AppTheme.textSecondary,
              fontSize: 11,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              _interactiveKey('Up', Icons.keyboard_arrow_up, '\x1B[A'),
              _interactiveKey('Down', Icons.keyboard_arrow_down, '\x1B[B'),
              _interactiveKey('Left', Icons.keyboard_arrow_left, '\x1B[D'),
              _interactiveKey('Right', Icons.keyboard_arrow_right, '\x1B[C'),
              _interactiveKey('Enter', Icons.keyboard_return, '\n'),
              _interactiveKey('Tab', Icons.keyboard_tab, '\t'),
              _interactiveKey('Esc', Icons.close_fullscreen, '\x1B'),
              _interactiveKey('Space', Icons.space_bar, ' '),
              _interactiveKey('Ctrl+C', Icons.cancel_outlined, '\x03'),
            ],
          ),
        ],
      ),
    );
  }

  Widget _interactiveKey(String label, IconData icon, String value) {
    return GestureDetector(
      onTap: () => provider.sendRawInput(value),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
        decoration: BoxDecoration(
          color: AppTheme.bgPrimary,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: AppTheme.borderColor),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 14, color: AppTheme.brand),
            const SizedBox(width: 5),
            Text(
              label,
              style: const TextStyle(color: AppTheme.textPrimary, fontSize: 12),
            ),
          ],
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
          decoration: BoxDecoration(borderRadius: BorderRadius.circular(4)),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 14, color: AppTheme.textSecondary),
              const SizedBox(width: 3),
              Text(
                label,
                style: const TextStyle(
                  color: AppTheme.textTertiary,
                  fontSize: 10,
                ),
              ),
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
      ['git status', 'Git'],
      ['git diff', 'Git'],
      ['git log --oneline -5', 'Git'],
      ['cargo build', 'Rust'],
      ['cargo test', 'Rust'],
      ['npm run build', 'Node'],
      ['npm test', 'Node'],
      ['docker ps', 'Docker'],
      ['ls -la', 'Shell'],
      ['pwd', 'Shell'],
    ];
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'FlowMind · 命令模板',
            style: TextStyle(
              color: AppTheme.textPrimary,
              fontSize: 14,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 10),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: cmds.map((c) {
              final cmd = c[0];
              return GestureDetector(
                onTap: () {
                  provider.sendInput('$cmd\n');
                  Navigator.pop(context);
                },
                child: Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 6,
                  ),
                  decoration: BoxDecoration(
                    color: AppTheme.bgTertiary,
                    borderRadius: BorderRadius.circular(6),
                    border: Border.all(color: AppTheme.borderColor),
                  ),
                  child: Text(
                    cmd,
                    style: const TextStyle(
                      color: AppTheme.textPrimary,
                      fontSize: 12,
                      fontFamily: 'monospace',
                    ),
                  ),
                ),
              );
            }).toList(),
          ),
        ],
      ),
    );
  }
}
