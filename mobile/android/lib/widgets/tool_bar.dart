import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../providers/session_provider.dart';
import '../../theme/app_theme.dart';

/// 工具行 — 底部第二行，高频能力入口
/// 顺序: Sessions | 文件 | FlowMind | 图片 | 模式 | 动作 | 设置 | 更多
class ToolBar extends StatelessWidget {
  const ToolBar({super.key});

  static const _tools = [
    _ToolDef(Icons.dns_outlined, 'Sessions', 'sessions'),
    _ToolDef(Icons.folder_outlined, '文件', 'files'),
    _ToolDef(Icons.psychology_outlined, 'FlowMind', 'flowmind'),
    _ToolDef(Icons.image_outlined, '图片', 'image'),
    _ToolDef(Icons.swap_horiz, '模式', 'mode'),
    _ToolDef(Icons.flash_on, '动作', 'actions'),
    _ToolDef(Icons.settings_outlined, '设置', 'settings'),
    _ToolDef(Icons.more_horiz, '更多', 'more'),
  ];

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 40,
      padding: const EdgeInsets.symmetric(horizontal: 4),
      child: Row(
        children: _tools.map((tool) {
          return Expanded(
            child: _ToolButton(
              tool: tool,
              onTap: () => _handleToolTap(context, tool.id),
            ),
          );
        }).toList(),
      ),
    );
  }

  void _handleToolTap(BuildContext context, String toolId) {
    final provider = context.read<SessionProvider>();

    switch (toolId) {
      case 'sessions':
        _showSessionsDrawer(context);
        break;
      case 'files':
        _showComingSoon(context, '文件投喂');
        break;
      case 'flowmind':
        _showFlowMindPanel(context);
        break;
      case 'image':
        _showComingSoon(context, '图片投递');
        break;
      case 'mode':
        provider.toggleViewMode();
        break;
      case 'actions':
        _showQuickActions(context, provider);
        break;
      case 'settings':
        _showComingSoon(context, '设置');
        break;
      case 'more':
        _showMorePanel(context);
        break;
    }
  }

  void _showSessionsDrawer(BuildContext context) {
    Scaffold.of(context).openDrawer();
  }

  void _showFlowMindPanel(BuildContext context) {
    showModalBottomSheet(
      context: context,
      backgroundColor: AppTheme.bgSecondary,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) => const _FlowMindPanel(),
    );
  }

  void _showQuickActions(
      BuildContext context, SessionProvider provider) {
    showModalBottomSheet(
      context: context,
      backgroundColor: AppTheme.bgSecondary,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) => _QuickActionsPanel(provider: provider),
    );
  }

  void _showMorePanel(BuildContext context) {
    showModalBottomSheet(
      context: context,
      backgroundColor: AppTheme.bgSecondary,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) => const _MorePanel(),
    );
  }

  void _showComingSoon(BuildContext context, String feature) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('$feature — 即将推出'),
        duration: const Duration(seconds: 2),
      ),
    );
  }
}

class _ToolDef {
  final IconData icon;
  final String label;
  final String id;
  const _ToolDef(this.icon, this.label, this.id);
}

class _ToolButton extends StatelessWidget {
  final _ToolDef tool;
  final VoidCallback onTap;

  const _ToolButton({required this.tool, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(6),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(tool.icon, size: 16, color: AppTheme.textSecondary),
          const SizedBox(height: 2),
          Text(tool.label,
              style:
                  const TextStyle(color: AppTheme.textTertiary, fontSize: 9)),
        ],
      ),
    );
  }
}

/// FlowMind 面板 — 命令模板和快捷注入
class _FlowMindPanel extends StatelessWidget {
  const _FlowMindPanel();

