import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import '../models/session.dart';
import '../models/device.dart';
import '../models/event_message.dart';
import '../services/api_service.dart';
import '../services/signal_client.dart';
import 'auth_provider.dart';

/// Session + 连接状态管理 — 移动端主状态中枢
/// 每 5 秒轮询 REST API 同步 session 列表（服务端不广播 session 变更）
class SessionProvider extends ChangeNotifier {
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

  StreamSubscription<EventMessage>? _eventSub;
  StreamSubscription<bool>? _connSub;

  SessionProvider(this._auth) {
    _eventSub = _signal.events.listen(_onEvent);
    _connSub = _signal.connectionState.listen((connected) {
      _isConnected = connected;
      notifyListeners();
    });
  }

  /// 登录后初始化连接 + 启动轮询
  void initWithAuth() {
    final serverUrl = _auth.serverUrl;
    final token = _auth.token;
    if (serverUrl == null || serverUrl.isEmpty || token == null || token.isEmpty) {
      return;
    }

    final authKey = '$serverUrl|$token';
    if (_lastInitToken != authKey) {
      _stopPolling();
      _signal.disconnect();
      _devices = [];
      _sessions = [];
      _activeSession = null;
      _events = [];
      _onlineDeviceIds = [];
      _error = null;
      _lastInitToken = authKey;
    }

    _api.setBaseUrl(serverUrl, token);
    _signal.configure(
      serverUrl: serverUrl,
      token: token,
    );
    _signal.connect();
    _startPolling();
    loadDevicesAndSessions();
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

      if (_listChanged(_sessions, newSessions)) {
        _sessions = newSessions;
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
    final normalized = sessions
        .map((session) {
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
        })
        .toList();

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
  }

  /// 单次加载设备列表和 session 列表
  Future<void> loadDevicesAndSessions() async {
    _isLoading = true;
    notifyListeners();

    try {
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
    if (event.type == EventType.sessionListUpdate) {
      // session:list_update / session:update / session:register — 实时同步session变更
      try {
        final decoded = jsonDecode(event.text);
        if (decoded is List) {
          _sessions = _normalizeSessions(
            decoded
                .whereType<Map<String, dynamic>>()
                .map(Session.fromJson)
                .toList(),
          );
        } else if (decoded is Map<String, dynamic>) {
          final action = decoded['action'] as String?;
          final sessionData = decoded['session'] as Map<String, dynamic>?;

          if (action == 'deleted') {
            final sid = decoded['session_id'] as String? ?? event.sessionId;
            _sessions.removeWhere((s) => s.sessionId == sid);
          } else if (action == 'upserted' && sessionData != null) {
            final updated = Session.fromJson(sessionData);
            if (_isDesktopOnline()) {
              _upsertSession(updated);
            } else {
              _upsertSession(updated.copyWith(status: 'stale'));
            }
          } else if ((decoded['session_id'] as String?)?.isNotEmpty == true) {
            final state = decoded['state'] as String?;
            final sid = decoded['session_id'] as String;
            if (state == 'deleted' || action == 'deleted') {
              _sessions.removeWhere((s) => s.sessionId == sid);
            } else {
              final updated = Session.fromJson({
                'id': sid,
                ...decoded,
              });
              _upsertSession(updated);
            }
          }
        }
        _syncActiveSession();
        notifyListeners();
      } catch (_) {
        // 解析失败忽略
      }
    } else if (event.type == EventType.sessionState && event.state == 'session_list') {
      // 批量更新 session 列表（来自 desktop WS 直推）
      try {
        final list = jsonDecode(event.text) as List<dynamic>;
        _sessions =
            list.map((s) => Session.fromJson(s as Map<String, dynamic>)).toList();
        _syncActiveSession();
      } catch (_) {}
    } else {
      _events.add(event);
      if (_events.length > 500) {
        _events = _events.sublist(_events.length - 300);
      }
    }
    notifyListeners();
  }

  /// 更新或添加 session 到列表
  void _upsertSession(Session session) {
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

  /// 当前活跃 session
  void selectSession(Session session) {
    _activeSession = session;
    notifyListeners();
  }

  /// 当前 session 的事件列表
  List<EventMessage> get activeSessionEvents {
    if (_activeSession == null) return _events;
    return _events
        .where((e) =>
            e.sessionId.isEmpty || e.sessionId == _activeSession!.sessionId)
        .toList();
  }

  /// 发送输入
  void sendInput(String text) {
    if (_activeSession == null) return;
    _signal.sendInput(_activeSession!.sessionId, text);
    _events.add(EventMessage(
      type: EventType.userInput,
      sessionId: _activeSession!.sessionId,
      text: text,
      ts: DateTime.now(),
      senderDevice: 'mobile',
    ));
    notifyListeners();
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
        _signal.sendControl(session.sessionId, 'stop');
      }
    }
    _scheduleRefreshAfterControl();
  }

  Future<void> closeSession(Session session) async {
    if (session.status == 'stale') {
      _signal.sendUnregister(session.sessionId);
      _sessions.removeWhere((s) => s.sessionId == session.sessionId);
      _syncActiveSession();
      notifyListeners();
    } else {
      _sessions.removeWhere((s) => s.sessionId == session.sessionId);
      _syncActiveSession();
      notifyListeners();
      try {
        await _api.removeSession(session.sessionId);
      } catch (_) {
        _signal.sendControl(session.sessionId, 'close');
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
    _signal.createSession(shellKind);
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
    notifyListeners();
  }

  void _scheduleRefreshAfterControl() {
    unawaited(Future<void>.delayed(
      const Duration(milliseconds: 350),
      _pollSessions,
    ));
    unawaited(Future<void>.delayed(
      const Duration(milliseconds: 1400),
      _pollSessions,
    ));
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
