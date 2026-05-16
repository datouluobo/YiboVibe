/// 消息事件模型 — 对应 mobile-console-plan 第9节标准事件类型
enum EventType {
  userInput,
  terminalOutput,
  sessionState,
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

  bool get isError => stream == OutputStream.stderr || type == EventType.systemNotice;
  bool get isUserMessage => type == EventType.userInput;
}
