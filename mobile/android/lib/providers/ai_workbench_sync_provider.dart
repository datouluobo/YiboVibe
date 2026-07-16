import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../models/ai_workbench.dart';
import '../models/event_message.dart';
import '../services/signal_client.dart';
import 'auth_provider.dart';

class AiWorkbenchSyncProvider extends ChangeNotifier {
  static const Duration _preferredSenderFreshness = Duration(seconds: 45);

  AiWorkbenchSyncProvider(this._auth) {
    unawaited(_restoreCachedSnapshot());
    _eventSub = _signal.events.listen(_onEvent);
    _connSub = _signal.connectionState.listen((connected) {
      _isConnected = connected;
      if (connected) {
        _setStatus('mobile sync channel connected');
        _startBackgroundRefresh();
        _signal.requestWorkbenchSnapshot();
        _ensureSnapshotTimeout();
      } else {
        _setStatus('mobile sync channel disconnected');
        _snapshotTimeoutTimer?.cancel();
        _snapshotTimeoutTimer = null;
        _backgroundRefreshTimer?.cancel();
        _backgroundRefreshTimer = null;
        _preferredWorkbenchSenderDevice = null;
        _announcedThreadCountBySender.clear();
        _lastWorkbenchSignalAtBySender.clear();
      }
      notifyListeners();
    });
    syncWithAuth();
  }

  final SignalClient _signal = SignalClient();
  AuthProvider _auth;
  StreamSubscription<EventMessage>? _eventSub;
  StreamSubscription<bool>? _connSub;
  Timer? _snapshotTimeoutTimer;
  Timer? _backgroundRefreshTimer;
  static const _cachedCodexSnapshotKey =
      'ai_workbench_cached_codex_snapshot_v1';

  AiWorkbenchSnapshot? _snapshot;
  final Map<String, List<AiWorkbenchMessage>> _pendingMessagesByConversationId =
      <String, List<AiWorkbenchMessage>>{};
  final Set<String> _sendingConversationIds = <String>{};
  final Map<String, int> _announcedThreadCountBySender = <String, int>{};
  final Map<String, DateTime> _lastWorkbenchSignalAtBySender =
      <String, DateTime>{};
  bool _isConnected = false;
  String? _error;
  String? _lastAuthKey;
  String? _lastStatus;
  DateTime? _lastStatusAt;
  String? _preferredWorkbenchSenderDevice;
  final List<String> _statusTrail = <String>[];
  final List<String> _debugTrail = <String>[];

  AiWorkbenchSnapshot? get snapshot => _snapshot;
  bool get isConnected => _isConnected;
  String? get error => _error;
  String? get lastStatus => _lastStatus;
  DateTime? get lastStatusAt => _lastStatusAt;
  List<String> get statusTrail => List.unmodifiable(_statusTrail);
  List<String> get debugTrail => List.unmodifiable(_debugTrail);
  Map<String, List<AiWorkbenchMessage>> get pendingMessagesByConversationId =>
      Map.unmodifiable(_pendingMessagesByConversationId);
  bool isConversationSending(String conversationId) =>
      _sendingConversationIds.contains(conversationId);
  String debugStateForConversation(String conversationId) {
    final pending =
        _pendingMessagesByConversationId[conversationId] ?? const [];
    final statuses = pending.map((item) => item.status ?? 'none').join(',');
    return 'conversation=$conversationId sending=${_sendingConversationIds.contains(conversationId)} pending=${pending.length} statuses=[$statuses]';
  }

  void refreshSnapshot() {
    if (!_signal.isConnected) {
      syncWithAuth();
      return;
    }
    _error = null;
    _resetPreferredSnapshotSender(keepSenderStats: true);
    _setStatus('mobile requested fresh workbench snapshot');
    _signal.requestWorkbenchSnapshot();
    _ensureSnapshotTimeout();
    notifyListeners();
  }

  Future<bool> sendCodexMessage({
    required String conversationId,
    required String text,
    String? cwd,
    String? model,
    String? effort,
    String? serviceTier,
    String? approvalPolicy,
    String? sandboxMode,
  }) async {
    final trimmed = text.trim();
    if (conversationId.isEmpty || trimmed.isEmpty) {
      _debugLog('send skipped because conversation/text was empty');
      return false;
    }
    if (!_signal.isConnected) {
      _error = '移动端同步通道未连接';
      _setStatus('mobile codex send blocked because sync channel is offline');
      _debugLog('send blocked because websocket was offline');
      syncWithAuth();
      notifyListeners();
      return false;
    }

    final sent = _signal.sendCodexTurnStart(
      conversationId: conversationId,
      text: trimmed,
      cwd: cwd,
      model: model,
      effort: effort,
      serviceTier: serviceTier,
      approvalPolicy: approvalPolicy,
      sandboxMode: sandboxMode,
    );
    if (!sent) {
      _error = 'Codex 消息发送失败';
      _setStatus('mobile codex send failed before websocket dispatch');
      _debugLog('send failed before websocket dispatch');
      notifyListeners();
      return false;
    }

    _appendPendingMessage(conversationId, trimmed);
    _sendingConversationIds.add(conversationId);
    _debugLog(
      'send accepted by websocket | ${debugStateForConversation(conversationId)}',
    );
    _error = null;
    _setStatus('mobile sent codex message');
    _signal.requestWorkbenchSnapshot();
    _ensureSnapshotTimeout();
    notifyListeners();
    Future<void>.delayed(const Duration(seconds: 10), () {
      _expirePendingConversationIfStalled(conversationId);
    });
    return true;
  }

