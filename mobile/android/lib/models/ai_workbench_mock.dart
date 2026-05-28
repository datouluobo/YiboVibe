import 'ai_workbench.dart';

final aiWorkbenchMockSnapshot = AiWorkbenchSnapshot.fromJson({
  'schemaVersion': 1,
  'generatedAt': '2026-05-28T00:00:00.000Z',
  'providers': [
    {
      'id': 'codex',
      'name': 'Codex',
      'transport': 'app-server',
      'capabilities': [
        'project-list',
        'conversation-list',
        'conversation-read',
        'conversation-create',
        'conversation-rename',
        'conversation-archive',
        'message-send',
        'turn-cancel',
        'model-list',
        'config-read',
        'config-write',
        'event-stream',
      ],
    },
  ],
  'projects': [
    {
      'id': r'codex:F:\Download\GitHub\YiboVibe',
      'providerId': 'codex',
      'name': 'YiboVibe',
      'path': r'F:\Download\GitHub\YiboVibe',
      'conversationIds': ['thread-1', 'thread-2'],
      'branches': ['codex/test-codex-app-server-mvp'],
      'originUrl': 'https://github.com/datouluobo/YiboVibe.git',
      'updatedAt': 1779955200,
    },
  ],
  'conversations': [
    {
      'id': 'thread-1',
      'providerId': 'codex',
      'projectId': r'codex:F:\Download\GitHub\YiboVibe',
      'title': '收到回复 hello',
      'preview': '移动端 UI mock 对话',
      'cwd': r'F:\Download\GitHub\YiboVibe',
      'source': 'vscode',
      'cliVersion': '0.133.0-alpha.1',
      'status': 'idle',
      'gitInfo': {
        'branch': 'codex/test-codex-app-server-mvp',
        'originUrl': 'https://github.com/datouluobo/YiboVibe.git',
      },
      'createdAt': 1779951600,
      'updatedAt': 1779955200,
    },
    {
      'id': 'thread-2',
      'providerId': 'codex',
      'projectId': r'codex:F:\Download\GitHub\YiboVibe',
      'title': '运行中的任务',
      'cwd': r'F:\Download\GitHub\YiboVibe',
      'source': 'vscode',
      'status': 'running',
      'updatedAt': 1779955100,
    },
  ],
  'activeConversationId': 'thread-1',
  'messagesByConversationId': {
    'thread-1': [
      {
        'id': 'thread-1:user:0',
        'providerId': 'codex',
        'conversationId': 'thread-1',
        'role': 'user',
        'title': '用户',
        'text': '回复一句 hello，确认收到',
      },
      {
        'id': 'thread-1:assistant:1',
        'providerId': 'codex',
        'conversationId': 'thread-1',
        'role': 'assistant',
        'title': 'Codex',
        'text': 'hello，确认收到。',
      },
    ],
    'thread-2': [
      {
        'id': 'thread-2:user:0',
        'providerId': 'codex',
        'conversationId': 'thread-2',
        'role': 'user',
        'title': '用户',
        'text': '继续推进移动端基础设施',
      },
    ],
  },
  'modelsByProviderId': {
    'codex': [
      {
        'id': 'gpt-5.5',
        'providerId': 'codex',
        'label': 'GPT-5.5',
        'isDefault': true,
        'defaultReasoningEffort': 'medium',
        'supportedReasoningEfforts': ['minimal', 'low', 'medium', 'high'],
      },
    ],
  },
  'configsByProviderId': {
    'codex': {
      'providerId': 'codex',
      'model': 'gpt-5.5',
      'modelProvider': 'chatgpt',
      'approvalPolicy': 'on-request',
      'sandboxMode': 'workspace-write',
    },
  },
  'errors': [],
});
