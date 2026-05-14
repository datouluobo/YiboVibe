import "dart:convert";
import "dart:async";
import "package:web_socket_channel/web_socket_channel.dart";
import "package:shared_preferences/shared_preferences.dart";

/// SignalClient manages the connection to the server Signal Hub.
/// It handles:
/// - WebSocket connection lifecycle
/// - Session state sync
/// - Heartbeat relay
/// - Command routing between desktop host and mobile console
class SignalClient {
  WebSocketChannel? _channel;
  String? _token;
  String? _serverUrl;
  int _uid = 0;
  int _deviceId = 0;

  final StreamController<SignalEvent> _eventController =
      StreamController<SignalEvent>.broadcast();

  Stream<SignalEvent> get events => _eventController.stream;
  bool get isConnected => _channel != null;

  Future<void> connect(String serverUrl, String token, int uid, int deviceId) async {
    _serverUrl = serverUrl;
    _token = token;
    _uid = uid;
    _deviceId = deviceId;

    final wsUrl = serverUrl.replaceAll("http://", "ws://").replaceAll("https://", "wss://");
    final uri = Uri.parse("$wsUrl/api/v1/sync/ws?token=$token");

    try {
      _channel = WebSocketChannel.connect(uri);
      await _channel!.ready;
      _eventController.add(SignalEvent.connected());

      // Listen for incoming messages
      _channel!.stream.listen(
        (data) {
          try {
            final msg = jsonDecode(data as String);
            _eventController.add(SignalEvent.message(msg));
          } catch (e) {
            // ignore malformed messages
          }
        },
        onError: (error) {
          _eventController.add(SignalEvent.disconnected(error.toString()));
          _channel = null;
        },
        onDone: () {
          _eventController.add(SignalEvent.disconnected("Connection closed"));
          _channel = null;
        },
      );
    } catch (e) {
      _eventController.add(SignalEvent.disconnected(e.toString()));
    }
  }

  void send(Map<String, dynamic> message) {
    if (_channel != null) {
      _channel!.sink.add(jsonEncode(message));
    }
  }

  /// Send a remote command to the desktop agent
  void sendCommand(String sessionId, String command, {Map<String, dynamic>? payload}) {
    send({
      "type": command,
      "session_id": sessionId,
      "sender_uid": _uid,
      "sender_device": _deviceId,
      "payload": payload ?? {},
    });
  }

  void disconnect() {
    _channel?.sink.close();
    _channel = null;
    _eventController.add(SignalEvent.disconnected("Manual disconnect"));
  }

  void dispose() {
    disconnect();
    _eventController.close();
  }
}

/// SignalEvent represents events from the Signal Hub
class SignalEvent {
  final String type;
  final Map<String, dynamic>? data;
  final String? error;

  SignalEvent._(this.type, {this.data, this.error});

  factory SignalEvent.connected() => SignalEvent._("connected");
  factory SignalEvent.disconnected(String reason) =>
      SignalEvent._("disconnected", error: reason);
  factory SignalEvent.message(Map<String, dynamic> msg) =>
      SignalEvent._("message", data: msg);
}
