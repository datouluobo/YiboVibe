import 'dart:async';
import 'dart:convert';
import 'package:web_socket_channel/web_socket_channel.dart';
import '../models/event_message.dart';

/// Signal Client — WebSocket 连接，对接服务端 Signal Hub
/// WS 路径: /api/v1/sync/ws?token=<access_token>
/// 消息类型: session:stdin, session:output, session:update, session:list, session:create
class SignalClient {
  WebSocketChannel? _channel;
  String? _serverUrl;
  String? _token;
  String? _uid;
  int? _deviceId;

  final _eventController = StreamController<EventMessage>.broadcast();
  final _connectionController = StreamController<bool>.broadcast();

  Stream<EventMessage> get events => _eventController.stream;
  Stream<bool> get connectionState => _connectionController.stream;
  bool get isConnected => _channel != null;

  void configure({
    required String serverUrl,
    required String token,
    required String uid,
    required int deviceId,
  }) {
    _serverUrl = serverUrl;
    _token = token;
    _uid = uid;
    _deviceId = deviceId;
  }

  /// 建立 WebSocket 连接
  /// 服务端支持通过 query token 认证: /api/v1/sync/ws?token=<token>
  void connect() {
    if (_serverUrl == null || _token == null) return;

    _disconnect();

    final wsUrl = _serverUrl!
        .replaceFirst('http://', 'ws://')
        .replaceFirst('https://', 'wss://');

    // 移除末尾 /
    final base = wsUrl.endsWith('/') ? wsUrl.substring(0, wsUrl.length - 1) : wsUrl;
    final uri = Uri.parse('${base}api/v1/sync/ws?token=$_token');

    try {
      _channel = WebSocketChannel.connect(uri);
      _connectionController.add(true);

      _channel!.stream.listen(
        (data) => _handleMessage(data as String),
        onError: (error) {
          _connectionController.add(false);
          _scheduleReconnect();
        },
        onDone: () {
          _connectionController.add(false);
          _scheduleReconnect();
        },
      );
    } catch (e) {
      _connectionController.add(false);
      _scheduleReconnect();
    }
  }

  void _scheduleReconnect() {
    Future.delayed(const Duration(seconds: 3), () {
      if (!isConnected) connect();
    });
  }

  void _handleMessage(String raw) {
    try {
      final data = jsonDecode(raw) as Map<String, dynamic>;

      // session 列表推送
      if (data['type'] == 'session_list') {
        final sessions = (data['sessions'] as List<dynamic>?)
                ?.map((s) => s as Map<String, dynamic>)
                .toList() ??
            [];
        _eventController.add(EventMessage(
          type: EventType.sessionState,
          sessionId: '',
          text: jsonEncode(sessions),
          ts: DateTime.now(),
          state: 'session_list',
        ));
        return;
      }

      // session 状态更新
      if (data['type'] == 'session_state' || data['type'] == 'session:update') {
        _eventController.add(EventMessage(
          type: EventType.sessionState,
          sessionId: data['session_id']?.toString() ?? '',
          text: data['state']?.toString() ?? '',
          ts: DateTime.now(),
          state: data['state']?.toString(),
        ));
        return;
      }

      // 通用事件
      final event = EventMessage.fromJson(data);
      _eventController.add(event);
    } catch (e) {
      // 忽略解析失败
    }
  }

  /// 发送文本到指定 session
  void sendInput(String sessionId, String text) {
    _send({
      'type': 'session:stdin',
      'session_id': sessionId,
      'text': text,
    });
  }

  /// 控制 session 生命周期
  void sendControl(String sessionId, String action) {
    // action: start|stop|pause|resume|close
    _send({
      'type': 'session:control',
      'session_id': sessionId,
      'action': action,
    });
  }

  /// 请求 session 列表
  void requestSessions() {
    _send({
      'type': 'session:list',
    });
  }

  /// 创建新 session
  void createSession(String shellKind) {
    _send({
      'type': 'session:create',
      'shell_kind': shellKind,
    });
  }

  void _send(Map<String, dynamic> data) {
    if (_channel != null) {
      data['uid'] = _uid;
      data['device_id'] = _deviceId?.toString();
      _channel!.sink.add(jsonEncode(data));
    }
  }

  void _disconnect() {
    _channel?.sink.close();
    _channel = null;
  }

  void disconnect() {
    _disconnect();
    _connectionController.add(false);
  }

  void dispose() {
    disconnect();
    _eventController.close();
    _connectionController.close();
  }
}