  @override
  Widget build(BuildContext context) {
    const templates = [
      _TemplateItem('git status', 'Git'),
      _TemplateItem('git diff', 'Git'),
      _TemplateItem('git log --oneline -10', 'Git'),
      _TemplateItem('cargo build', 'Rust'),
      _TemplateItem('cargo test', 'Rust'),
      _TemplateItem('npm run build', 'Node'),
      _TemplateItem('npm test', 'Node'),
      _TemplateItem('docker ps', 'Docker'),
      _TemplateItem('ls -la', 'Shell'),
      _TemplateItem('pwd', 'Shell'),
    ];

    return Padding(
      padding: const EdgeInsets.all(20),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Center(
            child: _DragHandle(),
          ),
          const SizedBox(height: 16),
          const Text('FlowMind · 命令模板',
              style: TextStyle(
                  color: AppTheme.textPrimary,
                  fontSize: 16,
                  fontWeight: FontWeight.w600)),
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: templates.map((t) {
              return GestureDetector(
                onTap: () {
                  // 填入当前输入框（通过 SessionProvider）
                  context.read<SessionProvider>().sendInput(t.command);
                  Navigator.pop(context);
                },
                child: Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  decoration: BoxDecoration(
                    color: AppTheme.bgTertiary,
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: AppTheme.borderColor),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(t.command,
                          style: const TextStyle(
                            color: AppTheme.textPrimary,
                            fontSize: 13,
                            fontFamily: 'monospace',
                          )),
                      const SizedBox(height: 2),
                      Text(t.category,
                          style: const TextStyle(
                            color: AppTheme.textTertiary,
                            fontSize: 10,
                          )),
                    ],
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

class _TemplateItem {
  final String command;
  final String category;
  const _TemplateItem(this.command, this.category);
}

/// 快捷动作面板
class _QuickActionsPanel extends StatelessWidget {
  final SessionProvider provider;
  const _QuickActionsPanel({required this.provider});

  @override
  Widget build(BuildContext context) {
    const actions = [
      _ActionItem(Icons.keyboard_return, 'Enter', ''),
      _ActionItem(Icons.cancel, 'Ctrl+C', '\x03'),
      _ActionItem(Icons.check, 'y', 'y'),
      _ActionItem(Icons.close, 'n', 'n'),
      _ActionItem(Icons.refresh, '重试', ''),
      _ActionItem(Icons.summarize, '总结输出', ''),
    ];

    return Padding(
      padding: const EdgeInsets.all(20),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Center(child: _DragHandle()),
          const SizedBox(height: 16),
          const Text('快捷动作',
              style: TextStyle(
                  color: AppTheme.textPrimary,
                  fontSize: 16,
                  fontWeight: FontWeight.w600)),
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: actions.map((a) {
              return InkWell(
                onTap: () {
                  if (a.text.isNotEmpty) provider.sendInput(a.text);
                  Navigator.pop(context);
                },
                borderRadius: BorderRadius.circular(8),
                child: Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                  decoration: BoxDecoration(
                    color: AppTheme.bgTertiary,
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: AppTheme.borderColor),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(a.icon, size: 16, color: AppTheme.brandPurpleLight),
                      const SizedBox(width: 6),
                      Text(a.label,
                          style: const TextStyle(
                            color: AppTheme.textPrimary,
                            fontSize: 13,
                          )),
                    ],
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

class _ActionItem {
  final IconData icon;
  final String label;
  final String text;
  const _ActionItem(this.icon, this.label, this.text);
}

/// 更多面板
class _MorePanel extends StatelessWidget {
  const _MorePanel();

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(20),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Center(child: _DragHandle()),
          const SizedBox(height: 16),
          const Text('更多',
              style: TextStyle(
                  color: AppTheme.textPrimary,
                  fontSize: 16,
                  fontWeight: FontWeight.w600)),
          const SizedBox(height: 12),
          _MoreItem(Icons.cleaning_services, '清空视图缓存', () {
            context.read<SessionProvider>().clearEvents();
            Navigator.pop(context);
          }),
          _MoreItem(Icons.info_outline, '查看设备详情', () {
            Navigator.pop(context);
          }),
          _MoreItem(Icons.link_off, '断开连接', () {
            Navigator.pop(context);
          }),
        ],
      ),
    );
  }
}

class _MoreItem extends StatelessWidget {
  final IconData icon;
  final String label;
  final VoidCallback onTap;

  const _MoreItem(this.icon, this.label, this.onTap);

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(8),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 12),
        child: Row(
          children: [
            Icon(icon, size: 20, color: AppTheme.textSecondary),
            const SizedBox(width: 12),
            Text(label,
                style: const TextStyle(
                    color: AppTheme.textPrimary, fontSize: 14)),
          ],
        ),
      ),
    );
  }
}

class _DragHandle extends StatelessWidget {
  const _DragHandle();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 36,
      height: 4,
      decoration: BoxDecoration(
        color: AppTheme.textTertiary,
        borderRadius: BorderRadius.circular(2),
      ),
    );
  }
}
