import 'dart:math';
import 'package:flutter/material.dart';
import '../models/terminal_screen_state.dart';

/// CustomPainter that renders a terminal grid cell by cell
class TerminalSurfacePainter extends CustomPainter {
  final TerminalScreenState state;
  final double cellWidth;
  final double cellHeight;
  final double fontSize;
  final double scale;

  TerminalSurfacePainter({
    required this.state,
    required this.cellWidth,
    required this.cellHeight,
    required this.fontSize,
    this.scale = 1.0,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()..isAntiAlias = false;
    final visibleCols = (size.width / cellWidth).floor();
    final visibleRows = (size.height / cellHeight).floor();
    final startRow = 0;
    final startCol = 0;
    const baseBackground = Color(0xFF1E1E1E);

    canvas.drawRect(
      Rect.fromLTWH(0, 0, size.width, size.height),
      paint..color = baseBackground,
    );

    // Draw only non-default backgrounds to avoid cell seam artifacts.
    for (
      int r = startRow;
      r < min(state.rows, startRow + visibleRows + 1);
      r++
    ) {
      for (
        int c = startCol;
        c < min(state.cols, startCol + visibleCols + 1);
        c++
      ) {
        final cell = r < state.lines.length && c < state.lines[r].length
            ? state.lines[r][c]
            : null;
        final x = (c - startCol) * cellWidth;
        final y = (r - startRow) * cellHeight;

        Color? cellBackground;
        if (cell != null && cell.style.inverse) {
          cellBackground = _parseColor(cell.style.fg) ?? Colors.white;
        } else if (cell != null && cell.style.bg != null) {
          cellBackground = _parseColor(cell.style.bg) ?? baseBackground;
        }
        if (cellBackground != null && cellBackground != baseBackground) {
          paint.color = cellBackground;
          canvas.drawRect(Rect.fromLTWH(x, y, cellWidth, cellHeight), paint);
        }
      }
    }

    // Draw text
    for (
      int r = startRow;
      r < min(state.rows, startRow + visibleRows + 1);
      r++
    ) {
      for (
        int c = startCol;
        c < min(state.cols, startCol + visibleCols + 1);
        c++
      ) {
        final cell = r < state.lines.length && c < state.lines[r].length
            ? state.lines[r][c]
            : null;
        if (cell == null || cell.char.isEmpty || cell.char == ' ') continue;

        final x = (c - startCol) * cellWidth + 0.8;
        final y = (r - startRow) * cellHeight + 0.2;

        // Determine text color
        Color textColor;
        if (cell.style.inverse) {
          // Inverse: use background as foreground
          textColor = _parseColor(cell.style.bg) ?? const Color(0xFF1E1E1E);
        } else if (cell.style.fg != null) {
          textColor = _parseColor(cell.style.fg)!;
        } else {
          textColor = const Color(0xFFE0E0E0);
        }

        if (cell.style.dim) {
          textColor = textColor.withAlpha(140);
        }

        final tp = TextPainter(
          text: TextSpan(
            text: cell.char,
            style: TextStyle(
              color: textColor,
              fontSize: fontSize,
              fontFamily: 'monospace',
              fontWeight: cell.style.bold ? FontWeight.bold : FontWeight.normal,
              fontStyle: cell.style.italic
                  ? FontStyle.italic
                  : FontStyle.normal,
              decoration: cell.style.underline
                  ? TextDecoration.underline
                  : null,
            ),
          ),
          textDirection: TextDirection.ltr,
        );
        tp.layout(maxWidth: cellWidth);
        tp.paint(canvas, Offset(x, y));
      }
    }

    // Draw cursor
    final cursor = state.cursor;
    if (cursor.visible && cursor.row < state.rows && cursor.col < state.cols) {
      final cx = (cursor.col - startCol) * cellWidth;
      final cy = (cursor.row - startRow) * cellHeight;

      paint.color = Colors.white.withAlpha(120);
      canvas.drawRect(Rect.fromLTWH(cx, cy, cellWidth, cellHeight), paint);

      // Draw cursor character in inverse
      final cursorCell =
          cursor.row < state.lines.length &&
              cursor.col < state.lines[cursor.row].length
          ? state.lines[cursor.row][cursor.col]
          : null;
      if (cursorCell != null &&
          cursorCell.char.isNotEmpty &&
          cursorCell.char != ' ') {
        final tp = TextPainter(
          text: TextSpan(
            text: cursorCell.char,
            style: TextStyle(
              color: const Color(0xFF1E1E1E),
              fontSize: fontSize,
              fontFamily: 'monospace',
              fontWeight: FontWeight.bold,
            ),
          ),
          textDirection: TextDirection.ltr,
        );
        tp.layout(maxWidth: cellWidth);
        tp.paint(canvas, Offset(cx + 1, cy));
      }
    }
  }

  @override
  bool shouldRepaint(covariant TerminalSurfacePainter oldDelegate) {
    return oldDelegate.state.seq != state.seq || oldDelegate.scale != scale;
  }

  Color? _parseColor(String? hex) {
    if (hex == null || hex.length < 6) return null;
    final h = hex.replaceFirst('#', '');
    if (h.length != 6) return null;
    final r = int.tryParse(h.substring(0, 2), radix: 16);
    final g = int.tryParse(h.substring(2, 4), radix: 16);
    final b = int.tryParse(h.substring(4, 6), radix: 16);
    if (r == null || g == null || b == null) return null;
    return Color.fromARGB(255, r, g, b);
  }
}
