import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../providers/auth_provider.dart';
import '../../theme/app_theme.dart';

// DEV ONLY: 发布前移除这组默认登录信息。
const _devServerUrl = 'https://lisibo.top:98';
const _devUsername = 'admin';
const _devPassword = 'ila5youNAS';
const _devDeviceName = 'Android Phone';

/// 登录页 — 输入服务端地址、账号密码、设备名
class LoginPage extends StatefulWidget {
  const LoginPage({super.key});

  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  final _serverUrlController = TextEditingController(text: _devServerUrl);
  final _usernameController = TextEditingController(text: _devUsername);
  final _passwordController = TextEditingController(text: _devPassword);
  final _deviceNameController = TextEditingController(text: _devDeviceName);
  final _formKey = GlobalKey<FormState>();
  bool _obscurePassword = true;
  bool _autoLoginTried = false;

  @override
  void initState() {
    super.initState();
    if (kDebugMode) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted || _autoLoginTried) return;
        _autoLoginTried = true;
        _login();
      });
    }
  }

  @override
  void dispose() {
    _serverUrlController.dispose();
    _usernameController.dispose();
    _passwordController.dispose();
    _deviceNameController.dispose();
    super.dispose();
  }

  Future<void> _login() async {
    if (!_formKey.currentState!.validate()) return;

    final auth = context.read<AuthProvider>();
    final success = await auth.login(
      serverUrl: _serverUrlController.text.trim(),
      username: _usernameController.text.trim(),
      password: _passwordController.text,
      deviceName: _deviceNameController.text.trim(),
    );
    if (!success || !mounted) return;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 28),
            child: Form(
              key: _formKey,
              child: Consumer<AuthProvider>(
                builder: (context, auth, _) {
                  return Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      // Logo 区
                      const Icon(
                        Icons.developer_mode,
                        size: 48,
                        color: AppTheme.brandLight,
                      ),
                      const SizedBox(height: 16),
                      const Text(
                        'YiboVibe',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          color: AppTheme.textPrimary,
                          fontSize: 28,
                          fontWeight: FontWeight.w700,
                          letterSpacing: -0.5,
                        ),
                      ),
                      const SizedBox(height: 4),
                      const Text(
                        'Vibe Coding Tools · Remote Console',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          color: AppTheme.textTertiary,
                          fontSize: 13,
                        ),
                      ),
                      const SizedBox(height: 40),

                      // 服务端地址
                      TextFormField(
                        controller: _serverUrlController,
                        style: const TextStyle(
                          color: AppTheme.textPrimary,
                          fontSize: 14,
                        ),
                        decoration: const InputDecoration(
                          labelText: '服务端地址',
                          hintText: 'http://your-server:8080',
                          prefixIcon: Icon(
                            Icons.dns,
                            color: AppTheme.textSecondary,
                          ),
                        ),
                        keyboardType: TextInputType.url,
                        validator: (v) =>
                            (v == null || v.trim().isEmpty) ? '请输入服务端地址' : null,
                      ),
                      const SizedBox(height: 14),

                      // 用户名
                      TextFormField(
                        controller: _usernameController,
                        style: const TextStyle(
                          color: AppTheme.textPrimary,
                          fontSize: 14,
                        ),
                        decoration: const InputDecoration(
                          labelText: '用户名',
                          hintText: '输入账号',
                          prefixIcon: Icon(
                            Icons.person,
                            color: AppTheme.textSecondary,
                          ),
                        ),
                        validator: (v) =>
                            (v == null || v.trim().isEmpty) ? '请输入用户名' : null,
                      ),
                      const SizedBox(height: 14),

                      // 密码
                      TextFormField(
                        controller: _passwordController,
                        obscureText: _obscurePassword,
                        style: const TextStyle(
                          color: AppTheme.textPrimary,
                          fontSize: 14,
                        ),
                        decoration: InputDecoration(
                          labelText: '密码',
                          hintText: '输入密码',
                          prefixIcon: const Icon(
                            Icons.lock,
                            color: AppTheme.textSecondary,
                          ),
                          suffixIcon: IconButton(
                            icon: Icon(
                              _obscurePassword
                                  ? Icons.visibility_off
                                  : Icons.visibility,
                              color: AppTheme.textSecondary,
                            ),
                            onPressed: () => setState(
                              () => _obscurePassword = !_obscurePassword,
                            ),
                          ),
                        ),
                        validator: (v) =>
                            (v == null || v.isEmpty) ? '请输入密码' : null,
                      ),
                      const SizedBox(height: 14),

                      // 设备名
                      TextFormField(
                        controller: _deviceNameController,
                        style: const TextStyle(
                          color: AppTheme.textPrimary,
                          fontSize: 14,
                        ),
                        decoration: const InputDecoration(
                          labelText: '设备名',
                          hintText: '此手机的名称',
                          prefixIcon: Icon(
                            Icons.phone_android,
                            color: AppTheme.textSecondary,
                          ),
                        ),
                        validator: (v) =>
                            (v == null || v.trim().isEmpty) ? '请输入设备名' : null,
                      ),
                      const SizedBox(height: 24),

                      // 错误提示
                      if (auth.error != null)
                        Container(
                          padding: const EdgeInsets.all(10),
                          margin: const EdgeInsets.only(bottom: 16),
                          decoration: BoxDecoration(
                            color: AppTheme.statusRed.withAlpha(15),
                            borderRadius: BorderRadius.circular(8),
                            border: Border.all(
                              color: AppTheme.statusRed.withAlpha(40),
                            ),
                          ),
                          child: Row(
                            children: [
                              const Icon(
                                Icons.error_outline,
                                size: 16,
                                color: AppTheme.statusRed,
                              ),
                              const SizedBox(width: 8),
                              Expanded(
                                child: Text(
                                  auth.error!,
                                  style: const TextStyle(
                                    color: AppTheme.statusRed,
                                    fontSize: 12,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),

                      // 登录按钮
                      SizedBox(
                        height: 46,
                        child: ElevatedButton(
                          onPressed: auth.isLoading ? null : _login,
                          child: auth.isLoading
                              ? const SizedBox(
                                  width: 20,
                                  height: 20,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                    color: AppTheme.textPrimary,
                                  ),
                                )
                              : const Text(
                                  '连接',
                                  style: TextStyle(
                                    fontSize: 15,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                        ),
                      ),
                    ],
                  );
                },
              ),
            ),
          ),
        ),
      ),
    );
  }
}
