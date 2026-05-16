import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'providers/auth_provider.dart';
import 'providers/session_provider.dart';
import 'pages/login_page.dart';
import 'pages/console_page.dart';
import 'theme/app_theme.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();

  // 强制竖屏
  SystemChrome.setPreferredOrientations([
    DeviceOrientation.portraitUp,
    DeviceOrientation.portraitDown,
  ]);

  // 沉浸式状态栏
  SystemChrome.setSystemUIOverlayStyle(const SystemUiOverlayStyle(
    statusBarColor: Colors.transparent,
    statusBarIconBrightness: Brightness.light,
    systemNavigationBarColor: AppTheme.bgSecondary,
    systemNavigationBarIconBrightness: Brightness.light,
  ));

  runApp(const YiboVibeApp());
}

class YiboVibeApp extends StatelessWidget {
  const YiboVibeApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (_) => AuthProvider()),
        ChangeNotifierProxyProvider<AuthProvider, SessionProvider>(
          create: (ctx) => SessionProvider(ctx.read<AuthProvider>()),
          update: (ctx, auth, previous) => previous!,
        ),
      ],
      child: MaterialApp(
        title: 'YiboVibe Mobile',
        debugShowCheckedModeBanner: false,
        theme: AppTheme.darkTheme,
        home: const _AuthGate(),
      ),
    );
  }
}

/// 认证网关 — 自动登录或跳到登录页
class _AuthGate extends StatefulWidget {
  const _AuthGate();

  @override
  State<_AuthGate> createState() => _AuthGateState();
}

class _AuthGateState extends State<_AuthGate> {
  bool _checking = true;

  @override
  void initState() {
    super.initState();
    _tryAutoLogin();
  }

  Future<void> _tryAutoLogin() async {
    final auth = context.read<AuthProvider>();
    await auth.tryAutoLogin();
    if (mounted) {
      setState(() => _checking = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_checking) {
      return const Scaffold(
        backgroundColor: AppTheme.bgPrimary,
        body: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.developer_mode,
                  size: 48, color: AppTheme.brandPurpleLight),
              SizedBox(height: 16),
              Text('YiboVibe',
                  style: TextStyle(
                      color: AppTheme.textPrimary,
                      fontSize: 20,
                      fontWeight: FontWeight.w700)),
              SizedBox(height: 20),
              SizedBox(
                width: 24,
                height: 24,
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  color: AppTheme.brandPurpleLight,
                ),
              ),
            ],
          ),
        ),
      );
    }

    return Consumer<AuthProvider>(
      builder: (context, auth, _) {
        if (auth.isLoggedIn) {
          return const ConsolePage();
        }
        return const LoginPage();
      },
    );
  }
}
