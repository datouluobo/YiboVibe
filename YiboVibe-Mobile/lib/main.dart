// YiboVibe Remote Console - Main entry point
// Connects to the server Signal Hub and provides remote control

import "package:flutter/material.dart";
import "services/signal_client.dart";
import "pages/console_page.dart";
import "pages/login_page.dart";

void main() {
  runApp(const YiboVibeMobileApp());
}

class YiboVibeMobileApp extends StatelessWidget {
  const YiboVibeMobileApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: "YiboVibe Remote",
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF1A73E8),
          brightness: Brightness.dark,
        ),
        useMaterial3: true,
      ),
      home: const LoginPage(),
    );
  }
}
