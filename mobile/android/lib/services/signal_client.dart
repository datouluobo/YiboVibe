import 'dart:async';
import 'dart:convert';
import 'package:web_socket_channel/web_socket_channel.dart';
import '../models/event_message.dart';

/// Signal Client — WebSocket 连接，对接服务端 Signal Hub
/// WS 路径: /api/v1/sync/ws?token=`access_token`
/// 服务端消息采用 Message 信封格式:
/// {"sender_uid":N, "sender_device_id":N, "type":"session:output", "payload":{...}}
class SignalClient {
  WebSocketChannel? _channel;
  String? _serverUrl;
  String? _token;

  final _eventController = StreamController<EventMessage>.broadcast();
  final _connectionController = StreamController<bool>.broadcast();

  Stream<EventMessage> get events => _eventController.stream;
  Stream<bool> get connectionState => _connectionController.stream;
  bool get isConnected => _channel != null;

  void configure({required String serverUrl, required String token}) {
    _serverUrl = serverUrl;
    _token = token;
  }

  /// 建立 WebSocket 连接
  void connect() {
    if (_serverUrl == null || _token == null) return;

    _disconnect();

    final wsUrl = _serverUrl!
        .replaceFirst('http://', 'ws://')
        .replaceFirst('https://', 'wss://');

    // 移除末尾 /
    final base = wsUrl.endsWith('/')
        ? wsUrl.substring(0, wsUrl.length - 1)
        : wsUrl;
    final uri = Uri.parse('$base/api/v1/sync/ws?token=$_token');

    try {
      _channel = WebSocketChannel.connect(uri);

      // 等待连接确认（web_socket_channel 3.x 支持 ready）
      _channel!.ready
          .then((_) {
            _connectionController.add(true);
          })
          .catchError((error) {
            _connectionController.add(false);
            _channel = null;
            _scheduleReconnect();
          });

      _channel!.stream.listen(
        (data) => _handleMessage(data as String),
        onError: (error) {
          _connectionController.add(false);
          _channel = null;
          _scheduleReconnect();
        },
        onDone: () {
          _connectionController.add(false);
          _channel = null;
          _scheduleReconnect();
        },
      );
    } catch (e) {
      _connectionController.add(false);
      _channel = null;
      _scheduleReconnect();
    }
  }

  void _scheduleReconnect() {
    Future.delayed(const Duration(seconds: 3), () {
      if (!isConnected) connect();
    });
  }

  /// 处理服务端 WS 消息 — 兼容嵌套 Message 信封格式
  /// 服务端 WritePump 发送 Message 结构:
  /// {"sender_uid":N, "sender_device_id":N, "type":"session:output", "payload":{...}}
  void _handleMessage(String raw) {
    try {
      final data = jsonDecode(raw) as Map<String, dynamic>;

      // 检查是否有 payload 字段 → Message 信封格式
      if (data.containsKey('payload')) {
        _handleEnvelope(data);
        return;
      }

      // 无 payload → 旧格式 EventMessage（向后兼容）
      _handleFlatMessage(data);
    } catch (_) {
      // 解析失败忽略
    }
  }

  /// 处理 Message 信封格式: {sender_uid, sender_device_id, type, payload}
  void _handleEnvelope(Map<String, dynamic> envelope) {
    final msgType = envelope['type'] as String? ?? '';
    final payloadRaw = envelope['payload'];
    final senderDevice = envelope['sender_device_id'] as int?;

    // payload 可能是 string(JSON) 或 object
    Map<String, dynamic> payload;
    if (payloadRaw is String) {
      try {
        payload = jsonDecode(payloadRaw) as Map<String, dynamic>;
      } catch (_) {
        payload = {'text': payloadRaw};
      }
    } else if (payloadRaw is Map) {
      payload = Map<String, dynamic>.from(payloadRaw);
    } else {
      payload = {};
    }

    // 提取 session_id — 可能在 payload 外层或 RelayMessage 内层
    String sessionId = payload['session_id'] as String? ?? '';

    // 如果 payload 内还有 payload（RelayMessage 嵌套），递归解一层
    Map<String, dynamic> innerPayload = payload;
    if (payload.containsKey('payload') && payload['payload'] is Map) {
      innerPayload = Map<String, dynamic>.from(payload['payload'] as Map);
      if (sessionId.isEmpty) {
        sessionId = payload['session_id'] as String? ?? '';
      }
    }

    // 映射服务端 type → EventType
    final eventType = _mapEnvelopeType(msgType);

    // 提取文本内容
    // 对 session:list_update 类型，payload 本身就是完整数据
    String text;
    if (msgType == 'session_list') {
      text = jsonEncode(payload['sessions'] ?? const []);
    } else if ({
      'session:screen_mode',
      'session:screen_snapshot',
      'session:screen_patch',
      'session:screen_resize',
      'session:screen_reset',
    }.contains(msgType)) {
      text = jsonEncode(payload);
    } else if ({
      'session:list_update',
      'session:update',
      'session:register',
      'session:unregister',
      'session:list',
    }.contains(msgType)) {
      text = jsonEncode(payload);
    } else {
      text =
          innerPayload['text'] as String? ??
          innerPayload['label'] as String? ??
          payload['text'] as String? ??
          '';
    }

    // 提取 stream
    OutputStream? stream;
    final streamStr = innerPayload['stream'] as String?;
    if (streamStr != null) {
      stream = OutputStream.values.firstWhere(
        (e) => e.name == streamStr,
        orElse: () => OutputStream.stdout,
      );
    }

    // 提取 state
    final state =
        innerPayload['state'] as String? ??
        payload['state'] as String? ??
        (msgType == 'session_list' ? 'session_list' : null);

    // 提取时间
    DateTime ts;
    if (payload['ts'] != null) {
      ts = DateTime.tryParse(payload['ts'].toString()) ?? DateTime.now();
    } else if (innerPayload['ts'] != null) {
      ts = DateTime.tryParse(innerPayload['ts'].toString()) ?? DateTime.now();
    } else {
      ts = DateTime.now();
    }

    _eventController.add(
      EventMessage(
        type: eventType,
        sessionId: sessionId,
        text: text,
        ts: ts,
        stream: stream,
        state: state,
        senderDevice: senderDevice?.toString(),
        wireType: msgType,
      ),
    );
  }

