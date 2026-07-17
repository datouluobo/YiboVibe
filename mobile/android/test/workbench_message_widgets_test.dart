import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:yibovibe_mobile/models/ai_workbench.dart';
import 'package:yibovibe_mobile/pages/workbench_message_widgets.dart';

void main() {
  testWidgets('Codex session body shows digest summary and approval state', (
    tester,
  ) async {
    const session = AiWorkbenchConversation(
      id: 'thread-1',
      providerId: 'codex',
      title: 'Digest Test',
      status: 'waitingApproval',
      preview: '桌面刚完成构建并等待下一步确认',
      pendingApproval: AiWorkbenchPendingApproval(
        requestId: 'req-1',
        approvalId: 'approval-1',
        kind: 'exec-approval',
        title: '命令执行待确认',
        summary: 'cargo check -p tauri-app',
      ),
      sessionSummary: AiWorkbenchSessionSummary(
        statusLabel: '等待移动端确认',
        hasError: true,
      ),
    );
    const messages = [
      AiWorkbenchMessage(
        id: 'assistant-1',
        providerId: 'codex',
        conversationId: 'thread-1',
        role: 'assistant',
        title: 'Codex',
        text: '构建已经完成，接下来建议先确认这个高风险操作再继续。',
      ),
      AiWorkbenchMessage(
        id: 'tool-1',
        providerId: 'codex',
        conversationId: 'thread-1',
        role: 'system',
        title: 'Tool',
        text: 'error: command failed with exit code 1',
        rawType: 'tool',
      ),
    ];

    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: CodexSessionBody(session: session, messages: messages),
        ),
      ),
    );

    expect(find.text('等待移动端确认'), findsOneWidget);
    expect(find.text('等待确认'), findsOneWidget);
    expect(find.text('存在错误'), findsOneWidget);
    expect(find.textContaining('当前等待确认: 命令执行待确认'), findsOneWidget);
    expect(find.textContaining('最近技术事件:'), findsOneWidget);
  });

  testWidgets('message block highlights technical summary labels', (
    tester,
  ) async {
    const message = AiWorkbenchMessage(
      id: 'tool-2',
      providerId: 'codex',
      role: 'system',
      title: 'Tool',
      text: 'error: failed to apply patch because file was modified',
      rawType: 'tool',
    );

    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(body: WorkbenchMessageBlock(message: message)),
      ),
    );

    expect(find.text('技术事件'), findsOneWidget);
    expect(find.text('工具结果'), findsOneWidget);
    expect(find.textContaining('error: failed to apply patch'), findsOneWidget);
  });
}
