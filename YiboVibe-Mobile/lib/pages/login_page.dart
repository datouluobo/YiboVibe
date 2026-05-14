import "package:flutter/material.dart";
import "package:shared_preferences/shared_preferences.dart";
import "../services/signal_client.dart";
import "console_page.dart";

class LoginPage extends StatefulWidget {
  const LoginPage({super.key});

  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  final _serverCtrl = TextEditingController(text: "http://192.168.1.100:11434");
  final _tokenCtrl = TextEditingController();
  bool _loading = false;

  @override
  void initState() {
    super.initState();
    _loadSaved();
  }

  Future<void> _loadSaved() async {
    final prefs = await SharedPreferences.getInstance();
    setState(() {
      _serverCtrl.text = prefs.getString("server_url") ?? _serverCtrl.text;
      _tokenCtrl.text = prefs.getString("auth_token") ?? "";
    });
  }

  Future<void> _connect() async {
    setState(() => _loading = true);
    try {
      final client = SignalClient();
      await client.connect(
        _serverCtrl.text.trim(),
        _tokenCtrl.text.trim(),
        1, // uid from login response
        101, // device id from login
      );

      if (mounted) {
        Navigator.pushReplacement(
          context,
          MaterialPageRoute(
            builder: (_) => ConsolePage(client: client),
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text("Connection failed: $e")),
        );
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text("YiboVibe Remote Console")),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            TextField(
              controller: _serverCtrl,
              decoration: const InputDecoration(
                labelText: "Server URL",
                hintText: "http://192.168.1.100:11434",
              ),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _tokenCtrl,
              obscureText: true,
              decoration: const InputDecoration(
                labelText: "Auth Token",
              ),
            ),
            const SizedBox(height: 24),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                onPressed: _loading ? null : _connect,
                child: _loading
                    ? const CircularProgressIndicator()
                    : const Text("Connect"),
              ),
            ),
          ],
        ),
      ),
    );
  }

  @override
  void dispose() {
    _serverCtrl.dispose();
    _tokenCtrl.dispose();
    super.dispose();
  }
}