  Future<bool> respondToCodexApproval({
    required String conversationId,
    required String requestId,
    required String approvalId,
    required String kind,
    required bool approved,
    String? cwd,
    String? model,
    String? effort,
    String? serviceTier,
    String? approvalPolicy,
    String? sandboxMode,
  }) async {
    if (conversationId.isEmpty || requestId.isEmpty) {
      _debugLog(
        'approval response skipped because conversation/approval was empty',
      );
      return false;
    }
    if (!_signal.isConnected) {
      _error = '移动端同步通道未连接';
      _setStatus(
        'mobile approval response blocked because sync channel is offline',
      );
      syncWithAuth();
      notifyListeners();
      return false;
    }

    final sent = _signal.sendCodexApprovalDecision(
      conversationId: conversationId,
      requestId: requestId,
      approvalId: approvalId,
      approved: approved,
      kind: kind,
      cwd: cwd,
      model: model,
      effort: effort,
      serviceTier: serviceTier,
      approvalPolicy: approvalPolicy,
      sandboxMode: sandboxMode,
    );
    if (!sent) {
      _error = '确认动作发送失败';
      _setStatus('mobile approval response failed before websocket dispatch');
      notifyListeners();
      return false;
    }

    _error = null;
    _setStatus(
      approved
          ? 'mobile sent codex approval accept'
          : 'mobile sent codex approval reject',
    );
    _debugLog(
      'approval response dispatched | conversation=$conversationId request=$requestId approval=$approvalId approved=$approved kind=$kind',
    );
    _signal.requestWorkbenchSnapshot();
    _ensureSnapshotTimeout();
    notifyListeners();
    return true;
  }

  Future<bool> archiveCodexConversation({
    required String conversationId,
  }) async {
    if (conversationId.isEmpty) {
      _debugLog('archive skipped because conversation was empty');
      return false;
    }
    if (!_signal.isConnected) {
      _error = '移动端同步通道未连接';
      _setStatus('mobile archive blocked because sync channel is offline');
      syncWithAuth();
      notifyListeners();
      return false;
    }

    final sent = _signal.sendCodexArchiveConversation(
      conversationId: conversationId,
    );
    if (!sent) {
      _error = '归档请求发送失败';
      _setStatus('mobile archive failed before websocket dispatch');
      notifyListeners();
      return false;
    }

    _error = null;
    _setStatus('mobile requested codex archive');
    _debugLog('archive dispatched | conversation=$conversationId');
    _signal.requestWorkbenchSnapshot();
    _ensureSnapshotTimeout();
    notifyListeners();
    return true;
  }

  Future<bool> updateCodexConfig({
    String? model,
    String? serviceTier,
    String? approvalPolicy,
    String? sandboxMode,
  }) async {
    if (!_signal.isConnected) {
      _error = '移动端同步通道未连接';
      _setStatus(
        'mobile config update blocked because sync channel is offline',
      );
      syncWithAuth();
      notifyListeners();
      return false;
    }
    final sent = _signal.sendCodexConfigUpdate(
      model: model,
      serviceTier: serviceTier,
      approvalPolicy: approvalPolicy,
      sandboxMode: sandboxMode,
    );
    if (!sent) {
      _error = '配置更新发送失败';
      _setStatus('mobile config update failed before websocket dispatch');
      notifyListeners();
      return false;
    }
    _optimisticallyUpdateCodexConfig(
      model: model,
      serviceTier: serviceTier,
      approvalPolicy: approvalPolicy,
      sandboxMode: sandboxMode,
    );
    _error = null;
    _setStatus('mobile requested codex config update');
    _signal.requestWorkbenchSnapshot();
    _ensureSnapshotTimeout();
    notifyListeners();
    return true;
  }

  Future<bool> switchCodexProjectBranch({
    required String cwd,
    required String branch,
  }) async {
    if (cwd.trim().isEmpty || branch.trim().isEmpty) {
      return false;
    }
    if (!_signal.isConnected) {
      _error = '移动端同步通道未连接';
      _setStatus(
        'mobile branch switch blocked because sync channel is offline',
      );
      syncWithAuth();
      notifyListeners();
      return false;
    }
    final sent = _signal.sendCodexBranchSwitch(cwd: cwd, branch: branch);
    if (!sent) {
      _error = '分支切换发送失败';
      _setStatus('mobile branch switch failed before websocket dispatch');
      notifyListeners();
      return false;
    }
    _optimisticallySwitchProjectBranch(cwd: cwd, branch: branch);
    _error = null;
    _setStatus('mobile requested git branch switch');
    _signal.requestWorkbenchSnapshot();
    _ensureSnapshotTimeout();
    notifyListeners();
    return true;
  }

