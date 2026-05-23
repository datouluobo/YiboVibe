/// Terminal cell style attributes
class TerminalCellStyle {
  final String? fg;
  final String? bg;
  final bool bold;
  final bool italic;
  final bool underline;
  final bool inverse;
  final bool dim;

  const TerminalCellStyle({
    this.fg,
    this.bg,
    this.bold = false,
    this.italic = false,
    this.underline = false,
    this.inverse = false,
    this.dim = false,
  });

  factory TerminalCellStyle.fromJson(Map<String, dynamic> json) {
    return TerminalCellStyle(
      fg: json['fg'] as String?,
      bg: json['bg'] as String?,
      bold: json['bold'] as bool? ?? false,
      italic: json['italic'] as bool? ?? false,
      underline: json['underline'] as bool? ?? false,
      inverse: json['inverse'] as bool? ?? false,
      dim: json['dim'] as bool? ?? false,
    );
  }

  Map<String, dynamic> toJson() => {
    if (fg != null) 'fg': fg,
    if (bg != null) 'bg': bg,
    if (bold) 'bold': true,
    if (italic) 'italic': true,
    if (underline) 'underline': true,
    if (inverse) 'inverse': true,
    if (dim) 'dim': true,
  };
}

/// A single cell in the terminal grid
class TerminalCell {
  final String char;
  final TerminalCellStyle style;

  const TerminalCell({required this.char, required this.style});

  factory TerminalCell.fromJson(Map<String, dynamic> json) {
    return TerminalCell(
      char: json['char'] as String? ?? ' ',
      style: TerminalCellStyle.fromJson(json),
    );
  }
}

/// Cursor state
class TerminalCursor {
  final int row;
  final int col;
  final bool visible;
  final String shape;

  const TerminalCursor({
    required this.row,
    required this.col,
    this.visible = true,
    this.shape = 'block',
  });

  factory TerminalCursor.fromJson(Map<String, dynamic> json) {
    return TerminalCursor(
      row: (json['row'] as num?)?.toInt() ?? 0,
      col: (json['col'] as num?)?.toInt() ?? 0,
      visible: json['visible'] as bool? ?? true,
      shape: json['shape'] as String? ?? 'block',
    );
  }
}

/// Full terminal screen state
class TerminalScreenState {
  final String sessionId;
  final int seq;
  final int cols;
  final int rows;
  TerminalCursor cursor;
  String activeBuffer;
  String title;
  bool mouseSupport;
  final List<List<TerminalCell?>> lines;

  TerminalScreenState({
    required this.sessionId,
    required this.seq,
    required this.cols,
    required this.rows,
    required this.cursor,
    this.activeBuffer = 'normal',
    this.title = '',
    this.mouseSupport = false,
    required this.lines,
  });

  factory TerminalScreenState.fromJson(Map<String, dynamic> json) {
    final rawLines = json['lines'] as List<dynamic>? ?? [];
    final cols = (json['cols'] as num?)?.toInt() ?? 80;
    final rows = (json['rows'] as num?)?.toInt() ?? 24;
    final lines = <List<TerminalCell?>>[];
    for (final row in rawLines) {
      final cells = <TerminalCell?>[];
      if (row is List) {
        for (final cell in row) {
          if (cell is Map<String, dynamic>) {
            cells.add(TerminalCell.fromJson(cell));
          } else {
            cells.add(null);
          }
        }
      }
      // Pad to full width
      while (cells.length < cols) {
        cells.add(null);
      }
      lines.add(cells);
    }
    // Pad to full height
    while (lines.length < rows) {
      lines.add(List.filled(cols, null));
    }
    return TerminalScreenState(
      sessionId: json['session_id'] as String? ?? '',
      seq: (json['seq'] as num?)?.toInt() ?? 0,
      cols: cols,
      rows: rows,
      cursor: json['cursor'] is Map<String, dynamic>
          ? TerminalCursor.fromJson(json['cursor'] as Map<String, dynamic>)
          : const TerminalCursor(row: 0, col: 0),
      activeBuffer: json['active_buffer'] as String? ?? 'normal',
      title: json['title'] as String? ?? '',
      mouseSupport: json['mouse_support'] as bool? ?? false,
      lines: lines,
    );
  }

