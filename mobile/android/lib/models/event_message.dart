/// 消息事件模型 — 对应 mobile-console-plan 第9节标准事件类型
enum EventType {
  userInput,
  terminalOutput,
  sessionState,
  sessionListUpdate,
  promptRequest,
  resourceEvent,
  controlEvent,
  systemNotice,
}

enum OutputStream { stdout, stderr, system }

class EventMessage {
  final EventType type;
  final String sessionId;
  final String text;
  final DateTime ts;
  final String? senderDevice;
  final OutputStream? stream;
  final String? chunkId;
  final String? state;
  final int? exitCode;
  final String? promptKind;
  final List<String>? suggestedActions;
  final String? resourceType;
  final String? action;
  final String? result;
  final String? wireType;

  const EventMessage({
    required this.type,
    required this.sessionId,
    required this.text,
    required this.ts,
    this.senderDevice,
    this.stream,
    this.chunkId,
    this.state,
    this.exitCode,
    this.promptKind,
    this.suggestedActions,
    this.resourceType,
    this.action,
    this.result,
    this.wireType,
  });

  factory EventMessage.fromJson(Map<String, dynamic> json) {
    return EventMessage(
      type: _parseType(json['type'] as String? ?? ''),
      sessionId: json['session_id'] as String? ?? '',
      text: json['text'] as String? ?? '',
      ts: json['ts'] != null
          ? DateTime.tryParse(json['ts'] as String) ?? DateTime.now()
          : DateTime.now(),
      senderDevice: json['sender_device'] as String?,
      stream: json['stream'] != null
          ? OutputStream.values.firstWhere(
              (e) => e.name == json['stream'],
              orElse: () => OutputStream.stdout,
            )
          : null,
      chunkId: json['chunk_id'] as String?,
      state: json['state'] as String?,
      exitCode: (json['exit_code'] as num?)?.toInt(),
      promptKind: json['prompt_kind'] as String?,
      suggestedActions: (json['suggested_actions'] as List<dynamic>?)
          ?.map((e) => e.toString())
          .toList(),
      resourceType: json['resource_type'] as String?,
      action: json['action'] as String?,
      result: json['result'] as String?,
      wireType: json['wire_type'] as String?,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'type': _typeToWire(type),
      'session_id': sessionId,
      'text': text,
      'ts': ts.toIso8601String(),
      'sender_device': senderDevice,
      'stream': stream?.name,
      'chunk_id': chunkId,
      'state': state,
      'exit_code': exitCode,
      'prompt_kind': promptKind,
      'suggested_actions': suggestedActions,
      'resource_type': resourceType,
      'action': action,
      'result': result,
      'wire_type': wireType,
    };
  }

  EventMessage copyWith({
    EventType? type,
    String? sessionId,
    String? text,
    DateTime? ts,
    String? senderDevice,
    OutputStream? stream,
    String? chunkId,
    String? state,
    int? exitCode,
    String? promptKind,
    List<String>? suggestedActions,
    String? resourceType,
    String? action,
    String? result,
    String? wireType,
  }) {
    return EventMessage(
      type: type ?? this.type,
      sessionId: sessionId ?? this.sessionId,
      text: text ?? this.text,
      ts: ts ?? this.ts,
      senderDevice: senderDevice ?? this.senderDevice,
      stream: stream ?? this.stream,
      chunkId: chunkId ?? this.chunkId,
      state: state ?? this.state,
      exitCode: exitCode ?? this.exitCode,
      promptKind: promptKind ?? this.promptKind,
      suggestedActions: suggestedActions ?? this.suggestedActions,
      resourceType: resourceType ?? this.resourceType,
      action: action ?? this.action,
      result: result ?? this.result,
      wireType: wireType ?? this.wireType,
    );
  }

  static EventType _parseType(String type) {
    switch (type) {
      case 'user_input':
        return EventType.userInput;
      case 'terminal_output':
        return EventType.terminalOutput;
      case 'session_state':
        return EventType.sessionState;
      case 'prompt_request':
        return EventType.promptRequest;
      case 'resource_event':
        return EventType.resourceEvent;
      case 'control_event':
        return EventType.controlEvent;
      case 'system_notice':
        return EventType.systemNotice;
      default:
        return EventType.terminalOutput; // fallback
    }
  }

  static String _typeToWire(EventType type) {
    switch (type) {
      case EventType.userInput:
        return 'user_input';
      case EventType.terminalOutput:
        return 'terminal_output';
      case EventType.sessionState:
        return 'session_state';
      case EventType.sessionListUpdate:
        return 'session_list_update';
      case EventType.promptRequest:
        return 'prompt_request';
      case EventType.resourceEvent:
        return 'resource_event';
      case EventType.controlEvent:
        return 'control_event';
      case EventType.systemNotice:
        return 'system_notice';
    }
  }

  bool get isError => stream == OutputStream.stderr;
  bool get isUserMessage => type == EventType.userInput;
}
