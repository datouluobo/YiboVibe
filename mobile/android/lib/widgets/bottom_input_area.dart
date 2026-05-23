import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
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
  final _screenCtrl = TextEditingController();
  final FocusNode _screenFocus = FocusNode();

  @override
  void dispose() {
    _ctrl.dispose();
    _focus.dispose();
    _screenCtrl.dispose();
    _screenFocus.dispose();
    super.dispose();
  }

  void _send() {
    final t = _ctrl.text.trim();
    if (t.isEmpty) return;
    context.read<SessionProvider>().sendInput('$t\n');
    _ctrl.clear();
    _focus.requestFocus();
  }

  bool get _hasScreenDraft =>
      _screenCtrl.text.isNotEmpty;

  void _sendScreenDraft(SessionProvider provider, {bool appendEnter = false}) {
    final text = _screenCtrl.text;
    if (text.isEmpty && !appendEnter) return;
    if (text.isNotEmpty) {
      provider.sendRawInput(text);
    }
    if (appendEnter) {
      provider.sendRawInput('\n');
    }
    _screenCtrl.clear();
    setState(() {});
    _screenFocus.requestFocus();
  }

  @override
  Widget build(BuildContext context) {
    return Consumer<SessionProvider>(
      builder: (context, p, _) {
        final running = p.activeSession?.isRunning ?? false;
        final interactive = p.isInteractiveSession;
        final screenMode = p.isScreenMode;
        final viewport = MediaQuery.sizeOf(context);
        final compact = viewport.width < 390 || viewport.height < 820;
        final prompt = screenMode ? null : p.currentPrompt;
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
              Padding(
                padding: const EdgeInsets.fromLTRB(6, 6, 6, 2),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.center,
                  children: [
                    _ModeToggle(p: p, disabled: interactive),
                    const SizedBox(width: 6),
                    Expanded(
                      child: SizedBox(
                        height: 36,
                        child: TextField(
                          controller: screenMode ? _screenCtrl : _ctrl,
                          focusNode: screenMode ? _screenFocus : _focus,
                          enabled: running,
                          maxLines: 1,
                          autocorrect: !screenMode,
                          enableSuggestions: !screenMode,
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
                            hintText: running
                                ? (screenMode ? '输入内容到终端…' : '输入命令…')
                                : 'Session 未运行',
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
                            suffixIcon: screenMode
                                ? (_hasScreenDraft
                                      ? GestureDetector(
                                          onTap: () {
                                            _screenCtrl.clear();
                                            setState(() {});
                                          },
                                          child: const Padding(
                                            padding: EdgeInsets.all(8),
                                            child: Icon(
                                              Icons.close,
                                              size: 14,
                                              color: AppTheme.textTertiary,
                                            ),
                                          ),
                                        )
                                      : null)
                                : (_ctrl.text.isNotEmpty
                                      ? GestureDetector(
                                          onTap: () {
                                            _ctrl.clear();
                                            setState(() {});
                                          },
                                          child: const Padding(
                                            padding: EdgeInsets.all(8),
                                            child: Icon(
                                              Icons.close,
                                              size: 14,
                                              color: AppTheme.textTertiary,
                                            ),
                                          ),
                                        )
                                      : null),
                          ),
                          onChanged: (value) {
                            setState(() {});
                          },
                          onSubmitted: (_) => screenMode
                              ? _sendScreenDraft(p, appendEnter: true)
                              : _send(),
                        ),
                      ),
                    ),
                    const SizedBox(width: 6),
                    GestureDetector(
                      onTap: screenMode
                          ? (running && _hasScreenDraft
                                ? () => _sendScreenDraft(p, appendEnter: true)
                                : null)
                          : (running && _ctrl.text.trim().isNotEmpty
                                ? _send
                                : null),
                      child: Container(
                        width: 36,
                        height: 36,
                        decoration: BoxDecoration(
                          color: screenMode
                              ? (running ? AppTheme.brand : AppTheme.bgTertiary)
                              : (running && _ctrl.text.trim().isNotEmpty
                                    ? AppTheme.brand
                                    : AppTheme.bgTertiary),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Icon(
                          Icons.arrow_upward_rounded,
                          size: 18,
                          color: screenMode
                              ? (running && _hasScreenDraft
                                    ? Colors.white
                                    : AppTheme.textTertiary)
                              : (running && _ctrl.text.trim().isNotEmpty
                                    ? Colors.white
                                    : AppTheme.textTertiary),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              // 工具行 — 关键操作
              Padding(
                padding: EdgeInsets.fromLTRB(4, 0, 4, compact ? 4 : 6),
                child: _MobileToolStrip(
                  compact: compact,
                  children: [
                    Builder(
                      builder: (innerContext) => _ToolBtn(
                        Icons.dns_outlined,
                        'Sessions',
                        () => Scaffold.maybeOf(innerContext)?.openDrawer(),
                        compact: compact,
                      ),
                    ),
                    _ToolBtn(
                      Icons.bolt,
                      'FlowMind',
                      () => _openFlowMind(context),
                      compact: compact,
                    ),
                    _ToolBtn(
                      Icons.flash_on,
                      '快捷',
                      () => _openActions(context, p, interactive || screenMode),
                      compact: compact,
                    ),
                    _ToolBtn(
                      Icons.folder_outlined,
                      '文件',
                      () => _comingSoon(context),
                      compact: compact,
                    ),
                    _ToolBtn(
                      Icons.image_outlined,
                      '图片',
                      () => _comingSoon(context),
                      compact: compact,
                    ),
                    _ToolBtn(
                      Icons.more_horiz,
                      '更多',
                      () => _openMore(context, p),
                      compact: compact,
                    ),
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
      backgroundColor: AppTheme.bgPrimary,
      builder: (_) => _FlowMindPanel(provider: context.read<SessionProvider>()),
    );
  }

  void _openActions(BuildContext ctx, SessionProvider p, bool showInteractive) {
    final actionItems = <Widget>[
      _sheetActionBtn('Enter', Icons.keyboard_return, () {
        p.sendRawInput('\n');
      }, closeOnTap: true),
      _sheetActionBtn('Ctrl+C', Icons.cancel, () {
        p.sendRawInput('\x03');
      }, closeOnTap: true),
      _sheetActionBtn('Ctrl+A', Icons.select_all, () {
        p.sendRawInput('\x01');
      }, closeOnTap: true),
      _sheetActionBtn('粘贴', Icons.content_paste_rounded, () async {
        final data = await Clipboard.getData(Clipboard.kTextPlain);
        final text = data?.text ?? '';
        if (text.isNotEmpty) {
          p.sendRawInput(text);
        }
        if (ctx.mounted) {
          Navigator.pop(ctx);
          ScaffoldMessenger.of(ctx).showSnackBar(
            SnackBar(
              content: Text(
                text.isEmpty ? '剪贴板为空' : '已粘贴 ${text.length} 个字符',
                style: const TextStyle(fontSize: 12),
              ),
              duration: const Duration(seconds: 1),
            ),
          );
        }
      }, closeOnTap: false),
      _sheetActionBtn('y', Icons.check, () {
        p.sendInput('y\n');
      }, closeOnTap: true),
      _sheetActionBtn('n', Icons.close, () {
        p.sendInput('n\n');
      }, closeOnTap: true),
      _sheetActionBtn('重试', Icons.refresh, null),
      _sheetActionBtn('总结', Icons.summarize, null),
    ];
    if (showInteractive) {
      actionItems.insertAll(0, [
        _sheetActionBtn('Up', Icons.keyboard_arrow_up, () {
          p.sendRawInput('\x1B[A');
        }, closeOnTap: false),
        _sheetActionBtn('Down', Icons.keyboard_arrow_down, () {
          p.sendRawInput('\x1B[B');
        }, closeOnTap: false),
        _sheetActionBtn('Left', Icons.keyboard_arrow_left, () {
          p.sendRawInput('\x1B[D');
        }, closeOnTap: false),
        _sheetActionBtn('Right', Icons.keyboard_arrow_right, () {
          p.sendRawInput('\x1B[C');
        }, closeOnTap: false),
        _sheetActionBtn('Bksp', Icons.backspace_outlined, () {
          p.sendRawInput('\b');
        }, closeOnTap: false),
        _sheetActionBtn('Tab', Icons.keyboard_tab, () {
          p.sendRawInput('\t');
        }, closeOnTap: false),
        _sheetActionBtn('Esc', Icons.close_fullscreen, () {
          p.sendRawInput('\x1B');
        }, closeOnTap: false),
        _sheetActionBtn('Space', Icons.space_bar, () {
          p.sendRawInput(' ');
        }, closeOnTap: false),
      ]);
    }

    showModalBottomSheet(
      context: ctx,
      backgroundColor: AppTheme.bgPrimary,
      isScrollControlled: true,
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
              spacing: 10,
              runSpacing: 10,
              children: actionItems,
            ),
          ],
        ),
      ),
    );
  }

  Widget _sheetActionBtn(
    String label,
    IconData icon,
    VoidCallback? onTap, {
    bool closeOnTap = false,
  }) {
    return GestureDetector(
      onTap: onTap == null
          ? null
          : () {
              onTap();
              if (closeOnTap && context.mounted) {
                Navigator.pop(context);
              }
            },
      child: Container(
        constraints: const BoxConstraints(minWidth: 88),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
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
              style: TextStyle(
                color: onTap == null
                    ? AppTheme.textTertiary
                    : AppTheme.textPrimary,
                fontSize: 12,
              ),
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

class _MobileToolStrip extends StatelessWidget {
  final bool compact;
  final List<Widget> children;

  const _MobileToolStrip({required this.compact, required this.children});

  @override
  Widget build(BuildContext context) {
    if (!compact) {
      return Wrap(spacing: 2, runSpacing: 2, children: children);
    }

    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(children: children),
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
  final bool compact;

  const _ToolBtn(this.icon, this.label, this.onTap, {this.compact = false});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 1, vertical: 1),
      child: GestureDetector(
        onTap: onTap,
        child: Container(
          padding: EdgeInsets.symmetric(
            horizontal: compact ? 6 : 7,
            vertical: compact ? 5 : 4,
          ),
          decoration: BoxDecoration(borderRadius: BorderRadius.circular(4)),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                icon,
                size: compact ? 15 : 14,
                color: AppTheme.textSecondary,
              ),
              SizedBox(width: compact ? 4 : 3),
              Text(
                label,
                style: TextStyle(
                  color: AppTheme.textTertiary,
                  fontSize: compact ? 10.5 : 10,
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
