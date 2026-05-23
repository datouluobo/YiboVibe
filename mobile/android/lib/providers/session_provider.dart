import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../models/session.dart';
import '../models/device.dart';
import '../models/event_message.dart';
import '../models/terminal_screen_state.dart';
import '../services/api_service.dart';
import '../services/signal_client.dart';
import '../utils/terminal_text_formatter.dart';
import 'auth_provider.dart';

/// Session + 连接状态管理 — 移动端主状态中枢
/// 每 5 秒轮询 REST API 同步 session 列表（服务端不广播 session 变更）
class SessionProvider extends ChangeNotifier {
  static const _eventsStorageKey = 'yibovibe_mobile_events_v1';
  final ApiService _api = ApiService();
  final SignalClient _signal = SignalClient();
  final AuthProvider _auth;

  List<Device> _devices = [];
  List<Session> _sessions = [];
  Session? _activeSession;
  List<EventMessage> _events = [];
  bool _isConnected = false;
  bool _isLoading = false;
  String? _error;
  bool _isDialogMode = false;
  List<int> _onlineDeviceIds = [];
  final Map<String, String> _ansiCarryBySession = {};
  final Map<String, String> _pendingEchoBySession = {};
  final Map<String, DateTime> _closingSessions = {};
  final Map<String, String> _renderModeBySession = {};
  final Map<String, String> _renderReasonBySession = {};
  final Map<String, TerminalScreenState> _screenStateBySession = {};
  final Map<String, int> _lastScreenSeqBySession = {};
  String? _preferredSessionId;
  DateTime? _preferredSessionSetAt;

  Timer? _pollTimer;
  String? _lastInitToken;

  List<Device> get devices => _devices;
  List<Session> get sessions => _sessions;
  Session? get activeSession => _activeSession;
  List<EventMessage> get events => _events;
  bool get isConnected => _isConnected;
  bool get isLoading => _isLoading;
  String? get error => _error;
  bool get isDialogMode => _isDialogMode;
  List<int> get onlineDeviceIds => _onlineDeviceIds;
  String renderModeForSession(String sessionId) =>
      _renderModeBySession[sessionId] ?? 'text';
  String renderReasonForSession(String sessionId) =>
      _renderReasonBySession[sessionId] ?? 'none';
  int? lastScreenSeqForSession(String sessionId) =>
      _lastScreenSeqBySession[sessionId];
  bool get isScreenMode =>
      _activeSession != null &&
      renderModeForSession(_activeSession!.sessionId) == 'screen';
  TerminalScreenState? get activeScreenState => _activeSession == null
      ? null
      : _screenStateBySession[_activeSession!.sessionId];

  StreamSubscription<EventMessage>? _eventSub;
  StreamSubscription<bool>? _connSub;

  SessionProvider(this._auth) {
    unawaited(_restorePersistedEvents());
    _eventSub = _signal.events.listen(_onEvent);
    _connSub = _signal.connectionState.listen((connected) {
      _isConnected = connected;
      if (connected) {
        _signal.requestSessions();
        unawaited(loadDevicesAndSessions());
      }
      notifyListeners();
    });
  }

  /// 登录后初始化连接 + 启动轮询
  void initWithAuth() {
    final serverUrl = _auth.serverUrl;
    final token = _auth.token;
    if (serverUrl == null ||
        serverUrl.isEmpty ||
        token == null ||
        token.isEmpty) {
      return;
    }

    final authKey = '$serverUrl|$token';
    if (_lastInitToken != authKey) {
      _stopPolling();
      _signal.disconnect();
      _devices = [];
      _sessions = [];
      _activeSession = null;
      _preferredSessionId = null;
      _preferredSessionSetAt = null;
      _onlineDeviceIds = [];
      _error = null;
      _lastInitToken = authKey;
    }

    _api.setBaseUrl(serverUrl, token);
    _signal.configure(serverUrl: serverUrl, token: token);
    _signal.connect();
    _startPolling();
    loadDevicesAndSessions();
    _signal.requestSessions();
    notifyListeners();
  }

  /// 每 5 秒轮询 REST API 刷新 session 列表
  void _startPolling() {
    _pollTimer?.cancel();
    _pollTimer = Timer.periodic(const Duration(seconds: 5), (_) {
      _pollSessions();
    });
  }

  void _stopPolling() {
    _pollTimer?.cancel();
    _pollTimer = null;
  }

