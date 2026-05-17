import sys

content = r'''import "dart:async";
import "dart:convert";
import "package:flutter/material.dart";
import "../services/signal_client.dart";
import "../services/api_service.dart";

class ConsolePage extends StatefulWidget {
  final SignalClient client;
  final String serverUrl;
  final String token;

  const ConsolePage({
    super.key,
    required this.client,
    required this.serverUrl,
    required this.token,
  });

  @override
  State<ConsolePage> createState() => _ConsolePageState();
}

class _ConsolePageState extends State<ConsolePage> {
  StreamSubscription<SignalEvent>? _sub;
  final List<Map<String, dynamic>> _sessions = [];
  final Map<String, List<String>> _outputs = {};
  final List<String> _events = [];
  final TextEditingController _inputCtrl = TextEditingController();
  final ScrollController _outputScrollCtrl = ScrollController();
  String? _selectedSessionId;
  String _statusText = "Disconnected";
  Color _statusColor = Colors.grey;
  bool _autoRefresh = true;
  Timer? _refreshTimer;

  @override
  void initState() {
    super.initState();
    _sub = widget.client.events.listen(_onEvent);
    _fetchSessions();
    _refreshTimer = Timer.periodic(const Duration(seconds: 3), (_) {
      if (_autoRefresh) _fetchSessions();
    });
  }

  @override
  void dispose() {
    _sub?.cancel();
    _inputCtrl.dispose();
    _outputScrollCtrl.dispose();
    _refreshTimer?.cancel();
    super.dispose();
  }

  Future<void> _fetchSessions() async {
    try {
      final api = ApiService(widget.serverUrl);
      final sessions = await api.fetchSessions(widget.token);
      if (!mounted) return;
      setState(() {
        _sessions.clear();
        _sessions.addAll(sessions);
        // Auto-select first session if none selected or selected removed
        if (_selectedSessionId == null || !sessions.any((s) => s["id"] == _selectedSessionId)) {
          _selectedSessionId = sessions.isNotEmpty ? sessions[0]["id"] as String? : null;
        }
      });
    } catch (_) {
      // ignore refresh errors
    }
  }

  void _onEvent(SignalEvent event) {
    if (!mounted) return;
    setState(() {
      if (event.type == "connected") {
        _statusText = "Connected";
        _statusColor = Colors.green;
      } else if (event.type == "disconnected") {
        _statusText = "Disconnected: ${event.error ?? ""}";
        _statusColor = Colors.red;
      } else if (event.type == "message" && event.data != null) {
        final msg = event.data!;
        final msgType = msg["type"] as String? ?? "";
        final sessionId = msg["session_id"] as String? ?? msg["payload"]?["session_id"] as String? ?? "";

        if (msgType == "session:output" && sessionId.isNotEmpty) {
          final text = msg["payload"]?["text"] as String? ?? msg["text"] as String? ?? "";
          if (text.isNotEmpty) {
            _outputs.putIfAbsent(sessionId, () => []);
            _outputs[sessionId]!.add(text);
            // Scroll to bottom
            WidgetsBinding.instance.addPostFrameCallback((_) {
              if (_outputScrollCtrl.hasClients) {
                _outputScrollCtrl.animateTo(
                  _outputScrollCtrl.position.maxScrollExtent,
                  duration: const Duration(milliseconds: 100),
                  curve: Curves.easeOut,
                );
              }
            });
          }
        } else if (msgType == "session:register" || msgType == "session:update") {
          // Session list changed, refresh
          _fetchSessions();
        } else {
          _events.insert(0, "[${msgType}] ${msg["payload"]?.toString() ?? ""}");
          if (_events.length > 100) _events.removeLast();
        }
      }
    });
  }

  void _sendCommand(String sessionId, String command) {
    widget.client.sendCommand(sessionId, command);
    _addEvent("Sent: $command");
  }

  void _sendStdin() {
    final text = _inputCtrl.text;
    if (text.isEmpty || _selectedSessionId == null) return;
    widget.client.sendStdin(_selectedSessionId!, text);
    _addEvent("Sent stdin: $text");
    _inputCtrl.clear();
  }

  void _addEvent(String text) {
    setState(() {
      _events.insert(0, "[local] $text");
      if (_events.length > 100) _events.removeLast();
    });
  }

  /// Confirm before sending a destructive command
  Future<bool> _confirmAction(String action) async {
    final result = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text("$action session?"),
        content: const Text("This will affect the running process on the desktop host."),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text("Cancel")),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text("Confirm")),
        ],
      ),
    );
    return result ?? false;
  }

  @override
  Widget build(BuildContext context) {
    final session = _sessions.where((s) => s["id"] == _selectedSessionId).firstOrNull;
    final output = _selectedSessionId != null
        ? (_outputs[_selectedSessionId] ?? [])
        : <String>[];

    return Scaffold(
      appBar: AppBar(
        title: const Text("Remote Console"),
        actions: [
          // Connection status dot
          Container(
            margin: const EdgeInsets.only(right: 8),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: 10,
                  height: 10,
                  decoration: BoxDecoration(
                    color: _statusColor,
                    shape: BoxShape.circle,
                  ),
                ),
                const SizedBox(width: 6),
                Text(
                  _statusText.length > 20
                      ? "${_statusText.substring(0, 20)}..."
                      : _statusText,
                  style: const TextStyle(fontSize: 11),
                ),
              ],
            ),
          ),
          IconButton(
            icon: const Icon(Icons.refresh),
            tooltip: "Refresh sessions",
            onPressed: _fetchSessions,
          ),
        ],
      ),
      body: Column(
        children: [
          // Device/Session selector bar
          if (_sessions.isNotEmpty)
            Container(
              height: 44,
              padding: const EdgeInsets.symmetric(horizontal: 12),
              child: ListView.builder(
                scrollDirection: Axis.horizontal,
                itemCount: _sessions.length,
                itemBuilder: (ctx, i) {
                  final s = _sessions[i];
                  final id = s["id"] as String? ?? "";
                  final state = s["state"] as String? ?? "unknown";
                  final label = s["shell_kind"] as String? ?? "shell";
                  final active = id == _selectedSessionId;
                  final isRunning = state == "running";

                  return Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: FilterChip(
                      selected: active,
                      label: Text("$label #${i + 1}"),
                      avatar: Container(
                        width: 8,
                        height: 8,
                        decoration: BoxDecoration(
                          color: isRunning ? Colors.green : Colors.grey,
                          shape: BoxShape.circle,
                        ),
                      ),
                      onSelected: (val) {
                        setState(() => _selectedSessionId = id);
                      },
                    ),
                  );
                },
              ),
            ),

          // No sessions placeholder
          if (_sessions.isEmpty)
            const Padding(
              padding: EdgeInsets.all(32),
              child: Text("No active sessions. Start one from your desktop.", style: TextStyle(color: Colors.grey)),
            ),

          // Session action buttons
          if (_selectedSessionId != null)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
              child: Row(
                children: [
                  _actionButton("Start", Icons.play_arrow, () => _sendCommand(_selectedSessionId!, "session:start")),
                  const SizedBox(width: 6),
                  _actionButton("Stop", Icons.stop, () async {
                    if (await _confirmAction("Stop")) {
                      _sendCommand(_selectedSessionId!, "session:stop");
                    }
                  }),
                  const SizedBox(width: 6),
                  _actionButton("Pause", Icons.pause, () => _sendCommand(_selectedSessionId!, "session:pause")),
                  const SizedBox(width: 6),
                  _actionButton("Resume", Icons.skip_next, () => _sendCommand(_selectedSessionId!, "session:resume")),
                  const Spacer(),
                  Text("state: ${_sessionState(_selectedSessionId!)}", style: const TextStyle(fontSize: 12, color: Colors.grey)),
                ],
              ),
            ),

          const Divider(height: 1),

          // Output area
          Expanded(
            child: output.isEmpty
                ? const Center(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(Icons.terminal, size: 48, color: Colors.grey),
                        SizedBox(height: 12),
                        Text("No output yet", style: TextStyle(color: Colors.grey)),
                        SizedBox(height: 4),
                        Text("Send a command or start a session", style: TextStyle(fontSize: 12, color: Colors.grey)),
                      ],
                    ),
                  )
                : ListView.builder(
                    controller: _outputScrollCtrl,
                    padding: const EdgeInsets.all(12),
                    itemCount: output.length,
                    itemBuilder: (ctx, i) {
                      final line = output[i].trimRight();
                      if (line.isEmpty) return const SizedBox(height: 4);
                      return Padding(
                        padding: const EdgeInsets.only(bottom: 2),
                        child: Text(
                          line,
                          style: const TextStyle(
                            fontFamily: "monospace",
                            fontSize: 12,
                            color: Color(0xFFD4D4D4),
                          ),
                        ),
                      );
                    },
                  ),
          ),

          // Input area
          Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: Theme.of(context).colorScheme.surfaceContainerHighest,
            ),
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _inputCtrl,
                    decoration: const InputDecoration(
                      hintText: "Type a command to send...",
                      border: OutlineInputBorder(),
                      contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                      isDense: true,
                    ),
                    style: const TextStyle(fontFamily: "monospace", fontSize: 14),
                    textInputAction: TextInputAction.send,
                    onSubmitted: (_) => _sendStdin(),
                  ),
                ),
                const SizedBox(width: 8),
                IconButton(
                  icon: const Icon(Icons.send),
                  onPressed: _sendStdin,
                  tooltip: "Send to session",
                ),
              ],
            ),
          ),

          // Event log toggle
          ExpansionTile(
            title: const Text("Event Log", style: TextStyle(fontSize: 12)),
            initiallyExpanded: false,
            children: [
              SizedBox(
                height: 120,
                child: ListView.builder(
                  reverse: true,
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  itemCount: _events.length,
                  itemBuilder: (ctx, i) => Padding(
                    padding: const EdgeInsets.only(bottom: 2),
                    child: Text(
                      _events[i],
                      style: const TextStyle(fontSize: 10, color: Colors.grey, fontFamily: "monospace"),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _actionButton(String label, IconData icon, VoidCallback onPressed) {
    return SizedBox(
      height: 32,
      child: OutlinedButton.icon(
        onPressed: onPressed,
        icon: Icon(icon, size: 16),
        label: Text(label, style: const TextStyle(fontSize: 11)),
        style: OutlinedButton.styleFrom(
          padding: const EdgeInsets.symmetric(horizontal: 8),
        ),
      ),
    );
  }

  String _sessionState(String id) {
    final s = _sessions.where((s) => s["id"] == id).firstOrNull;
    return (s?["state"] as String? ?? "unknown");
  }
}
'''

with open(sys.argv[1], 'w', encoding='utf-8') as f:
    f.write(content)
print('OK: console_page.dart rewritten')