  /// Apply a screen patch to this state (in-place mutation)
  void applyPatch(Map<String, dynamic> patch) {
    final dirtyRows = patch['dirty_rows'] as List<dynamic>? ?? [];
    for (final dr in dirtyRows) {
      if (dr is Map<String, dynamic>) {
        final rowIdx = (dr['row'] as num?)?.toInt() ?? 0;
        final cells = dr['cells'] as List<dynamic>? ?? [];
        if (rowIdx < lines.length) {
          for (int c = 0; c < cells.length && c < cols; c++) {
            final cellData = cells[c];
            if (cellData is Map<String, dynamic>) {
              lines[rowIdx][c] = TerminalCell.fromJson(cellData);
            }
          }
        }
      }
    }
    if (patch['cursor'] is Map<String, dynamic>) {
      cursor = TerminalCursor.fromJson(patch['cursor'] as Map<String, dynamic>);
    }
    activeBuffer = patch['active_buffer'] as String? ?? activeBuffer;
    mouseSupport = patch['mouse_support'] as bool? ?? mouseSupport;
  }

  TerminalScreenState copyWith({
    int? seq,
    int? cols,
    int? rows,
    TerminalCursor? cursor,
    String? activeBuffer,
    String? title,
    bool? mouseSupport,
    List<List<TerminalCell?>>? lines,
  }) {
    return TerminalScreenState(
      sessionId: sessionId,
      seq: seq ?? this.seq,
      cols: cols ?? this.cols,
      rows: rows ?? this.rows,
      cursor: cursor ?? this.cursor,
      activeBuffer: activeBuffer ?? this.activeBuffer,
      title: title ?? this.title,
      mouseSupport: mouseSupport ?? this.mouseSupport,
      lines: lines ?? this.lines,
    );
  }

  void applyLocalInputPreview(String text) {
    if (text.isEmpty) return;

    for (final rune in text.runes) {
      final char = String.fromCharCode(rune);
      if (char == '\x1B' || char == '\r') {
        continue;
      }
      if (char == '\n') {
        final nextRow = (cursor.row + 1).clamp(0, rows - 1);
        cursor = TerminalCursor(
          row: nextRow,
          col: 0,
          visible: cursor.visible,
          shape: cursor.shape,
        );
        continue;
      }
      if (char == '\b' || rune == 127) {
        final nextCol = cursor.col > 0 ? cursor.col - 1 : 0;
        if (cursor.row >= 0 &&
            cursor.row < lines.length &&
            nextCol >= 0 &&
            nextCol < lines[cursor.row].length) {
          lines[cursor.row][nextCol] = null;
        }
        cursor = TerminalCursor(
          row: cursor.row,
          col: nextCol,
          visible: cursor.visible,
          shape: cursor.shape,
        );
        continue;
      }
      if (char == '\t') {
        applyLocalInputPreview('  ');
        continue;
      }
      if (_isControlChar(rune)) {
        continue;
      }

      final row = cursor.row.clamp(0, rows - 1);
      final col = cursor.col.clamp(0, cols - 1);
      if (row >= lines.length) continue;
      if (col >= lines[row].length) continue;

      lines[row][col] = TerminalCell(
        char: char,
        style: _previewStyleAt(row, col),
      );

      var nextRow = row;
      var nextCol = col + 1;
      if (nextCol >= cols) {
        nextCol = 0;
        nextRow = (row + 1).clamp(0, rows - 1);
      }
      cursor = TerminalCursor(
        row: nextRow,
        col: nextCol,
        visible: cursor.visible,
        shape: cursor.shape,
      );
    }
  }

  bool _isControlChar(int rune) => rune < 32;

  TerminalCellStyle _previewStyleAt(int row, int col) {
    final current = lines[row][col];
    if (current != null) return current.style;
    if (col > 0) {
      final left = lines[row][col - 1];
      if (left != null) return left.style;
    }
    return const TerminalCellStyle(fg: '#E6E1CF');
  }
}
