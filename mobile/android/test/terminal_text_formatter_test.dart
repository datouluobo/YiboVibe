import 'package:flutter_test/flutter_test.dart';
import 'package:yibovibe_mobile/utils/terminal_text_formatter.dart';

void main() {
  group('TerminalTextFormatter', () {
    test('detects interactive terminal surfaces', () {
      const sample =
          '⚙️ Model Picker — Select Provider\n'
          '┌──────────────────────────────┐\n'
          '│ Current: flowprobe-anthropic │\n'
          '└──────────────────────────────┘';

      expect(TerminalTextFormatter.looksLikeInteractiveSurface(sample), isTrue);
    });

    test('cleans pwsh body and prompt artifacts', () {
      const sample =
          'm\n> pwd\n32m1m\nPath\n----m\nF:\\Download\\GitHub\\YiboVibe\\desktop\\src-tauri\n\nPSF:\\Download\\GitHub\\YiboVibe\\desktop\\src-tauri>';

      expect(
        TerminalTextFormatter.displayBody(
          sample,
          preserveBlankLines: true,
          dropPromptLines: true,
        ),
        'Path\n----\nF:\\Download\\GitHub\\YiboVibe\\desktop\\src-tauri',
      );

      expect(
        TerminalTextFormatter.extractPrompt(sample),
        'PS F:\\Download\\GitHub\\YiboVibe\\desktop\\src-tauri>',
      );
    });

    test('cleans cmd dir output and prompt artifacts', () {
      const sample =
          'mF:\\Download\\GitHub\\YiboVibe\\desktop\\src-tauri>\n> dir\n驱动器 F 中的卷是 Temporary\n卷的序列号是 D8E9-38AE\nF:\\Download\\GitHub\\YiboVibe\\desktop\\src-tauri 的目录\n2026-05-14  10:25    <DIR>          .\n2026-05-12  17:04    <DIR>          ..\n2026-05-14  10:25            12,288 .swp\nF:\\Download\\GitHub\\YiboVibe\\desktop\\src-tauri>';

      expect(
        TerminalTextFormatter.displayBody(
          sample,
          preserveBlankLines: true,
          dropPromptLines: true,
        ),
        '驱动器 F 中的卷是 Temporary\n'
        '卷的序列号是 D8E9-38AE\n'
        'F:\\Download\\GitHub\\YiboVibe\\desktop\\src-tauri 的目录\n'
        '2026-05-14  10:25    <DIR>          .\n'
        '2026-05-12  17:04    <DIR>          ..\n'
        '2026-05-14  10:25            12,288 .swp',
      );

      expect(
        TerminalTextFormatter.extractPrompt(sample),
        'F:\\Download\\GitHub\\YiboVibe\\desktop\\src-tauri>',
      );
    });

    test('cleans wsl ls body and prompt artifacts', () {
      const sample =
          'm\n> ls\n32m1m2 32m1mbuild.rsm 32m1mcheck_out.txtm 32m1merr.txtm\n34m42mcapabilitiesm 32m1mout.txtm\nadministrator@Lis-PC:m34m1m/mnt/f/Download/GitHub/YiboVibe/desktop/src-taurim\$';

      expect(
        TerminalTextFormatter.displayBody(
          sample,
          preserveBlankLines: true,
          dropPromptLines: true,
        ),
        '2 build.rs check_out.txt err.txt\ncapabilities out.txt',
      );

      expect(
        TerminalTextFormatter.extractPrompt(sample),
        r'administrator@Lis-PC:/mnt/f/Download/GitHub/YiboVibe/desktop/src-tauri$',
      );
    });

    test(
      'reconstructs interactive redraw stream without injecting fake lines',
      () {
        const sample =
            'Current: flowprobe-anthropic\r'
            'Current: Nvidia (55 models)\r'
            'Current: OpenRouter (31 models)\n'
            '> ';

        expect(
          TerminalTextFormatter.sanitize(
            sample,
            preserveBlankLines: true,
            preserveCarriageReturns: true,
          ),
          'Current: OpenRouter (31 models)\n>',
        );
      },
    );
  });
}