  void updateAuth(AuthProvider auth) {
    _auth = auth;
    syncWithAuth();
  }

  void syncWithAuth() {
    final serverUrl = _auth.serverUrl;
    final token = _auth.token;
    if (serverUrl == null ||
        serverUrl.isEmpty ||
        token == null ||
        token.isEmpty) {
      return;
    }

    final authKey = '$serverUrl|$token';
    if (_lastAuthKey == authKey && _signal.isConnected) {
      _resetPreferredSnapshotSender(keepSenderStats: true);
      _setStatus('mobile re-requested workbench snapshot');
      _signal.requestWorkbenchSnapshot();
      _ensureSnapshotTimeout();
      return;
    }

    _lastAuthKey = authKey;
    _signal.configure(serverUrl: serverUrl, token: token);
    _resetPreferredSnapshotSender(keepSenderStats: false);
    _setStatus('mobile opening sync channel');
    _signal.connect();
  }

  void _ensureSnapshotTimeout() {
    _snapshotTimeoutTimer?.cancel();
    _snapshotTimeoutTimer = Timer(const Duration(seconds: 20), () {
      if (_snapshot == null && _signal.isConnected) {
        _error = 'workbench snapshot timed out';
        _setStatus('mobile timed out waiting for workbench snapshot');
        _debugLog('snapshot timeout fired while snapshot was still null');
        notifyListeners();
      }
    });
  }

  void _startBackgroundRefresh() {
    _backgroundRefreshTimer?.cancel();
    _backgroundRefreshTimer = Timer.periodic(const Duration(seconds: 20), (_) {
      if (!_signal.isConnected) {
        return;
      }
      _resetPreferredSnapshotSender(keepSenderStats: true);
      _signal.requestWorkbenchSnapshot();
      _ensureSnapshotTimeout();
      _debugLog('background requested fresh workbench snapshot');
    });
  }

  void _onEvent(EventMessage event) {
    if (event.text.isEmpty) {
      return;
    }

    if (event.wireType == 'workbench:changed') {
      _debugLog('received workbench changed event');
      _preferSnapshotSender(event.senderDevice, force: true);
      try {
        final payload = jsonDecode(event.text) as Map<String, dynamic>;
        final params = payload['params'] is Map<String, dynamic>
            ? payload['params'] as Map<String, dynamic>
            : payload;
        final reason = params['reason']?.toString();
        final threadId = params['threadId']?.toString();
        if (reason == 'thread/archive' &&
            threadId != null &&
            threadId.isNotEmpty) {
          _optimisticallyRemoveArchivedConversation(threadId);
        }
        _setStatus(
          'desktop[$reason]${threadId == null || threadId.isEmpty ? '' : ' | thread=$threadId'}',
        );
      } catch (_) {
        _setStatus('desktop signaled workbench changed');
      }
      _signal.requestWorkbenchSnapshot();
      _ensureSnapshotTimeout();
      notifyListeners();
      return;
    }

    if (event.wireType == 'workbench:snapshot:status') {
      _debugLog('received status event');
      _applySnapshotStatus(event.text, senderDevice: event.senderDevice);
      return;
    }

    if (event.wireType != 'workbench:snapshot') {
      return;
    }

    try {
      final payload = jsonDecode(event.text) as Map<String, dynamic>;
      final parsed = AiWorkbenchSnapshot.fromJson(payload);
      final nextCodexCount = _codexConversationCount(parsed);
      if (_shouldIgnoreSnapshotFromSender(event.senderDevice, nextCodexCount)) {
        _debugLog(
          'ignored snapshot from sender=${event.senderDevice} because it would downgrade current codex conversations',
        );
        return;
      }
      _rememberSnapshotSender(
        event.senderDevice,
        threadCount: nextCodexCount,
        preferIfStronger: true,
      );
      _debugLog(
        'received snapshot payload | sender=${event.senderDevice} conversations=${parsed.conversations.length} messageMaps=${parsed.messagesByConversationId.length}',
      );
      final hasCodexProvider = parsed.providers.any(
        (item) => item.id == 'codex',
      );
      if (!hasCodexProvider) {
        _error = 'workbench snapshot missing codex provider';
        _setStatus('mobile received snapshot without codex provider');
        if (kDebugMode) {
          debugPrint(_error);
        }
        notifyListeners();
        return;
      }
      _reconcilePendingMessages(parsed);
      _snapshot = parsed;
      if (nextCodexCount > 0) {
        unawaited(_persistCachedSnapshot(parsed));
      }
      _error = null;
      _setStatus(
        'mobile received workbench snapshot with ${parsed.conversations.length} conversations',
      );
      _snapshotTimeoutTimer?.cancel();
      _snapshotTimeoutTimer = null;
      notifyListeners();
    } catch (err) {
      _error = 'workbench snapshot parse failed: $err';
      _setStatus('mobile failed to parse workbench snapshot');
      if (kDebugMode) {
        debugPrint(_error);
      }
      notifyListeners();
    }
  }

