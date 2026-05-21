import 'package:flutter/material.dart';

class TerminalChunkRepairResult {
  final String text;
  final String carry;

  const TerminalChunkRepairResult({
    required this.text,
    required this.carry,
  });
}

class TerminalEchoStripResult {
  final String text;
  final bool matched;

  const TerminalEchoStripResult({
    required this.text,
    required this.matched,
  });
}

class TerminalTextFormatter {
  static final RegExp _oscPattern = RegExp(
    r'\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)',
  );
  static final RegExp _csiPattern = RegExp(r'\x1B\[[0-?]*[ -/]*[@-~]');
  static final RegExp _singleEscapePattern = RegExp(r'\x1B[@-_]');
  static final RegExp _sgrPattern = RegExp(r'^\x1B\[[0-9;]*m$');
  static final RegExp _cmdPromptPattern = RegExp(r'^[A-Za-z]:\\.*>$');
  static final RegExp _pwshPromptPattern = RegExp(r'^PS [A-Za-z]:\\.*>$');
  static final RegExp _wslPromptPattern = RegExp(r'^[^@\s]+@[^:]+:.*[$#]$');
  static final RegExp _cursorTogglePrefixPattern = RegExp(
    r'^(?:\?25[hl]|\[\?25[hl]|\[[0-9;]*[A-Za-z])\s*',
  );
  static final RegExp _ansiOnlyPattern = RegExp(r'^(?:\x1B\[[0-9;]*m)+$');

  static String sanitize(String input) {
    if (input.isEmpty) return '';

    final text = _prepareRichTextInput(input);
    final lines = <String>[];
    final buffer = <String>[];
    var cursor = 0;

    void flushLine() {
      lines.add(buffer.join());
      buffer.clear();
      cursor = 0;
    }

    for (final rune in text.runes) {
      switch (rune) {
        case 0x0A:
          flushLine();
          break;
        case 0x0D:
          cursor = 0;
          break;
        case 0x08:
        case 0x7F:
          if (cursor > 0) {
            cursor -= 1;
            if (cursor < buffer.length) {
              buffer.removeAt(cursor);
            }
          }
          break;
        case 0x09:
          for (var i = 0; i < 2; i++) {
            if (cursor < buffer.length) {
              buffer[cursor] = ' ';
            } else {
              buffer.add(' ');
            }
            cursor += 1;
          }
          break;
        default:
          if (rune < 0x20) {
            continue;
          }
          final ch = String.fromCharCode(rune);
          if (cursor < buffer.length) {
            buffer[cursor] = ch;
          } else {
            buffer.add(ch);
          }
          cursor += 1;
      }
    }

    if (buffer.isNotEmpty || lines.isEmpty) {
      lines.add(buffer.join());
    }

    final cleaned = lines
        .map((line) {
          var cleanedLine = line.replaceAll(RegExp(r'[ \t]+$'), '');
          cleanedLine = cleanedLine.replaceFirst(_cursorTogglePrefixPattern, '');
          return cleanedLine;
        })
        .where((line) => line.trim().isNotEmpty)
        .join('\n')
        .replaceAll(RegExp(r'\n{3,}'), '\n\n')
        .trimRight();

    return cleaned;
  }

  static String displayText(String input) {
    final cleaned = sanitize(input);
    return cleaned.isEmpty ? '' : cleaned;
  }

  static TerminalChunkRepairResult repairChunk(String carry, String chunk) {
    final source = '$carry$chunk';
    if (source.isEmpty) {
      return const TerminalChunkRepairResult(text: '', carry: '');
    }

    final output = StringBuffer();
    var index = 0;
    while (index < source.length) {
      final char = source[index];
      if (char != '\x1B') {
        output.write(char);
        index += 1;
        continue;
      }

      if (index + 1 >= source.length) {
        return TerminalChunkRepairResult(
          text: output.toString(),
          carry: source.substring(index),
        );
      }

      final next = source[index + 1];
      if (next == '[') {
        final end = _findCsiEnd(source, index + 2);
        if (end == -1) {
          return TerminalChunkRepairResult(
            text: output.toString(),
            carry: source.substring(index),
          );
        }
        output.write(source.substring(index, end + 1));
        index = end + 1;
        continue;
      }

      if (next == ']') {
        final end = _findOscEnd(source, index + 2);
        if (end == -1) {
          return TerminalChunkRepairResult(
            text: output.toString(),
            carry: source.substring(index),
          );
        }
        output.write(source.substring(index, end));
        index = end;
        continue;
      }

      output.write(source.substring(index, index + 2));
      index += 2;
    }

    return TerminalChunkRepairResult(text: output.toString(), carry: '');
  }

