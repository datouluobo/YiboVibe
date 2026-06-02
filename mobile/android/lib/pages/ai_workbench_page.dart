import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../app_version.dart';
import '../models/ai_workbench.dart';
import '../models/event_message.dart';
import '../providers/ai_workbench_sync_provider.dart';
import '../providers/auth_provider.dart';
import '../providers/session_provider.dart';
import '../theme/app_theme.dart';

enum _WorkbenchTab { sessions, tools, mine }

const List<String> _serviceTierOptions = <String>['default', 'priority'];
const List<String> _fallbackReasoningEfforts = <String>[
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
];

class AiWorkbenchPage extends StatefulWidget {
  const AiWorkbenchPage({super.key, this.snapshot});

  final AiWorkbenchSnapshot? snapshot;

  @override
  State<AiWorkbenchPage> createState() => _AiWorkbenchPageState();
}

class _AiWorkbenchPageState extends State<AiWorkbenchPage> {
  _WorkbenchTab _tab = _WorkbenchTab.sessions;
  String _selectedToolId = '';
  String _selectedProjectId = '';
  String _selectedSessionId = '';
  final Map<String, String> _selectedModelByProviderId = <String, String>{};
  final Map<String, String> _selectedServiceTierByProviderId =
      <String, String>{};
  final Map<String, String> _selectedEffortByProviderId = <String, String>{};
  AiWorkbenchSnapshot? _liveSnapshot;
  AiWorkbenchSnapshot? _composedSnapshot;
  String? _lastSnapshotKey;
  String? _lastSessionInitAuthKey;
  bool _sessionInitScheduled = false;
  AiWorkbenchSnapshot? get _resolvedSnapshot =>
      widget.snapshot ?? _liveSnapshot;

  @override
  void initState() {
    super.initState();
    final snapshot = _resolvedSnapshot;
    if (snapshot != null) {
      _applySnapshotSelection(snapshot);
    }
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _scheduleSessionProviderInit();
    if (widget.snapshot != null) {
      return;
    }

    final liveSnapshot = context.watch<AiWorkbenchSyncProvider>().snapshot;
    final nextSnapshotKey = liveSnapshot?.generatedAt.toIso8601String();
    if (liveSnapshot == null || nextSnapshotKey == _lastSnapshotKey) {
      return;
    }

    _liveSnapshot = liveSnapshot;
    _lastSnapshotKey = nextSnapshotKey;
    _applySnapshotSelection(liveSnapshot);
  }

  void _scheduleSessionProviderInit() {
    final auth = context.read<AuthProvider>();
    final sessionProvider = context.read<SessionProvider>();
    final serverUrl = auth.serverUrl?.trim() ?? '';
    final token = auth.token?.trim() ?? '';
    if (serverUrl.isEmpty || token.isEmpty) {
      _lastSessionInitAuthKey = null;
      return;
    }
    final authKey = '$serverUrl|$token';
    if (_lastSessionInitAuthKey == authKey || _sessionInitScheduled) {
      return;
    }
    _lastSessionInitAuthKey = authKey;
    _sessionInitScheduled = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      _sessionInitScheduled = false;
      sessionProvider.initWithAuth();
    });
  }

  @override
  Widget build(BuildContext context) {
    final syncProvider = context.watch<AiWorkbenchSyncProvider>();
    final sessionProvider = context.watch<SessionProvider>();
    final snapshot = _mergeSnapshots(
      codexSnapshot: _resolvedSnapshot,
      sessionProvider: sessionProvider,
    );
    if (snapshot == null) {
      return _WorkbenchSyncPlaceholder(
        isConnected: syncProvider.isConnected || sessionProvider.isConnected,
        error: syncProvider.error,
        lastStatus: syncProvider.lastStatus,
        lastStatusAt: syncProvider.lastStatusAt,
        statusTrail: syncProvider.statusTrail,
      );
    }
    _composedSnapshot = snapshot;
    if (_selectionNeedsRefresh(snapshot)) {
      _applySnapshotSelection(snapshot);
    }

    debugPrint('AiWorkbenchPage build');
    final selectedTool = _toolById(_selectedToolId);
    final selectedProject = _projectById(_selectedProjectId);
    final selectedSession = _sessionById(_selectedSessionId);
    final effectiveModel = _resolvedModelForTool(
      _selectedToolId,
      snapshot.configsByProviderId[_selectedToolId],
    );
    final effectiveServiceTier = _resolvedServiceTierForTool(
      _selectedToolId,
      snapshot.configsByProviderId[_selectedToolId],
    );
    final effectiveEffort = _resolvedEffortForTool(
      _selectedToolId,
      effectiveModel,
    );

    return Scaffold(
      backgroundColor: AppTheme.bgPrimary,
      appBar: AppBar(
        title: Row(
          children: [
            const Expanded(child: Text('移动工作台')),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
              decoration: BoxDecoration(
                color: AppTheme.bgTertiary,
                borderRadius: BorderRadius.circular(999),
                border: Border.all(color: AppTheme.borderColor),
              ),
              child: const Text(
                mobileAppVersion,
                style: TextStyle(
                  color: AppTheme.textSecondary,
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ],
        ),
        actions: [
          IconButton(
            tooltip: '刷新',
            onPressed: () async {
              context.read<AiWorkbenchSyncProvider>().refreshSnapshot();
              await context.read<SessionProvider>().refreshNow();
            },
            icon: const Icon(Icons.refresh, size: 19),
          ),
          IconButton(
            tooltip: '更多',
            onPressed: () {},
            icon: const Icon(Icons.more_horiz, size: 20),
          ),
        ],
      ),
      body: IndexedStack(
        index: _tab.index,
        children: [
          _SessionLayer(
            snapshot: snapshot,
            tool: selectedTool,
            project: selectedProject,
            session: selectedSession,
            sessions: _sessionsForTool(_selectedToolId),
            selectedModel: _selectedModelByProviderId[_selectedToolId],
            effectiveModel: effectiveModel,
            selectedServiceTier:
                _selectedServiceTierByProviderId[_selectedToolId],
            effectiveServiceTier: effectiveServiceTier,
            selectedEffort: _selectedEffortByProviderId[_selectedToolId],
            effectiveEffort: effectiveEffort,
            onSwitchProjectBranch: (branch) async {
              if (selectedProject?.path == null ||
                  selectedProject!.path.isEmpty) {
                return;
              }
              await context
                  .read<AiWorkbenchSyncProvider>()
                  .switchCodexProjectBranch(
                    cwd: selectedProject.path,
                    branch: branch,
                  );
            },
            onSelectProject: _selectProject,
            onSelectSession: _selectSession,
            onSelectedModelChanged: (model) =>
                _setModelForTool(_selectedToolId, model),
            onSelectedServiceTierChanged: (tier) =>
                _setServiceTierForTool(_selectedToolId, tier),
            onSelectedEffortChanged: (effort) =>
                _setEffortForTool(_selectedToolId, effort),
          ),
          _ToolLayer(
            snapshot: snapshot,
            selectedToolId: _selectedToolId,
            onSelectTool: _selectTool,
          ),
          const _MineLayer(),
        ],
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tab.index,
        height: 64,
        onDestinationSelected: (index) {
          setState(() => _tab = _WorkbenchTab.values[index]);
        },
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.forum_outlined),
            selectedIcon: Icon(Icons.forum),
            label: '会话',
          ),
          NavigationDestination(
            icon: Icon(Icons.dashboard_customize_outlined),
            selectedIcon: Icon(Icons.dashboard_customize),
            label: '工具',
          ),
          NavigationDestination(
            icon: Icon(Icons.person_outline),
            selectedIcon: Icon(Icons.person),
            label: '我的',
          ),
        ],
      ),
    );
  }

  AiWorkbenchSnapshot get _snapshot => _composedSnapshot ?? _resolvedSnapshot!;

  AiWorkbenchProvider? _toolById(String id) {
    return _snapshot.providers.where((item) => item.id == id).firstOrNull;
  }

  AiWorkbenchProject? _projectById(String id) {
    return _snapshot.projects.where((item) => item.id == id).firstOrNull;
  }

  AiWorkbenchConversation? _sessionById(String id) {
    return _snapshot.conversations.where((item) => item.id == id).firstOrNull;
  }

  List<AiWorkbenchModel> _modelsForTool(String toolId) {
    return _snapshot.modelsByProviderId[toolId] ?? const [];
  }

  String? _resolvedModelForTool(String toolId, AiWorkbenchConfig? config) {
    final override = _selectedModelByProviderId[toolId]?.trim();
    if (override != null && override.isNotEmpty) {
      return override;
    }
    final configured = config?.model?.trim();
    if (configured != null && configured.isNotEmpty) {
      return configured;
    }
    final models = _modelsForTool(toolId);
    return models.where((item) => item.isDefault == true).firstOrNull?.id ??
        models.firstOrNull?.id;
  }

  void _setModelForTool(String toolId, String model) {
    final normalized = model.trim();
    final nextModel = _modelsForTool(toolId).firstWhere(
      (item) => item.id == normalized,
      orElse: () =>
          _modelsForTool(toolId).firstOrNull ??
          const AiWorkbenchModel(id: '', providerId: 'codex', label: ''),
    );
    setState(() {
      if (normalized.isEmpty) {
        _selectedModelByProviderId.remove(toolId);
      } else {
        _selectedModelByProviderId[toolId] = normalized;
      }
      final defaultEffort = nextModel.defaultReasoningEffort?.trim();
      if (defaultEffort != null && defaultEffort.isNotEmpty) {
        _selectedEffortByProviderId[toolId] = defaultEffort;
      }
    });
  }

  String _resolvedServiceTierForTool(String toolId, AiWorkbenchConfig? config) {
    final override = _selectedServiceTierByProviderId[toolId]?.trim();
    if (override != null && override.isNotEmpty) {
      return override;
    }
    final configured = config?.serviceTier?.trim();
    if (configured != null && configured.isNotEmpty) {
      return configured;
    }
    return 'default';
  }

  void _setServiceTierForTool(String toolId, String tier) {
    final normalized = tier.trim();
    setState(() {
      if (normalized.isEmpty) {
        _selectedServiceTierByProviderId.remove(toolId);
      } else {
        _selectedServiceTierByProviderId[toolId] = normalized;
      }
    });
  }

  String _resolvedEffortForTool(String toolId, String? modelId) {
    final override = _selectedEffortByProviderId[toolId]?.trim();
    if (override != null && override.isNotEmpty) {
      return override;
    }
    final model = _modelsForTool(toolId).firstWhere(
      (item) => item.id == modelId,
      orElse: () =>
          _modelsForTool(toolId).firstOrNull ??
          const AiWorkbenchModel(id: '', providerId: 'codex', label: ''),
    );
    return model.defaultReasoningEffort?.trim().isNotEmpty == true
        ? model.defaultReasoningEffort!.trim()
        : 'medium';
  }

  void _setEffortForTool(String toolId, String effort) {
    final normalized = effort.trim();
    setState(() {
      if (normalized.isEmpty) {
        _selectedEffortByProviderId.remove(toolId);
      } else {
        _selectedEffortByProviderId[toolId] = normalized;
      }
    });
  }

  bool _selectionNeedsRefresh(AiWorkbenchSnapshot snapshot) {
    if (_selectedToolId.isEmpty) {
      return true;
    }

    final selectedTool = snapshot.providers
        .where((item) => item.id == _selectedToolId)
        .firstOrNull;
    if (selectedTool == null) {
      return true;
    }

    final selectedProject = _selectedProjectId.isEmpty
        ? null
        : snapshot.projects
              .where((item) => item.id == _selectedProjectId)
              .firstOrNull;
    if (selectedProject != null &&
        selectedProject.providerId != _selectedToolId) {
      return true;
    }

    final selectedSession = _selectedSessionId.isEmpty
        ? null
        : snapshot.conversations
              .where((item) => item.id == _selectedSessionId)
              .firstOrNull;
    if (selectedSession == null) {
      return _selectedSessionId.isNotEmpty;
    }
    if (selectedSession.providerId != _selectedToolId) {
      return true;
    }
    if (_selectedProjectId.isNotEmpty &&
        selectedSession.projectId != _selectedProjectId) {
      return true;
    }

    return false;
  }

  void _applySnapshotSelection(AiWorkbenchSnapshot snapshot) {
    final activeSession = snapshot.conversations
        .where((item) => item.id == snapshot.activeConversationId)
        .firstOrNull;

    final codexToolId = snapshot.providers
        .where((item) => item.id == 'codex')
        .firstOrNull
        ?.id;
    final selectedToolId =
        snapshot.providers
            .where((item) => item.id == _selectedToolId)
            .firstOrNull
            ?.id ??
        codexToolId ??
        activeSession?.providerId ??
        snapshot.providers.firstOrNull?.id ??
        '';
    final toolProjects = snapshot.projects
        .where((project) => project.providerId == selectedToolId)
        .toList(growable: false);
    final toolSessions = snapshot.conversations
        .where((session) => session.providerId == selectedToolId)
        .toList(growable: false);
    final activeProjectId = activeSession?.providerId == selectedToolId
        ? activeSession?.projectId
        : null;
    final selectedProjectId =
        toolProjects
            .where((item) => item.id == _selectedProjectId)
            .firstOrNull
            ?.id ??
        activeProjectId ??
        toolProjects.firstOrNull?.id ??
        '';
    final projectSessions = selectedProjectId.isEmpty
        ? toolSessions
        : toolSessions
              .where((session) => session.projectId == selectedProjectId)
              .toList(growable: false);
    final activeSessionForSelection =
        activeSession != null &&
            activeSession.providerId == selectedToolId &&
            (selectedProjectId.isEmpty ||
                activeSession.projectId == selectedProjectId)
        ? activeSession
        : null;
    final selectedSessionId =
        projectSessions
            .where((item) => item.id == _selectedSessionId)
            .firstOrNull
            ?.id ??
        activeSessionForSelection?.id ??
        projectSessions.firstOrNull?.id ??
        '';

    _selectedToolId = selectedToolId;
    _selectedProjectId = selectedProjectId;
    _selectedSessionId = selectedSessionId;
  }

  List<AiWorkbenchConversation> _sessionsForTool(String toolId) {
    return _snapshot.conversations
        .where((session) => session.providerId == toolId)
        .toList(growable: false);
  }

  void _selectTool(String toolId) {
    final projects = _snapshot.projects
        .where((project) => project.providerId == toolId)
        .toList(growable: false);
    final activeInTool = _snapshot.conversations
        .where(
          (session) =>
              session.providerId == toolId &&
              session.id == _snapshot.activeConversationId,
        )
        .firstOrNull;
    final nextProjectId = projects.firstOrNull?.id ?? '';
    final nextSessionId =
        activeInTool?.id ??
        _snapshot.conversations
            .where((session) => session.projectId == nextProjectId)
            .firstOrNull
            ?.id ??
        '';
    setState(() {
      _selectedToolId = toolId;
      _selectedProjectId = activeInTool?.projectId ?? nextProjectId;
      _selectedSessionId = nextSessionId;
      _tab = _WorkbenchTab.sessions;
    });
  }

  void _selectProject(String projectId) {
    final nextSessionId =
        _snapshot.conversations
            .where((session) => session.projectId == projectId)
            .firstOrNull
            ?.id ??
        '';
    setState(() {
      _selectedProjectId = projectId;
      _selectedSessionId = nextSessionId;
    });
  }

  void _selectSession(String sessionId) {
    final nextSession = _sessionById(sessionId);
    setState(() {
      _selectedSessionId = sessionId;
      if (nextSession?.projectId != null) {
        _selectedProjectId = nextSession!.projectId!;
      }
    });
  }
}