  Future<void> _pollSessions() async {
    try {
      _purgeClosingSessions();
      final previousSessions = List<Session>.from(_sessions);
      final sessionData = await _api.getSessions();
      var newSessions = sessionData.map((s) => Session.fromJson(s)).toList();

      // 按设备检测幽灵session — 只保留在线设备的session
      try {
        final onlineIds = await _api.getOnlineDevices();
        _onlineDeviceIds = onlineIds;
        for (int i = 0; i < newSessions.length; i++) {
          final s = newSessions[i];
          if (s.status == 'running' || s.status == 'paused') {
            // 检查该session的所属设备是否在线
            if (!onlineIds.contains(s.ownerDevice)) {
              newSessions[i] = s.copyWith(status: 'stale');
            }
          }
        }
      } catch (_) {
        // 在线设备检测失败不影响session列表
      }

      newSessions = _normalizeSessions(newSessions);
      _reconcileClosingSessions(newSessions);
      newSessions = newSessions
          .where((session) => !_isSessionClosing(session.sessionId))
          .toList();

      if (_listChanged(_sessions, newSessions)) {
        _sessions = newSessions;
        _selectNewestAddedSession(previousSessions, newSessions);
        _syncActiveSession();
        notifyListeners();
      }
      // 清除之前的错误（轮询成功表示连接已恢复）
      if (_error != null) {
        _error = null;
        notifyListeners();
      }
    } catch (e) {
      _error = '轮询Session失败: ${e.toString().replaceFirst("Exception: ", "")}';
      notifyListeners();
    }
  }

  bool _listChanged(List<Session> a, List<Session> b) {
    if (a.length != b.length) return true;
    for (int i = 0; i < a.length; i++) {
      if (a[i].sessionId != b[i].sessionId ||
          a[i].status != b[i].status ||
          a[i].ownerDevice != b[i].ownerDevice ||
          a[i].startedAt != b[i].startedAt ||
          a[i].title != b[i].title ||
          a[i].shellKind != b[i].shellKind) {
        return true;
      }
    }
    return false;
  }

  List<Session> _normalizeSessions(List<Session> sessions) {
    final normalized = sessions.map((session) {
      final existing = _sessions
          .where((item) => item.sessionId == session.sessionId)
          .firstOrNull;
      if (existing == null) {
        return session;
      }
      return session.copyWith(
        startedAt: session.startedAt ?? existing.startedAt,
        lastActiveAt: session.lastActiveAt ?? existing.lastActiveAt,
        title: session.title.isNotEmpty ? session.title : existing.title,
        shellKind: session.shellKind.isNotEmpty
            ? session.shellKind
            : existing.shellKind,
        cwd: session.cwd.isNotEmpty ? session.cwd : existing.cwd,
      );
    }).toList();

    normalized.sort((left, right) {
      final ownerCmp = left.ownerDevice.compareTo(right.ownerDevice);
      if (ownerCmp != 0) return ownerCmp;

      final leftStarted = left.startedAt?.millisecondsSinceEpoch ?? 0;
      final rightStarted = right.startedAt?.millisecondsSinceEpoch ?? 0;
      final startedCmp = leftStarted.compareTo(rightStarted);
      if (startedCmp != 0) return startedCmp;

      return left.sessionId.compareTo(right.sessionId);
    });

    return normalized;
  }

  void _syncActiveSession() {
    if (_preferredSessionId != null) {
      final preferred = _sessions
          .where((s) => s.sessionId == _preferredSessionId)
          .firstOrNull;
      if (preferred != null) {
        _activeSession = preferred;
        _maybeRequestActiveScreenSnapshot();
        return;
      }
      final preferredStillFresh =
          _preferredSessionSetAt != null &&
          DateTime.now().difference(_preferredSessionSetAt!) <
              const Duration(seconds: 4);
      if (preferredStillFresh &&
          _activeSession?.sessionId == _preferredSessionId) {
        _maybeRequestActiveScreenSnapshot();
        return;
      }
      _preferredSessionId = null;
      _preferredSessionSetAt = null;
    }

    if (_activeSession == null) {
      // 默认选第一个
      if (_sessions.isNotEmpty) {
        _activeSession = _sessions.first;
      }
    } else {
      final updated = _sessions
          .where((s) => s.sessionId == _activeSession!.sessionId)
          .firstOrNull;
      if (updated != null) {
        _activeSession = updated;
      } else if (_sessions.isNotEmpty) {
        // 当前 session 被移除，选第一个
        _activeSession = _sessions.first;
      } else {
        _activeSession = null;
      }
    }
    _maybeRequestActiveScreenSnapshot();
  }

