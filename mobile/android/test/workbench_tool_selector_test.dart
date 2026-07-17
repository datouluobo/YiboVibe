import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:yibovibe_mobile/models/ai_workbench.dart';
import 'package:yibovibe_mobile/pages/workbench_tool_selector.dart';

void main() {
  testWidgets('tool card reflects waiting approval state', (tester) async {
    const tool = AiWorkbenchProvider(
      id: 'codex',
      name: 'Codex',
      transport: 'app-server',
      capabilities: ['conversation-read'],
    );
    const projects = [
      AiWorkbenchProject(
        id: 'p1',
        providerId: 'codex',
        name: 'YiboVibe',
        path: r'F:\Download\GitHub\YiboVibe',
        conversationIds: ['thread-1'],
        branches: ['main'],
      ),
    ];
    const sessions = [
      AiWorkbenchConversation(
        id: 'thread-1',
        providerId: 'codex',
        title: 'Remote approval',
        status: 'waitingApproval',
      ),
    ];

    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: WorkbenchToolCard(
            tool: tool,
            projects: projects,
            sessions: sessions,
            selected: true,
            onTap: _noop,
          ),
        ),
      ),
    );

    expect(find.text('Codex'), findsOneWidget);
    expect(find.text('需确认'), findsOneWidget);
    expect(find.textContaining('1 个项目 · 1 个会话'), findsOneWidget);
    expect(find.text('有会话等待远程确认'), findsOneWidget);
  });

  testWidgets('recent row shows source chip and relative time', (tester) async {
    final nowSeconds = DateTime.now().millisecondsSinceEpoch ~/ 1000;
    final session = AiWorkbenchConversation(
      id: 'thread-2',
      providerId: 'codex',
      title: 'Recent thread',
      status: 'idle',
      source: 'vscode',
      updatedAt: nowSeconds - 60,
    );

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: WorkbenchRecentRow(
            session: session,
            selected: false,
            onTap: _noop,
          ),
        ),
      ),
    );

    expect(find.text('Recent thread'), findsOneWidget);
    expect(find.text('1分'), findsOneWidget);
  });
}

void _noop() {}
