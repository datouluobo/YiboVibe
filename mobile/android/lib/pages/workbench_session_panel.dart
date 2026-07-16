// Workbench session panel — extracted from ai_workbench_page.dart
// Shows the list of AI workbench sessions

import 'package:flutter/material.dart';
import '../models/ai_workbench.dart';

class WorkbenchSessionPanel extends StatelessWidget {
  final List<AiWorkbenchConversation> conversations;
  final String? selectedSessionId;
  final ValueChanged<String> onSelectSession;

  const WorkbenchSessionPanel({
    super.key,
    required this.conversations,
    this.selectedSessionId,
    required this.onSelectSession,
  });

  @override
  Widget build(BuildContext context) {
    if (conversations.isEmpty) {
      return const Center(child: Text('暂无会话'));
    }
    return ListView.builder(
      itemCount: conversations.length,
      itemBuilder: (context, index) {
        final conv = conversations[index];
        final isSelected = conv.id == selectedSessionId;
        return ListTile(
          selected: isSelected,
          title: Text(conv.title, maxLines: 1, overflow: TextOverflow.ellipsis),
          subtitle: conv.preview != null
              ? Text(conv.preview!, maxLines: 2, overflow: TextOverflow.ellipsis)
              : null,
          onTap: () => onSelectSession(conv.id),
        );
      },
    );
  }
}
