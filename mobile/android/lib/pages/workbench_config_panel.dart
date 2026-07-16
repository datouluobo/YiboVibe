// Workbench config panel — extracted from ai_workbench_page.dart
// Configures model, service tier, and reasoning effort

import 'package:flutter/material.dart';
import '../models/ai_workbench.dart';

class WorkbenchConfigPanel extends StatelessWidget {
  final List<AiWorkbenchModel> models;
  final String? selectedModelId;
  final ValueChanged<String> onSelectModel;
  final String? selectedServiceTier;
  final ValueChanged<String> onSelectServiceTier;
  final String? selectedEffort;
  final ValueChanged<String> onSelectEffort;

  const WorkbenchConfigPanel({
    super.key,
    required this.models,
    this.selectedModelId,
    required this.onSelectModel,
    this.selectedServiceTier,
    required this.onSelectServiceTier,
    this.selectedEffort,
    required this.onSelectEffort,
  });

  static const List<String> _serviceTierOptions = ['default', 'priority'];
  static const List<String> _fallbackReasoningEfforts = [
    'minimal', 'low', 'medium', 'high', 'xhigh',
  ];

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Model selector
        const Padding(
          padding: EdgeInsets.all(8.0),
          child: Text('模型', style: TextStyle(fontWeight: FontWeight.bold)),
        ),
        ...models.map((model) => RadioListTile<String>(
          title: Text(model.label),
          value: model.id,
          groupValue: selectedModelId,
          onChanged: (id) { if (id != null) onSelectModel(id); },
        )),
        // Service tier
        const Padding(
          padding: EdgeInsets.all(8.0),
          child: Text('服务等级', style: TextStyle(fontWeight: FontWeight.bold)),
        ),
        ..._serviceTierOptions.map((tier) => RadioListTile<String>(
          title: Text(tier),
          value: tier,
          groupValue: selectedServiceTier,
          onChanged: (v) { if (v != null) onSelectServiceTier(v); },
        )),
        // Reasoning effort
        const Padding(
          padding: EdgeInsets.all(8.0),
          child: Text('推理深度', style: TextStyle(fontWeight: FontWeight.bold)),
        ),
        ..._fallbackReasoningEfforts.map((effort) => RadioListTile<String>(
          title: Text(effort),
          value: effort,
          groupValue: selectedEffort,
          onChanged: (v) { if (v != null) onSelectEffort(v); },
        )),
      ],
    );
  }
}