  /// 单次加载设备列表和 session 列表
  Future<void> loadDevicesAndSessions() async {
    _isLoading = true;
    notifyListeners();

    try {
      final previousSessions = List<Session>.from(_sessions);
      // 加载设备列表 — 失败不阻塞 sessions
      try {
        final deviceData = await _api.getDevices();
        _devices = deviceData.map((d) => Device.fromJson(d)).toList();
      } catch (_) {
        // 设备列表可选
      }

      // 加载 sessions
      final sessionData = await _api.getSessions();
      _sessions = sessionData.map((s) => Session.fromJson(s)).toList();

      // 按设备检测幽灵session
      try {
        final onlineIds = await _api.getOnlineDevices();
        _onlineDeviceIds = onlineIds;
        for (int i = 0; i < _sessions.length; i++) {
          final s = _sessions[i];
          if (s.status == 'running' || s.status == 'paused') {
            if (!onlineIds.contains(s.ownerDevice)) {
              _sessions[i] = s.copyWith(status: 'stale');
            }
          }
        }
      } catch (_) {}

      _sessions = _normalizeSessions(_sessions);
      _selectNewestAddedSession(previousSessions, _sessions);
      _syncActiveSession();
      _error = null;
    } catch (e) {
      _error = e.toString();
    }

    _isLoading = false;
    notifyListeners();
  }

  /// 处理 Signal 事件
  void _onEvent(EventMessage event) {
    _purgeClosingSessions();
    final normalizedEvent = _normalizeEventForDisplay(event);
    if (normalizedEvent == null) {
      return;
    }

    if (_handleScreenEvent(normalizedEvent)) {
      notifyListeners();
      return;
    }

    if (normalizedEvent.type == EventType.sessionListUpdate) {
      // session:list_update / session:update / session:register — 实时同步session变更
      try {
        final decoded = jsonDecode(normalizedEvent.text);
        if (decoded is List) {
          final previousSessions = List<Session>.from(_sessions);
          _sessions = _normalizeSessions(
            decoded
                .whereType<Map<String, dynamic>>()
                .map(Session.fromJson)
                .toList(),
          );
          _selectNewestAddedSession(previousSessions, _sessions);
        } else if (decoded is Map<String, dynamic>) {
          final action = decoded['action'] as String?;
          final sessionData = decoded['session'] as Map<String, dynamic>?;

          if (action == 'deleted') {
            final sid =
                decoded['session_id'] as String? ?? normalizedEvent.sessionId;
            _closingSessions.remove(sid);
            _sessions.removeWhere((s) => s.sessionId == sid);
          } else if (action == 'upserted' && sessionData != null) {
            final updated = Session.fromJson(sessionData);
            if (_isSessionClosing(updated.sessionId)) {
              // ignore stale re-upserts while a close is still in flight
            } else if (_isDesktopOnline()) {
              _upsertSession(updated);
            } else {
              _upsertSession(updated.copyWith(status: 'stale'));
            }
          } else if ((decoded['session_id'] as String?)?.isNotEmpty == true) {
            final state = decoded['state'] as String?;
            final sid = decoded['session_id'] as String;
            if (state == 'deleted' || action == 'deleted') {
              _closingSessions.remove(sid);
              _sessions.removeWhere((s) => s.sessionId == sid);
            } else {
              final updated = Session.fromJson({'id': sid, ...decoded});
              if (!_isSessionClosing(updated.sessionId)) {
                _upsertSession(updated);
              }
            }
          }
        }
        _syncActiveSession();
        notifyListeners();
      } catch (_) {
        // 解析失败忽略
      }
    } else if (normalizedEvent.type == EventType.sessionState &&
        normalizedEvent.state == 'session_list') {
      // 批量更新 session 列表（来自 desktop WS 直推）
      try {
        final list = jsonDecode(normalizedEvent.text) as List<dynamic>;
        final nextSessions = list
            .map((s) => Session.fromJson(s as Map<String, dynamic>))
            .toList();
        _reconcileClosingSessions(nextSessions);
        _sessions = nextSessions
            .where((session) => !_isSessionClosing(session.sessionId))
            .toList();
        _syncActiveSession();
      } catch (_) {}
    } else {
      _events.add(normalizedEvent);
      if (_isDialogMode &&
          TerminalTextFormatter.looksLikeInteractiveSurface(
            normalizedEvent.text,
          )) {
        _isDialogMode = false;
      }
      if (_events.length > 500) {
        _events = _events.sublist(_events.length - 300);
      }
      unawaited(_persistEvents());
    }
    notifyListeners();
  }