  void _appendPendingMessage(String conversationId, String text) {
    final pending = AiWorkbenchMessage(
      id: 'pending:$conversationId:${DateTime.now().millisecondsSinceEpoch}',
      providerId: 'codex',
      conversationId: conversationId,
      role: 'user',
      title: '你',
      text: text,
      status: 'pending',
      createdAt: DateTime.now().toIso8601String(),
      rawType: 'pendingUserMessage',
    );
    final queue = List<AiWorkbenchMessage>.of(
      _pendingMessagesByConversationId[conversationId] ?? const [],
      growable: true,
    );
    queue.add(pending);
    _pendingMessagesByConversationId[conversationId] = queue;
    _debugLog(
      'pending appended | ${debugStateForConversation(conversationId)} text=${text.length > 32 ? '${text.substring(0, 32)}...' : text}',
    );
  }

  void _optimisticallyRemoveArchivedConversation(String conversationId) {
    final current = _snapshot;
    if (current == null) {
      return;
    }
    final remainingConversations = current.conversations
        .where((item) => item.id != conversationId)
        .toList(growable: false);
    final remainingProjects = current.projects
        .map((project) {
          final nextIds = project.conversationIds
              .where((item) => item != conversationId)
              .toList(growable: false);
          return AiWorkbenchProject(
            id: project.id,
            providerId: project.providerId,
            name: project.name,
            path: project.path,
            conversationIds: nextIds,
            branches: project.branches,
            originUrl: project.originUrl,
            updatedAt: project.updatedAt,
          );
        })
        .where((project) => project.conversationIds.isNotEmpty)
        .toList(growable: false);
    final remainingMessages = Map<String, List<AiWorkbenchMessage>>.from(
      current.messagesByConversationId,
    )..remove(conversationId);
    String? nextActiveConversationId = current.activeConversationId;
    if (current.activeConversationId == conversationId) {
      final preferred = remainingConversations.where(
        (item) => item.providerId == 'codex',
      );
      if (preferred.isNotEmpty) {
        nextActiveConversationId = preferred.first.id;
      } else if (remainingConversations.isNotEmpty) {
        nextActiveConversationId = remainingConversations.first.id;
      } else {
        nextActiveConversationId = null;
      }
    }

    _snapshot = AiWorkbenchSnapshot(
      schemaVersion: current.schemaVersion,
      generatedAt: current.generatedAt,
      providers: current.providers,
      projects: remainingProjects,
      conversations: remainingConversations,
      messagesByConversationId: remainingMessages,
      modelsByProviderId: current.modelsByProviderId,
      configsByProviderId: current.configsByProviderId,
      activeConversationId:
          nextActiveConversationId == null || nextActiveConversationId.isEmpty
          ? null
          : nextActiveConversationId,
      errors: current.errors,
    );
    _pendingMessagesByConversationId.remove(conversationId);
    _sendingConversationIds.remove(conversationId);
    _debugLog('optimistically removed archived conversation=$conversationId');
  }

  void _optimisticallyUpdateCodexConfig({
    String? model,
    String? serviceTier,
    String? approvalPolicy,
    String? sandboxMode,
  }) {
    final current = _snapshot;
    if (current == null) {
      return;
    }
    final currentConfig = current.configsByProviderId['codex'];
    final nextConfigs = Map<String, AiWorkbenchConfig>.from(
      current.configsByProviderId,
    );
    nextConfigs['codex'] = AiWorkbenchConfig(
      providerId: 'codex',
      model: model ?? currentConfig?.model,
      modelProvider: currentConfig?.modelProvider,
      approvalPolicy: approvalPolicy ?? currentConfig?.approvalPolicy,
      sandboxMode: sandboxMode ?? currentConfig?.sandboxMode,
      serviceTier: serviceTier ?? currentConfig?.serviceTier,
      cwd: currentConfig?.cwd,
    );
    _snapshot = AiWorkbenchSnapshot(
      schemaVersion: current.schemaVersion,
      generatedAt: current.generatedAt,
      providers: current.providers,
      projects: current.projects,
      conversations: current.conversations,
      messagesByConversationId: current.messagesByConversationId,
      modelsByProviderId: current.modelsByProviderId,
      configsByProviderId: nextConfigs,
      activeConversationId: current.activeConversationId,
      errors: current.errors,
    );
  }

