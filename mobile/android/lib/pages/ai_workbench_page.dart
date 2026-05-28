import 'package:flutter/material.dart';
import '../models/ai_workbench.dart';
import '../models/ai_workbench_mock.dart';
import '../theme/app_theme.dart';

class AiWorkbenchPage extends StatefulWidget {
  const AiWorkbenchPage({super.key, this.snapshot});

  final AiWorkbenchSnapshot? snapshot;

  @override
  State<AiWorkbenchPage> createState() => _AiWorkbenchPageState();
}

class _AiWorkbenchPageState extends State<AiWorkbenchPage> {
  late String _selectedConversationId;

  @override
  void initState() {
    super.initState();
    final snapshot = widget.snapshot ?? aiWorkbenchMockSnapshot;
    _selectedConversationId = snapshot.activeConversationId ??
        snapshot.conversations.firstOrNull?.id ??
        '';
  }

  @override
  Widget build(BuildContext context) {
    final snapshot = widget.snapshot ?? aiWorkbenchMockSnapshot;
    final activeConversation = snapshot.conversations
        .where((item) => item.id == _selectedConversationId)
        .firstOrNull;
    final messages =
        snapshot.messagesByConversationId[_selectedConversationId] ?? const [];
    final activeProject = activeConversation == null
        ? null
        : snapshot.projects
            .where((project) => project.id == activeConversation.projectId)
            .firstOrNull;

    return Scaffold(
      backgroundColor: AppTheme.bgPrimary,
      appBar: AppBar(
        title: const Text('AI 工作台'),
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: 12),
            child: Center(
              child: Text(
                snapshot.providers.map((item) => item.name).join(' / '),
                style: const TextStyle(
                  color: AppTheme.textTertiary,
                  fontSize: 11,
                ),
              ),
            ),
          ),
        ],
      ),
      body: Column(
        children: [
          _ProjectHeader(project: activeProject, conversation: activeConversation),
          SizedBox(
            height: 92,
            child: ListView.separated(
              padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
              scrollDirection: Axis.horizontal,
              itemCount: snapshot.conversations.length,
              separatorBuilder: (_, __) => const SizedBox(width: 8),
              itemBuilder: (context, index) {
                final conversation = snapshot.conversations[index];
                final selected = conversation.id == _selectedConversationId;
                return _ConversationChip(
                  conversation: conversation,
                  selected: selected,
                  onTap: () {
                    setState(() => _selectedConversationId = conversation.id);
                  },
                );
              },
            ),
          ),
          const Divider(height: 1),
          Expanded(
            child: messages.isEmpty
                ? const Center(
                    child: Text(
                      '暂无消息',
                      style: TextStyle(color: AppTheme.textTertiary),
                    ),
                  )
                : ListView.separated(
                    padding: const EdgeInsets.fromLTRB(14, 14, 14, 18),
                    itemCount: messages.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 12),
                    itemBuilder: (context, index) {
                      return _MessageBubble(message: messages[index]);
                    },
                  ),
          ),
          _ComposerPreview(
            config: snapshot.configsByProviderId[activeConversation?.providerId],
          ),
        ],
      ),
    );
  }
}

class _ProjectHeader extends StatelessWidget {
  const _ProjectHeader({required this.project, required this.conversation});

  final AiWorkbenchProject? project;
  final AiWorkbenchConversation? conversation;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(14, 10, 14, 10),
      decoration: const BoxDecoration(
        color: AppTheme.bgSecondary,
        border: Border(bottom: BorderSide(color: AppTheme.borderColor)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            project?.name ?? '未选择项目',
            style: const TextStyle(
              color: AppTheme.textPrimary,
              fontSize: 15,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            [
              conversation?.status ?? 'notLoaded',
              project?.branches.firstOrNull,
              project?.path,
            ].whereType<String>().where((item) => item.isNotEmpty).join(' · '),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              color: AppTheme.textSecondary,
              fontSize: 11,
            ),
          ),
        ],
      ),
    );
  }
}

class _ConversationChip extends StatelessWidget {
  const _ConversationChip({
    required this.conversation,
    required this.selected,
    required this.onTap,
  });

  final AiWorkbenchConversation conversation;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final statusColor = switch (conversation.status) {
      'running' => AppTheme.statusGreen,
      'waitingApproval' => AppTheme.statusYellow,
      'failed' => AppTheme.statusRed,
      _ => AppTheme.statusGray,
    };

    return Material(
      color: selected ? AppTheme.bgHover : AppTheme.bgSecondary,
      borderRadius: BorderRadius.circular(10),
      child: InkWell(
        borderRadius: BorderRadius.circular(10),
        onTap: onTap,
        child: Container(
          width: 220,
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(10),
            border: Border.all(
              color: selected ? AppTheme.brandLight : AppTheme.borderColor,
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
                      color: statusColor,
                      shape: BoxShape.circle,
                    ),
                  ),
                  const SizedBox(width: 7),
                  Expanded(
                    child: Text(
                      conversation.title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppTheme.textPrimary,
                        fontSize: 13,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Text(
                conversation.preview ?? conversation.cwd ?? conversation.id,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: AppTheme.textSecondary,
                  fontSize: 11,
                  height: 1.25,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _MessageBubble extends StatelessWidget {
  const _MessageBubble({required this.message});

  final AiWorkbenchMessage message;

  @override
  Widget build(BuildContext context) {
    final user = message.role == 'user';
    return Align(
      alignment: user ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        constraints: const BoxConstraints(maxWidth: 330),
        padding: EdgeInsets.fromLTRB(user ? 14 : 12, 10, 14, 10),
        decoration: BoxDecoration(
          color: user ? AppTheme.bgTertiary : AppTheme.bgPrimary,
          borderRadius: BorderRadius.circular(user ? 18 : 8),
          border: user
              ? null
              : const Border(left: BorderSide(color: AppTheme.statusGreen, width: 3)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (!user)
              Text(
                message.title,
                style: const TextStyle(
                  color: AppTheme.statusGreen,
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                ),
              ),
            if (!user) const SizedBox(height: 6),
            SelectableText(
              message.text,
              style: const TextStyle(
                color: AppTheme.textPrimary,
                fontSize: 14,
                height: 1.45,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ComposerPreview extends StatelessWidget {
  const _ComposerPreview({required this.config});

  final AiWorkbenchConfig? config;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      top: false,
      child: Container(
        padding: const EdgeInsets.fromLTRB(12, 10, 12, 12),
        decoration: const BoxDecoration(
          color: AppTheme.bgSecondary,
          border: Border(top: BorderSide(color: AppTheme.borderColor)),
        ),
        child: Row(
          children: [
            Expanded(
              child: Container(
                constraints: const BoxConstraints(minHeight: 44),
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                decoration: BoxDecoration(
                  color: AppTheme.bgPrimary,
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: AppTheme.borderColor),
                ),
                child: Text(
                  '给 ${config?.modelProvider ?? 'AI'} 发送消息 · ${config?.model ?? '未选择模型'}',
                  style: const TextStyle(
                    color: AppTheme.textTertiary,
                    fontSize: 13,
                  ),
                ),
              ),
            ),
            const SizedBox(width: 8),
            Container(
              width: 44,
              height: 44,
              decoration: BoxDecoration(
                color: AppTheme.brand,
                borderRadius: BorderRadius.circular(14),
              ),
              child: const Icon(Icons.send, color: Colors.white, size: 18),
            ),
          ],
        ),
      ),
    );
  }
}