AiWorkbenchSnapshot? _mergeSnapshots({
  required AiWorkbenchSnapshot? codexSnapshot,
  required SessionProvider sessionProvider,
}) {
  final terminalSnapshot = _buildTerminalSnapshot(sessionProvider);
  final terminalPlaceholder = _buildTerminalPlaceholderSnapshot();
  final codexPlaceholder = _buildCodexPlaceholderSnapshot();
  if (codexSnapshot == null) {
    if (terminalSnapshot == null) {
      return null;
    }
    return AiWorkbenchSnapshot(
      schemaVersion: terminalSnapshot.schemaVersion,
      generatedAt: terminalSnapshot.generatedAt,
      providers: [...terminalSnapshot.providers, ...codexPlaceholder.providers],
      projects: terminalSnapshot.projects,
      conversations: terminalSnapshot.conversations,
      messagesByConversationId: terminalSnapshot.messagesByConversationId,
      modelsByProviderId: {
        ...terminalSnapshot.modelsByProviderId,
        ...codexPlaceholder.modelsByProviderId,
      },
      configsByProviderId: terminalSnapshot.configsByProviderId,
      activeConversationId: terminalSnapshot.activeConversationId,
      errors: terminalSnapshot.errors,
    );
  }
  final codexProviders =
      codexSnapshot.providers.any((item) => item.id == 'codex')
      ? codexSnapshot.providers
      : [...codexSnapshot.providers, ...codexPlaceholder.providers];
  final codexModels = codexSnapshot.modelsByProviderId.containsKey('codex')
      ? codexSnapshot.modelsByProviderId
      : {
          ...codexSnapshot.modelsByProviderId,
          ...codexPlaceholder.modelsByProviderId,
        };
  final terminalProviders =
      terminalSnapshot?.providers ?? terminalPlaceholder.providers;
  final terminalProjects =
      terminalSnapshot?.projects ?? const <AiWorkbenchProject>[];
  final terminalConversations =
      terminalSnapshot?.conversations ?? const <AiWorkbenchConversation>[];
  final terminalMessages =
      terminalSnapshot?.messagesByConversationId ??
      const <String, List<AiWorkbenchMessage>>{};
  final terminalModels =
      terminalSnapshot?.modelsByProviderId ??
      terminalPlaceholder.modelsByProviderId;
  final terminalConfigs =
      terminalSnapshot?.configsByProviderId ??
      terminalPlaceholder.configsByProviderId;
  final terminalErrors = terminalSnapshot?.errors ?? const <AiWorkbenchError>[];
  final terminalGeneratedAt = terminalSnapshot?.generatedAt;

  return AiWorkbenchSnapshot(
    schemaVersion: codexSnapshot.schemaVersion,
    generatedAt:
        terminalGeneratedAt == null ||
            codexSnapshot.generatedAt.isAfter(terminalGeneratedAt)
        ? codexSnapshot.generatedAt
        : terminalGeneratedAt,
    providers: [...terminalProviders, ...codexProviders],
    projects: [...terminalProjects, ...codexSnapshot.projects],
    conversations: [...terminalConversations, ...codexSnapshot.conversations],
    messagesByConversationId: {
      ...terminalMessages,
      ...codexSnapshot.messagesByConversationId,
    },
    modelsByProviderId: {...terminalModels, ...codexModels},
    configsByProviderId: {
      ...terminalConfigs,
      ...codexSnapshot.configsByProviderId,
    },
    activeConversationId:
        terminalSnapshot?.activeConversationId ??
        codexSnapshot.activeConversationId,
    errors: [...terminalErrors, ...codexSnapshot.errors],
  );
}

AiWorkbenchSnapshot _buildCodexPlaceholderSnapshot() {
  return AiWorkbenchSnapshot(
    schemaVersion: 1,
    generatedAt: DateTime.now(),
    providers: const [
      AiWorkbenchProvider(
        id: 'codex',
        name: 'Codex',
        transport: 'app-server',
        capabilities: [
          'project-list',
          'conversation-list',
          'conversation-read',
          'message-send',
          'event-stream',
        ],
      ),
    ],
    projects: const [],
    conversations: const [],
    messagesByConversationId: const {},
    modelsByProviderId: const {'codex': []},
    configsByProviderId: const {},
    errors: const [],
  );
}