  static TerminalEchoStripResult stripLeadingCommandEcho(
    String input,
    String command,
  ) {
    final normalizedCommand = command.trim();
    if (normalizedCommand.isEmpty || input.isEmpty) {
      return TerminalEchoStripResult(text: input, matched: false);
    }

    final normalized = input.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
    final lines = normalized.split('\n');
    var matched = false;
    var cursor = 0;

    while (cursor < lines.length) {
      final rawLine = lines[cursor];
      final visibleLine = displayText(rawLine).trim();
      if (visibleLine.isEmpty || _ansiOnlyPattern.hasMatch(rawLine.trim())) {
        cursor += 1;
        continue;
      }

      if (_matchesCommandEcho(visibleLine, normalizedCommand)) {
        matched = true;
        cursor += 1;
      }
      break;
    }

    if (!matched) {
      return TerminalEchoStripResult(text: input, matched: false);
    }

    final stripped = lines.skip(cursor).join('\n').trimLeft();
    return TerminalEchoStripResult(text: stripped, matched: true);
  }

  static String? extractPrompt(String input) {
    final promptLines = extractPromptLines(input);
    if (promptLines.isEmpty) return null;
    return promptLines.join('\n');
  }

  static List<String> extractPromptLines(String input) {
    final lines = _promptCandidateLines(input);
    if (lines.isEmpty) return const [];

    List<String> best = const [];
    for (var index = 0; index < lines.length; index++) {
      final single = lines[index];
      if (isPromptLine(single)) {
        best = [single];
      }

      if (index + 1 >= lines.length) {
        continue;
      }

      final first = lines[index];
      final second = lines[index + 1];
      final joined = '$first$second';
      if (_isWrappedPrompt(joined)) {
        best = [first, second];
      }
    }
    return best;
  }

  static bool isPromptLine(String input) {
    final line = input.trim();
    if (line.isEmpty) return false;
    return _cmdPromptPattern.hasMatch(line) ||
        _pwshPromptPattern.hasMatch(line) ||
        _wslPromptPattern.hasMatch(line);
  }

  static String fallbackPrompt({
    required String shellKind,
    required String cwd,
  }) {
    final normalizedShell = shellKind.trim().toLowerCase();
    switch (normalizedShell) {
      case 'pwsh':
      case 'powershell':
        return 'PS $cwd>';
      case 'wsl':
        final wslPath = _toWslPath(cwd);
        return '$wslPath\n\$';
      case 'cmd':
      default:
        return '$cwd>';
    }
  }

  static String _prepareRichTextInput(String input) {
    var text = input
        .replaceAll(_oscPattern, '')
        .replaceAllMapped(
          _csiPattern,
          (match) => _sgrPattern.hasMatch(match[0]!) ? match[0]! : '',
        )
        .replaceAll(_singleEscapePattern, '');

    text = text.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
    text = text.replaceAll(RegExp(r'\n{3,}'), '\n\n');
    final sourceLines = text.split('\n');
    final filteredLines = <String>[];
    for (var index = 0; index < sourceLines.length; index++) {
      final line = sourceLines[index];
      final trimmed = line.trim();
      if (trimmed.isEmpty) {
        filteredLines.add(line);
        continue;
      }
      if (trimmed == '25h' || trimmed == '25l' || trimmed == '?25h' || trimmed == '?25l') {
        continue;
      }
      if (_isProcessTitleLine(trimmed)) {
        continue;
      }
      if (trimmed == 'm') {
        final nextMeaningful = sourceLines
            .skip(index + 1)
            .map((item) => item.trim())
            .firstWhere(
              (item) => item.isNotEmpty,
              orElse: () => '',
            );
        if (_isProcessTitleLine(nextMeaningful) ||
            isPromptLine(nextMeaningful) ||
            _isWrappedPrompt(nextMeaningful)) {
          continue;
        }
      }
      filteredLines.add(line);
    }
    return filteredLines.join('\n');
  }

  static List<String> _promptCandidateLines(String input) {
    return _prepareRichTextInput(input)
        .split('\n')
        .map((line) => line.trimRight())
        .map((line) => line.replaceFirst(_cursorTogglePrefixPattern, ''))
        .where((line) => line.trim().isNotEmpty)
        .where((line) => !_isProcessTitleLine(line.trim()))
        .toList();
  }

  static bool _isWrappedPrompt(String joined) {
    return _cmdPromptPattern.hasMatch(joined) ||
        _pwshPromptPattern.hasMatch(joined) ||
        _wslPromptPattern.hasMatch(joined);
  }

  static bool _matchesCommandEcho(String visibleLine, String command) {
    return visibleLine == command ||
        visibleLine.endsWith('> $command') ||
        visibleLine.endsWith('\$ $command') ||
        visibleLine.endsWith('# $command');
  }

  static bool _isProcessTitleLine(String input) {
    final trimmed = input.trim();
    if (trimmed.startsWith(']0;') || trimmed.startsWith('m]0;')) {
      return trimmed.contains('cmd.exe') ||
          trimmed.contains('pwsh.exe') ||
          trimmed.contains('wsl');
    }
    return false;
  }

  static int _findCsiEnd(String source, int start) {
    for (var index = start; index < source.length; index++) {
      final code = source.codeUnitAt(index);
      if (code >= 0x40 && code <= 0x7E) {
        return index;
      }
    }
    return -1;
  }

