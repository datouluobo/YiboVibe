import 'package:flutter_test/flutter_test.dart';
import 'package:yibovibe_mobile/models/ai_workbench_mock.dart';

void main() {
  test('AI workbench mock snapshot parses mobile contract', () {
    final snapshot = aiWorkbenchMockSnapshot;

    expect(snapshot.schemaVersion, 1);
    expect(snapshot.providers.single.id, 'codex');
    expect(snapshot.projects.single.name, 'YiboVibe');
    expect(snapshot.conversations, hasLength(2));
    expect(snapshot.activeConversationId, 'thread-1');
    expect(snapshot.messagesByConversationId['thread-1'], hasLength(2));
    expect(snapshot.configsByProviderId['codex']?.model, 'gpt-5.5');
  });
}
