import "dart:async";
import "package:flutter/material.dart";
import "../services/signal_client.dart";

class ConsolePage extends StatefulWidget {
  final SignalClient client;
  const ConsolePage({super.key, required this.client});

  @override
  State<ConsolePage> createState() => _ConsolePageState();
}

class _ConsolePageState extends State<ConsolePage> {
  StreamSubscription<SignalEvent>? _sub;
  final List<Map<String, dynamic>> _sessions = [];
  final List<String> _logs = [];
  int _selectedIndex = 0;

  @override
  void initState() {
    super.initState();
    _sub = widget.client.events.listen(_onEvent);
  }

  void _onEvent(SignalEvent event) {
    if (!mounted) return;
    setState(() {
      _logs.insert(0, "[${event.type}] ${event.error ?? event.data?.toString() ?? ""}");
      if (_logs.length > 100) _logs.removeLast();
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text("Remote Console"),
        actions: [
          IconButton(
            icon: const Icon(Icons.link),
            tooltip: "Connection Status",
            onPressed: () {},
          ),
        ],
      ),
      body: _selectedIndex == 0 ? _buildSessionsView() : _buildLogsView(),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _selectedIndex,
        onDestinationSelected: (i) => setState(() => _selectedIndex = i),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.terminal), label: "Sessions"),
          NavigationDestination(icon: Icon(Icons.article), label: "Logs"),
        ],
      ),
    );
  }

  Widget _buildSessionsView() {
    return _sessions.isEmpty
        ? const Center(child: Text("No active sessions"))
        : ListView.builder(
            itemCount: _sessions.length,
            itemBuilder: (ctx, i) {
              final s = _sessions[i];
              return ListTile(
                leading: const Icon(Icons.terminal),
                title: Text(s["label"] ?? "Session ${s["id"]}"),
                subtitle: Text("State: ${s["state"]}"),
                trailing: PopupMenuButton<String>(
                  onSelected: (cmd) {
                    widget.client.sendCommand(s["id"], cmd);
                  },
                  itemBuilder: (_) => [
                    const PopupMenuItem(value: "session:start", child: Text("Start")),
                    const PopupMenuItem(value: "session:stop", child: Text("Stop")),
                    const PopupMenuItem(value: "session:pause", child: Text("Pause")),
                    const PopupMenuItem(value: "session:resume", child: Text("Resume")),
                  ],
                ),
              );
            },
          );
  }

  Widget _buildLogsView() {
    return ListView.builder(
      reverse: true,
      itemCount: _logs.length,
      itemBuilder: (ctx, i) => ListTile(
        dense: true,
        title: Text(_logs[i], style: const TextStyle(fontSize: 12)),
      ),
    );
  }

  @override
  void dispose() {
    _sub?.cancel();
    widget.client.dispose();
    super.dispose();
  }
}
