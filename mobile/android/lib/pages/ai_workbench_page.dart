import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../app_version.dart';
import '../models/ai_workbench.dart';
import '../models/event_message.dart';
import '../providers/ai_workbench_sync_provider.dart';
import '../providers/auth_provider.dart';
import '../providers/session_provider.dart';
import '../theme/app_theme.dart';
// Components extracted during refactoring — to be used in build()
// import 'workbench_session_panel.dart';
// import 'workbench_tool_selector.dart';
// import 'workbench_config_panel.dart';

enum _WorkbenchTab { sessions, tools, mine }

const List<String> _serviceTierOptions = <String>['default', 'priority'];
const List<String> _approvalPolicyOptions = <String>[
  'on-request',
  'untrusted',
  'on-failure',
  'never',
];
const List<String> _sandboxModeOptions = <String>[
  'workspace-write',
  'read-only',
  'danger-full-access',
];
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
  _WorkbenchTab _tab = _WorkbenchTab.tools;
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
    final selectedToolSessionCount = _sessionsForTool(_selectedToolId).length;
    final pageTitle = switch (_tab) {
      _WorkbenchTab.sessions => selectedSession?.title ?? 'Codex',
      _WorkbenchTab.tools => selectedTool?.name ?? 'Codex',
      _WorkbenchTab.mine => '我的',
    };
    final pageSubtitle = switch (_tab) {
      _WorkbenchTab.sessions => [
        if (selectedProject?.name.isNotEmpty == true) selectedProject!.name,
        if (selectedTool?.name.isNotEmpty == true) selectedTool!.name,
        if (selectedSession != null) _mobileStatus(selectedSession.status),
      ].join('  ·  '),
      _WorkbenchTab.tools =>
        selectedTool == null
            ? '未连接设备'
            : '${selectedTool.name} · $selectedToolSessionCount 个会话',
      _WorkbenchTab.mine => mobileAppVersion,
    };

    return Scaffold(
      backgroundColor: AppTheme.bgPrimary,
      appBar: _tab == _WorkbenchTab.sessions
          ? null
          : AppBar(
              toolbarHeight: 78,
              titleSpacing: 20,
              title: _tab == _WorkbenchTab.tools
                  ? Text(
                      pageTitle,
                      style: const TextStyle(
                        color: AppTheme.textPrimary,
                        fontSize: 17,
                        fontWeight: FontWeight.w800,
                      ),
                    )
                  : Text(
                      pageSubtitle.isNotEmpty
                          ? '$pageTitle · $pageSubtitle'
                          : pageTitle,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppTheme.textPrimary,
                        fontSize: 16,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
              actions: [
                Padding(
                  padding: const EdgeInsets.only(right: 6),
                  child: _RoundIconButton(
                    tooltip: '刷新',
                    icon: Icons.refresh_rounded,
                    onTap: () async {
                      context.read<AiWorkbenchSyncProvider>().refreshSnapshot();
                      await context.read<SessionProvider>().refreshNow();
                    },
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.only(right: 14),
                  child: _RoundIconButton(
                    tooltip: '更多',
                    icon: Icons.more_vert,
                    onTap: () {
                      setState(() => _tab = _WorkbenchTab.mine);
                    },
                  ),
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
            onRefresh: () async {
              context.read<AiWorkbenchSyncProvider>().refreshSnapshot();
              await context.read<SessionProvider>().refreshNow();
            },
            onSelectProject: _selectProject,
            onSelectSession: _selectSession,
            onSelectedModelChanged: (model) =>
                _setModelForTool(_selectedToolId, model),
            onSelectedServiceTierChanged: (tier) =>
                _setServiceTierForTool(_selectedToolId, tier),
            onSelectedEffortChanged: (effort) =>
                _setEffortForTool(_selectedToolId, effort),
            onBackToTools: () {
              setState(() => _tab = _WorkbenchTab.tools);
            },
          ),
          _ToolLayer(
            snapshot: snapshot,
            selectedToolId: _selectedToolId,
            selectedProjectId: _selectedProjectId,
            selectedSessionId: _selectedSessionId,
            onSelectTool: _selectTool,
            onSelectProject: (projectId) {
              _selectProject(projectId);
              setState(() => _tab = _WorkbenchTab.sessions);
            },
            onSelectSession: (sessionId) {
              _selectSession(sessionId);
              setState(() => _tab = _WorkbenchTab.sessions);
            },
            onOpenSessions: () {
              setState(() => _tab = _WorkbenchTab.sessions);
            },
          ),
          const _MineLayer(),
        ],
      ),
      bottomNavigationBar: _tab == _WorkbenchTab.sessions
          ? null
          : SafeArea(
              top: false,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(14, 0, 14, 12),
                child: _WorkbenchNavBar(
                  tab: _tab,
                  onSelected: (tab) {
                    setState(() => _tab = tab);
                  },
                ),
              ),
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
        selectedSession.projectId != null &&
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
    final selectedSession = toolSessions
        .where((item) => item.id == _selectedSessionId)
        .firstOrNull;
    final selectedSessionProjectId =
        selectedSession?.providerId == selectedToolId
        ? selectedSession?.projectId
        : null;
    final hasUngroupedSessions = toolSessions.any(
      (session) => (session.projectId ?? '').isEmpty,
    );
    final selectedProjectId =
        toolProjects
            .where((item) => item.id == _selectedProjectId)
            .firstOrNull
            ?.id ??
        selectedSessionProjectId ??
        activeProjectId ??
        (hasUngroupedSessions ? '' : null) ??
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
      _selectedProjectId = nextSession?.projectId ?? '';
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
    required this.selectedProjectId,
    required this.selectedSessionId,
    required this.onSelectTool,
    required this.onSelectProject,
    required this.onSelectSession,
    required this.onOpenSessions,
  });

  final AiWorkbenchSnapshot snapshot;
  final String selectedToolId;
  final String selectedProjectId;
  final String selectedSessionId;
  final ValueChanged<String> onSelectTool;
  final ValueChanged<String> onSelectProject;
  final ValueChanged<String> onSelectSession;
  final VoidCallback onOpenSessions;

  @override
  Widget build(BuildContext context) {
    final providers = snapshot.providers.toList(growable: false);
    final selectedTool = providers
        .where((item) => item.id == selectedToolId)
        .firstOrNull;
    if (providers.isEmpty) {
      return const Center(
        child: Text('暂无工具', style: TextStyle(color: AppTheme.textTertiary)),
      );
    }
    final currentTool = selectedTool ?? providers.first;
    final allProjects = snapshot.projects.toList(growable: false)
      ..sort((a, b) {
        final aSelected = a.id == selectedProjectId ? 1 : 0;
        final bSelected = b.id == selectedProjectId ? 1 : 0;
        if (aSelected != bSelected) {
          return bSelected.compareTo(aSelected);
        }
        return (b.updatedAt ?? 0).compareTo(a.updatedAt ?? 0);
      });
    final recentSessions = snapshot.conversations.toList(growable: false)
      ..sort((a, b) {
        final aSelected = a.id == selectedSessionId ? 1 : 0;
        final bSelected = b.id == selectedSessionId ? 1 : 0;
        if (aSelected != bSelected) {
          return bSelected.compareTo(aSelected);
        }
        return (b.updatedAt ?? 0).compareTo(a.updatedAt ?? 0);
      });

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 6, 16, 20),
      children: [
        const _SectionLabel(label: '工具'),
        const SizedBox(height: 12),
        for (final provider in providers) ...[
          WorkbenchToolCard(
            tool: provider,
            projects: snapshot.projects
                .where((project) => project.providerId == provider.id)
                .toList(growable: false),
            sessions: snapshot.conversations
                .where((session) => session.providerId == provider.id)
                .toList(growable: false),
            selected: provider.id == currentTool.id,
            onTap: () => onSelectTool(provider.id),
          ),
          const SizedBox(height: 10),
        ],
        const SizedBox(height: 24),
        const _SectionLabel(label: '项目'),
        const SizedBox(height: 14),
        if (allProjects.isEmpty)
          const _EmptyHint(label: '暂无项目')
        else
          for (final project in allProjects) ...[
            _CodexProjectRow(
              project: project,
              selected: project.id == selectedProjectId,
              toolId: project.providerId,
              onTap: () {
                onSelectTool(project.providerId);
                onSelectProject(project.id);
                onOpenSessions();
              },
            ),
            const SizedBox(height: 14),
          ],
        const SizedBox(height: 18),
        const _SectionLabel(label: '最近'),
        const SizedBox(height: 8),
        if (recentSessions.isEmpty)
          const _EmptyHint(label: '没有更多线程')
        else
          for (final session in recentSessions.take(8)) ...[
            _CodexRecentRow(
              session: session,
              selected: session.id == selectedSessionId,
              onTap: () {
                onSelectTool(session.providerId);
                if ((session.projectId ?? '').isNotEmpty) {
                  onSelectProject(session.projectId!);
                }
                onSelectSession(session.id);
                onOpenSessions();
              },
            ),
            const SizedBox(height: 4),
          ],
      ],
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
    required this.onRefresh,
    required this.onSelectProject,
    required this.onSelectSession,
    required this.onSelectedModelChanged,
    required this.onSelectedServiceTierChanged,
    required this.onSelectedEffortChanged,
    required this.onBackToTools,
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
  final Future<void> Function() onRefresh;
  final ValueChanged<String> onSelectProject;
  final ValueChanged<String> onSelectSession;
  final ValueChanged<String> onSelectedModelChanged;
  final ValueChanged<String> onSelectedServiceTierChanged;
  final ValueChanged<String> onSelectedEffortChanged;
  final VoidCallback onBackToTools;

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
            onRefresh: onRefresh,
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
            onBack: onBackToTools,
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
            onSelectedApprovalPolicyChanged: (policy) async {
              if (tool?.id != 'codex') return;
              await context.read<AiWorkbenchSyncProvider>().updateCodexConfig(
                model: effectiveModel,
                serviceTier: effectiveServiceTier,
                approvalPolicy: policy,
                sandboxMode:
                    snapshot.configsByProviderId[tool!.id]?.sandboxMode,
              );
            },
            onSelectedSandboxModeChanged: (mode) async {
              if (tool?.id != 'codex') return;
              await context.read<AiWorkbenchSyncProvider>().updateCodexConfig(
                model: effectiveModel,
                serviceTier: effectiveServiceTier,
                approvalPolicy:
                    snapshot.configsByProviderId[tool!.id]?.approvalPolicy,
                sandboxMode: mode,
              );
            },
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
      backgroundColor: AppTheme.bgPrimary,
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
        borderRadius: BorderRadius.circular(22),
        child: Container(
          padding: const EdgeInsets.fromLTRB(14, 14, 14, 14),
          decoration: BoxDecoration(
            color: AppTheme.bgSecondary,
            borderRadius: BorderRadius.circular(22),
            border: Border.all(
              color: expanded
                  ? AppTheme.brand.withAlpha(80)
                  : AppTheme.borderColor,
            ),
            boxShadow: const [
              BoxShadow(
                color: AppTheme.shadowColor,
                blurRadius: 18,
                offset: Offset(0, 8),
              ),
            ],
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

class _RoundIconButton extends StatelessWidget {
  const _RoundIconButton({
    required this.tooltip,
    required this.icon,
    required this.onTap,
  });

  final String tooltip;
  final IconData icon;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final background = AppTheme.bgSecondary;
    final foreground = AppTheme.textPrimary;
    return Material(
      color: background,
      borderRadius: BorderRadius.circular(999),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(999),
        child: Tooltip(
          message: tooltip,
          child: Container(
            width: 48,
            height: 48,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(999),
              border: Border.all(color: AppTheme.borderColor),
            ),
            child: Icon(icon, color: foreground, size: 21),
          ),
        ),
      ),
    );
  }
}