  /// 更新或添加 session 到列表
  void _upsertSession(Session session) {
    if (_isSessionClosing(session.sessionId)) {
      return;
    }
    final idx = _sessions.indexWhere((s) => s.sessionId == session.sessionId);
    if (idx >= 0) {
      final existing = _sessions[idx];
      _sessions[idx] = session.copyWith(
        startedAt: session.startedAt ?? existing.startedAt,
        lastActiveAt: session.lastActiveAt ?? existing.lastActiveAt,
        title: session.title.isNotEmpty ? session.title : existing.title,
        shellKind: session.shellKind.isNotEmpty
            ? session.shellKind
            : existing.shellKind,
        cwd: session.cwd.isNotEmpty ? session.cwd : existing.cwd,
      );
    } else {
      _sessions.add(session);
    }
    _sessions = _normalizeSessions(_sessions);
  }

  void _selectNewestAddedSession(
    List<Session> previous,
    List<Session> current,
  ) {
    final previousIds = previous.map((session) => session.sessionId).toSet();
    final added = current
        .where((session) => !previousIds.contains(session.sessionId))
        .toList();
    if (added.isEmpty) return;
    added.sort((left, right) {
      final leftStarted = left.startedAt?.millisecondsSinceEpoch ?? 0;
      final rightStarted = right.startedAt?.millisecondsSinceEpoch ?? 0;
      return leftStarted.compareTo(rightStarted);
    });
    _activeSession = added.last;
    _preferredSessionId = _activeSession?.sessionId;
    _preferredSessionSetAt = DateTime.now();
  }

  /// 检查是否有桌面端在线（除了移动端自己之外的在线设备）
  bool _isDesktopOnline() {
    return _onlineDeviceIds.where((id) => id != _auth.deviceId).isNotEmpty;
  }

  /// Session 按设备分组
  Map<int, List<Session>> get sessionsByDevice {
    final map = <int, List<Session>>{};
    for (final s in _sessions) {
      map.putIfAbsent(s.ownerDevice, () => []);
      map[s.ownerDevice]!.add(s);
    }
    return map;
  }

  /// 获取设备名称
  String deviceName(int deviceId) {
    final device = _devices.where((d) => d.deviceId == deviceId).firstOrNull;
    return device?.deviceName ?? '设备 $deviceId';
  }

  String sessionDisplayTitle(Session session) {
    final sameDeviceSessions = _sessions
        .where((item) => item.ownerDevice == session.ownerDevice)
        .toList();
    final index = sameDeviceSessions.indexWhere(
      (item) => item.sessionId == session.sessionId,
    );
    final ordinal = index >= 0 ? index + 1 : 0;
    if (ordinal > 0) {
      return '${session.shellKind} #$ordinal';
    }
    return session.shellKind.isNotEmpty ? session.shellKind : session.sessionId;
  }

  /// 当前活跃 session
  void selectSession(Session session) {
    _activeSession = session;
    _preferredSessionId = session.sessionId;
    _preferredSessionSetAt = DateTime.now();
    _maybeRequestActiveScreenSnapshot();
    notifyListeners();
  }

  /// 当前 session 的事件列表
  List<EventMessage> get activeSessionEvents {
    if (_activeSession == null) return _events;
    return _events
        .where(
          (e) =>
              e.sessionId.isEmpty || e.sessionId == _activeSession!.sessionId,
        )
        .toList();
  }

  bool get isInteractiveSession {
    if (isScreenMode) {
      return true;
    }
    final events = activeSessionEvents.reversed.take(24);
    for (final event in events) {
      if (TerminalTextFormatter.looksLikeInteractiveSurface(event.text)) {
        return true;
      }
    }
    return false;
  }

  String? get currentPrompt {
    final events = activeSessionEvents;
    for (final event in events.reversed) {
      final prompt = TerminalTextFormatter.extractPrompt(event.text);
      if (prompt != null && prompt.isNotEmpty) return prompt;
    }
    final session = _activeSession;
    if (session == null || session.cwd.isEmpty) return null;
    return TerminalTextFormatter.fallbackPrompt(
      shellKind: session.shellKind,
      cwd: session.cwd,
    );
  }

