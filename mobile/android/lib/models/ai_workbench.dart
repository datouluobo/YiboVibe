class AiWorkbenchSnapshot {
  const AiWorkbenchSnapshot({
    required this.schemaVersion,
    required this.generatedAt,
    required this.providers,
    required this.projects,
    required this.conversations,
    required this.messagesByConversationId,
    required this.modelsByProviderId,
    required this.configsByProviderId,
    this.activeConversationId,
    this.errors = const [],
  });

  final int schemaVersion;
  final DateTime generatedAt;
  final List<AiWorkbenchProvider> providers;
  final List<AiWorkbenchProject> projects;
  final List<AiWorkbenchConversation> conversations;
  final String? activeConversationId;
  final Map<String, List<AiWorkbenchMessage>> messagesByConversationId;
  final Map<String, List<AiWorkbenchModel>> modelsByProviderId;
  final Map<String, AiWorkbenchConfig> configsByProviderId;
  final List<AiWorkbenchError> errors;

  factory AiWorkbenchSnapshot.fromJson(Map<String, dynamic> json) {
    return AiWorkbenchSnapshot(
      schemaVersion: json['schemaVersion'] as int? ?? 1,
      generatedAt: DateTime.tryParse(json['generatedAt'] as String? ?? '') ??
          DateTime.fromMillisecondsSinceEpoch(0),
      providers: _listOf(json['providers'], AiWorkbenchProvider.fromJson),
      projects: _listOf(json['projects'], AiWorkbenchProject.fromJson),
      conversations:
          _listOf(json['conversations'], AiWorkbenchConversation.fromJson),
      activeConversationId: json['activeConversationId'] as String?,
      messagesByConversationId: _mapOfList(
        json['messagesByConversationId'],
        AiWorkbenchMessage.fromJson,
      ),
      modelsByProviderId: _mapOfList(
        json['modelsByProviderId'],
        AiWorkbenchModel.fromJson,
      ),
      configsByProviderId: _mapOf(
        json['configsByProviderId'],
        AiWorkbenchConfig.fromJson,
      ),
      errors: _listOf(json['errors'], AiWorkbenchError.fromJson),
    );
  }
}

class AiWorkbenchProvider {
  const AiWorkbenchProvider({
    required this.id,
    required this.name,
    required this.transport,
    required this.capabilities,
  });

  final String id;
  final String name;
  final String transport;
  final List<String> capabilities;

  factory AiWorkbenchProvider.fromJson(Map<String, dynamic> json) {
    return AiWorkbenchProvider(
      id: json['id'] as String? ?? 'custom',
      name: json['name'] as String? ?? 'Unknown',
      transport: json['transport'] as String? ?? 'custom',
      capabilities: _stringList(json['capabilities']),
    );
  }
}

class AiWorkbenchProject {
  const AiWorkbenchProject({
    required this.id,
    required this.providerId,
    required this.name,
    required this.path,
    required this.conversationIds,
    required this.branches,
    this.originUrl,
    this.updatedAt,
  });

  final String id;
  final String providerId;
  final String name;
  final String path;
  final List<String> conversationIds;
  final List<String> branches;
  final String? originUrl;
  final int? updatedAt;

  factory AiWorkbenchProject.fromJson(Map<String, dynamic> json) {
    return AiWorkbenchProject(
      id: json['id'] as String? ?? '',
      providerId: json['providerId'] as String? ?? 'custom',
      name: json['name'] as String? ?? '',
      path: json['path'] as String? ?? '',
      conversationIds: _stringList(json['conversationIds']),
      branches: _stringList(json['branches']),
      originUrl: json['originUrl'] as String?,
      updatedAt: json['updatedAt'] as int?,
    );
  }
}

class AiWorkbenchConversation {
  const AiWorkbenchConversation({
    required this.id,
    required this.providerId,
    required this.title,
    required this.status,
    this.projectId,
    this.preview,
    this.cwd,
    this.source,
    this.cliVersion,
    this.gitInfo,
    this.createdAt,
    this.updatedAt,
  });

  final String id;
  final String providerId;
  final String? projectId;
  final String title;
  final String status;
  final String? preview;
  final String? cwd;
  final String? source;
  final String? cliVersion;
  final AiWorkbenchGitInfo? gitInfo;
  final int? createdAt;
  final int? updatedAt;

  factory AiWorkbenchConversation.fromJson(Map<String, dynamic> json) {
    return AiWorkbenchConversation(
      id: json['id'] as String? ?? '',
      providerId: json['providerId'] as String? ?? 'custom',
      projectId: json['projectId'] as String?,
      title: json['title'] as String? ?? '',
      status: json['status'] as String? ?? 'notLoaded',
      preview: json['preview'] as String?,
      cwd: json['cwd'] as String?,
      source: json['source'] as String?,
      cliVersion: json['cliVersion'] as String?,
      gitInfo: json['gitInfo'] is Map<String, dynamic>
          ? AiWorkbenchGitInfo.fromJson(json['gitInfo'] as Map<String, dynamic>)
          : null,
      createdAt: json['createdAt'] as int?,
      updatedAt: json['updatedAt'] as int?,
    );
  }
}