class _GhostPill extends StatelessWidget {
  const _GhostPill({required this.label, this.onTap});

  final String label;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppTheme.bgTertiary,
      borderRadius: BorderRadius.circular(999),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(999),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
          decoration: BoxDecoration(borderRadius: BorderRadius.circular(999)),
          child: Text(
            label,
            style: const TextStyle(
              color: AppTheme.textPrimary,
              fontSize: 12,
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
      ),
    );
  }
}

class _WorkbenchNavBar extends StatelessWidget {
  const _WorkbenchNavBar({required this.tab, required this.onSelected});

  final _WorkbenchTab tab;
  final ValueChanged<_WorkbenchTab> onSelected;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
      decoration: BoxDecoration(
        color: AppTheme.bgSecondary,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: AppTheme.borderColor),
      ),
      child: Row(
        children: [
          Expanded(
            child: _WorkbenchNavItem(
              label: '工具',
              icon: Icons.widgets_outlined,
              selected: tab == _WorkbenchTab.tools,
              onTap: () => onSelected(_WorkbenchTab.tools),
            ),
          ),
          Expanded(
            child: _WorkbenchNavItem(
              label: '会话',
              icon: Icons.chat_bubble_outline,
              selected: tab == _WorkbenchTab.sessions,
              onTap: () => onSelected(_WorkbenchTab.sessions),
            ),
          ),
          Expanded(
            child: _WorkbenchNavItem(
              label: '我的',
              icon: Icons.person_outline,
              selected: tab == _WorkbenchTab.mine,
              onTap: () => onSelected(_WorkbenchTab.mine),
            ),
          ),
        ],
      ),
    );
  }
}