  void _optimisticallySwitchProjectBranch({
    required String cwd,
    required String branch,
  }) {
    final current = _snapshot;
    if (current == null) {
      return;
    }
    final nextProjects = current.projects
        .map((project) {
          if (project.path != cwd) {
            return project;
          }
          final nextBranches = <String>[
            branch,
            ...project.branches.where((item) => item != branch),
          ];
          return AiWorkbenchProject(
            id: project.id,
            providerId: project.providerId,
            name: project.name,
            path: project.path,
            conversationIds: project.conversationIds,
            branches: nextBranches,
            originUrl: project.originUrl,
            updatedAt: project.updatedAt,
          );
        })
        .toList(growable: false);
    final nextConversations = current.conversations
        .map((conversation) {
          if ((conversation.cwd ?? '') != cwd) {
            return conversation;
          }
          final info = conversation.gitInfo;
          return AiWorkbenchConversation(
            id: conversation.id,
            providerId: conversation.providerId,
            projectId: conversation.projectId,
            title: conversation.title,
            preview: conversation.preview,
            cwd: conversation.cwd,
            source: conversation.source,
            cliVersion: conversation.cliVersion,
            status: conversation.status,
            gitInfo: AiWorkbenchGitInfo(
              branch: branch,
              originUrl: info?.originUrl,
              sha: info?.sha,
            ),
            pendingApproval: conversation.pendingApproval,
            createdAt: conversation.createdAt,
            updatedAt: conversation.updatedAt,
          );
        })
        .toList(growable: false);
    _snapshot = AiWorkbenchSnapshot(
      schemaVersion: current.schemaVersion,
      generatedAt: current.generatedAt,
      providers: current.providers,
      projects: nextProjects,
      conversations: nextConversations,
      messagesByConversationId: current.messagesByConversationId,
      modelsByProviderId: current.modelsByProviderId,
      configsByProviderId: current.configsByProviderId,
      activeConversationId: current.activeConversationId,
      errors: current.errors,
    );
  }

  void _markPendingMessagesQueued() {
    final conversationIds = _pendingMessagesByConversationId.keys.toList();
    for (final conversationId in conversationIds) {
      final pending = _pendingMessagesByConversationId[conversationId];
      if (pending == null || pending.isEmpty) {
        _sendingConversationIds.remove(conversationId);
        continue;
      }
      final hadPending = pending.any((message) => message.status == 'pending');
      _pendingMessagesByConversationId[conversationId] = pending
          .map(
            (message) => AiWorkbenchMessage(
              id: message.id,
              providerId: message.providerId,
              conversationId: message.conversationId,
              role: message.role,
              title: message.title,
              text: message.text,
              status: message.status == 'pending' ? 'queued' : message.status,
              createdAt: message.createdAt,
              rawType: message.rawType,
            ),
          )
          .toList(growable: true);
      _sendingConversationIds.remove(conversationId);
      if (hadPending) {
        _debugLog(
          'pending marked queued | ${debugStateForConversation(conversationId)}',
        );
      }
    }
  }

  void _markPendingMessagesFailed(String errorText) {
    final conversationIds = _pendingMessagesByConversationId.keys.toList();
    for (final conversationId in conversationIds) {
      final pending = _pendingMessagesByConversationId[conversationId];
      if (pending == null || pending.isEmpty) {
        _sendingConversationIds.remove(conversationId);
        continue;
      }
      _pendingMessagesByConversationId[conversationId] = pending
          .map(
            (message) => AiWorkbenchMessage(
              id: message.id,
              providerId: message.providerId,
              conversationId: message.conversationId,
              role: message.role,
              title: message.title,
              text: message.text,
              status: 'failed',
              createdAt: message.createdAt,
              rawType: message.rawType,
            ),
          )
          .toList(growable: true);
      _sendingConversationIds.remove(conversationId);
      _debugLog(
        'pending marked failed | ${debugStateForConversation(conversationId)} error=$errorText',
      );
    }
    _error = errorText;
  }

  void _expirePendingConversationIfStalled(String conversationId) {
    final pending = _pendingMessagesByConversationId[conversationId];
    if (pending == null || pending.isEmpty) {
      return;
    }
    final hasActivePending = pending.any((message) {
      final status = message.status ?? 'pending';
      return status == 'pending' || status == 'queued';
    });
    if (!hasActivePending) {
      return;
    }
    _debugLog(
      'pending send timeout reached | ${debugStateForConversation(conversationId)}',
    );
    _pendingMessagesByConversationId[conversationId] = pending
        .map(
          (message) => AiWorkbenchMessage(
            id: message.id,
            providerId: message.providerId,
            conversationId: message.conversationId,
            role: message.role,
            title: message.title,
            text: message.text,
            status: 'failed',
            createdAt: message.createdAt,
            rawType: message.rawType,
          ),
        )
        .toList(growable: true);
    _sendingConversationIds.remove(conversationId);
    _error = 'Codex 消息发送超时';
    _setStatus('mobile codex send timed out while waiting for desktop sync');
    notifyListeners();
  }

