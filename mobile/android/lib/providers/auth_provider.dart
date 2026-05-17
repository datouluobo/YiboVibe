import 'package:flutter/foundation.dart';
import '../services/api_service.dart';

/// 认证状态管理
class AuthProvider extends ChangeNotifier {
  final ApiService _api = ApiService();

  bool _isLoggedIn = false;
  bool _isLoading = false;
  String? _error;
  int? _uid;
  int? _deviceId;
  String? _serverUrl;
  String? _token;

  bool get isLoggedIn => _isLoggedIn;
  bool get isLoading => _isLoading;
  String? get error => _error;
  int? get uid => _uid;
  int? get deviceId => _deviceId;
  String? get serverUrl => _serverUrl;
  String? get token => _token;

  Future<void> tryAutoLogin() async {
    await _api.loadFromStorage();
    if (_api.isLoggedIn) {
      try {
        await _api.validateToken();
        final uidStr = await _api.getSavedUid();
        final deviceIdStr = await _api.getSavedDeviceId();
        _uid = uidStr != null ? int.tryParse(uidStr) : null;
        _deviceId = deviceIdStr != null ? int.tryParse(deviceIdStr) : null;
        _serverUrl = _api.baseUrl;
        _token = _api.token;
        _isLoggedIn = true;
      } catch (_) {
        await _api.logout();
        _isLoggedIn = false;
        _uid = null;
        _deviceId = null;
        _serverUrl = null;
        _token = null;
      }
      notifyListeners();
    }
  }

  Future<bool> login({
    required String serverUrl,
    required String username,
    required String password,
    required String deviceName,
  }) async {
    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      final result = await _api.login(
        serverUrl: serverUrl,
        username: username,
        password: password,
        deviceName: deviceName,
      );
      _uid = result['uid'] as int?;
      _deviceId = result['device_id'] as int?;
      _serverUrl = _api.baseUrl;
      _token = _api.token;
      _isLoggedIn = true;
      _error = null;
      _isLoading = false;
      notifyListeners();
      return true;
    } catch (e) {
      _error = e.toString().replaceFirst('Exception: ', '');
      _isLoading = false;
      notifyListeners();
      return false;
    }
  }

  Future<void> logout() async {
    await _api.logout();
    _isLoggedIn = false;
    _uid = null;
    _deviceId = null;
    _serverUrl = null;
    _token = null;
    _error = null;
    notifyListeners();
  }
}
