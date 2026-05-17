import sys

# Write API service
content = r'''import "dart:convert";
import "dart:io";
import "package:shared_preferences/shared_preferences.dart";

/// Auth result from the YiboVibe server login API.
class AuthResult {
  final int uid;
  final int deviceId;
  final String username;
  final String role;
  final String accessToken;
  final String kdfSalt;

  AuthResult({
    required this.uid,
    required this.deviceId,
    required this.username,
    required this.role,
    required this.accessToken,
    required this.kdfSalt,
  });

  factory AuthResult.fromJson(Map<String, dynamic> json) {
    final data = json["data"] as Map<String, dynamic>? ?? {};
    return AuthResult(
      uid: data["uid"] as int? ?? 0,
      deviceId: data["device_id"] as int? ?? 0,
      username: data["username"] as String? ?? "",
      role: data["role"] as String? ?? "user",
      accessToken: data["access_token"] as String? ?? "",
      kdfSalt: data["kdf_salt"] as String? ?? "",
    );
  }

  Map<String, dynamic> toJson() => {
    "uid": uid,
    "device_id": deviceId,
    "username": username,
    "role": role,
    "access_token": accessToken,
    "kdf_salt": kdfSalt,
  };
}

/// API service for communicating with the YiboVibe server.
class ApiService {
  final String serverUrl;
  final HttpClient _client = HttpClient()
    ..connectionTimeout = const Duration(seconds: 10);

  ApiService(this.serverUrl);

  String get wsUrl => serverUrl
      .replaceAll("http://", "ws://")
      .replaceAll("https://", "wss://");

  /// POST /api/v1/user/login with username + password + device info
  /// Returns AuthResult with token, uid, device_id.
  Future<AuthResult> login(
    String username,
    String password, {
    String deviceName = "YiboVibe Mobile",
    String deviceType = "android",
    String deviceFingerprint = "mobile-default",
  }) async {
    final url = Uri.parse("$serverUrl/api/v1/user/login");
    final body = jsonEncode({
      "username": username,
      "password": password,
      "device_name": deviceName,
      "device_type": deviceType,
      "device_fingerprint": deviceFingerprint,
    });

    final request = await _client.postUrl(url);
    request.headers.contentType = ContentType.json;
    request.write(body);
    final response = await request.close();
    final responseBody = await response.transform(utf8.decoder).join();
    final json = jsonDecode(responseBody) as Map<String, dynamic>;

    final code = json["code"] as int? ?? 500;
    if (code != 200) {
      throw Exception(json["msg"] ?? "Login failed");
    }

    return AuthResult.fromJson(json);
  }

  /// GET /api/v1/sync/signal/sessions with Bearer token
  /// Returns list of session data from the server.
  Future<List<Map<String, dynamic>>> fetchSessions(String token) async {
    final url = Uri.parse("$serverUrl/api/v1/sync/signal/sessions");
    final request = await _client.getUrl(url);
    request.headers.set("Authorization", "Bearer $token");
    final response = await request.close();
    final responseBody = await response.transform(utf8.decoder).join();
    final json = jsonDecode(responseBody) as Map<String, dynamic>;

    final code = json["code"] as int? ?? 500;
    if (code != 200) {
      throw Exception(json["msg"] ?? "Failed to fetch sessions");
    }

    final data = json["data"] as List<dynamic>? ?? [];
    return data.cast<Map<String, dynamic>>();
  }
}
'''

with open(sys.argv[1], 'w', encoding='utf-8') as f:
    f.write(content)
print('OK: api_service.dart written')
