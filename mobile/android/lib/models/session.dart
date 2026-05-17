/// Session 模型 — 对应服务端 Session Hub API 返回格式
/// 服务端字段: id, owner_uid, owner_device, label, state, shell_kind, cwd, started_at, last_active_at
class Session {
  final String sessionId;
  final int ownerUid;
  final int ownerDevice;
  final String title;
  final String shellKind;
  final String cwd;
  final String status; // starting|running|paused|waiting_input|stopped|crashed
  final DateTime? startedAt;
  final DateTime? lastActiveAt;
  final int unreadCount;
  final bool isWaitingInput;
  final bool hasError;

  const Session({
    required this.sessionId,
    this.ownerUid = 0,
    this.ownerDevice = 0,
    required this.title,
    required this.shellKind,
    required this.cwd,
    required this.status,
    this.startedAt,
    this.lastActiveAt,
    this.unreadCount = 0,
    this.isWaitingInput = false,
    this.hasError = false,
  });

  factory Session.fromJson(Map<String, dynamic> json) {
    return Session(
      sessionId: json['id'] as String? ?? '',
      ownerUid: (json['owner_uid'] as num?)?.toInt() ?? 0,
      ownerDevice: (json['owner_device'] as num?)?.toInt() ?? 0,
      title: (json['label'] as String?)?.isNotEmpty == true
          ? json['label'] as String
          : json['id']?.toString().substring(0, 18) ?? '',
      shellKind: json['shell_kind'] as String? ?? 'cmd',
      cwd: json['cwd'] as String? ?? '',
      status: json['state'] as String? ?? 'stopped',
      startedAt: json['started_at'] != null
          ? DateTime.fromMillisecondsSinceEpoch(
              (json['started_at'] as num).toInt() * 1000)
          : null,
      lastActiveAt: json['last_active_at'] != null
          ? DateTime.fromMillisecondsSinceEpoch(
              (json['last_active_at'] as num).toInt() * 1000)
          : null,
      unreadCount: (json['unread_count'] as num?)?.toInt() ?? 0,
      isWaitingInput: json['is_waiting_input'] as bool? ?? false,
      hasError: json['has_error'] as bool? ?? false,
    );
  }

  Map<String, dynamic> toJson() => {
        'session_id': sessionId,
        'owner_device': ownerDevice,
        'label': title,
        'shell_kind': shellKind,
        'cwd': cwd,
        'state': status,
      };

  Session copyWith({
    String? sessionId,
    int? ownerUid,
    int? ownerDevice,
    String? title,
    String? shellKind,
    String? cwd,
    String? status,
    DateTime? startedAt,
    DateTime? lastActiveAt,
    int? unreadCount,
    bool? isWaitingInput,
    bool? hasError,
  }) =>
      Session(
        sessionId: sessionId ?? this.sessionId,
        ownerUid: ownerUid ?? this.ownerUid,
        ownerDevice: ownerDevice ?? this.ownerDevice,
        title: title ?? this.title,
        shellKind: shellKind ?? this.shellKind,
        cwd: cwd ?? this.cwd,
        status: status ?? this.status,
        startedAt: startedAt ?? this.startedAt,
        lastActiveAt: lastActiveAt ?? this.lastActiveAt,
        unreadCount: unreadCount ?? this.unreadCount,
        isWaitingInput: isWaitingInput ?? this.isWaitingInput,
        hasError: hasError ?? this.hasError,
      );

  /// 状态颜色语义
  String get statusColor {
    switch (status) {
      case 'running':
        return 'green';
      case 'paused':
      case 'waiting_input':
        return 'yellow';
      case 'stale':
        return 'gray';
      case 'crashed':
        return 'red';
      case 'stopped':
      default:
        return 'gray';
    }
  }

  bool get isRunning => status == 'running';
  bool get isStopped => status == 'stopped' || status == 'crashed';
}
