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

  List<Device> get devices => _devices;
  List<Session> get sessions => _sessions;
  Session? get activeSession => _activeSession;
  List<EventMessage> get events => _events;
  bool get isConnected => _isConnected;
  bool get isLoading => _isLoading;
  String? get error => _error;
  bool get isDialogMode => _isDialogMode;

  StreamSubscription<EventMessage>? _eventSub;
  StreamSubscription<bool>? _connSub;

  SessionProvider(this._auth) {
    _eventSub = _signal.events.listen(_onEvent);
    _connSub = _signal.connectionState.listen((connected) {
      _isConnected = connected;
      notifyListeners();
    });
  }

  /// 登录后初始化连接
  void initWithAuth() {
    _api.loadFromStorage();
    _signal.configure(
      serverUrl: _auth.serverUrl!,
      token: _auth.token!,
      uid: _auth.uid!.toString(),
      deviceId: _auth.deviceId!,
    );
    _signal.connect();
    notifyListeners();
  }

  /// 加载设备和 session 列表
  Future<void> loadDevicesAndSessions() async {
    _isLoading = true;
    notifyListeners();

    try {
      // 加载设备列表 GET /api/v1/sync/devices
      final deviceData = await _api.getDevices();
      _devices = deviceData.map((d) => Device.fromJson(d)).toList();

      // 加载 sessions GET /api/v1/sync/signal/sessions
      final sessionData = await _api.getSessions();
      _sessions = sessionData.map((s) => Session.fromJson(s)).toList();

      // 默认选中第一个 active session
      if (_sessions.isNotEmpty && _activeSession == null) {
        _activeSession = _sessions.first;
      } else if (_sessions.isNotEmpty && _activeSession != null) {
        // 更新 active session 引用
        final updated = _sessions
            .where((s) => s.sessionId == _activeSession!.sessionId)
            .firstOrNull;
        if (updated != null) _activeSession = updated;
      }

      _error = null;
    } catch (e) {
      _error = e.toString();
    }

    _isLoading = false;
    notifyListeners();
  }

  /// 处理 Signal 事件
  void _onEvent(EventMessage event) {
    if (event.type == EventType.sessionState && event.state == 'session_list') {
      // 批量更新 session 列表
      final list = jsonDecode(event.text) as List<dynamic>;
      _sessions =
          list.map((s) => Session.fromJson(s as Map<String, dynamic>)).toList();
      if (_activeSession != null) {
        final updated = _sessions
            .where((s) => s.sessionId == _activeSession!.sessionId)
            .firstOrNull;
        if (updated != null) _activeSession = updated;
      }
    } else {
      _events.add(event);
      if (_events.length > 500) {
        _events = _events.sublist(_events.length - 300);
      }
    }
    notifyListeners();
  }

  /// 切换活跃 session
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
  void stopSession(Session session) =>
      _signal.sendControl(session.sessionId, 'stop');
  void pauseSession(Session session) =>
      _signal.sendControl(session.sessionId, 'pause');
  void resumeSession(Session session) =>
      _signal.sendControl(session.sessionId, 'resume');
  void closeSession(Session session) =>
      _signal.sendControl(session.sessionId, 'close');

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

  @override
  void dispose() {
    _eventSub?.cancel();
    _connSub?.cancel();
    _signal.dispose();
    super.dispose();
  }
}
