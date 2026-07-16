import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'providers/ai_workbench_sync_provider.dart';
import 'providers/auth_provider.dart';
import 'providers/session_provider.dart';
import 'pages/login_page.dart';
import 'pages/console_page.dart';
import 'pages/ai_workbench_page.dart';
import 'theme/app_theme.dart';

void main() {
  debugPrint('YiboVibe main() start');
  WidgetsFlutterBinding.ensureInitialized();
  final launchProbe =
      kIsWeb && Uri.base.fragment.toLowerCase().contains('/probe');
  if (!kIsWeb) {
    SystemChrome.setPreferredOrientations([
      DeviceOrientation.portraitUp,
      DeviceOrientation.portraitDown,
    ]);
    SystemChrome.setSystemUIOverlayStyle(
      const SystemUiOverlayStyle(
        statusBarColor: Colors.transparent,
        statusBarIconBrightness: Brightness.dark,
        systemNavigationBarColor: AppTheme.bgPrimary,
        systemNavigationBarIconBrightness: Brightness.dark,
      ),
    );
  }
  if (launchProbe) {
    debugPrint('YiboVibe runApp() probe');
    runApp(const _WebProbeApp());
    return;
  }
  debugPrint('YiboVibe runApp()');
  runApp(const YiboVibeApp());
}

class YiboVibeApp extends StatelessWidget {
  const YiboVibeApp({super.key});

  @override
  Widget build(BuildContext context) {
    debugPrint('YiboVibeApp build');
    return MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (_) => AuthProvider()),
        ChangeNotifierProxyProvider<AuthProvider, AiWorkbenchSyncProvider>(
          create: (ctx) => AiWorkbenchSyncProvider(ctx.read<AuthProvider>()),
          update: (ctx, auth, previous) {
            final provider = previous ?? AiWorkbenchSyncProvider(auth);
            provider.updateAuth(auth);
            return provider;
          },
        ),
        ChangeNotifierProxyProvider<AuthProvider, SessionProvider>(
          create: (ctx) => SessionProvider(ctx.read<AuthProvider>()),
          update: (ctx, auth, previous) => previous ?? SessionProvider(auth),
        ),
      ],
      child: MaterialApp(
        title: 'YiboVibe Mobile',
        debugShowCheckedModeBanner: false,
        theme: AppTheme.lightTheme,
        builder: kIsWeb ? _webFrameBuilder : null,
        routes: {
          '/console-legacy': (_) => const ConsolePage(),
          '/workbench': (_) => const AiWorkbenchPage(),
          '/probe': (_) => const _WebProbePage(),
        },
        home: const _AuthGate(),
      ),
    );
  }
}

/// Web 宽度限制: 居中显示在桌面浏览器，模拟手机屏幕
Widget _webFrameBuilder(BuildContext context, Widget? child) {
  debugPrint('YiboVibe web frame build');
  return Material(
    color: const Color(0xFFF0F0F3),
    child: LayoutBuilder(
      builder: (context, constraints) {
        return Center(
          child: ClipRRect(
            child: SizedBox(
              width: 420,
              height: constraints.maxHeight,
              child: child,
            ),
          ),
        );
      },
    ),
  );
}

/// 认证网关
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
    if (mounted) setState(() => _checking = false);
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
              Icon(Icons.developer_mode, size: 48, color: AppTheme.brandLight),
              SizedBox(height: 16),
              Text(
                'YiboVibe',
                style: TextStyle(
                  color: AppTheme.textPrimary,
                  fontSize: 20,
                  fontWeight: FontWeight.w700,
                ),
              ),
              SizedBox(height: 20),
              SizedBox(
                width: 24,
                height: 24,
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  color: AppTheme.brandLight,
                ),
              ),
            ],
          ),
        ),
      );
    }
    return Consumer<AuthProvider>(
      builder: (context, auth, _) {
        if (auth.isLoggedIn) return const AiWorkbenchPage();
        return const LoginPage();
      },
    );
  }
}

class _WebProbePage extends StatelessWidget {
  const _WebProbePage();

  @override
  Widget build(BuildContext context) {
    debugPrint('WebProbePage build');
    return const Scaffold(
      backgroundColor: Colors.white,
      body: Center(
        child: Text(
          'web probe ok',
          style: TextStyle(
            color: Colors.black,
            fontSize: 24,
            fontWeight: FontWeight.w700,
          ),
        ),
      ),
    );
  }
}

class _WebProbeApp extends StatelessWidget {
  const _WebProbeApp();

  @override
  Widget build(BuildContext context) {
    debugPrint('WebProbeApp build');
    return const MaterialApp(
      debugShowCheckedModeBanner: false,
      home: _WebProbePage(),
    );
  }
}