  /// 发送输入
  void sendInput(String text) {
    if (_activeSession == null) return;
    if (isScreenMode) {
      _previewScreenInput(text);
      _signal.sendInput(_activeSession!.sessionId, text);
      notifyListeners();
      return;
    }
    final command = text.trim();
    if (command.isNotEmpty) {
      _pendingEchoBySession[_activeSession!.sessionId] = command;
    }
    _signal.sendInput(_activeSession!.sessionId, text);
    _events.add(
      EventMessage(
        type: EventType.userInput,
        sessionId: _activeSession!.sessionId,
        text: text,
        ts: DateTime.now(),
        senderDevice: 'mobile',
      ),
    );
    unawaited(_persistEvents());
    notifyListeners();
  }

  void sendRawInput(String text) {
    if (_activeSession == null || text.isEmpty) return;
    _previewScreenInput(text);
    _signal.sendInput(_activeSession!.sessionId, text);
    notifyListeners();
  }

  void _previewScreenInput(String text) {
    if (!isScreenMode || text.isEmpty) return;
    final session = _activeSession;
    if (session == null) return;
    if (text.contains('\x1B')) return;
    final state = _screenStateBySession[session.sessionId];
    state?.applyLocalInputPreview(text);
  }

  void _maybeRequestActiveScreenSnapshot() {
    final session = _activeSession;
    if (session == null) return;
    if (renderModeForSession(session.sessionId) != 'screen') return;
    if (_screenStateBySession.containsKey(session.sessionId)) return;
    _signal.requestScreenSnapshot(
      session.sessionId,
      lastSeq: _lastScreenSeqBySession[session.sessionId],
    );
  }

  bool _handleScreenEvent(EventMessage event) {
    switch (event.wireType) {
      case 'session:screen_mode':
        final payload = _decodePayload(event.text);
        if (payload == null) return false;
        final sessionId = payload['session_id'] as String? ?? event.sessionId;
        if (sessionId.isEmpty) return false;
        final mode = payload['mode'] as String? ?? 'text';
        final reason = payload['reason'] as String? ?? 'none';
        final allowScreen = mode == 'screen'
            ? _shouldUseScreenMode(
                reason: reason,
                state: _screenStateBySession[sessionId],
              )
            : false;
        _renderModeBySession[sessionId] = allowScreen ? 'screen' : 'text';
        _renderReasonBySession[sessionId] = reason;
        final seq = (payload['seq'] as num?)?.toInt();
        if (seq != null) {
          _lastScreenSeqBySession[sessionId] = seq;
        }
        if (!allowScreen) {
          _screenStateBySession.remove(sessionId);
        } else if (_screenStateBySession[sessionId] == null) {
          _signal.requestScreenSnapshot(
            sessionId,
            lastSeq: _lastScreenSeqBySession[sessionId],
          );
        }
        return true;
      case 'session:screen_snapshot':
        final payload = _decodePayload(event.text);
        if (payload == null) return false;
        final snapshot = TerminalScreenState.fromJson(payload);
        final lastSeq = _lastScreenSeqBySession[snapshot.sessionId] ?? -1;
        if (snapshot.seq <= lastSeq) {
          return true;
        }
        _screenStateBySession[snapshot.sessionId] = snapshot;
        _lastScreenSeqBySession[snapshot.sessionId] = snapshot.seq;
        final reason = _renderReasonBySession[snapshot.sessionId] ?? 'snapshot';
        final allowScreen = _shouldUseScreenMode(
          reason: reason,
          state: snapshot,
        );
        _renderModeBySession[snapshot.sessionId] = allowScreen
            ? 'screen'
            : 'text';
        _renderReasonBySession[snapshot.sessionId] = reason;
        if (!allowScreen) {
          _screenStateBySession.remove(snapshot.sessionId);
        }
        return true;
      case 'session:screen_patch':
        final payload = _decodePayload(event.text);
        if (payload == null) return false;
        final sessionId = payload['session_id'] as String? ?? event.sessionId;
        if (sessionId.isEmpty) return false;
        final seq = (payload['seq'] as num?)?.toInt() ?? 0;
        final lastSeq = _lastScreenSeqBySession[sessionId] ?? 0;
        final state = _screenStateBySession[sessionId];
        if (state == null) {
          _signal.requestScreenSnapshot(sessionId, lastSeq: lastSeq);
          return true;
        }
        if (seq <= lastSeq) {
          return true;
        }
        if (seq > lastSeq + 1) {
          _signal.requestScreenSnapshot(sessionId, lastSeq: lastSeq);
          return true;
        }
        state.applyPatch(payload);
        final nextState = state.copyWith(seq: seq);
        _lastScreenSeqBySession[sessionId] = seq;
        final reason = _renderReasonBySession[sessionId] ?? 'patch';
        final allowScreen = _shouldUseScreenMode(
          reason: reason,
          state: nextState,
        );
        if (allowScreen) {
          _screenStateBySession[sessionId] = nextState;
          _renderModeBySession[sessionId] = 'screen';
        } else {
          _screenStateBySession.remove(sessionId);
          _renderModeBySession[sessionId] = 'text';
        }
        _renderReasonBySession[sessionId] = reason;
        return true;
      case 'session:screen_resize':
        final payload = _decodePayload(event.text);
        if (payload == null) return false;
        final sessionId = payload['session_id'] as String? ?? event.sessionId;
        if (sessionId.isEmpty) return false;
        _signal.requestScreenSnapshot(
          sessionId,
          lastSeq: _lastScreenSeqBySession[sessionId],
        );
        return true;
      case 'session:screen_reset':
        final payload = _decodePayload(event.text);
        final sessionId = payload?['session_id'] as String? ?? event.sessionId;
        if (sessionId.isEmpty) return false;
        _screenStateBySession.remove(sessionId);
        _lastScreenSeqBySession.remove(sessionId);
        _renderReasonBySession[sessionId] = 'reset';
        _signal.requestScreenSnapshot(sessionId);
        return true;
      default:
        return false;
    }
  }