class _WorkbenchNavItem extends StatelessWidget {
  const _WorkbenchNavItem({
    required this.label,
    required this.icon,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final IconData icon;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 180),
        curve: Curves.easeOutCubic,
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 10),
        decoration: BoxDecoration(
          color: selected ? AppTheme.brand : Colors.transparent,
          borderRadius: BorderRadius.circular(999),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              icon,
              size: 20,
              color: selected ? Colors.white : AppTheme.textPrimary,
            ),
            const SizedBox(height: 4),
            Text(
              label,
              style: TextStyle(
                color: selected ? Colors.white : AppTheme.textPrimary,
                fontSize: 11,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _DeviceStrip extends StatelessWidget {
  const _DeviceStrip({
    required this.tool,
    required this.project,
    required this.session,
  });

  final AiWorkbenchProvider tool;
  final AiWorkbenchProject? project;
  final AiWorkbenchConversation? session;

  @override
  Widget build(BuildContext context) {
    final label = project?.name ?? tool.name;
    final online = session?.status == 'running' || tool.id == 'codex';
    return Row(
      children: [
        Container(
          width: 8,
          height: 8,
          decoration: BoxDecoration(
            color: online ? AppTheme.statusGreen : AppTheme.statusGray,
            shape: BoxShape.circle,
          ),
        ),
        const SizedBox(width: 10),
        const Icon(Icons.laptop_mac_outlined, size: 20, color: AppTheme.brand),
        const SizedBox(width: 10),
        Expanded(
          child: Text(
            label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              color: AppTheme.textPrimary,
              fontSize: 16,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
      ],
    );
  }
}

class _SectionLabel extends StatelessWidget {
  const _SectionLabel({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Text(
      label,
      style: const TextStyle(
        color: AppTheme.textPrimary,
        fontSize: 18,
        fontWeight: FontWeight.w700,
      ),
    );
  }
}

class _CodexProjectRow extends StatelessWidget {
  const _CodexProjectRow({
    required this.project,
    required this.selected,
    required this.toolId,
    required this.onTap,
  });

  final AiWorkbenchProject project;
  final bool selected;
  final String toolId;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(18),
      child: Row(
        children: [
          Icon(
            selected ? Icons.chat_bubble_outline : Icons.folder_outlined,
            size: 24,
            color: AppTheme.brand,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              project.name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: AppTheme.textPrimary,
                fontSize: 16,
                fontWeight: FontWeight.w500,
              ),
            ),
          ),
          const SizedBox(width: 10),
          _ToolChip(toolId: toolId),
        ],
      ),
    );
  }
}

class _CodexRecentRow extends StatelessWidget {
  const _CodexRecentRow({
    required this.session,
    required this.selected,
    required this.onTap,
  });

  final AiWorkbenchConversation session;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(18),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Row(
          children: [
            Expanded(
              child: Text(
                session.title,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  color: selected ? AppTheme.brand : AppTheme.textPrimary,
                  fontSize: 14.5,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ),
            const SizedBox(width: 8),
            _ToolChip(toolId: session.providerId, source: session.source),
            const SizedBox(width: 8),
            Text(
              _relativeTimeLabel(session.updatedAt),
              style: const TextStyle(
                color: AppTheme.textSecondary,
                fontSize: 12,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _EmptyHint extends StatelessWidget {
  const _EmptyHint({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 14),
      child: Text(
        label,
        style: const TextStyle(color: AppTheme.textSecondary, fontSize: 13),
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
    required this.onRefresh,
    required this.onSendCodexMessage,
    required this.onRespondToCodexApproval,
    required this.onArchiveCodexConversation,
    required this.onBack,
    required this.onShowSessionSheet,
    required this.onSelectedModelChanged,
    required this.onSelectedServiceTierChanged,
    required this.onSelectedEffortChanged,
    required this.onSelectedApprovalPolicyChanged,
    required this.onSelectedSandboxModeChanged,
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
  final Future<void> Function() onRefresh;
  final Future<bool> Function(String text) onSendCodexMessage;
  final Future<bool> Function(bool approved) onRespondToCodexApproval;
  final Future<bool> Function() onArchiveCodexConversation;
  final VoidCallback onBack;
  final VoidCallback onShowSessionSheet;
  final ValueChanged<String> onSelectedModelChanged;
  final ValueChanged<String> onSelectedServiceTierChanged;
  final ValueChanged<String> onSelectedEffortChanged;
  final ValueChanged<String> onSelectedApprovalPolicyChanged;
  final ValueChanged<String> onSelectedSandboxModeChanged;
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
          onBack: onBack,
          onShowSessionSheet: onShowSessionSheet,
          onRefresh: onRefresh,
          onArchiveCodexConversation: onArchiveCodexConversation,
        ),
        Expanded(
          child: tool.id == 'terminal'
              ? TerminalSessionBody(session: session!, messages: messages)
              : CodexSessionBody(messages: messages),
        ),
        SessionStatusStrip(
          tool: tool,
          session: session!,
          statusOverride: lastStatus,
          isSending: tool.id == 'codex' && isSendingCodex,
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
          onSelectedApprovalPolicyChanged: onSelectedApprovalPolicyChanged,
          onSelectedSandboxModeChanged: onSelectedSandboxModeChanged,
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
    required this.onBack,
    required this.onShowSessionSheet,
    required this.onRefresh,
    required this.onArchiveCodexConversation,
  });

  final AiWorkbenchProvider tool;
  final AiWorkbenchProject? project;
  final AiWorkbenchConversation session;
  final VoidCallback onBack;
  final VoidCallback onShowSessionSheet;
  final Future<void> Function() onRefresh;
  final Future<bool> Function() onArchiveCodexConversation;

  @override
  Widget build(BuildContext context) {
    final projectLabel = project?.name ?? tool.name;
    final deviceLabel = tool.id == 'terminal' ? 'Terminal' : 'Lis-PC';

    return SafeArea(
      bottom: false,
      child: Container(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 10),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            _RoundIconButton(
              tooltip: '返回上一级',
              icon: Icons.arrow_back,
              onTap: onBack,
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Material(
                color: Colors.transparent,
                child: InkWell(
                  onTap: onShowSessionSheet,
                  borderRadius: BorderRadius.circular(999),
                  child: Container(
                    padding: const EdgeInsets.fromLTRB(14, 11, 14, 11),
                    decoration: BoxDecoration(
                      color: AppTheme.bgSecondary,
                      borderRadius: BorderRadius.circular(999),
                      border: Border.all(color: AppTheme.borderColor),
                    ),
                    child: Row(
                      children: [
                        Expanded(
                          child: Text(
                            session.title,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: AppTheme.textPrimary,
                              fontSize: 14.5,
                              fontWeight: FontWeight.w800,
                              height: 1.1,
                            ),
                          ),
                        ),
                        const SizedBox(width: 8),
                        Flexible(
                          child: Text(
                            '$projectLabel · $deviceLabel',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            textAlign: TextAlign.right,
                            style: const TextStyle(
                              color: AppTheme.textSecondary,
                              fontSize: 11,
                              fontWeight: FontWeight.w500,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
            const SizedBox(width: 10),
            Container(
              decoration: BoxDecoration(
                color: AppTheme.bgSecondary,
                borderRadius: BorderRadius.circular(999),
                border: Border.all(color: AppTheme.borderColor),
              ),
              child: PopupMenuButton<String>(
                tooltip: '会话操作',
                color: AppTheme.bgPrimary,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(28),
                ),
                onSelected: (value) async {
                  if (value == 'refresh') {
                    await onRefresh();
                    if (!context.mounted) return;
                    ScaffoldMessenger.of(
                      context,
                    ).showSnackBar(const SnackBar(content: Text('已刷新会话状态')));
                    return;
                  }
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
                  PopupMenuItem<String>(value: 'refresh', child: Text('刷新')),
                  PopupMenuItem<String>(
                    value: 'archive',
                    child: Text('归档当前会话'),
                  ),
                ],
                child: const Padding(
                  padding: EdgeInsets.symmetric(horizontal: 14, vertical: 14),
                  child: Icon(
                    Icons.more_vert,
                    size: 19,
                    color: AppTheme.textPrimary,
                  ),
                ),
              ),
            ),
          ],
        ),
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
      color: const Color(0xFF121212),
      child: _AutoScrollMessageList(
        sessionKey: session.id,
        padding: const EdgeInsets.fromLTRB(14, 16, 14, 18),
        itemCount: messages.length,
        separatorHeight: 8,
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
          '没有更多线程',
          style: TextStyle(color: AppTheme.textSecondary, fontSize: 16),
        ),
      );
    }

    return _AutoScrollMessageList(
      sessionKey: messages.first.conversationId ?? 'codex',
      padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
      itemCount: messages.length + 1,
      separatorHeight: 14,
      itemBuilder: (context, index) {
        if (index == 0) {
          return Text(
            '前 ${messages.length} 条消息 ›',
            style: const TextStyle(
              color: AppTheme.textSecondary,
              fontSize: 16,
              fontWeight: FontWeight.w500,
            ),
          );
        }
        return _MessageBlock(message: messages[index - 1]);
      },
    );
  }
}

class _AutoScrollMessageList extends StatefulWidget {
  const _AutoScrollMessageList({
    required this.sessionKey,
    required this.padding,
    required this.itemCount,
    required this.itemBuilder,
    this.separatorHeight = 0,
  });

  final String sessionKey;
  final EdgeInsets padding;
  final int itemCount;
  final IndexedWidgetBuilder itemBuilder;
  final double separatorHeight;

  @override
  State<_AutoScrollMessageList> createState() => _AutoScrollMessageListState();
}

class _AutoScrollMessageListState extends State<_AutoScrollMessageList> {
  late final ScrollController _controller;
  bool _stickToBottom = true;

  @override
  void initState() {
    super.initState();
    _controller = ScrollController()..addListener(_handleScroll);
    WidgetsBinding.instance.addPostFrameCallback((_) => _jumpToBottom());
  }

  @override
  void didUpdateWidget(covariant _AutoScrollMessageList oldWidget) {
    super.didUpdateWidget(oldWidget);
    final sessionChanged = oldWidget.sessionKey != widget.sessionKey;
    final grew = widget.itemCount > oldWidget.itemCount;
    if (sessionChanged || (grew && _stickToBottom)) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _jumpToBottom());
    }
  }

  @override
  void dispose() {
    _controller
      ..removeListener(_handleScroll)
      ..dispose();
    super.dispose();
  }

  void _handleScroll() {
    if (!_controller.hasClients) return;
    final position = _controller.position;
    final nextStick = position.maxScrollExtent - position.pixels <= 96;
    if (nextStick != _stickToBottom && mounted) {
      setState(() {
        _stickToBottom = nextStick;
      });
    }
  }

  void _jumpToBottom({bool animated = false}) {
    if (!_controller.hasClients) return;
    final target = _controller.position.maxScrollExtent;
    if (animated) {
      _controller.animateTo(
        target,
        duration: const Duration(milliseconds: 220),
        curve: Curves.easeOutCubic,
      );
      return;
    }
    _controller.jumpTo(target);
  }

  void _jumpToTop() {
    if (!_controller.hasClients) return;
    _controller.animateTo(
      0,
      duration: const Duration(milliseconds: 220),
      curve: Curves.easeOutCubic,
    );
  }

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        ListView.separated(
          controller: _controller,
          padding: widget.padding,
          itemCount: widget.itemCount,
          separatorBuilder: (_, _) => SizedBox(height: widget.separatorHeight),
          itemBuilder: widget.itemBuilder,
        ),
        Positioned(
          right: 10,
          bottom: 10,
          child: Column(
            children: [
              _ScrollJumpButton(
                icon: Icons.vertical_align_top,
                tooltip: '到顶部',
                onTap: _jumpToTop,
              ),
              const SizedBox(height: 8),
              _ScrollJumpButton(
                icon: Icons.vertical_align_bottom,
                tooltip: '到底部',
                onTap: () => _jumpToBottom(animated: true),
                highlighted: !_stickToBottom,
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _ScrollJumpButton extends StatelessWidget {
  const _ScrollJumpButton({
    required this.icon,
    required this.tooltip,
    required this.onTap,
    this.highlighted = false,
  });

  final IconData icon;
  final String tooltip;
  final VoidCallback onTap;
  final bool highlighted;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: highlighted ? AppTheme.brand.withAlpha(230) : AppTheme.bgPrimary,
      borderRadius: BorderRadius.circular(10),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(10),
        child: Tooltip(
          message: tooltip,
          child: Container(
            width: 32,
            height: 32,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(10),
              border: Border.all(
                color: highlighted ? AppTheme.brand : AppTheme.borderColor,
              ),
              boxShadow: const [
                BoxShadow(
                  color: Color(0x140F172A),
                  blurRadius: 12,
                  offset: Offset(0, 4),
                ),
              ],
            ),
            child: Icon(
              icon,
              size: 16,
              color: highlighted ? Colors.white : AppTheme.textSecondary,
            ),
          ),
        ),
      ),
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
      margin: const EdgeInsets.fromLTRB(12, 0, 12, 6),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
      decoration: BoxDecoration(
        color: AppTheme.bgSecondary,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppTheme.borderColor),
      ),
      child: Text(
        text,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: const TextStyle(
          color: AppTheme.textSecondary,
          fontSize: 10.5,
          fontWeight: FontWeight.w500,
        ),
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
    required this.onSelectedApprovalPolicyChanged,
    required this.onSelectedSandboxModeChanged,
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
  final ValueChanged<String> onSelectedApprovalPolicyChanged;
  final ValueChanged<String> onSelectedSandboxModeChanged;
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
    final placeholder = terminal ? '输入命令...' : '向 Codex 提问';
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
    final currentApprovalPolicy =
        widget.config?.approvalPolicy?.trim().isNotEmpty == true
        ? widget.config!.approvalPolicy!.trim()
        : 'on-request';
    final currentSandboxMode =
        widget.config?.sandboxMode?.trim().isNotEmpty == true
        ? widget.config!.sandboxMode!.trim()
        : 'workspace-write';
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
        padding: const EdgeInsets.fromLTRB(16, 2, 16, 8),
        decoration: const BoxDecoration(color: AppTheme.bgPrimary),
        child: Column(
          children: [
            if (!terminal)
              SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.only(bottom: 6),
                child: Row(
                  children: [
                    _GhostPill(
                      label: _modelChipLabel(currentModel),
                      onTap: () => _showSimplePicker(
                        title: '模型',
                        currentValue: currentModel,
                        options: widget.models
                            .map((item) => item.id)
                            .toList(growable: false),
                        labelBuilder: _modelMenuLabel,
                        onSelected: widget.onSelectedModelChanged,
                      ),
                    ),
                    const SizedBox(width: 8),
                    _GhostPill(
                      label: _effortChipLabel(currentEffort),
                      onTap: () => _showSimplePicker(
                        title: '智能',
                        currentValue: currentEffort,
                        options: visibleEfforts,
                        labelBuilder: _effortMenuLabel,
                        onSelected: widget.onSelectedEffortChanged,
                      ),
                    ),
                    const SizedBox(width: 8),
                    _GhostPill(
                      label: _permissionChipLabel(
                        currentApprovalPolicy,
                        currentSandboxMode,
                      ),
                      onTap: () => _showPermissionPicker(
                        currentApprovalPolicy: currentApprovalPolicy,
                        currentSandboxMode: currentSandboxMode,
                      ),
                    ),
                  ],
                ),
              ),
            Container(
              padding: const EdgeInsets.fromLTRB(10, 8, 10, 8),
              decoration: BoxDecoration(
                color: AppTheme.bgSecondary,
                borderRadius: BorderRadius.circular(999),
                border: Border.all(color: AppTheme.borderColor),
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  _RoundIconButton(
                    tooltip: '更多能力',
                    icon: Icons.add,
                    onTap: () => _openComposerMenu(
                      context,
                      branch: branch,
                      currentModel: currentModel,
                      currentServiceTier: currentServiceTier,
                      currentEffort: currentEffort,
                      visibleEfforts: visibleEfforts,
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: TextField(
                      controller: _controller,
                      minLines: 1,
                      maxLines: 5,
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
                        enabledBorder: InputBorder.none,
                        focusedBorder: InputBorder.none,
                        filled: false,
                        contentPadding: const EdgeInsets.symmetric(
                          horizontal: 4,
                          vertical: 12,
                        ),
                      ),
                      style: const TextStyle(
                        color: AppTheme.textPrimary,
                        fontSize: 14,
                        height: 1.35,
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  InkWell(
                    onTap: widget.isSending ? null : _submit,
                    borderRadius: BorderRadius.circular(999),
                    child: Container(
                      width: 40,
                      height: 40,
                      alignment: Alignment.center,
                      child: Icon(
                        widget.isSending
                            ? Icons.hourglass_top
                            : terminal
                            ? Icons.keyboard_return
                            : Icons.mic_none_rounded,
                        size: 24,
                        color: widget.isSending
                            ? AppTheme.textTertiary
                            : AppTheme.textSecondary,
                      ),
                    ),
                  ),
                ],
              ),
            ),
            if (_showDetails) ...[
              const SizedBox(height: 8),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
                decoration: BoxDecoration(
                  color: AppTheme.bgTertiary,
                  borderRadius: BorderRadius.circular(28),
                  border: Border.all(color: AppTheme.borderColor),
                ),
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
                      value: widget.config?.sandboxMode ?? 'workspace-write',
                    ),
                    const SizedBox(height: 4),
                    _DetailLine(label: '会话', value: '${widget.sessionCount} 个'),
                    const SizedBox(height: 4),
                    _DetailLine(
                      label: '确认',
                      value: widget.config?.approvalPolicy ?? 'on-request',
                    ),
                    const SizedBox(height: 4),
                    _DetailLine(
                      label: '状态',
                      value: _mobileStatus(widget.session.status),
                    ),
                    if (widget.statusHint != null &&
                        widget.statusHint!.trim().isNotEmpty) ...[
                      const SizedBox(height: 4),
                      _DetailLine(label: '同步', value: widget.statusHint!),
                    ],
                  ],
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  String _modelChipLabel(String value) {
    final simplified = value.toUpperCase().replaceAll('-LATEST', '');
    if (simplified.startsWith('GPT-5.4')) {
      return 'GPT-5.4';
    }
    return simplified;
  }

  String _modelMenuLabel(String value) {
    final label = widget.models
        .where((item) => item.id == value)
        .firstOrNull
        ?.label
        .trim();
    return label != null && label.isNotEmpty ? label : value;
  }

  String _effortChipLabel(String value) {
    return switch (value) {
      'minimal' => '智能 低',
      'low' => '智能 低',
      'medium' => '智能 中',
      'high' => '智能 高',
      'xhigh' => '智能 极高',
      _ => '智能 $value',
    };
  }

  String _permissionChipLabel(String approvalPolicy, String sandboxMode) {
    return switch (sandboxMode) {
      'danger-full-access' => '完全访问权限',
      'read-only' => '只读权限',
      'workspace-write' => approvalPolicy == 'never' ? '默认权限' : '工作区写入',
      _ => sandboxMode,
    };
  }

  Future<void> _openComposerMenu(
    BuildContext context, {
    required String branch,
    required String currentModel,
    required String currentServiceTier,
    required String currentEffort,
    required List<String> visibleEfforts,
  }) async {
    await showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      backgroundColor: AppTheme.bgPrimary,
      builder: (context) {
        return SafeArea(
          top: false,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(22, 8, 22, 24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _ComposerMenuItem(
                  icon: Icons.image_outlined,
                  title: '上传图片',
                  subtitle: '暂未接入，保留 Codex 风格入口',
                  onTap: () {
                    Navigator.pop(context);
                    if (this.context.mounted) {
                      ScaffoldMessenger.of(
                        this.context,
                      ).showSnackBar(const SnackBar(content: Text('图片上传即将推出')));
                    }
                  },
                ),
                _ComposerMenuItem(
                  icon: Icons.checklist_rounded,
                  title: '计划模式',
                  subtitle: '切换到项目 / 会话 / 参数设置',
                  onTap: () {
                    Navigator.pop(context);
                    setState(() => _showDetails = true);
                    widget.onShowSessionSheet();
                  },
                ),
                const SizedBox(height: 10),
                const Divider(height: 1, color: AppTheme.borderColor),
                const SizedBox(height: 12),
                _ComposerSelectorLine(
                  label: '模型',
                  value: currentModel,
                  onTap: () async {
                    Navigator.pop(context);
                    await _showSimplePicker(
                      title: '模型',
                      currentValue: currentModel,
                      options: widget.models
                          .map((item) => item.id)
                          .toList(growable: false),
                      labelBuilder: _modelMenuLabel,
                      onSelected: widget.onSelectedModelChanged,
                    );
                  },
                ),
                _ComposerSelectorLine(
                  label: '速度',
                  value: currentServiceTier,
                  onTap: () async {
                    Navigator.pop(context);
                    await _showSimplePicker(
                      title: '速度',
                      currentValue: currentServiceTier,
                      options: _serviceTierOptions,
                      onSelected: widget.onSelectedServiceTierChanged,
                    );
                  },
                ),
                _ComposerSelectorLine(
                  label: '智能',
                  value: _effortMenuLabel(currentEffort),
                  onTap: () async {
                    Navigator.pop(context);
                    await _showSimplePicker(
                      title: '智能',
                      currentValue: currentEffort,
                      options: visibleEfforts,
                      labelBuilder: _effortMenuLabel,
                      onSelected: widget.onSelectedEffortChanged,
                    );
                  },
                ),
                if ((widget.project?.branches.length ?? 0) > 0)
                  _ComposerSelectorLine(
                    label: '分支',
                    value: branch,
                    onTap: () async {
                      Navigator.pop(context);
                      await _showSimplePicker(
                        title: '分支',
                        currentValue: branch,
                        options: widget.project?.branches ?? const [],
                        onSelected: (value) {
                          if (value == branch) return;
                          unawaited(widget.onSwitchProjectBranch(value));
                        },
                      );
                    },
                  ),
              ],
            ),
          ),
        );
      },
    );
  }

  String _effortMenuLabel(String value) {
    return switch (value) {
      'minimal' => '低',
      'low' => '低',
      'medium' => '中',
      'high' => '高',
      'xhigh' => '极高',
      _ => value,
    };
  }

  String _sandboxModeMenuLabel(String value) {
    return switch (value) {
      'workspace-write' => '工作区写入',
      'read-only' => '只读',
      'danger-full-access' => '完全访问权限',
      _ => value,
    };
  }

  String _approvalPolicyMenuLabel(String value) {
    return switch (value) {
      'on-request' => '请求时确认',
      'untrusted' => '不可信时确认',
      'on-failure' => '失败时确认',
      'never' => '从不确认',
      _ => value,
    };
  }

  Future<void> _showPermissionPicker({
    required String currentApprovalPolicy,
    required String currentSandboxMode,
  }) async {
    await showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      backgroundColor: AppTheme.bgPrimary,
      builder: (context) {
        return SafeArea(
          top: false,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(22, 10, 22, 24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  '权限',
                  style: TextStyle(color: AppTheme.textSecondary, fontSize: 14),
                ),
                const SizedBox(height: 10),
                _ComposerSelectorLine(
                  label: '访问范围',
                  value: _sandboxModeMenuLabel(currentSandboxMode),
                  onTap: () async {
                    Navigator.pop(context);
                    await _showSimplePicker(
                      title: '访问范围',
                      currentValue: currentSandboxMode,
                      options: _sandboxModeOptions,
                      labelBuilder: _sandboxModeMenuLabel,
                      onSelected: widget.onSelectedSandboxModeChanged,
                    );
                  },
                ),
                _ComposerSelectorLine(
                  label: '确认策略',
                  value: _approvalPolicyMenuLabel(currentApprovalPolicy),
                  onTap: () async {
                    Navigator.pop(context);
                    await _showSimplePicker(
                      title: '确认策略',
                      currentValue: currentApprovalPolicy,
                      options: _approvalPolicyOptions,
                      labelBuilder: _approvalPolicyMenuLabel,
                      onSelected: widget.onSelectedApprovalPolicyChanged,
                    );
                  },
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  Future<void> _showSimplePicker({
    required String title,
    required String currentValue,
    required List<String> options,
    required ValueChanged<String> onSelected,
    String Function(String value)? labelBuilder,
  }) async {
    if (options.isEmpty) {
      return;
    }
    await showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      backgroundColor: AppTheme.bgPrimary,
      builder: (context) {
        return SafeArea(
          top: false,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(22, 10, 22, 24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    color: AppTheme.textSecondary,
                    fontSize: 14,
                  ),
                ),
                const SizedBox(height: 10),
                for (final option in options)
                  InkWell(
                    onTap: () {
                      onSelected(option);
                      Navigator.pop(context);
                    },
                    child: Padding(
                      padding: const EdgeInsets.symmetric(vertical: 16),
                      child: Row(
                        children: [
                          Expanded(
                            child: Text(
                              labelBuilder?.call(option) ?? option,
                              style: const TextStyle(
                                color: AppTheme.textPrimary,
                                fontSize: 18,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ),
                          if (option == currentValue)
                            const Icon(
                              Icons.check,
                              size: 22,
                              color: AppTheme.brand,
                            ),
                        ],
                      ),
                    ),
                  ),
              ],
            ),
          ),
        );
      },
    );
  }
}

class _ComposerMenuItem extends StatelessWidget {
  const _ComposerMenuItem({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(20),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 10),
        child: Row(
          children: [
            Icon(icon, size: 24, color: AppTheme.brand),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: const TextStyle(
                      color: AppTheme.textPrimary,
                      fontSize: 18,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    subtitle,
                    style: const TextStyle(
                      color: AppTheme.textSecondary,
                      fontSize: 13,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ComposerSelectorLine extends StatelessWidget {
  const _ComposerSelectorLine({
    required this.label,
    required this.value,
    required this.onTap,
  });

  final String label;
  final String value;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(18),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 14),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    label,
                    style: const TextStyle(
                      color: AppTheme.textPrimary,
                      fontSize: 15,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    value,
                    style: const TextStyle(
                      color: AppTheme.textSecondary,
                      fontSize: 14,
                    ),
                  ),
                ],
              ),
            ),
            const Icon(
              Icons.chevron_right_rounded,
              size: 24,
              color: AppTheme.textPrimary,
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
    final imageUrls = message.imageUrls;
    final truncated = message.isTruncated == true;
    final hiddenCharCount = truncated && message.fullTextCharCount != null
        ? message.fullTextCharCount! - message.text.runes.length
        : 0;
    final hasDisplayText = displayText.trim().isNotEmpty;

    final roleLabel = pending
        ? '发送中'
        : queued
        ? '已发送'
        : failed
        ? '发送失败'
        : technical
        ? '技术事件'
        : user
        ? '你'
        : message.title;
    final containerColor = user
        ? const Color(0xFFF5F5F5)
        : technical
        ? const Color(0xFFFFFBEB)
        : Colors.transparent;
    final borderColor = failed
        ? AppTheme.statusRed.withAlpha(90)
        : pending || queued
        ? AppTheme.borderColor
        : technical
        ? AppTheme.statusYellow.withAlpha(80)
        : user
        ? AppTheme.borderColor
        : Colors.transparent;

    return Align(
      alignment: user ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        constraints: BoxConstraints(
          maxWidth: user ? maxWidth : double.infinity,
        ),
        padding: user
            ? const EdgeInsets.fromLTRB(18, 14, 18, 14)
            : const EdgeInsets.fromLTRB(0, 2, 0, 2),
        decoration: BoxDecoration(
          color: containerColor,
          borderRadius: BorderRadius.circular(user || technical ? 28 : 0),
          border: Border.all(color: borderColor),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (!user || technical || pending || queued || failed)
              Padding(
                padding: EdgeInsets.only(
                  left: user ? 0 : 2,
                  right: 0,
                  bottom: hasDisplayText || imageUrls.isNotEmpty ? 8 : 0,
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Flexible(
                      child: Text(
                        roleLabel,
                        style: TextStyle(
                          color: failed
                              ? AppTheme.statusRed
                              : user
                              ? AppTheme.textSecondary
                              : technical
                              ? const Color(0xFF9A6700)
                              : const Color(0xFF22C55E),
                          fontSize: 12,
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
              ),
            if (imageUrls.isNotEmpty) ...[
              for (final imageUrl in imageUrls) ...[
                _InlineMessageImage(imageUrl: imageUrl),
                if (imageUrl != imageUrls.last) const SizedBox(height: 8),
              ],
              if (hasDisplayText) const SizedBox(height: 8),
            ],
            if (hasDisplayText)
              SelectableText(
                displayText,
                style: TextStyle(
                  color: AppTheme.textPrimary,
                  fontSize: user ? 15 : 15.5,
                  height: user ? 1.55 : 1.68,
                  fontWeight: user ? FontWeight.w500 : FontWeight.w400,
                ),
              ),
            if (!hasDisplayText && imageUrls.isEmpty)
              const Text(
                '(empty)',
                style: TextStyle(
                  color: AppTheme.textTertiary,
                  fontSize: 13,
                  fontStyle: FontStyle.italic,
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
                            color: AppTheme.textSecondary,
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

class _InlineMessageImage extends StatelessWidget {
  const _InlineMessageImage({required this.imageUrl});

  final String imageUrl;

  @override
  Widget build(BuildContext context) {
    final provider = _imageProviderFor(imageUrl);
    if (provider == null) {
      return Container(
        width: double.infinity,
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(
          color: AppTheme.bgPrimary,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: AppTheme.borderColor),
        ),
        child: SelectableText(
          imageUrl,
          style: const TextStyle(
            color: AppTheme.textSecondary,
            fontSize: 12,
            height: 1.4,
          ),
        ),
      );
    }

    return ClipRRect(
      borderRadius: BorderRadius.circular(12),
      child: Container(
        constraints: const BoxConstraints(maxHeight: 280),
        decoration: BoxDecoration(
          color: AppTheme.bgPrimary,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: AppTheme.borderColor),
        ),
        child: Image(
          image: provider,
          fit: BoxFit.cover,
          errorBuilder: (_, error, stackTrace) => Container(
            width: double.infinity,
            padding: const EdgeInsets.all(12),
            color: AppTheme.bgPrimary,
            child: const Text(
              '图片加载失败',
              style: TextStyle(color: AppTheme.textSecondary, fontSize: 12),
            ),
          ),
        ),
      ),
    );
  }
}

ImageProvider<Object>? _imageProviderFor(String imageUrl) {
  final trimmed = imageUrl.trim();
  if (trimmed.isEmpty) {
    return null;
  }
  if (trimmed.startsWith('data:image/')) {
    try {
      final data = UriData.parse(trimmed);
      return MemoryImage(data.contentAsBytes());
    } catch (_) {
      final marker = trimmed.indexOf('base64,');
      if (marker <= 0) return null;
      try {
        return MemoryImage(base64Decode(trimmed.substring(marker + 7)));
      } catch (_) {
        return null;
      }
    }
  }
  final uri = Uri.tryParse(trimmed);
  if (uri == null || (!uri.hasScheme)) {
    return null;
  }
  return NetworkImage(trimmed);
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
      child: Icon(_toolGlyph(toolId, null), color: AppTheme.brand, size: 20),
    );
  }
}

class _ToolChip extends StatelessWidget {
  const _ToolChip({required this.toolId, this.source});

  final String toolId;
  final String? source;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 34,
      height: 34,
      decoration: BoxDecoration(
        color: AppTheme.bgSecondary,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppTheme.borderColor),
      ),
      child: Icon(
        _toolGlyph(toolId, source),
        color: AppTheme.textSecondary,
        size: 17,
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

IconData _toolGlyph(String toolId, String? source) {
  // Keep this mapper aligned with docs/tool-icon-registry.md.
  // We intentionally prefer neutral glyphs over "close enough" fake brand logos
  // until an approved official asset is imported into the app bundle.
  final normalized = '${toolId.toLowerCase()} ${source?.toLowerCase() ?? ''}';
  if (normalized.contains('terminal') ||
      normalized.contains('powershell') ||
      normalized.contains('bash') ||
      normalized.contains('zsh') ||
      normalized.contains('cmd')) {
    return Icons.terminal;
  }
  if (normalized.contains('claude')) {
    return Icons.psychology_outlined;
  }
  if (normalized.contains('gemini')) {
    return Icons.auto_awesome_outlined;
  }
  if (normalized.contains('aider')) {
    return Icons.assistant_outlined;
  }
  if (normalized.contains('cursor')) {
    return Icons.change_history_outlined;
  }
  if (normalized.contains('vscode') || normalized.contains('visual studio')) {
    return Icons.code;
  }
  if (normalized.contains('windsurf')) {
    return Icons.air_rounded;
  }
  if (normalized.contains('zed')) {
    return Icons.bolt_outlined;
  }
  if (normalized.contains('jetbrains') ||
      normalized.contains('idea') ||
      normalized.contains('android studio')) {
    return Icons.developer_mode_outlined;
  }
  if (normalized.contains('xcode')) {
    return Icons.phone_iphone_outlined;
  }
  if (normalized.contains('codex')) {
    return Icons.smart_toy_outlined;
  }
  return Icons.extension_outlined;
}

String _relativeTimeLabel(int? timestamp) {
  if (timestamp == null || timestamp <= 0) {
    return '刚刚';
  }
  final normalizedTimestamp = timestamp < 1000000000000
      ? timestamp * 1000
      : timestamp;
  final time = DateTime.fromMillisecondsSinceEpoch(normalizedTimestamp);
  final now = DateTime.now();
  if (time.isAfter(now)) {
    return '刚刚';
  }
  final diff = now.difference(time);
  if (diff.inMinutes < 1) {
    return '刚刚';
  }
  if (diff.inHours < 1) {
    return '${diff.inMinutes}分';
  }
  if (diff.inDays < 1) {
    return '${diff.inHours}小时';
  }
  if (diff.inDays < 30) {
    return '${diff.inDays}天';
  }
  final months = (diff.inDays / 30).floor();
  if (months < 12) {
    return '${months}月';
  }
  return '${(diff.inDays / 365).floor()}年';
}