AiWorkbenchSnapshot _buildTerminalPlaceholderSnapshot() {
  return AiWorkbenchSnapshot(
    schemaVersion: 1,
    generatedAt: DateTime.now(),
    providers: const [
      AiWorkbenchProvider(
        id: 'terminal',
        name: '终端',
        transport: 'signal',
        capabilities: [
          'project-list',
          'conversation-list',
          'conversation-read',
          'conversation-create',
          'message-send',
          'session-control',
          'event-stream',
        ],
      ),
    ],
    projects: const [],
    conversations: const [],
    messagesByConversationId: const {},
    modelsByProviderId: const {'terminal': []},
    configsByProviderId: const {},
    errors: const [],
  );
}

AiWorkbenchSnapshot? _buildTerminalSnapshot(SessionProvider sessionProvider) {
  final sessions = sessionProvider.sessions;
  if (sessions.isEmpty) {
    return null;
  }

  final provider = AiWorkbenchProvider(
    id: 'terminal',
    name: '终端',
    transport: 'signal',
    capabilities: const [
      'project-list',
      'conversation-list',
      'conversation-read',
      'conversation-create',
      'message-send',
      'session-control',
      'event-stream',
    ],
  );

  final projects = <AiWorkbenchProject>[];
  final conversations = <AiWorkbenchConversation>[];
  final messagesByConversationId = <String, List<AiWorkbenchMessage>>{};
  final projectIdByCwd = <String, String>{};
  final projectConversationIds = <String, List<String>>{};

  for (final session in sessions) {
    final cwd = session.cwd.trim();
    final projectId = cwd.isNotEmpty ? _terminalProjectId(cwd) : null;

    if (projectId != null && !projectIdByCwd.containsKey(cwd)) {
      projectIdByCwd[cwd] = projectId;
      projectConversationIds[projectId] = [];
      projects.add(
        AiWorkbenchProject(
          id: projectId,
          providerId: provider.id,
          name: _terminalProjectName(cwd),
          path: cwd,
          conversationIds: const [],
          branches: const [],
          updatedAt: _toEpochSeconds(session.lastActiveAt ?? session.startedAt),
        ),
      );
    }

    if (projectId != null) {
      projectConversationIds
          .putIfAbsent(projectId, () => [])
          .add(session.sessionId);
    }

    conversations.add(
      AiWorkbenchConversation(
        id: session.sessionId,
        providerId: provider.id,
        projectId: projectId,
        title: sessionProvider.sessionDisplayTitle(session),
        status: session.status,
        preview: _terminalPreview(
          sessionProvider.eventsForSession(session.sessionId),
        ),
        cwd: cwd.isEmpty ? null : cwd,
        source: session.shellKind,
        createdAt: _toEpochSeconds(session.startedAt),
        updatedAt: _toEpochSeconds(session.lastActiveAt ?? session.startedAt),
      ),
    );

    messagesByConversationId[session.sessionId] = _terminalMessagesForSession(
      sessionProvider.eventsForSession(session.sessionId),
      sessionId: session.sessionId,
      shellKind: session.shellKind,
    );
  }

  final normalizedProjects = projects
      .map(
        (project) => AiWorkbenchProject(
          id: project.id,
          providerId: project.providerId,
          name: project.name,
          path: project.path,
          conversationIds: projectConversationIds[project.id] ?? const [],
          branches: project.branches,
          originUrl: project.originUrl,
          updatedAt: project.updatedAt,
        ),
      )
      .toList(growable: false);

  return AiWorkbenchSnapshot(
    schemaVersion: 1,
    generatedAt: DateTime.now(),
    providers: [provider],
    projects: normalizedProjects,
    conversations: conversations,
    activeConversationId: sessionProvider.activeSession?.sessionId,
    messagesByConversationId: messagesByConversationId,
    modelsByProviderId: const {'terminal': []},
    configsByProviderId: const {},
    errors: const [],
  );
}

String _terminalProjectId(String cwd) {
  final lowered = cwd.toLowerCase();
  return 'terminal::$lowered';
}

String _terminalProjectName(String cwd) {
  final normalized = cwd.replaceAll('\\', '/');
  final parts = normalized.split('/').where((part) => part.isNotEmpty).toList();
  return parts.isNotEmpty ? parts.last : cwd;
}

int? _toEpochSeconds(DateTime? value) =>
    value == null ? null : value.millisecondsSinceEpoch ~/ 1000;

String? _terminalPreview(List<EventMessage> events) {
  for (final event in events.reversed) {
    final text = event.text.trim();
    if (text.isNotEmpty) {
      return text.replaceAll('\n', ' ');
    }
  }
  return null;
}

List<AiWorkbenchMessage> _terminalMessagesForSession(
  List<EventMessage> events, {
  required String sessionId,
  required String shellKind,
}) {
  if (events.isEmpty) {
    return [
      AiWorkbenchMessage(
        id: '$sessionId-empty',
        providerId: 'terminal',
        conversationId: sessionId,
        role: 'system',
        title: shellKind,
        text: '等待输出...',
      ),
    ];
  }

  return events
      .where((event) => event.text.trim().isNotEmpty)
      .map(
        (event) => AiWorkbenchMessage(
          id: '$sessionId-${event.ts.microsecondsSinceEpoch}',
          providerId: 'terminal',
          conversationId: sessionId,
          role: event.type == EventType.userInput ? 'user' : 'assistant',
          title: event.type == EventType.userInput ? '输入' : shellKind,
          text: event.text,
          status: event.state,
          createdAt: event.ts.toIso8601String(),
          rawType: event.wireType,
        ),
      )
      .toList(growable: false);
}

class _WorkbenchSyncPlaceholder extends StatelessWidget {
  const _WorkbenchSyncPlaceholder({
    required this.isConnected,
    this.error,
    this.lastStatus,
    this.lastStatusAt,
    this.statusTrail = const [],
  });

  final bool isConnected;
  final String? error;
  final String? lastStatus;
  final DateTime? lastStatusAt;
  final List<String> statusTrail;

