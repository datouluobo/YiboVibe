import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:yibovibe_mobile/models/ai_workbench.dart';
import 'package:yibovibe_mobile/pages/workbench_session_panel.dart';

void main() {
  testWidgets('session row renders observation summary details', (
    tester,
  ) async {
    const session = AiWorkbenchConversation(
      id: 'terminal-1',
      providerId: 'terminal',
      title: 'pwsh #1',
      status: 'running',
      preview: '最近执行 cargo check -p tauri-app',
      source: 'pwsh',
      sessionSummary: AiWorkbenchSessionSummary(
        statusLabel: '终端运行中',
        lastOutputAt: 1784160000,
        waitingForInput: true,
        hasError: true,
        unreadCount: 3,
        runningForSeconds: 3720,
      ),
    );

    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: WorkbenchSessionRow(
            session: session,
            selected: false,
            onTap: _noop,
          ),
        ),
      ),
    );

    expect(find.text('pwsh #1'), findsOneWidget);
    expect(find.text('pwsh'), findsOneWidget);
    expect(find.textContaining('最后输出'), findsOneWidget);
    expect(find.textContaining('等待输入'), findsOneWidget);
    expect(find.textContaining('存在错误'), findsOneWidget);
    expect(find.textContaining('未读 3'), findsOneWidget);
    expect(find.textContaining('已运行 1h2m'), findsOneWidget);
  });
}

void _noop() {}