  Map<String, dynamic>? _decodePayload(String text) {
    try {
      final decoded = jsonDecode(text);
      if (decoded is Map<String, dynamic>) {
        return decoded;
      }
      if (decoded is Map) {
        return Map<String, dynamic>.from(decoded);
      }
    } catch (_) {}
    return null;
  }

  bool _shouldUseScreenMode({
    required String reason,
    TerminalScreenState? state,
  }) {
    if (reason == 'alternate_screen' || reason == 'known_tui') {
      return true;
    }
    return state?.activeBuffer == 'alternate' || state?.mouseSupport == true;
  }

  EventMessage? _normalizeEventForDisplay(EventMessage event) {
    if (event.isUserMessage) {
      final command = event.text.trim();
      if (command.isNotEmpty && event.sessionId.isNotEmpty) {
        _pendingEchoBySession[event.sessionId] = command;
      }
      return event;
    }

    if (event.type != EventType.terminalOutput) {
      return event;
    }

    final sessionId = event.sessionId;
    final repaired = TerminalTextFormatter.repairChunk(
      _ansiCarryBySession[sessionId] ?? '',
      event.text,
    );
    _ansiCarryBySession[sessionId] = repaired.carry;

    var text = repaired.text;
    var matchedEcho = false;
    final pendingEcho = _pendingEchoBySession[sessionId];
    if (pendingEcho != null && pendingEcho.isNotEmpty) {
      final stripped = TerminalTextFormatter.stripLeadingCommandEcho(
        text,
        pendingEcho,
      );
      text = stripped.text;
      matchedEcho = stripped.matched;
    }

    if (matchedEcho) {
      _pendingEchoBySession.remove(sessionId);
    }

    if (text.trim().isEmpty && !text.contains('\x1B') && !text.contains('\r')) {
      return null;
    }

    return event.copyWith(text: text);
  }

  /// Session 控制
  void startSession(Session session) =>
      _signal.sendControl(session.sessionId, 'start');

  /// 停止/关闭 — 对 stale 幽灵session直接发 unregister 给服务端
  Future<void> stopSession(Session session) async {
    if (session.status == 'stale') {
      // 幽灵session：直接unregister，不经过桌面端
      _signal.sendUnregister(session.sessionId);
      _sessions.removeWhere((s) => s.sessionId == session.sessionId);
      _syncActiveSession();
      notifyListeners();
    } else {
      _upsertSession(session.copyWith(status: 'stopped'));
      _syncActiveSession();
      notifyListeners();
      try {
        await _api.stopSession(session.sessionId);
      } catch (_) {
        // REST 可能因为服务端 session 缓存未命中而失败，仍直接通知桌面端停止。
      }
      _signal.sendControl(session.sessionId, 'stop');
    }
    _scheduleRefreshAfterControl();
  }