  @override
  Widget build(BuildContext context) {
    final message = switch ((isConnected, error?.isNotEmpty ?? false)) {
      (_, true) => '真实会话同步失败',
      (true, false) => '正在同步桌面会话...',
      (false, false) => '正在连接会话通道...',
    };

    final detail = error?.isNotEmpty == true
        ? error
        : (lastStatus?.isNotEmpty == true
              ? _statusDetail(lastStatus!, lastStatusAt)
              : '请保持桌面端在线并登录同一账号。');

    return Scaffold(
      backgroundColor: AppTheme.bgPrimary,
      appBar: AppBar(title: const Text('移动工作台')),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              SizedBox(
                width: 28,
                height: 28,
                child: CircularProgressIndicator(
                  strokeWidth: 2.2,
                  color: error == null ? AppTheme.brand : Colors.redAccent,
                ),
              ),
              const SizedBox(height: 18),
              Text(
                message,
                style: const TextStyle(
                  color: AppTheme.textPrimary,
                  fontSize: 18,
                  fontWeight: FontWeight.w700,
                ),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 10),
              Text(
                detail!,
                style: const TextStyle(
                  color: AppTheme.textSecondary,
                  fontSize: 13,
                  height: 1.5,
                ),
                textAlign: TextAlign.center,
              ),
              if (statusTrail.isNotEmpty) ...[
                const SizedBox(height: 18),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: AppTheme.bgSecondary,
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(color: AppTheme.borderColor),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        '同步日志',
                        style: TextStyle(
                          color: AppTheme.textPrimary,
                          fontSize: 12,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(height: 8),
                      for (final line in statusTrail.reversed)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 6),
                          child: Text(
                            line,
                            style: const TextStyle(
                              color: AppTheme.textSecondary,
                              fontSize: 11.5,
                              height: 1.45,
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  String _statusDetail(String status, DateTime? statusAt) {
    final stamp = statusAt == null
        ? ''
        : '${statusAt.hour.toString().padLeft(2, '0')}:${statusAt.minute.toString().padLeft(2, '0')}:${statusAt.second.toString().padLeft(2, '0')}';
    return stamp.isEmpty ? status : '$stamp  $status';
  }
}

class _ToolLayer extends StatelessWidget {
  const _ToolLayer({
    required this.snapshot,
    required this.selectedToolId,
    required this.onSelectTool,
  });

  final AiWorkbenchSnapshot snapshot;
  final String selectedToolId;
  final ValueChanged<String> onSelectTool;

  @override
  Widget build(BuildContext context) {
    return ListView.separated(
      padding: const EdgeInsets.fromLTRB(14, 14, 14, 18),
      itemCount: snapshot.providers.length,
      separatorBuilder: (_, _) => const SizedBox(height: 10),
      itemBuilder: (context, index) {
        final tool = snapshot.providers[index];
        final projects = snapshot.projects
            .where((project) => project.providerId == tool.id)
            .toList(growable: false);
        final sessions = snapshot.conversations
            .where((session) => session.providerId == tool.id)
            .toList(growable: false);
        return WorkbenchToolCard(
          tool: tool,
          projects: projects,
          sessions: sessions,
          selected: tool.id == selectedToolId,
          onTap: () => onSelectTool(tool.id),
        );
      },
    );
  }
}

class _SessionLayer extends StatelessWidget {
  const _SessionLayer({
    required this.snapshot,
    required this.tool,
    required this.project,
    required this.session,
    required this.sessions,
    required this.selectedModel,
    required this.effectiveModel,
    required this.selectedServiceTier,
    required this.effectiveServiceTier,
    required this.selectedEffort,
    required this.effectiveEffort,
    required this.onSwitchProjectBranch,
    required this.onSelectProject,
    required this.onSelectSession,
    required this.onSelectedModelChanged,
    required this.onSelectedServiceTierChanged,
    required this.onSelectedEffortChanged,
  });

  final AiWorkbenchSnapshot snapshot;
  final AiWorkbenchProvider? tool;
  final AiWorkbenchProject? project;
  final AiWorkbenchConversation? session;
  final List<AiWorkbenchConversation> sessions;
  final String? selectedModel;
  final String? effectiveModel;
  final String? selectedServiceTier;
  final String effectiveServiceTier;
  final String? selectedEffort;
  final String effectiveEffort;
  final Future<void> Function(String branch) onSwitchProjectBranch;
  final ValueChanged<String> onSelectProject;
  final ValueChanged<String> onSelectSession;
  final ValueChanged<String> onSelectedModelChanged;
  final ValueChanged<String> onSelectedServiceTierChanged;
  final ValueChanged<String> onSelectedEffortChanged;

  @override
  Widget build(BuildContext context) {
    if (tool == null) {
      return const Center(
        child: Text('暂无工具', style: TextStyle(color: AppTheme.textTertiary)),
      );
    }

    final syncProvider = context.watch<AiWorkbenchSyncProvider>();
    final sessionId = session?.id ?? '';
    final messages = <AiWorkbenchMessage>[
      ...(snapshot.messagesByConversationId[sessionId] ?? const []),
      ...(syncProvider.pendingMessagesByConversationId[sessionId] ?? const []),
    ];

    return Column(
      children: [
        Expanded(
          child: SessionDetailShell(
            tool: tool!,
            project: project,
            session: session,
            messages: messages,
            sessionCount: sessions.length,
            config: snapshot.configsByProviderId[tool!.id],
            models: snapshot.modelsByProviderId[tool!.id] ?? const [],
            selectedModel: selectedModel,
            selectedServiceTier: selectedServiceTier,
            effectiveServiceTier: effectiveServiceTier,
            selectedEffort: selectedEffort,
            effectiveEffort: effectiveEffort,
            onSwitchProjectBranch: onSwitchProjectBranch,
            lastStatus: tool!.id == 'codex' ? syncProvider.lastStatus : null,
            isSendingCodex:
                sessionId.isNotEmpty &&
                tool!.id == 'codex' &&
                syncProvider.isConversationSending(sessionId),
            onSendCodexMessage: (text) async {
              if (session == null) return false;
              return context.read<AiWorkbenchSyncProvider>().sendCodexMessage(
                conversationId: session!.id,
                text: text,
                cwd:
                    session!.cwd ??
                    project?.path ??
                    snapshot.configsByProviderId[tool!.id]?.cwd,
                model: effectiveModel,
                effort: effectiveEffort,
                serviceTier: effectiveServiceTier,
                approvalPolicy:
                    snapshot.configsByProviderId[tool!.id]?.approvalPolicy,
                sandboxMode:
                    snapshot.configsByProviderId[tool!.id]?.sandboxMode,
              );
            },
            onRespondToCodexApproval: (approved) async {
              if (session?.pendingApproval == null) return false;
              return context
                  .read<AiWorkbenchSyncProvider>()
                  .respondToCodexApproval(
                    conversationId: session!.id,
                    approvalId: session!.pendingApproval!.approvalId,
                    requestId: session!.pendingApproval!.requestId,
                    kind: session!.pendingApproval!.kind,
                    approved: approved,
                    cwd:
                        session!.cwd ??
                        project?.path ??
                        snapshot.configsByProviderId[tool!.id]?.cwd,
                    model: effectiveModel,
                    effort: effectiveEffort,
                    serviceTier: effectiveServiceTier,
                    approvalPolicy:
                        snapshot.configsByProviderId[tool!.id]?.approvalPolicy,
                    sandboxMode:
                        snapshot.configsByProviderId[tool!.id]?.sandboxMode,
                  );
            },
            onArchiveCodexConversation: () async {
              if (tool?.id != 'codex' || session == null) return false;
              return context
                  .read<AiWorkbenchSyncProvider>()
                  .archiveCodexConversation(conversationId: session!.id);
            },
            onShowSessionSheet: () => _showSessionSheet(context),
            onSelectedModelChanged: (model) {
              onSelectedModelChanged(model);
              if (tool?.id == 'codex') {
                context.read<AiWorkbenchSyncProvider>().updateCodexConfig(
                  model: model,
                  serviceTier: effectiveServiceTier,
                );
              }
            },
            onSelectedServiceTierChanged: (tier) {
              onSelectedServiceTierChanged(tier);
              if (tool?.id == 'codex') {
                context.read<AiWorkbenchSyncProvider>().updateCodexConfig(
                  model: effectiveModel,
                  serviceTier: tier,
                );
              }
            },
            onSelectedEffortChanged: onSelectedEffortChanged,
          ),
        ),
      ],
    );
  }

  Future<void> _showSessionSheet(BuildContext context) async {
    final projects = snapshot.projects
        .where((item) => item.providerId == tool?.id)
        .toList(growable: false);
    final sessionsByProject =
        <AiWorkbenchProject, List<AiWorkbenchConversation>>{};
    final groupedSessionIds = <String>{};

    for (final item in projects) {
      final linkedIds = item.conversationIds.toSet();
      final grouped = sessions
          .where((session) {
            if (linkedIds.isNotEmpty && linkedIds.contains(session.id)) {
              return true;
            }
            return session.projectId == item.id;
          })
          .toList(growable: false);
      sessionsByProject[item] = grouped;
      groupedSessionIds.addAll(grouped.map((session) => session.id));
    }

    final ungroupedSessions = sessions
        .where((session) => !groupedSessionIds.contains(session.id))
        .toList(growable: false);

    await showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      backgroundColor: AppTheme.bgSecondary,
      isScrollControlled: true,
      builder: (context) {
        final expandedProjectIds = <String>{
          for (final entry in sessionsByProject.entries)
            if (entry.value.isNotEmpty) entry.key.id,
        };
        var showUngrouped = ungroupedSessions.isNotEmpty;

        return StatefulBuilder(
          builder: (context, setModalState) {
            return SafeArea(
              top: false,
              child: SizedBox(
                height: MediaQuery.of(context).size.height * 0.72,
                child: Column(
                  children: [
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 4, 16, 10),
                      child: Row(
                        children: [
                          const Expanded(
                            child: Text(
                              '切换会话',
                              style: TextStyle(
                                color: AppTheme.textPrimary,
                                fontSize: 16,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ),
                          Text(
                            '${tool?.name ?? '当前工具'} · ${sessions.length} 个',
                            style: const TextStyle(
                              color: AppTheme.textSecondary,
                              fontSize: 12,
                            ),
                          ),
                        ],
                      ),
                    ),
                    Expanded(
                      child: ListView(
                        padding: const EdgeInsets.fromLTRB(14, 0, 14, 14),
                        children: [
                          for (final entry in sessionsByProject.entries) ...[
                            _SessionProjectHeader(
                              title: entry.key.name,
                              subtitle:
                                  '${entry.value.length} 个会话 · ${entry.key.path}',
                              expanded: expandedProjectIds.contains(
                                entry.key.id,
                              ),
                              onTap: () {
                                setModalState(() {
                                  if (expandedProjectIds.contains(
                                    entry.key.id,
                                  )) {
                                    expandedProjectIds.remove(entry.key.id);
                                  } else {
                                    expandedProjectIds.add(entry.key.id);
                                  }
                                });
                              },
                            ),
                            if (expandedProjectIds.contains(entry.key.id)) ...[
                              for (final item in entry.value) ...[
                                WorkbenchSessionRow(
                                  session: item,
                                  selected: item.id == session?.id,
                                  indent: 18,
                                  onTap: () {
                                    onSelectProject(entry.key.id);
                                    onSelectSession(item.id);
                                    Navigator.of(context).pop();
                                  },
                                ),
                                const SizedBox(height: 8),
                              ],
                              if (entry.value.isEmpty)
                                const Padding(
                                  padding: EdgeInsets.fromLTRB(12, 0, 12, 10),
                                  child: Text(
                                    '暂无会话',
                                    style: TextStyle(
                                      color: AppTheme.textSecondary,
                                      fontSize: 12,
                                    ),
                                  ),
                                ),
                              const SizedBox(height: 6),
                            ],
                          ],
                          if (ungroupedSessions.isNotEmpty) ...[
                            _SessionProjectHeader(
                              title: '对话',
                              subtitle: '没有绑定项目的会话',
                              expanded: showUngrouped,
                              onTap: () {
                                setModalState(() {
                                  showUngrouped = !showUngrouped;
                                });
                              },
                            ),
                            if (showUngrouped) ...[
                              for (final item in ungroupedSessions) ...[
                                WorkbenchSessionRow(
                                  session: item,
                                  selected: item.id == session?.id,
                                  indent: 18,
                                  onTap: () {
                                    onSelectSession(item.id);
                                    Navigator.of(context).pop();
                                  },
                                ),
                                const SizedBox(height: 8),
                              ],
                            ],
                          ],
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            );
          },
        );
      },
    );
  }
}

class _SessionProjectHeader extends StatelessWidget {
  const _SessionProjectHeader({
    required this.title,
    required this.subtitle,
    required this.expanded,
    required this.onTap,
  });

  final String title;
  final String subtitle;
  final bool expanded;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(2, 2, 2, 8),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Container(
          padding: const EdgeInsets.fromLTRB(10, 10, 10, 10),
          decoration: BoxDecoration(
            color: expanded ? AppTheme.bgTertiary : AppTheme.bgSecondary,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(
              color: expanded
                  ? AppTheme.brand.withAlpha(80)
                  : AppTheme.borderColor,
            ),
          ),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: const TextStyle(
                        color: AppTheme.textPrimary,
                        fontSize: 13,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      subtitle,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppTheme.textSecondary,
                        fontSize: 11,
                      ),
                    ),
                  ],
                ),
              ),
              Icon(
                expanded ? Icons.expand_less : Icons.expand_more,
                size: 18,
                color: AppTheme.textSecondary,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class WorkbenchToolCard extends StatelessWidget {
  const WorkbenchToolCard({
    super.key,
    required this.tool,
    required this.projects,
    required this.sessions,
    required this.selected,
    required this.onTap,
  });

  final AiWorkbenchProvider tool;
  final List<AiWorkbenchProject> projects;
  final List<AiWorkbenchConversation> sessions;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final running = sessions.any((item) => item.status == 'running');
    final waiting = sessions.any((item) => item.status == 'waitingApproval');
    final status = running ? '运行中' : (waiting ? '需确认' : '空闲');
    final statusColor = running
        ? AppTheme.statusGreen
        : (waiting ? AppTheme.statusYellow : AppTheme.statusGray);

    return Material(
      color: selected ? AppTheme.brand.withAlpha(12) : AppTheme.bgSecondary,
      borderRadius: BorderRadius.circular(8),
      child: InkWell(
        borderRadius: BorderRadius.circular(8),
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(8),
            border: Border.all(
              color: selected
                  ? AppTheme.brand.withAlpha(90)
                  : AppTheme.borderColor,
            ),
          ),
          child: Row(
            children: [
              _ToolIcon(toolId: tool.id),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            tool.name,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: AppTheme.textPrimary,
                              fontSize: 16,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                        _StatusPill(label: status, color: statusColor),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Text(
                      '${projects.length} 个项目 · ${sessions.length} 个会话 · 刚刚更新',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppTheme.textSecondary,
                        fontSize: 12,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      _toolSummary(tool.id, running, waiting),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppTheme.textTertiary,
                        fontSize: 11,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  String _toolSummary(String toolId, bool running, bool waiting) {
    if (toolId == 'terminal') {
      return running ? '远程终端正在输出' : '终端通道可用';
    }
    if (waiting) return '有会话等待远程确认';
    return '消息通道已同步';
  }
}

class WorkbenchProjectCard extends StatelessWidget {
  const WorkbenchProjectCard({
    super.key,
    required this.project,
    required this.sessions,
    required this.selected,
    this.compact = false,
    required this.onTap,
  });

  final AiWorkbenchProject project;
  final List<AiWorkbenchConversation> sessions;
  final bool selected;
  final bool compact;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final running = sessions.where((item) => item.status == 'running').length;
    final status = running > 0 ? '运行中' : '空闲';

    return SizedBox(
      width: compact ? 298 : 238,
      child: Material(
        color: selected ? AppTheme.brand.withAlpha(12) : AppTheme.bgSecondary,
        borderRadius: BorderRadius.circular(8),
        child: InkWell(
          borderRadius: BorderRadius.circular(8),
          onTap: onTap,
          child: Container(
            padding: EdgeInsets.all(compact ? 14 : 12),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(8),
              border: Border.all(
                color: selected
                    ? AppTheme.brand.withAlpha(90)
                    : AppTheme.borderColor,
              ),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        project.name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: AppTheme.textPrimary,
                          fontSize: compact ? 16 : 14,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                    Text(
                      status,
                      style: TextStyle(
                        color: AppTheme.textSecondary,
                        fontSize: compact ? 12 : 11,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                Text(
                  project.path,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: AppTheme.textSecondary,
                    fontSize: compact ? 12 : 11,
                  ),
                ),
                const SizedBox(height: 7),
                Text(
                  '${project.branches.firstOrNull ?? '无分支'} · ${sessions.length} 个会话',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: AppTheme.textTertiary,
                    fontSize: compact ? 11 : 10,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class WorkbenchSessionRow extends StatelessWidget {
  const WorkbenchSessionRow({
    super.key,
    required this.session,
    required this.selected,
    required this.onTap,
    this.compact = false,
    this.indent = 0,
  });

  final AiWorkbenchConversation session;
  final bool selected;
  final VoidCallback onTap;
  final bool compact;
  final double indent;

  @override
  Widget build(BuildContext context) {
    final color = _statusColor(session.status);
    final subtype = _sessionSubtype(session);
    final horizontalPadding = compact ? 9.0 : 12.0;

    return Padding(
      padding: EdgeInsets.only(left: indent),
      child: Material(
        color: selected ? AppTheme.bgHover : AppTheme.bgSecondary,
        borderRadius: BorderRadius.circular(8),
        child: InkWell(
          borderRadius: BorderRadius.circular(8),
          onTap: onTap,
          child: Container(
            padding: EdgeInsets.all(horizontalPadding),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(8),
              border: Border.all(
                color: selected
                    ? AppTheme.brand.withAlpha(80)
                    : AppTheme.borderColor,
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
                        color: color,
                        shape: BoxShape.circle,
                      ),
                    ),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text(
                        session.title,
                        maxLines: compact ? 2 : 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: selected
                              ? AppTheme.brandDark
                              : AppTheme.textPrimary,
                          fontSize: compact ? 12 : 13,
                          fontWeight: FontWeight.w700,
                          height: 1.2,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 7),
                if (subtype.isNotEmpty)
                  _MiniBadge(label: subtype)
                else
                  Text(
                    _mobileStatus(session.status),
                    style: const TextStyle(
                      color: AppTheme.textSecondary,
                      fontSize: 10,
                    ),
                  ),
                const SizedBox(height: 6),
                Text(
                  session.preview ?? session.cwd ?? '暂无摘要',
                  maxLines: compact ? 2 : 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: AppTheme.textTertiary,
                    fontSize: 10,
                    height: 1.25,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  String _sessionSubtype(AiWorkbenchConversation session) {
    if (session.providerId != 'terminal') return '';
    return session.source ?? '';
  }
}

class SessionDetailShell extends StatelessWidget {
  const SessionDetailShell({
    super.key,
    required this.tool,
    required this.project,
    required this.session,
    required this.messages,
    required this.sessionCount,
    required this.config,
    required this.models,
    required this.selectedModel,
    required this.selectedServiceTier,
    required this.effectiveServiceTier,
    required this.selectedEffort,
    required this.effectiveEffort,
    required this.onSwitchProjectBranch,
    required this.onSendCodexMessage,
    required this.onRespondToCodexApproval,
    required this.onArchiveCodexConversation,
    required this.onShowSessionSheet,
    required this.onSelectedModelChanged,
    required this.onSelectedServiceTierChanged,
    required this.onSelectedEffortChanged,
    required this.lastStatus,
    required this.isSendingCodex,
  });

  final AiWorkbenchProvider tool;
  final AiWorkbenchProject? project;
  final AiWorkbenchConversation? session;
  final List<AiWorkbenchMessage> messages;
  final int sessionCount;
  final AiWorkbenchConfig? config;
  final List<AiWorkbenchModel> models;
  final String? selectedModel;
  final String? selectedServiceTier;
  final String effectiveServiceTier;
  final String? selectedEffort;
  final String effectiveEffort;
  final Future<void> Function(String branch) onSwitchProjectBranch;
  final Future<bool> Function(String text) onSendCodexMessage;
  final Future<bool> Function(bool approved) onRespondToCodexApproval;
  final Future<bool> Function() onArchiveCodexConversation;
  final VoidCallback onShowSessionSheet;
  final ValueChanged<String> onSelectedModelChanged;
  final ValueChanged<String> onSelectedServiceTierChanged;
  final ValueChanged<String> onSelectedEffortChanged;
  final String? lastStatus;
  final bool isSendingCodex;

  @override
  Widget build(BuildContext context) {
    if (session == null) {
      return const Center(
        child: Text('暂无会话', style: TextStyle(color: AppTheme.textTertiary)),
      );
    }

    return Column(
      children: [
        SessionHeader(
          tool: tool,
          project: project,
          session: session!,
          onArchiveCodexConversation: onArchiveCodexConversation,
        ),
        Expanded(
          child: tool.id == 'terminal'
              ? TerminalSessionBody(session: session!, messages: messages)
              : CodexSessionBody(messages: messages),
        ),
        if (tool.id == 'codex' && session!.pendingApproval != null)
          CodexApprovalBar(
            approval: session!.pendingApproval!,
            onDecision: onRespondToCodexApproval,
          ),
        SessionComposer(
          tool: tool,
          project: project,
          session: session!,
          sessionCount: sessionCount,
          config: config,
          models: models,
          selectedModel: selectedModel,
          selectedServiceTier: selectedServiceTier,
          effectiveServiceTier: effectiveServiceTier,
          selectedEffort: selectedEffort,
          effectiveEffort: effectiveEffort,
          onSwitchProjectBranch: onSwitchProjectBranch,
          isSending: tool.id == 'codex' && isSendingCodex,
          onSendCodexMessage: onSendCodexMessage,
          onShowSessionSheet: onShowSessionSheet,
          onSelectedModelChanged: onSelectedModelChanged,
          onSelectedServiceTierChanged: onSelectedServiceTierChanged,
          onSelectedEffortChanged: onSelectedEffortChanged,
          statusHint: tool.id == 'codex' ? lastStatus : null,
        ),
      ],
    );
  }
}

class SessionHeader extends StatelessWidget {
  const SessionHeader({
    super.key,
    required this.tool,
    required this.project,
    required this.session,
    required this.onArchiveCodexConversation,
  });

  final AiWorkbenchProvider tool;
  final AiWorkbenchProject? project;
  final AiWorkbenchConversation session;
  final Future<bool> Function() onArchiveCodexConversation;

  @override
  Widget build(BuildContext context) {
    final branchOrPath =
        session.gitInfo?.branch ?? project?.branches.firstOrNull;
    final meta = <String>[
      tool.name,
      if (project?.name != null) project!.name,
      _mobileStatus(session.status),
    ];

    return Container(
      padding: const EdgeInsets.fromLTRB(12, 6, 12, 8),
      decoration: const BoxDecoration(
        color: AppTheme.bgSecondary,
        border: Border(bottom: BorderSide(color: AppTheme.borderColor)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  session.title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: AppTheme.textPrimary,
                    fontSize: 14,
                    fontWeight: FontWeight.w800,
                    height: 1.2,
                  ),
                ),
              ),
              if (tool.id == 'codex')
                PopupMenuButton<String>(
                  tooltip: '会话操作',
                  color: AppTheme.bgPrimary,
                  onSelected: (value) async {
                    if (value != 'archive') return;
                    final confirmed = await showDialog<bool>(
                      context: context,
                      builder: (context) => AlertDialog(
                        backgroundColor: AppTheme.bgPrimary,
                        title: const Text('归档会话'),
                        content: Text('归档后会从当前列表移除：${session.title}'),
                        actions: [
                          TextButton(
                            onPressed: () => Navigator.of(context).pop(false),
                            child: const Text('取消'),
                          ),
                          FilledButton(
                            onPressed: () => Navigator.of(context).pop(true),
                            child: const Text('归档'),
                          ),
                        ],
                      ),
                    );
                    if (confirmed != true || !context.mounted) return;
                    final ok = await onArchiveCodexConversation();
                    if (!context.mounted) return;
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(content: Text(ok ? '已请求归档会话' : '归档请求发送失败')),
                    );
                  },
                  itemBuilder: (context) => const [
                    PopupMenuItem<String>(
                      value: 'archive',
                      child: Text('归档当前会话'),
                    ),
                  ],
                  child: const Padding(
                    padding: EdgeInsets.fromLTRB(10, 6, 0, 6),
                    child: Icon(
                      Icons.more_horiz,
                      size: 18,
                      color: AppTheme.textSecondary,
                    ),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 4),
          Wrap(
            spacing: 6,
            runSpacing: 4,
            children: [
              for (final item in meta) _MiniBadge(label: item),
              if (branchOrPath != null && branchOrPath.isNotEmpty)
                _MiniBadge(label: branchOrPath),
            ],
          ),
          if (session.cwd != null && session.cwd!.isNotEmpty) ...[
            const SizedBox(height: 3),
          ],
        ],
      ),
    );
  }
}

class TerminalSessionBody extends StatelessWidget {
  const TerminalSessionBody({
    super.key,
    required this.session,
    required this.messages,
  });

  final AiWorkbenchConversation session;
  final List<AiWorkbenchMessage> messages;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      color: const Color(0xFF111827),
      child: ListView.separated(
        padding: const EdgeInsets.all(12),
        itemCount: messages.length,
        separatorBuilder: (_, _) => const SizedBox(height: 8),
        itemBuilder: (context, index) {
          final message = messages[index];
          return SelectableText(
            message.text,
            style: const TextStyle(
              color: Color(0xFFE5E7EB),
              fontFamily: 'monospace',
              fontSize: 12,
              height: 1.42,
            ),
          );
        },
      ),
    );
  }
}

class CodexSessionBody extends StatelessWidget {
  const CodexSessionBody({super.key, required this.messages});

  final List<AiWorkbenchMessage> messages;

  @override
  Widget build(BuildContext context) {
    if (messages.isEmpty) {
      return const Center(
        child: Text(
          '新对话尚未产生正文',
          style: TextStyle(color: AppTheme.textTertiary),
        ),
      );
    }

    return ListView.separated(
      padding: const EdgeInsets.fromLTRB(10, 10, 10, 12),
      itemCount: messages.length,
      separatorBuilder: (_, _) => const SizedBox(height: 8),
      itemBuilder: (context, index) => _MessageBlock(message: messages[index]),
    );
  }
}

class SessionStatusStrip extends StatelessWidget {
  const SessionStatusStrip({
    super.key,
    required this.tool,
    required this.session,
    this.statusOverride,
    this.isSending = false,
  });

  final AiWorkbenchProvider tool;
  final AiWorkbenchConversation session;
  final String? statusOverride;
  final bool isSending;

  @override
  Widget build(BuildContext context) {
    final text = switch (tool.id) {
      'terminal' => session.status == 'running' ? '已连接 · 最近收到输出' : '终端通道空闲',
      _ =>
        statusOverride ??
            (isSending
                ? '消息已发出，等待桌面端回流...'
                : session.status == 'running'
                ? 'Codex 正在回复...'
                : '消息通道空闲'),
    };

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
      decoration: const BoxDecoration(
        color: AppTheme.bgSecondary,
        border: Border(top: BorderSide(color: AppTheme.borderColor)),
      ),
      child: Text(
        text,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: const TextStyle(color: AppTheme.textSecondary, fontSize: 10),
      ),
    );
  }
}

class CodexApprovalBar extends StatefulWidget {
  const CodexApprovalBar({
    super.key,
    required this.approval,
    required this.onDecision,
  });

  final AiWorkbenchPendingApproval approval;
  final Future<bool> Function(bool approved) onDecision;

  @override
  State<CodexApprovalBar> createState() => _CodexApprovalBarState();
}

class _CodexApprovalBarState extends State<CodexApprovalBar> {
  bool _busy = false;

  Future<void> _submit(bool approved) async {
    if (_busy) return;
    setState(() => _busy = true);
    final ok = await widget.onDecision(approved);
    if (!mounted) return;
    setState(() => _busy = false);
    if (!ok) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('确认动作没有发出去，请检查桌面端连接状态')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final summary = widget.approval.summary?.trim();
    final permissionApproval = widget.approval.kind == 'permissions-approval';
    final denyLabel = permissionApproval ? '不授权' : '拒绝';
    final approveLabel = permissionApproval ? '授权并继续' : '确认并继续';
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.fromLTRB(10, 8, 10, 0),
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
      decoration: BoxDecoration(
        color: const Color(0xFFFFFBEB),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: const Color(0xFFFACC15).withAlpha(120)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            '待确认操作',
            style: TextStyle(
              color: Color(0xFF92400E),
              fontSize: 11,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            widget.approval.title,
            style: const TextStyle(
              color: AppTheme.textPrimary,
              fontSize: 13,
              fontWeight: FontWeight.w700,
            ),
          ),
          if (summary != null && summary.isNotEmpty) ...[
            const SizedBox(height: 6),
            Text(
              summary,
              maxLines: 3,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: AppTheme.textSecondary,
                fontSize: 12,
                height: 1.35,
              ),
            ),
          ],
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: _busy ? null : () => _submit(false),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: AppTheme.statusRed,
                    side: const BorderSide(color: AppTheme.statusRed),
                    minimumSize: const Size.fromHeight(38),
                  ),
                  child: Text(_busy ? '处理中...' : denyLabel),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: FilledButton(
                  onPressed: _busy ? null : () => _submit(true),
                  style: FilledButton.styleFrom(
                    minimumSize: const Size.fromHeight(38),
                    backgroundColor: AppTheme.brand,
                  ),
                  child: Text(_busy ? '处理中...' : approveLabel),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class SessionComposer extends StatefulWidget {
  const SessionComposer({
    super.key,
    required this.tool,
    required this.project,
    required this.session,
    required this.sessionCount,
    required this.config,
    required this.models,
    required this.selectedModel,
    required this.selectedServiceTier,
    required this.effectiveServiceTier,
    required this.selectedEffort,
    required this.effectiveEffort,
    required this.onSwitchProjectBranch,
    required this.onSendCodexMessage,
    required this.onShowSessionSheet,
    required this.onSelectedModelChanged,
    required this.onSelectedServiceTierChanged,
    required this.onSelectedEffortChanged,
    required this.isSending,
    this.statusHint,
  });

  final AiWorkbenchProvider tool;
  final AiWorkbenchProject? project;
  final AiWorkbenchConversation session;
  final int sessionCount;
  final AiWorkbenchConfig? config;
  final List<AiWorkbenchModel> models;
  final String? selectedModel;
  final String? selectedServiceTier;
  final String effectiveServiceTier;
  final String? selectedEffort;
  final String effectiveEffort;
  final Future<void> Function(String branch) onSwitchProjectBranch;
  final Future<bool> Function(String text) onSendCodexMessage;
  final VoidCallback onShowSessionSheet;
  final ValueChanged<String> onSelectedModelChanged;
  final ValueChanged<String> onSelectedServiceTierChanged;
  final ValueChanged<String> onSelectedEffortChanged;
  final bool isSending;
  final String? statusHint;

  @override
  State<SessionComposer> createState() => _SessionComposerState();
}

class _SessionComposerState extends State<SessionComposer> {
  late final TextEditingController _controller;
  bool _showDetails = false;

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final text = _controller.text.trim();
    if (text.isEmpty) {
      return;
    }
    if (widget.tool.id == 'terminal') {
      final sessionProvider = context.read<SessionProvider>();
      sessionProvider.sendInput(text);
      _controller.clear();
    } else {
      final sent = await widget.onSendCodexMessage(text);
      if (!sent) {
        if (!mounted) return;
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(const SnackBar(content: Text('消息没有发出去，请检查桌面端连接状态')));
        return;
      }
      _controller.clear();
    }
    if (!mounted) return;
    FocusScope.of(context).unfocus();
  }

  @override
  Widget build(BuildContext context) {
    final terminal = widget.tool.id == 'terminal';
    final placeholder = terminal ? '输入命令...' : '给 Codex 发送消息...';
    final status = _mobileStatus(widget.session.status);
    final branch =
        widget.project?.branches.firstOrNull ??
        widget.session.gitInfo?.branch ??
        '无分支';
    final currentModel = widget.selectedModel?.trim().isNotEmpty == true
        ? widget.selectedModel!.trim()
        : widget.config?.model?.trim().isNotEmpty == true
        ? widget.config!.model!.trim()
        : widget.models
                  .where((item) => item.isDefault == true)
                  .firstOrNull
                  ?.id ??
              widget.models.firstOrNull?.id ??
              '默认模型';
    final currentServiceTier =
        widget.selectedServiceTier?.trim().isNotEmpty == true
        ? widget.selectedServiceTier!.trim()
        : widget.effectiveServiceTier;
    final currentEffort = widget.selectedEffort?.trim().isNotEmpty == true
        ? widget.selectedEffort!.trim()
        : widget.effectiveEffort;
    final effortOptions = widget.models
        .firstWhere(
          (item) => item.id == currentModel,
          orElse: () =>
              widget.models.firstOrNull ??
              const AiWorkbenchModel(id: '', providerId: 'codex', label: ''),
        )
        .supportedReasoningEfforts;
    final visibleEfforts = effortOptions.isNotEmpty
        ? effortOptions
        : _fallbackReasoningEfforts;

    return SafeArea(
      top: false,
      child: Container(
        padding: const EdgeInsets.fromLTRB(10, 6, 10, 10),
        decoration: const BoxDecoration(color: AppTheme.bgSecondary),
        child: Column(
          children: [
            if (widget.statusHint != null &&
                widget.statusHint!.trim().isNotEmpty) ...[
              Align(
                alignment: Alignment.centerLeft,
                child: Padding(
                  padding: const EdgeInsets.only(bottom: 6),
                  child: Text(
                    widget.statusHint!,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: AppTheme.textSecondary,
                      fontSize: 10,
                    ),
                  ),
                ),
              ),
            ],
            Row(
              children: [
                Expanded(
                  child: Container(
                    constraints: const BoxConstraints(minHeight: 40),
                    decoration: BoxDecoration(
                      color: AppTheme.bgPrimary,
                      borderRadius: BorderRadius.circular(3),
                      border: Border.all(color: AppTheme.borderColor),
                    ),
                    child: TextField(
                      controller: _controller,
                      minLines: 1,
                      maxLines: 4,
                      textInputAction: terminal
                          ? TextInputAction.done
                          : TextInputAction.send,
                      onSubmitted: (_) {
                        _submit();
                      },
                      decoration: InputDecoration(
                        hintText: placeholder,
                        hintStyle: const TextStyle(
                          color: AppTheme.textTertiary,
                          fontSize: 13,
                        ),
                        border: InputBorder.none,
                        contentPadding: const EdgeInsets.symmetric(
                          horizontal: 12,
                          vertical: 10,
                        ),
                      ),
                      style: const TextStyle(
                        color: AppTheme.textPrimary,
                        fontSize: 13,
                        height: 1.35,
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                SizedBox(
                  width: 40,
                  height: 40,
                  child: FilledButton(
                    style: FilledButton.styleFrom(
                      padding: EdgeInsets.zero,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(3),
                      ),
                    ),
                    onPressed: widget.isSending ? null : () => _submit(),
                    child: Icon(
                      widget.isSending
                          ? Icons.hourglass_top
                          : terminal
                          ? Icons.keyboard_return
                          : Icons.send,
                      size: 18,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Container(
              decoration: BoxDecoration(
                color: AppTheme.bgPrimary,
                border: Border.all(color: AppTheme.borderColor),
              ),
              child: Column(
                children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(10, 8, 10, 8),
                    child: Row(
                      children: [
                        Expanded(
                          child: _ControlStripField(
                            label: '项目',
                            value: widget.project?.name ?? '未绑定项目',
                            hint: branch,
                          ),
                        ),
                        const SizedBox(width: 8),
                        if ((widget.project?.branches.length ?? 0) > 0)
                          SizedBox(
                            width: 124,
                            child: _OptionMenuButton(
                              icon: Icons.account_tree_outlined,
                              value: branch,
                              options: widget.project?.branches ?? const [],
                              onSelected: (value) {
                                if (value == branch) return;
                                unawaited(widget.onSwitchProjectBranch(value));
                              },
                            ),
                          ),
                        Container(
                          width: 1,
                          height: 32,
                          margin: const EdgeInsets.symmetric(horizontal: 10),
                          color: AppTheme.borderColor,
                        ),
                        Expanded(
                          child: _ControlStripField(
                            label: '会话',
                            value: widget.session.title,
                            hint: status,
                          ),
                        ),
                        const SizedBox(width: 8),
                        _HardEdgeButton(
                          label: '切换',
                          icon: Icons.swap_horiz,
                          onPressed: widget.onShowSessionSheet,
                        ),
                      ],
                    ),
                  ),
                  Container(height: 1, color: AppTheme.borderColor),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(10, 6, 10, 6),
                    child: Row(
                      children: [
                        Expanded(
                          child: _ModelSelectorButton(
                            value: currentModel,
                            models: widget.models,
                            onSelected: widget.onSelectedModelChanged,
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: _OptionMenuButton(
                            icon: Icons.speed,
                            value: currentServiceTier,
                            options: _serviceTierOptions,
                            onSelected: widget.onSelectedServiceTierChanged,
                          ),
                        ),
                        const SizedBox(width: 6),
                        Expanded(
                          child: _OptionMenuButton(
                            icon: Icons.psychology_alt_outlined,
                            value: currentEffort,
                            options: visibleEfforts,
                            onSelected: widget.onSelectedEffortChanged,
                          ),
                        ),
                        const SizedBox(width: 6),
                        _HardEdgeButton(
                          label: _showDetails ? '收起' : '详情',
                          icon: _showDetails
                              ? Icons.keyboard_arrow_up
                              : Icons.keyboard_arrow_down,
                          onPressed: () {
                            setState(() {
                              _showDetails = !_showDetails;
                            });
                          },
                        ),
                      ],
                    ),
                  ),
                  if (_showDetails) ...[
                    Container(height: 1, color: AppTheme.borderColor),
                    Padding(
                      padding: const EdgeInsets.fromLTRB(10, 7, 10, 8),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          _DetailLine(
                            label: '路径',
                            value:
                                widget.session.cwd ??
                                widget.project?.path ??
                                widget.config?.cwd ??
                                '-',
                          ),
                          const SizedBox(height: 4),
                          _DetailLine(
                            label: '沙箱',
                            value:
                                widget.config?.sandboxMode ?? 'workspace-write',
                          ),
                          const SizedBox(height: 4),
                          _DetailLine(
                            label: '会话',
                            value: '${widget.sessionCount} 个',
                          ),
                          const SizedBox(height: 4),
                          _DetailLine(
                            label: '确认',
                            value:
                                widget.config?.approvalPolicy ?? 'on-request',
                          ),
                          const SizedBox(height: 4),
                          _DetailLine(label: '状态', value: status),
                        ],
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ControlStripField extends StatelessWidget {
  const _ControlStripField({
    required this.label,
    required this.value,
    required this.hint,
  });

  final String label;
  final String value;
  final String hint;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(
            color: AppTheme.textTertiary,
            fontSize: 10,
            fontWeight: FontWeight.w700,
            letterSpacing: 0.2,
          ),
        ),
        const SizedBox(height: 2),
        Text(
          value,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(
            color: AppTheme.textPrimary,
            fontSize: 13,
            fontWeight: FontWeight.w800,
            height: 1.15,
          ),
        ),
        const SizedBox(height: 1),
        Text(
          hint,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(color: AppTheme.textSecondary, fontSize: 10),
        ),
      ],
    );
  }
}

class _HardEdgeButton extends StatelessWidget {
  const _HardEdgeButton({
    required this.label,
    required this.icon,
    required this.onPressed,
  });

  final String label;
  final IconData icon;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 32,
      child: OutlinedButton.icon(
        onPressed: onPressed,
        style: OutlinedButton.styleFrom(
          padding: const EdgeInsets.symmetric(horizontal: 10),
          side: const BorderSide(color: AppTheme.borderColor),
          shape: const RoundedRectangleBorder(),
        ),
        icon: Icon(icon, size: 15, color: AppTheme.brand),
        label: Text(
          label,
          style: const TextStyle(
            color: AppTheme.textPrimary,
            fontSize: 11.5,
            fontWeight: FontWeight.w700,
          ),
        ),
      ),
    );
  }
}

class _OptionMenuButton extends StatelessWidget {
  const _OptionMenuButton({
    required this.icon,
    required this.value,
    required this.options,
    required this.onSelected,
  });

  final IconData icon;
  final String value;
  final List<String> options;
  final ValueChanged<String> onSelected;

  @override
  Widget build(BuildContext context) {
    return PopupMenuButton<String>(
      tooltip: value,
      color: AppTheme.bgPrimary,
      onSelected: onSelected,
      itemBuilder: (context) => [
        for (final option in options)
          PopupMenuItem<String>(value: option, child: Text(option)),
      ],
      child: Container(
        height: 32,
        padding: const EdgeInsets.symmetric(horizontal: 10),
        decoration: BoxDecoration(
          border: Border.all(color: AppTheme.borderColor),
        ),
        child: Row(
          children: [
            Icon(icon, size: 15, color: AppTheme.brand),
            const SizedBox(width: 6),
            Expanded(
              child: Text(
                value,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: AppTheme.textPrimary,
                  fontSize: 11.5,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
            const SizedBox(width: 4),
            const Icon(
              Icons.expand_more,
              size: 16,
              color: AppTheme.textSecondary,
            ),
          ],
        ),
      ),
    );
  }
}

class _DetailLine extends StatelessWidget {
  const _DetailLine({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 32,
          child: Text(
            label,
            style: const TextStyle(
              color: AppTheme.textTertiary,
              fontSize: 10,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            value,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              color: AppTheme.textSecondary,
              fontSize: 10.5,
            ),
          ),
        ),
      ],
    );
  }
}

class _ModelSelectorButton extends StatelessWidget {
  const _ModelSelectorButton({
    required this.value,
    required this.models,
    required this.onSelected,
  });

  final String value;
  final List<AiWorkbenchModel> models;
  final ValueChanged<String> onSelected;

  @override
  Widget build(BuildContext context) {
    if (models.isEmpty) {
      return Container(
        height: 32,
        alignment: Alignment.centerLeft,
        padding: const EdgeInsets.symmetric(horizontal: 10),
        decoration: BoxDecoration(
          border: Border.all(color: AppTheme.borderColor),
        ),
        child: Text(
          '模型 $value',
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(
            color: AppTheme.textPrimary,
            fontSize: 11.5,
            fontWeight: FontWeight.w700,
          ),
        ),
      );
    }

    return PopupMenuButton<String>(
      tooltip: '选择模型',
      color: AppTheme.bgPrimary,
      onSelected: onSelected,
      itemBuilder: (context) => [
        for (final model in models)
          PopupMenuItem<String>(
            value: model.id,
            child: Text(
              model.label.isNotEmpty ? model.label : model.id,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
      ],
      child: Container(
        height: 32,
        padding: const EdgeInsets.symmetric(horizontal: 10),
        decoration: BoxDecoration(
          border: Border.all(color: AppTheme.borderColor),
        ),
        child: Row(
          children: [
            const Icon(Icons.tune, size: 15, color: AppTheme.brand),
            const SizedBox(width: 6),
            Expanded(
              child: Text(
                value,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: AppTheme.textPrimary,
                  fontSize: 11.5,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
            const SizedBox(width: 4),
            const Icon(
              Icons.expand_more,
              size: 16,
              color: AppTheme.textSecondary,
            ),
          ],
        ),
      ),
    );
  }
}

class CodexDebugPanel extends StatefulWidget {
  const CodexDebugPanel({
    super.key,
    required this.conversationId,
    required this.lastStatus,
  });

  final String conversationId;
  final String? lastStatus;

  @override
  State<CodexDebugPanel> createState() => _CodexDebugPanelState();
}

class _CodexDebugPanelState extends State<CodexDebugPanel> {
  bool _expanded = false;

  @override
  Widget build(BuildContext context) {
    final sync = context.watch<AiWorkbenchSyncProvider>();
    final pending =
        sync.pendingMessagesByConversationId[widget.conversationId] ?? const [];
    final summary = sync.debugStateForConversation(widget.conversationId);
    final lines = sync.debugTrail.reversed.take(5).toList(growable: false);
    final sending = sync.isConversationSending(widget.conversationId);

    return Container(
      width: double.infinity,
      decoration: const BoxDecoration(
        color: AppTheme.bgSecondary,
        border: Border(top: BorderSide(color: AppTheme.borderColor)),
      ),
      child: Column(
        children: [
          InkWell(
            onTap: () => setState(() => _expanded = !_expanded),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(12, 6, 12, 6),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      '调试 · pending=${pending.length} sending=$sending',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppTheme.textSecondary,
                        fontSize: 10,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                  Icon(
                    _expanded ? Icons.expand_less : Icons.expand_more,
                    size: 16,
                    color: AppTheme.textSecondary,
                  ),
                ],
              ),
            ),
          ),
          if (_expanded)
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 0, 12, 8),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    summary,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: AppTheme.textTertiary,
                      fontSize: 10,
                      height: 1.3,
                    ),
                  ),
                  if (widget.lastStatus != null &&
                      widget.lastStatus!.isNotEmpty) ...[
                    const SizedBox(height: 4),
                    Text(
                      'lastStatus: ${widget.lastStatus}',
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppTheme.textTertiary,
                        fontSize: 10,
                        height: 1.3,
                      ),
                    ),
                  ],
                  if (lines.isNotEmpty) ...[
                    const SizedBox(height: 4),
                    for (final line in lines)
                      Text(
                        line,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: AppTheme.textTertiary,
                          fontSize: 10,
                          height: 1.25,
                        ),
                      ),
                  ],
                ],
              ),
            ),
        ],
      ),
    );
  }
}

class _MessageBlock extends StatefulWidget {
  const _MessageBlock({required this.message});

  final AiWorkbenchMessage message;

  @override
  State<_MessageBlock> createState() => _MessageBlockState();
}

class _MessageBlockState extends State<_MessageBlock> {
  bool _expanded = false;

  @override
  Widget build(BuildContext context) {
    final message = widget.message;
    final user = message.role == 'user';
    final technical = message.rawType == 'tool' || message.rawType == 'command';
    final pending = message.status == 'pending';
    final queued = message.status == 'queued';
    final failed = message.status == 'failed';
    final maxWidth = MediaQuery.of(context).size.width * (user ? 0.84 : 0.9);
    final previewText = message.previewText?.trimRight();
    final hasExpandablePreview =
        previewText != null &&
        previewText.isNotEmpty &&
        previewText != message.text.trimRight();
    final displayText = _expanded || !hasExpandablePreview
        ? message.text
        : previewText;
    final truncated = message.isTruncated == true;
    final hiddenCharCount = truncated && message.fullTextCharCount != null
        ? message.fullTextCharCount! - message.text.runes.length
        : 0;

    return Align(
      alignment: user ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        constraints: BoxConstraints(maxWidth: maxWidth),
        padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
        decoration: BoxDecoration(
          color: user
              ? AppTheme.brand.withAlpha(pending || queued ? 8 : 14)
              : AppTheme.bgSecondary,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(
            color: failed
                ? AppTheme.statusRed.withAlpha(90)
                : pending || queued
                ? AppTheme.brand.withAlpha(90)
                : technical
                ? AppTheme.statusYellow.withAlpha(90)
                : AppTheme.borderColor,
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Flexible(
                  child: Text(
                    pending
                        ? '发送中'
                        : queued
                        ? '已发送，等待同步'
                        : failed
                        ? '发送失败'
                        : technical
                        ? '技术事件'
                        : message.title,
                    style: TextStyle(
                      color: failed
                          ? AppTheme.statusRed
                          : pending || queued
                          ? AppTheme.brandDark
                          : technical
                          ? const Color(0xFF9A6700)
                          : AppTheme.textSecondary,
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
                if (pending) ...[
                  const SizedBox(width: 6),
                  SizedBox(
                    width: 10,
                    height: 10,
                    child: CircularProgressIndicator(
                      strokeWidth: 1.8,
                      color: AppTheme.brand,
                    ),
                  ),
                ],
              ],
            ),
            const SizedBox(height: 6),
            SelectableText(
              displayText,
              style: const TextStyle(
                color: AppTheme.textPrimary,
                fontSize: 14,
                height: 1.5,
              ),
            ),
            if (hasExpandablePreview || truncated) ...[
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                runSpacing: 6,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  if (hasExpandablePreview)
                    InkWell(
                      onTap: () => setState(() => _expanded = !_expanded),
                      borderRadius: BorderRadius.circular(999),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 2,
                          vertical: 2,
                        ),
                        child: Text(
                          _expanded ? '收起' : '展开全文',
                          style: const TextStyle(
                            color: AppTheme.brandDark,
                            fontSize: 12,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                    ),
                  if (truncated)
                    Text(
                      hiddenCharCount > 0
                          ? '仍有约 $hiddenCharCount 字未同步到移动端'
                          : '完整内容仍以桌面端为准',
                      style: const TextStyle(
                        color: AppTheme.textTertiary,
                        fontSize: 11,
                        height: 1.35,
                      ),
                    ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _MineLayer extends StatelessWidget {
  const _MineLayer();

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(14, 14, 14, 18),
      children: const [
        _MineTile(
          icon: Icons.person_outline,
          title: '账号',
          subtitle: '已连接到本地信令服务',
        ),
        _MineTile(
          icon: Icons.sync,
          title: '同步',
          subtitle: '资产、会话状态和告警将按端到端加密策略同步',
        ),
        _MineTile(icon: Icons.security, title: '安全', subtitle: '高危远程操作需要二次确认'),
        _MineTile(
          icon: Icons.bug_report_outlined,
          title: '调试',
          subtitle: mobileAppVersion,
        ),
      ],
    );
  }
}

class _MineTile extends StatelessWidget {
  const _MineTile({
    required this.icon,
    required this.title,
    required this.subtitle,
  });

  final IconData icon;
  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppTheme.bgSecondary,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppTheme.borderColor),
      ),
      child: Row(
        children: [
          Icon(icon, color: AppTheme.brand, size: 20),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    color: AppTheme.textPrimary,
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 5),
                Text(
                  subtitle,
                  style: const TextStyle(
                    color: AppTheme.textSecondary,
                    fontSize: 12,
                    height: 1.35,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _ToolIcon extends StatelessWidget {
  const _ToolIcon({required this.toolId});

  final String toolId;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 42,
      height: 42,
      decoration: BoxDecoration(
        color: AppTheme.bgPrimary,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppTheme.borderColor),
      ),
      child: Icon(
        toolId == 'terminal' ? Icons.terminal : Icons.smart_toy_outlined,
        color: AppTheme.brand,
        size: 20,
      ),
    );
  }
}

class _StatusPill extends StatelessWidget {
  const _StatusPill({required this.label, required this.color});

  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
      decoration: BoxDecoration(
        color: color.withAlpha(18),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: color.withAlpha(90)),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: color,
          fontSize: 10,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }
}

class _MiniBadge extends StatelessWidget {
  const _MiniBadge({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
      decoration: BoxDecoration(
        color: AppTheme.bgTertiary,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: AppTheme.borderColor),
      ),
      child: Text(
        label,
        style: const TextStyle(color: AppTheme.textSecondary, fontSize: 10),
      ),
    );
  }
}

Color _statusColor(String status) {
  return switch (status) {
    'running' => AppTheme.statusGreen,
    'waitingApproval' => AppTheme.statusYellow,
    'failed' => AppTheme.statusRed,
    _ => AppTheme.statusGray,
  };
}

String _mobileStatus(String status) {
  return switch (status) {
    'running' => '运行中',
    'waitingApproval' => '需确认',
    'failed' => '失败',
    'offline' => '未连接',
    'idle' => '空闲',
    _ => '空闲',
  };
}
