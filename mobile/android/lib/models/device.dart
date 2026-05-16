/// 桌面设备模型 — 对应服务端 /api/v1/sync/devices 返回
/// 服务端字段: id, name, type, is_online, last_seen_at
class Device {
  final int deviceId;
  final String deviceName;
  final String deviceType;
  final bool isOnline;
  final DateTime? lastSeenAt;

  const Device({
    required this.deviceId,
    required this.deviceName,
    this.deviceType = '',
    this.isOnline = false,
    this.lastSeenAt,
  });

  factory Device.fromJson(Map<String, dynamic> json) {
    return Device(
      deviceId: (json['id'] as num?)?.toInt() ?? 0,
      deviceName: json['name'] as String? ?? '',
      deviceType: json['type'] as String? ?? '',
      isOnline: json['is_online'] as bool? ?? false,
      lastSeenAt: json['last_seen_at'] != null
          ? DateTime.tryParse(json['last_seen_at'] as String)
          : null,
    );
  }
}