  /// 映射服务端 WS type → 移动端 EventType
  EventType _mapEnvelopeType(String type) {
    switch (type) {
      case 'session:screen_mode':
      case 'session:screen_snapshot':
      case 'session:screen_patch':
      case 'session:screen_resize':
      case 'session:screen_reset':
        return EventType.controlEvent;
      case 'session:output':
      case 'terminal_output':
        return EventType.terminalOutput;
      case 'session:stdin':
      case 'user_input':
        return EventType.userInput;
      case 'session:list_update':
      case 'session:update':
      case 'session:register':
      case 'session:unregister':
      case 'session:list':
        return EventType.sessionListUpdate;
      case 'session_list':
        return EventType.sessionState;
      case 'system_notice':
        return EventType.systemNotice;
      case 'host:heartbeat':
      case 'host:alert':
      case 'host:vitals':
        // 忽略心跳/告警
        return EventType.systemNotice;
      default:
        return EventType.terminalOutput;
    }
  }

  /// 处理旧格式（无 Message 信封）
  void _handleFlatMessage(Map<String, dynamic> data) {
    // session 列表推送
    if (data['type'] == 'session_list') {
      final sessions =
          (data['sessions'] as List<dynamic>?)
              ?.map((s) => s as Map<String, dynamic>)
              .toList() ??
          [];
      _eventController.add(
        EventMessage(
          type: EventType.sessionState,
          sessionId: '',
          text: jsonEncode(sessions),
          ts: DateTime.now(),
          state: 'session_list',
        ),
      );
      return;
    }

    // session 状态更新
    if (data['type'] == 'session_state' || data['type'] == 'session:update') {
      _eventController.add(
        EventMessage(
          type: EventType.sessionState,
          sessionId: data['session_id']?.toString() ?? '',
          text: data['state']?.toString() ?? '',
          ts: DateTime.now(),
          state: data['state']?.toString(),
        ),
      );
      return;
    }

    // 通用事件
    final event = EventMessage.fromJson(data);
    _eventController.add(event);
  }

  /// 发送文本到指定 session
  void sendInput(String sessionId, String text) {
    _send({'type': 'session:stdin', 'session_id': sessionId, 'text': text});
  }

  /// 控制 session 生命周期
  /// 匹配桌面端 WS Broker 的消息类型:
  ///   session:start/resume — 创建并启动
  ///   session:stop (需 confirmed:true) — 停止
  ///   session:pause — 暂停
  ///   session:remove — 删除并注销
  void sendControl(String sessionId, String action) {
    switch (action) {
      case 'start':
        _send({'type': 'session:start', 'session_id': sessionId});
        break;
      case 'stop':
        _send({
          'type': 'session:stop',
          'session_id': sessionId,
          'confirmed': true,
        });
        break;
      case 'pause':
        _send({'type': 'session:pause', 'session_id': sessionId});
        break;
      case 'resume':
        _send({'type': 'session:resume', 'session_id': sessionId});
        break;
      case 'close':
        _send({'type': 'session:remove', 'session_id': sessionId});
        break;
    }
  }

  /// 直接向服务端发送 session:unregister — 用于清理幽灵session
  /// 不经过桌面端，服务端直接删除该session的内存记录并广播给其他设备
  void sendUnregister(String sessionId) {
    _send({'type': 'session:unregister', 'session_id': sessionId});
  }

  /// 请求 session 列表
  void requestSessions() {
    _send({'type': 'session:list'});
  }

  void requestScreenSnapshot(String sessionId, {int? lastSeq}) {
    _send({
      'type': 'session:screen_request_snapshot',
      'session_id': sessionId,
      // ignore: use_null_aware_elements
      if (lastSeq case final value?) 'last_seq': value,
    });
  }

  /// 创建新 session — 通过 session:start 发给桌面端（不存在则自动创建）
  String createSession(String shellKind) {
    final id = 'mobile-${DateTime.now().millisecondsSinceEpoch}';
    _send({'type': 'session:start', 'session_id': id, 'shell_kind': shellKind});
    return id;
  }

  void _send(Map<String, dynamic> data) {
    if (_channel != null) {
      final type = data['type'];
      final payload = Map<String, dynamic>.from(data);
      payload.remove('type');
      // 服务端 Message 结构只解析 type + payload
      // session_id/text/action 等字段必须放在 payload 里，否则被 json.Unmarshal 丢弃
      _channel!.sink.add(jsonEncode({'type': type, 'payload': payload}));
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