  void _reconcilePendingMessages(AiWorkbenchSnapshot snapshot) {
    final conversationIds = _pendingMessagesByConversationId.keys.toList();
    for (final conversationId in conversationIds) {
      final pending = _pendingMessagesByConversationId[conversationId];
      if (pending == null || pending.isEmpty) {
        _pendingMessagesByConversationId.remove(conversationId);
        _sendingConversationIds.remove(conversationId);
        continue;
      }
      final remoteMessages =
          snapshot.messagesByConversationId[conversationId] ?? const [];
      final unresolved = pending
          .where((pendingMessage) {
            return !remoteMessages.any(
              (remote) =>
                  remote.role == pendingMessage.role &&
                  remote.text.trim() == pendingMessage.text.trim(),
            );
          })
          .toList(growable: true);
      _debugLog(
        'reconcile snapshot | conversation=$conversationId remote=${remoteMessages.length} unresolved=${unresolved.length}',
      );

      if (unresolved.isEmpty) {
        _pendingMessagesByConversationId.remove(conversationId);
        _sendingConversationIds.remove(conversationId);
        _debugLog(
          'pending cleared | ${debugStateForConversation(conversationId)}',
        );
      } else {
        _pendingMessagesByConversationId[conversationId] = unresolved;
        _debugLog(
          'pending kept after reconcile | ${debugStateForConversation(conversationId)}',
        );
      }
    }
  }

  void _applySnapshotStatus(String rawText, {String? senderDevice}) {
    try {
      final payload = jsonDecode(rawText) as Map<String, dynamic>;
      final stage = payload['stage']?.toString();
      final message = payload['message']?.toString();
      final detail = payload['detail'];
      _debugLog('status sender=$senderDevice stage=$stage message=$message');
      final threadCount = detail is Map
          ? (detail['threadCount'] as num?)?.toInt()
          : null;
      if (stage == 'build-ok' ||
          stage == 'snapshot-ready' ||
          stage == 'snapshot-sent' ||
          stage == 'cache-sent' ||
          stage == 'fallback-cache') {
        _rememberSnapshotSender(
          senderDevice,
          threadCount: threadCount,
          preferIfStronger: true,
        );
      }
      if (stage == 'snapshot-sent') {
        _markPendingMessagesQueued();
      } else if (stage == 'codexTurnStartAccepted' ||
          stage == 'codexDesktopIpcTurnStartAccepted') {
        _markPendingMessagesQueued();
        _debugLog('desktop accepted turn/start for current message');
      } else if (stage == 'codexTurnStartFailed' || stage == 'codexTurnStart') {
        final error = (detail is Map ? detail['error'] : null)?.toString();
        _markPendingMessagesFailed(error ?? 'Codex 消息发送失败');
      } else if (stage == 'codexDesktopIpcTurnStartFailed') {
        _debugLog(
          'desktop ipc turn/start failed; waiting for app-server fallback',
        );
      } else if (stage == 'codexApprovalDecisionAccepted') {
        _debugLog('desktop accepted approval decision');
      } else if (stage == 'codexApprovalDecisionFailed') {
        final error = (detail is Map ? detail['error'] : null)?.toString();
        _error = error ?? '确认动作发送失败';
      }
      final detailText = _formatStatusDetail(detail);
      final pieces = <String>[
        if (stage != null && stage.isNotEmpty) 'desktop[$stage]',
        if (message != null && message.isNotEmpty) message,
        if (detailText != null && detailText.isNotEmpty) detailText,
      ];
      _setStatus(pieces.join(' | '));
      notifyListeners();
    } catch (_) {
      _setStatus(rawText);
      notifyListeners();
    }
  }

  String? _formatStatusDetail(Object? detail) {
    if (detail is Map) {
      final entries = <String>[];
      final elapsed = detail['elapsedMs'];
      final threads = detail['threadCount'];
      final projects = detail['projectCount'];
      final bytes = detail['snapshotBytes'];
      final listed = detail['listedCount'];
      final ipc = detail['ipcCount'];
      final cached = detail['cachedCount'];
      final merged = detail['mergedCount'];
      final usedUnfilteredFallback = detail['usedUnfilteredFallback'];
      final error = detail['error'];
      if (threads != null) {
        entries.add('threads=$threads');
      }
      if (projects != null) {
        entries.add('projects=$projects');
      }
      if (bytes != null) {
        entries.add('bytes=$bytes');
      }
      if (listed != null) {
        entries.add('listed=$listed');
      }
      if (ipc != null) {
        entries.add('ipc=$ipc');
      }
      if (cached != null) {
        entries.add('cached=$cached');
      }
      if (merged != null) {
        entries.add('merged=$merged');
      }
      if (usedUnfilteredFallback != null) {
        entries.add('unfilteredFallback=$usedUnfilteredFallback');
      }
      if (elapsed != null) {
        entries.add('elapsed=${elapsed}ms');
      }
      if (error != null) {
        entries.add('error=$error');
      }
      return entries.isEmpty ? null : entries.join(', ');
    }
    if (detail == null) {
      return null;
    }
    final text = detail.toString().trim();
    return text.isEmpty ? null : text;
  }