  static int _findOscEnd(String source, int start) {
    for (var index = start; index < source.length; index++) {
      final char = source[index];
      if (char == '\x07') {
        return index + 1;
      }
      if (char == '\x1B' &&
          index + 1 < source.length &&
          source[index + 1] == '\\') {
        return index + 2;
      }
    }
    return -1;
  }

  static String _toWslPath(String path) {
    final normalized = path.replaceAll('\\', '/');
    if (normalized.length >= 2 && normalized[1] == ':') {
      final drive = normalized[0].toLowerCase();
      final rest = normalized.substring(2).replaceFirst(RegExp(r'^/+'), '');
      if (rest.isEmpty) {
        return '/mnt/$drive';
      }
      return '/mnt/$drive/$rest';
    }
    return normalized;
  }

  static TextSpan buildStyledText(String input, TextStyle baseStyle) {
    final prepared = _prepareRichTextInput(input);
    final spans = <TextSpan>[];
    final buffer = StringBuffer();
    var currentStyle = baseStyle;

    void flush() {
      if (buffer.isEmpty) return;
      spans.add(TextSpan(text: buffer.toString(), style: currentStyle));
      buffer.clear();
    }

    var index = 0;
    while (index < prepared.length) {
      final char = prepared[index];

      if (char == '\x1B') {
        if (index + 1 < prepared.length && prepared[index + 1] == '[') {
          final start = index;
          index += 2;
          while (index < prepared.length) {
            final ch = prepared[index];
            index += 1;
            if (RegExp(r'[@-~]').hasMatch(ch)) {
              final sequence = prepared.substring(start, index);
              if (_sgrPattern.hasMatch(sequence)) {
                flush();
                currentStyle = _applySgr(currentStyle, baseStyle, sequence);
              }
              break;
            }
          }
          continue;
        }
        index += 1;
        continue;
      }

      final rune = char.codeUnitAt(0);
      switch (rune) {
        case 0x08:
        case 0x7F:
          final current = buffer.toString();
          buffer
            ..clear()
            ..write(current.isEmpty ? '' : current.substring(0, current.length - 1));
          index += 1;
          continue;
        default:
          if (rune < 0x20 && rune != 0x0A && rune != 0x09) {
            index += 1;
            continue;
          }
          buffer.write(char == '\t' ? '  ' : char);
          index += 1;
      }
    }

    flush();
    if (spans.isEmpty) {
      return TextSpan(text: displayText(prepared), style: baseStyle);
    }
    return TextSpan(children: spans);
  }

  static TextStyle _applySgr(
    TextStyle current,
    TextStyle baseStyle,
    String sequence,
  ) {
    final match = RegExp(r'\x1B\[([0-9;]*)m').firstMatch(sequence);
    if (match == null) return current;

    final rawParams = match.group(1);
    final params = (rawParams == null || rawParams.isEmpty)
        ? <int>[0]
        : rawParams
            .split(';')
            .map((part) => int.tryParse(part) ?? 0)
            .toList();

    var next = current;
    for (final code in params) {
      switch (code) {
        case 0:
          next = baseStyle;
          break;
        case 1:
          next = next.copyWith(fontWeight: FontWeight.w600);
          break;
        case 22:
          next = next.copyWith(fontWeight: baseStyle.fontWeight);
          break;
        case 30:
          next = next.copyWith(color: const Color(0xFF111827));
          break;
        case 31:
          next = next.copyWith(color: const Color(0xFFDC2626));
          break;
        case 32:
          next = next.copyWith(color: const Color(0xFF16A34A));
          break;
        case 33:
          next = next.copyWith(color: const Color(0xFFD97706));
          break;
        case 34:
          next = next.copyWith(color: const Color(0xFF2563EB));
          break;
        case 35:
          next = next.copyWith(color: const Color(0xFF9333EA));
          break;
        case 36:
          next = next.copyWith(color: const Color(0xFF0891B2));
          break;
        case 37:
          next = next.copyWith(color: const Color(0xFF4B5563));
          break;
        case 39:
          next = next.copyWith(color: baseStyle.color);
          break;
        case 90:
          next = next.copyWith(color: const Color(0xFF6B7280));
          break;
        case 91:
          next = next.copyWith(color: const Color(0xFFEF4444));
          break;
        case 92:
          next = next.copyWith(color: const Color(0xFF22C55E));
          break;
        case 93:
          next = next.copyWith(color: const Color(0xFFEAB308));
          break;
        case 94:
          next = next.copyWith(color: const Color(0xFF60A5FA));
          break;
        case 95:
          next = next.copyWith(color: const Color(0xFFA855F7));
          break;
        case 96:
          next = next.copyWith(color: const Color(0xFF22D3EE));
          break;
        case 97:
          next = next.copyWith(color: const Color(0xFFF3F4F6));
          break;
      }
    }
    return next;
  }
}