  Future<void> closeSession(Session session) async {
    _markSessionClosing(session.sessionId);
    if (session.status == 'stale') {
      _signal.sendUnregister(session.sessionId);
      _sessions.removeWhere((s) => s.sessionId == session.sessionId);
      _syncActiveSession();
      notifyListeners();
    } else {
      _sessions.removeWhere((s) => s.sessionId == session.sessionId);
      _syncActiveSession();
      notifyListeners();
      if (_isConnected) {
        _signal.sendControl(session.sessionId, 'close');
      }
      try {
        await _api.removeSession(session.sessionId);
      } catch (_) {
        // REST 失败时仍保留 WS 关闭路径，由 tombstone 防止短暂回弹。
      }
    }
    _scheduleRefreshAfterControl();
  }

  void pauseSession(Session session) =>
      _signal.sendControl(session.sessionId, 'pause');
  void resumeSession(Session session) =>
      _signal.sendControl(session.sessionId, 'resume');

  /// 创建新 session
  void createSession(String shellKind) {
    final sessionId = _signal.createSession(shellKind);
    final provisional = Session(
      sessionId: sessionId,
      ownerDevice: _auth.deviceId ?? 0,
      title: sessionId.substring(0, sessionId.length.clamp(0, 18)),
      shellKind: shellKind,
      cwd: '',
      status: 'running',
      startedAt: DateTime.now(),
      lastActiveAt: DateTime.now(),
    );
    _upsertSession(provisional);
    _activeSession = _sessions
        .where((session) => session.sessionId == sessionId)
        .firstOrNull ??
        provisional;
    _preferredSessionId = sessionId;
    _preferredSessionSetAt = DateTime.now();
    notifyListeners();
    unawaited(
      Future<void>.delayed(const Duration(milliseconds: 600), () async {
        _signal.requestSessions();
        await _pollSessions();
      }),
    );
  }

  /// 切换视图模式
  void toggleViewMode() {
    _isDialogMode = !_isDialogMode;
    notifyListeners();
  }

  void setDialogMode(bool value) {
    _isDialogMode = value;
    notifyListeners();
  }

  void clearEvents() {
    _events.clear();
    unawaited(_persistEvents());
    notifyListeners();
  }

  Future<void> _restorePersistedEvents() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(_eventsStorageKey);
      if (raw == null || raw.isEmpty) return;
      final decoded = jsonDecode(raw) as List<dynamic>;
      _events = decoded
          .whereType<Map>()
          .map((item) => EventMessage.fromJson(Map<String, dynamic>.from(item)))
          .toList();
      notifyListeners();
    } catch (_) {
      // ignore persistence failures
    }
  }

  Future<void> _persistEvents() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final eventsToStore = _events.length > 300
          ? _events.sublist(_events.length - 300)
          : _events;
      final payload = jsonEncode(
        eventsToStore.map((event) => event.toJson()).toList(),
      );
      await prefs.setString(_eventsStorageKey, payload);
    } catch (_) {
      // ignore persistence failures
    }
  }

  void _markSessionClosing(String sessionId) {
    if (sessionId.isEmpty) return;
    _closingSessions[sessionId] = DateTime.now();
  }

  bool _isSessionClosing(String sessionId) {
    final startedAt = _closingSessions[sessionId];
    if (startedAt == null) return false;
    return DateTime.now().difference(startedAt) < const Duration(seconds: 8);
  }

  void _purgeClosingSessions() {
    final now = DateTime.now();
    _closingSessions.removeWhere(
      (_, startedAt) => now.difference(startedAt) >= const Duration(seconds: 8),
    );
  }

  void _reconcileClosingSessions(List<Session> sessions) {
    final activeIds = sessions.map((session) => session.sessionId).toSet();
    _closingSessions.removeWhere(
      (sessionId, _) => !activeIds.contains(sessionId),
    );
  }

  void _scheduleRefreshAfterControl() {
    unawaited(
      Future<void>.delayed(const Duration(milliseconds: 350), _pollSessions),
    );
    unawaited(
      Future<void>.delayed(const Duration(milliseconds: 1400), _pollSessions),
    );
  }

  @override
  void dispose() {
    _stopPolling();
    _eventSub?.cancel();
    _connSub?.cancel();
    _signal.dispose();
    super.dispose();
  }
}
