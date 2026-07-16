// Workbench tool selector — extracted from ai_workbench_page.dart
// Lets the user select which AI tool provider to use

import 'package:flutter/material.dart';
import '../models/ai_workbench.dart';

class WorkbenchToolSelector extends StatelessWidget {
  final List<AiWorkbenchProvider> providers;
  final String? selectedToolId;
  final ValueChanged<String> onSelectTool;

  const WorkbenchToolSelector({
    super.key,
    required this.providers,
    this.selectedToolId,
    required this.onSelectTool,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Padding(
          padding: EdgeInsets.all(8.0),
          child: Text('选择工具', style: TextStyle(fontWeight: FontWeight.bold)),
        ),
        ...providers.map((provider) => RadioListTile<String>(
          title: Text(provider.name),
          subtitle: Text('传输: ${provider.transport}'),
          value: provider.id,
          groupValue: selectedToolId,
          onChanged: (id) {
            if (id != null) onSelectTool(id);
          },
        )),
      ],
    );
  }
}
