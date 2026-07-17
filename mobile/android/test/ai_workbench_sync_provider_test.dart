import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:yibovibe_mobile/models/event_message.dart';
import 'package:yibovibe_mobile/providers/ai_workbench_sync_provider.dart';
import 'package:yibovibe_mobile/providers/auth_provider.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('AiWorkbenchSyncProvider', () {
    test('restores cached codex snapshot before live sync', () async {
      SharedPreferences.setMockInitialValues({
        'ai_workbench_cached_codex_snapshot_v1': jsonEncode({
          'schemaVersion': 1,
          'generatedAt': '2026-07-16T09:00:00Z',
          'providers': [
            {
              'id': 'codex',
              'name': 'Codex',
              'transport': 'desktop',
              'capabilities': ['turnStart'],
            },
          ],
          'projects': [
            {
              'id': 'proj-1',
              'providerId': 'codex',
              'name': 'YiboVibe',
              'path': 'F:/Download/GitHub/YiboVibe',
              'conversationIds': ['conv-1'],
              'branches': ['main'],
              'updatedAt': 1721120400,
            },
          ],
          'conversations': [
            {
              'id': 'conv-1',
              'providerId': 'codex',
              'projectId': 'proj-1',
              'title': 'Cached thread',
              'status': 'running',
              'preview': 'Working...',
              'source': 'codex',
              'sessionSummary': {
                'statusLabel': '运行中',
                'lastOutputAt': 1721110800,
                'waitingForInput': false,
                'hasError': false,
                'unreadCount': 2,
                'runningForSeconds': 95,
              },
              'pendingApproval': {
                'requestId': 'req-1',
                'approvalId': 'approval-1',
                'kind': 'exec',
                'title': 'Need confirm',
                'summary': 'Run command',
                'canTerminate': true,
                'requiresDestructiveConfirm': true,
              },
              'activeTurnId': 'turn-1',
              'createdAt': 1721120280,
              'updatedAt': 1721120400,
            },
          ],
          'activeConversationId': 'conv-1',
          'messagesByConversationId': {
            'conv-1': [
              {
                'id': 'msg-1',
                'providerId': 'codex',
                'conversationId': 'conv-1',
                'role': 'assistant',
                'title': 'Codex',
                'text': 'Cached output',
                'status': 'completed',
                'createdAt': '2026-07-16T09:00:00Z',
                'rawType': 'assistant_message',
              },
            ],
          },
          'modelsByProviderId': const {
            'codex': [
              {
                'id': 'gpt-5',
                'providerId': 'codex',
                'label': 'GPT-5',
                'isDefault': true,
                'supportedReasoningEfforts': ['medium'],
              },
            ],
          },
          'configsByProviderId': const {
            'codex': {
              'providerId': 'codex',
              'model': 'gpt-5',
              'approvalPolicy': 'on-request',
              'sandboxMode': 'workspace-write',
              'serviceTier': 'standard',
              'cwd': 'F:/Download/GitHub/YiboVibe',
            },
          },
          'errors': const [],
        }),
      });

      final provider = AiWorkbenchSyncProvider(AuthProvider());
      await provider.debugRestoreCachedSnapshot();

      expect(provider.snapshot, isNotNull);
      expect(provider.snapshot!.activeConversationId, 'conv-1');
      expect(provider.snapshot!.conversations.single.activeTurnId, 'turn-1');
      expect(
        provider.snapshot!.conversations.single.pendingApproval?.canTerminate,
        isTrue,
      );
      expect(
        provider.lastStatus,
        contains('restored 1 cached codex conversations'),
      );

      provider.dispose();
    });

    test(
      'applies host vitals and alert events to remote observation state',
      () {
        SharedPreferences.setMockInitialValues({});
        final provider = AiWorkbenchSyncProvider(AuthProvider());

        provider.debugHandleEvent(
          EventMessage(
            type: EventType.systemNotice,
            sessionId: 'desktop-host',
            text: jsonEncode({
              'status': 'degraded',
              'lastHeartbeatAt': 1721111100,
              'lastOutputAt': 1721111090,
              'heartbeatTimedOut': true,
              'runningForSeconds': 480,
              'cpuPercent': 63.5,
              'memoryBytes': 2147483648,
              'sessionId': 'conv-1',
            }),
            ts: DateTime.parse('2026-07-16T09:05:00Z'),
            wireType: 'host:vitals',
          ),
        );

        provider.debugHandleEvent(
          EventMessage(
            type: EventType.systemNotice,
            sessionId: 'desktop-host',
            text: jsonEncode({
              'id': 'alert-1',
              'severity': 'error',
              'source': 'codex',
              'message': 'Session stalled',
              'recommendedAction': 'Retry connection',
              'sessionId': 'conv-1',
              'createdAt': 1721111110,
            }),
            ts: DateTime.parse('2026-07-16T09:05:10Z'),
            wireType: 'host:alert',
          ),
        );

        expect(provider.hostVitals, isNotNull);
        expect(provider.hostVitals!.status, 'degraded');
        expect(provider.hostVitals!.heartbeatTimedOut, isTrue);
        expect(provider.hostVitals!.runningForSeconds, 480);
        expect(provider.hostAlerts, hasLength(1));
        expect(provider.hostAlerts.single.message, 'Session stalled');
        expect(
          provider.hostAlerts.single.recommendedAction,
          'Retry connection',
        );
        expect(provider.lastStatus, 'desktop alert: Session stalled');

        provider.dispose();
      },
    );
  });
}