class AiWorkbenchMessage {
  const AiWorkbenchMessage({
    required this.id,
    required this.providerId,
    required this.role,
    required this.title,
    required this.text,
    this.conversationId,
    this.status,
    this.createdAt,
    this.rawType,
  });

  final String id;
  final String providerId;
  final String? conversationId;
  final String role;
  final String title;
  final String text;
  final String? status;
  final String? createdAt;
  final String? rawType;

  factory AiWorkbenchMessage.fromJson(Map<String, dynamic> json) {
    return AiWorkbenchMessage(
      id: json['id'] as String? ?? '',
      providerId: json['providerId'] as String? ?? 'custom',
      conversationId: json['conversationId'] as String?,
      role: json['role'] as String? ?? 'system',
      title: json['title'] as String? ?? '',
      text: json['text'] as String? ?? '',
      status: json['status'] as String?,
      createdAt: json['createdAt'] as String?,
      rawType: json['rawType'] as String?,
    );
  }
}

class AiWorkbenchModel {
  const AiWorkbenchModel({
    required this.id,
    required this.providerId,
    required this.label,
    this.description,
    this.hidden,
    this.isDefault,
    this.defaultReasoningEffort,
    this.supportedReasoningEfforts = const [],
  });

  final String id;
  final String providerId;
  final String label;
  final String? description;
  final bool? hidden;
  final bool? isDefault;
  final String? defaultReasoningEffort;
  final List<String> supportedReasoningEfforts;

  factory AiWorkbenchModel.fromJson(Map<String, dynamic> json) {
    return AiWorkbenchModel(
      id: json['id'] as String? ?? '',
      providerId: json['providerId'] as String? ?? 'custom',
      label: json['label'] as String? ?? '',
      description: json['description'] as String?,
      hidden: json['hidden'] as bool?,
      isDefault: json['isDefault'] as bool?,
      defaultReasoningEffort: json['defaultReasoningEffort'] as String?,
      supportedReasoningEfforts:
          _stringList(json['supportedReasoningEfforts']),
    );
  }
}

class AiWorkbenchConfig {
  const AiWorkbenchConfig({
    required this.providerId,
    this.model,
    this.modelProvider,
    this.approvalPolicy,
    this.sandboxMode,
    this.serviceTier,
    this.cwd,
  });

  final String providerId;
  final String? model;
  final String? modelProvider;
  final String? approvalPolicy;
  final String? sandboxMode;
  final String? serviceTier;
  final String? cwd;

  factory AiWorkbenchConfig.fromJson(Map<String, dynamic> json) {
    return AiWorkbenchConfig(
      providerId: json['providerId'] as String? ?? 'custom',
      model: json['model'] as String?,
      modelProvider: json['modelProvider'] as String?,
      approvalPolicy: json['approvalPolicy'] as String?,
      sandboxMode: json['sandboxMode'] as String?,
      serviceTier: json['serviceTier'] as String?,
      cwd: json['cwd'] as String?,
    );
  }
}

class AiWorkbenchGitInfo {
  const AiWorkbenchGitInfo({this.branch, this.originUrl, this.sha});

  final String? branch;
  final String? originUrl;
  final String? sha;

  factory AiWorkbenchGitInfo.fromJson(Map<String, dynamic> json) {
    return AiWorkbenchGitInfo(
      branch: json['branch'] as String?,
      originUrl: json['originUrl'] as String?,
      sha: json['sha'] as String?,
    );
  }
}

class AiWorkbenchError {
  const AiWorkbenchError({
    required this.code,
    required this.message,
    required this.retryable,
  });

  final String code;
  final String message;
  final bool retryable;

  factory AiWorkbenchError.fromJson(Map<String, dynamic> json) {
    return AiWorkbenchError(
      code: json['code'] as String? ?? 'unknown',
      message: json['message'] as String? ?? '',
      retryable: json['retryable'] as bool? ?? false,
    );
  }
}

List<T> _listOf<T>(
  Object? value,
  T Function(Map<String, dynamic>) mapper,
) {
  if (value is! List) return const [];
  return value
      .whereType<Map<String, dynamic>>()
      .map(mapper)
      .toList(growable: false);
}

Map<String, T> _mapOf<T>(
  Object? value,
  T Function(Map<String, dynamic>) mapper,
) {
  if (value is! Map<String, dynamic>) return const {};
  return value.map((key, item) {
    if (item is Map<String, dynamic>) {
      return MapEntry(key, mapper(item));
    }
    return MapEntry(key, mapper(const {}));
  });
}

Map<String, List<T>> _mapOfList<T>(
  Object? value,
  T Function(Map<String, dynamic>) mapper,
) {
  if (value is! Map<String, dynamic>) return const {};
  return value.map((key, item) => MapEntry(key, _listOf(item, mapper)));
}

List<String> _stringList(Object? value) {
  if (value is! List) return const [];
  return value.whereType<String>().toList(growable: false);
}
