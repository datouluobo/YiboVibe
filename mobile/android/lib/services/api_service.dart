import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

/// API Service — 对接 YiboVibe 服务端 v2-signal REST 接口
class ApiService {
  String? _baseUrl;
  String? _token;

  static const _keyServerUrl = 'yibovibe_server_url';
  static const _keyToken = 'yibovibe_access_token';
  static const _keyUid = 'yibovibe_uid';
  static const _keyDeviceId = 'yibovibe_device_id';

  String? get baseUrl => _baseUrl;
  String? get token => _token;
  bool get isLoggedIn => _token != null && _baseUrl != null;

  Future<void> loadFromStorage() async {
    final prefs = await SharedPreferences.getInstance();
    _baseUrl = prefs.getString(_keyServerUrl);
    _token = prefs.getString(_keyToken);
  }

  /// 登录并返回 {uid, access_token, device_id}
  /// 服务端路径: POST /api/v1/user/login
  Future<Map<String, dynamic>> login({
    required String serverUrl,
    required String username,
    required String password,
    required String deviceName,
  }) async {
    final url = serverUrl.endsWith('/') ? serverUrl : '$serverUrl/';
    _baseUrl = url;

    final response = await http.post(
      Uri.parse('${url}api/v1/user/login'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'username': username,
        'password': password,
        'device_name': deviceName,
        'device_type': 'mobile',
        'device_fingerprint': 'flutter-${DateTime.now().millisecondsSinceEpoch}', // 后端必须先注册设备再连接WS
      }),
    ).timeout(const Duration(seconds: 15));

    if (response.statusCode != 200) {
      throw Exception('登录失败: ${response.statusCode} ${response.body}');
    }

    final body = jsonDecode(response.body) as Map<String, dynamic>;
    if (body['code'] != 200) {
      throw Exception('登录失败: ${body['msg']}');
    }

    final data = body['data'] as Map<String, dynamic>;
    _token = data['access_token'] as String?;

    // 持久化
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_keyServerUrl, url);
    if (_token != null) await prefs.setString(_keyToken, _token!);
    await prefs.setString(
        _keyUid, data['uid']?.toString() ?? '');
    await prefs.setString(
        _keyDeviceId, data['device_id']?.toString() ?? '');

    return {
      'token': _token,
      'uid': data['uid'],
      'device_id': data['device_id'],
      'username': data['username'],
      'role': data['role'],
    };
  }

  /// 获取设备列表
  /// GET /api/v1/sync/devices
  Future<List<Map<String, dynamic>>> getDevices() async {
    final response = await _authGet('api/v1/sync/devices');
    final body = jsonDecode(response.body) as Map<String, dynamic>;
    if (body['code'] != 200) throw Exception(body['msg']);
    final list = body['data'] as List<dynamic>? ?? [];
    return list.cast<Map<String, dynamic>>();
  }

  /// 获取 session 列表
  /// GET /api/v1/sync/signal/sessions
  Future<List<Map<String, dynamic>>> getSessions() async {
    final response = await _authGet('api/v1/sync/signal/sessions');
    final body = jsonDecode(response.body) as Map<String, dynamic>;
    // 注意: sessions API 的 data 可能直接是数组
    final raw = body['data'] as List<dynamic>?;
    if (raw != null) return raw.cast<Map<String, dynamic>>();
    return [];
  }

  Future<String?> getSavedUid() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_keyUid);
  }

  Future<String?> getSavedDeviceId() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_keyDeviceId);
  }

  Future<void> logout() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_keyToken);
    await prefs.remove(_keyUid);
    await prefs.remove(_keyDeviceId);
    _token = null;
  }

  Future<http.Response> _authGet(String path) async {
    final response = await http.get(
      Uri.parse('${_baseUrl!}$path'),
      headers: _authHeaders(),
    ).timeout(const Duration(seconds: 10));
    _checkAuth(response);
    return response;
  }

  Map<String, String> _authHeaders() => {
        'Content-Type': 'application/json',
        if (_token != null) 'Authorization': 'Bearer $_token',
      };

  void _checkAuth(http.Response response) {
    if (response.statusCode == 401) {
      _token = null;
      throw Exception('认证已过期，请重新登录');
    }
  }
}