  void _setStatus(String value) {
    final now = DateTime.now();
    _lastStatus = value;
    _lastStatusAt = now;
    final stamped =
        '${now.hour.toString().padLeft(2, '0')}:${now.minute.toString().padLeft(2, '0')}:${now.second.toString().padLeft(2, '0')}  $value';
    if (_statusTrail.isEmpty || _statusTrail.last != stamped) {
      _statusTrail.add(stamped);
      if (_statusTrail.length > 8) {
        _statusTrail.removeAt(0);
      }
    }
  }

  Future<void> _restoreCachedSnapshot() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(_cachedCodexSnapshotKey);
      if (raw == null || raw.isEmpty || _snapshot != null) {
        return;
      }
      final decoded = jsonDecode(raw);
      if (decoded is! Map<String, dynamic>) {
        return;
      }
      final cached = AiWorkbenchSnapshot.fromJson(decoded);
      final codexCount = _codexConversationCount(cached);
      if (codexCount <= 0) {
        return;
      }
      _snapshot = cached;
      _setStatus(
        'mobile restored $codexCount cached codex conversations before live sync',
      );
      _debugLog(
        'restored cached snapshot | conversations=${cached.conversations.length} messageMaps=${cached.messagesByConversationId.length}',
      );
      notifyListeners();
    } catch (err) {
      _debugLog('failed to restore cached snapshot: $err');
    }
  }

  Future<void> _persistCachedSnapshot(AiWorkbenchSnapshot snapshot) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(
        _cachedCodexSnapshotKey,
        jsonEncode(_snapshotToJson(snapshot)),
      );
    } catch (err) {
      _debugLog('failed to persist cached snapshot: $err');
    }
  }

  Map<String, dynamic> _snapshotToJson(AiWorkbenchSnapshot snapshot) {
    return {
      'schemaVersion': snapshot.schemaVersion,
      'generatedAt': snapshot.generatedAt.toIso8601String(),
      'providers': snapshot.providers
          .map(
            (item) => {
              'id': item.id,
              'name': item.name,
              'transport': item.transport,
              'capabilities': item.capabilities,
            },
          )
          .toList(growable: false),
      'projects': snapshot.projects
          .map(
            (item) => {
              'id': item.id,
              'providerId': item.providerId,
              'name': item.name,
              'path': item.path,
              'conversationIds': item.conversationIds,
              'branches': item.branches,
              'originUrl': item.originUrl,
              'updatedAt': item.updatedAt,
            },
          )
          .toList(growable: false),
      'conversations': snapshot.conversations
          .map(
            (item) => {
              'id': item.id,
              'providerId': item.providerId,
              'projectId': item.projectId,
              'title': item.title,
              'status': item.status,
              'preview': item.preview,
              'cwd': item.cwd,
              'source': item.source,
              'cliVersion': item.cliVersion,
              'pendingApproval': item.pendingApproval == null
                  ? null
                  : {
                      'requestId': item.pendingApproval!.requestId,
                      'approvalId': item.pendingApproval!.approvalId,
                      'kind': item.pendingApproval!.kind,
                      'title': item.pendingApproval!.title,
                      'summary': item.pendingApproval!.summary,
                    },
              'gitInfo': item.gitInfo == null
                  ? null
                  : {
                      'branch': item.gitInfo!.branch,
                      'originUrl': item.gitInfo!.originUrl,
                      'sha': item.gitInfo!.sha,
                    },
              'createdAt': item.createdAt,
              'updatedAt': item.updatedAt,
            },
          )
          .toList(growable: false),
      'activeConversationId': snapshot.activeConversationId,
      'messagesByConversationId': snapshot.messagesByConversationId.map(
        (key, items) => MapEntry(
          key,
          items
              .map(
                (item) => {
                  'id': item.id,
                  'providerId': item.providerId,
                  'conversationId': item.conversationId,
                  'role': item.role,
                  'title': item.title,
                  'text': item.text,
                  'imageUrls': item.imageUrls,
                  'previewText': item.previewText,
                  'isTruncated': item.isTruncated,
                  'fullTextCharCount': item.fullTextCharCount,
                  'status': item.status,
                  'createdAt': item.createdAt,
                  'rawType': item.rawType,
                },
              )
              .toList(growable: false),
        ),
      ),
      'modelsByProviderId': snapshot.modelsByProviderId.map(
        (key, items) => MapEntry(
          key,
          items
              .map(
                (item) => {
                  'id': item.id,
                  'providerId': item.providerId,
                  'label': item.label,
                  'description': item.description,
                  'hidden': item.hidden,
                  'isDefault': item.isDefault,
                  'defaultReasoningEffort': item.defaultReasoningEffort,
                  'supportedReasoningEfforts': item.supportedReasoningEfforts,
                },
              )
              .toList(growable: false),
        ),
      ),
      'configsByProviderId': snapshot.configsByProviderId.map(
        (key, item) => MapEntry(key, {
          'providerId': item.providerId,
          'model': item.model,
          'modelProvider': item.modelProvider,
          'approvalPolicy': item.approvalPolicy,
          'sandboxMode': item.sandboxMode,
          'serviceTier': item.serviceTier,
          'cwd': item.cwd,
        }),
      ),
      'errors': snapshot.errors
          .map(
            (item) => {
              'code': item.code,
              'message': item.message,
              'retryable': item.retryable,
            },
          )
          .toList(growable: false),
    };
  }

  void _debugLog(String value) {
    final now = DateTime.now();
    final stamped =
        '${now.hour.toString().padLeft(2, '0')}:${now.minute.toString().padLeft(2, '0')}:${now.second.toString().padLeft(2, '0')}  $value';
    _debugTrail.add(stamped);
    if (_debugTrail.length > 20) {
      _debugTrail.removeAt(0);
    }
    if (kDebugMode) {
      debugPrint('[AiWorkbenchSync] $stamped');
    }
  }

  int _codexConversationCount(AiWorkbenchSnapshot? snapshot) {
    if (snapshot == null) {
      return 0;
    }
    return snapshot.conversations
        .where((item) => item.providerId == 'codex')
        .length;
  }

  void _rememberSnapshotSender(
    String? senderDevice, {
    int? threadCount,
    bool preferIfStronger = false,
  }) {
    final normalized = senderDevice?.trim();
    if (normalized == null || normalized.isEmpty) {
      return;
    }
    _lastWorkbenchSignalAtBySender[normalized] = DateTime.now();
    if (threadCount != null) {
      _announcedThreadCountBySender[normalized] = threadCount;
    }
    final preferred = _preferredWorkbenchSenderDevice;
    if (preferred == null || preferred.isEmpty) {
      _preferredWorkbenchSenderDevice = normalized;
      return;
    }
    if (!preferIfStronger || preferred == normalized) {
      return;
    }
    if (_isPreferredSenderFresh()) {
      return;
    }
    final preferredCount = _announcedThreadCountBySender[preferred] ?? -1;
    final nextCount = _announcedThreadCountBySender[normalized] ?? -1;
    if (nextCount > preferredCount) {
      _preferredWorkbenchSenderDevice = normalized;
      _debugLog(
        'preferred snapshot sender switched to $normalized | threads=$nextCount previous=$preferredCount',
      );
    }
  }

  bool _shouldIgnoreSnapshotFromSender(
    String? senderDevice,
    int nextCodexCount,
  ) {
    final normalized = senderDevice?.trim();
    final preferred = _preferredWorkbenchSenderDevice?.trim();
    if (normalized == null ||
        normalized.isEmpty ||
        preferred == null ||
        preferred.isEmpty ||
        normalized == preferred ||
        !_isPreferredSenderFresh()) {
      return false;
    }
    final currentCount = _codexConversationCount(_snapshot);
    if (currentCount <= 0 || nextCodexCount >= currentCount) {
      return false;
    }
    final preferredCount =
        _announcedThreadCountBySender[preferred] ?? currentCount;
    final senderCount =
        _announcedThreadCountBySender[normalized] ?? nextCodexCount;
    return preferredCount >= senderCount;
  }

  bool _isPreferredSenderFresh() {
    final preferred = _preferredWorkbenchSenderDevice?.trim();
    if (preferred == null || preferred.isEmpty) {
      return false;
    }
    final lastAt = _lastWorkbenchSignalAtBySender[preferred];
    if (lastAt == null) {
      return false;
    }
    return DateTime.now().difference(lastAt) <= _preferredSenderFreshness;
  }

  void _resetPreferredSnapshotSender({required bool keepSenderStats}) {
    _preferredWorkbenchSenderDevice = null;
    if (!keepSenderStats) {
      _announcedThreadCountBySender.clear();
      _lastWorkbenchSignalAtBySender.clear();
    }
  }

  void _preferSnapshotSender(String? senderDevice, {bool force = false}) {
    final normalized = senderDevice?.trim();
    if (normalized == null || normalized.isEmpty) {
      return;
    }
    _lastWorkbenchSignalAtBySender[normalized] = DateTime.now();
    if (force || !_isPreferredSenderFresh()) {
      _preferredWorkbenchSenderDevice = normalized;
      _debugLog('preferred snapshot sender pinned to $normalized');
    }
  }

  @override
  void dispose() {
    _eventSub?.cancel();
    _connSub?.cancel();
    _snapshotTimeoutTimer?.cancel();
    _backgroundRefreshTimer?.cancel();
    _signal.disconnect();
    super.dispose();
  }
}
