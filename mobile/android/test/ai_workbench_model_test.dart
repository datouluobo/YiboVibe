import 'package:flutter_test/flutter_test.dart';
import 'package:yibovibe_mobile/models/ai_workbench.dart';
import 'package:yibovibe_mobile/models/ai_workbench_mock.dart';

void main() {
  test('AI workbench mock snapshot parses mobile contract', () {
    final snapshot = aiWorkbenchMockSnapshot;

    expect(snapshot.schemaVersion, 1);
    expect(
      snapshot.providers.map((item) => item.id),
      containsAll(['terminal', 'codex']),
    );
    expect(
      snapshot.projects.map((item) => item.name),
      containsAll(['YiboVibe', 'Ooitech', 'YiboClock']),
    );
    expect(snapshot.conversations, hasLength(9));
    expect(snapshot.activeConversationId, 'thread-1');
    expect(snapshot.messagesByConversationId['thread-1'], hasLength(10));
    expect(snapshot.messagesByConversationId['terminal-1'], hasLength(3));
    expect(snapshot.messagesByConversationId['thread-5'], hasLength(1));
    expect(snapshot.configsByProviderId['codex']?.model, 'gpt-5.5');
  });

  test('AI workbench snapshot tolerates non-string conversation source', () {
    final snapshot = AiWorkbenchSnapshot.fromJson({
      'schemaVersion': 1,
      'generatedAt': '2026-05-31T00:00:00.000Z',
      'providers': [
        {
          'id': 'codex',
          'name': 'Codex',
          'transport': 'app-server',
          'capabilities': ['conversation-list'],
        },
      ],
      'projects': [
        {
          'id': r'codex:F:\Download\GitHub\YiboVibe',
          'providerId': 'codex',
          'name': 'YiboVibe',
          'path': r'F:\Download\GitHub\YiboVibe',
          'conversationIds': ['thread-guardian'],
          'branches': const <String>[],
        },
      ],
      'conversations': [
        {
          'id': 'thread-guardian',
          'providerId': 'codex',
          'projectId': r'codex:F:\Download\GitHub\YiboVibe',
          'title': 'Guardian thread',
          'status': 'notLoaded',
          'source': {
            'subAgent': {'other': 'guardian'},
          },
        },
      ],
      'messagesByConversationId': const <String, Object>{},
      'modelsByProviderId': const <String, Object>{'codex': <Object>[]},
      'configsByProviderId': const <String, Object>{},
      'errors': const <Object>[],
    });

    expect(snapshot.conversations, hasLength(1));
    expect(snapshot.conversations.single.source, contains('guardian'));
  });

  test('AI workbench message preserves mobile preview metadata', () {
    final snapshot = AiWorkbenchSnapshot.fromJson({
      'schemaVersion': 1,
      'generatedAt': '2026-06-02T00:00:00.000Z',
      'providers': [
        {
          'id': 'codex',
          'name': 'Codex',
          'transport': 'app-server',
          'capabilities': ['conversation-read'],
        },
      ],
      'projects': const <Object>[],
      'conversations': const <Object>[],
      'messagesByConversationId': {
        'thread-1': [
          {
            'id': 'thread-1:agentMessage:0',
            'providerId': 'codex',
            'role': 'assistant',
            'title': 'Codex',
            'text': 'full body',
            'previewText': 'compact body',
            'isTruncated': true,
            'fullTextCharCount': 20001,
          },
        ],
      },
      'modelsByProviderId': const <String, Object>{'codex': <Object>[]},
      'configsByProviderId': const <String, Object>{},
      'errors': const <Object>[],
    });

    final message = snapshot.messagesByConversationId['thread-1']!.single;
    expect(message.previewText, 'compact body');
    expect(message.isTruncated, isTrue);
    expect(message.fullTextCharCount, 20001);
  });

  test(
    'AI workbench conversation preserves session summary and cancel metadata',
    () {
      final snapshot = AiWorkbenchSnapshot.fromJson({
        'schemaVersion': 1,
        'generatedAt': '2026-07-16T00:00:00.000Z',
        'providers': [
          {
            'id': 'codex',
            'name': 'Codex',
            'transport': 'app-server',
            'capabilities': ['conversation-read', 'turn-cancel'],
          },
        ],
        'projects': const <Object>[],
        'conversations': [
          {
            'id': 'thread-1',
            'providerId': 'codex',
            'title': 'Remote handoff',
            'status': 'waitingApproval',
            'activeTurnId': 'turn-42',
            'sessionSummary': {
              'statusLabel': '等待移动端确认',
              'lastOutputAt': 1784160000,
              'waitingForInput': true,
              'hasError': false,
              'unreadCount': 2,
              'runningForSeconds': 91,
            },
            'pendingApproval': {
              'requestId': 'req-1',
              'approvalId': 'approval-1',
              'kind': 'exec-approval',
              'title': '命令执行待确认',
              'summary': 'cargo check -p tauri-app',
              'canTerminate': true,
              'requiresDestructiveConfirm': true,
            },
          },
        ],
        'messagesByConversationId': const <String, Object>{},
        'modelsByProviderId': const <String, Object>{'codex': <Object>[]},
        'configsByProviderId': const <String, Object>{},
        'errors': const <Object>[],
      });

      final conversation = snapshot.conversations.single;
      expect(conversation.activeTurnId, 'turn-42');
      expect(conversation.sessionSummary?.statusLabel, '等待移动端确认');
      expect(conversation.sessionSummary?.waitingForInput, isTrue);
      expect(conversation.sessionSummary?.unreadCount, 2);
      expect(conversation.pendingApproval?.canTerminate, isTrue);
      expect(conversation.pendingApproval?.requiresDestructiveConfirm, isTrue);
    },
  );
}
