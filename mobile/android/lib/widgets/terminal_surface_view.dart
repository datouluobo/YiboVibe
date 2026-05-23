import 'package:flutter/material.dart';
import 'package:flutter/gestures.dart';
import '../models/terminal_screen_state.dart';
import '../painters/terminal_surface_painter.dart';

/// Screen-mode terminal renderer using CustomPainter.
///
/// Mobile defaults favor fit-width rendering first, then allow manual pinch zoom.
class TerminalSurfaceView extends StatefulWidget {
  final TerminalScreenState state;
  final double initialScale;
  final void Function(int row, int col)? onTapCell;

  const TerminalSurfaceView({
    super.key,
    required this.state,
    this.initialScale = 1.0,
    this.onTapCell,
  });

  @override
  State<TerminalSurfaceView> createState() => _TerminalSurfaceViewState();
}

class _TerminalSurfaceViewState extends State<TerminalSurfaceView> {
  static const _baseCellWidth = 8.6;
  static const _baseCellHeight = 17.2;
  static const _baseFontSize = 12.0;

  _ScaleMode _scaleMode = _ScaleMode.fitWidth;
  double _scale = 1.0;
  final ScrollController _hScroll = ScrollController();
  final ScrollController _vScroll = ScrollController();

  double get _cellWidth => _baseCellWidth * _scale;
  double get _cellHeight => _baseCellHeight * _scale;
  double get _fontSize => _baseFontSize * _scale;

  double get _totalWidth => widget.state.cols * _cellWidth;
  double get _totalHeight => widget.state.rows * _cellHeight;

  @override
  void initState() {
    super.initState();
    _scale = widget.initialScale;
  }

  @override
  void didUpdateWidget(TerminalSurfaceView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.state.sessionId != widget.state.sessionId) {
      _scaleMode = _ScaleMode.fitWidth;
    }

    if (mounted && _vScroll.hasClients) {
      final cursorRow = widget.state.cursor.row;
      final viewBottom =
          _vScroll.position.pixels + _vScroll.position.viewportDimension;
      final cursorY = cursorRow * _cellHeight;
      if (cursorY > viewBottom - _cellHeight * 2) {
        _vScroll.animateTo(
          (cursorY - _vScroll.position.viewportDimension / 2).clamp(
            0.0,
            _totalHeight,
          ),
          duration: const Duration(milliseconds: 50),
          curve: Curves.easeOut,
        );
      }
    }

    if (mounted && _hScroll.hasClients) {
      final cursorCol = widget.state.cursor.col;
      final viewLeft = _hScroll.position.pixels;
      final viewRight =
          _hScroll.position.pixels + _hScroll.position.viewportDimension;
      final cursorX = cursorCol * _cellWidth;
      if (cursorX < viewLeft + _cellWidth * 2 ||
          cursorX > viewRight - _cellWidth * 2) {
        _hScroll.animateTo(
          (cursorX - _hScroll.position.viewportDimension / 2).clamp(
            0.0,
            _totalWidth,
          ),
          duration: const Duration(milliseconds: 50),
          curve: Curves.easeOut,
        );
      }
    }
  }

  @override
  void dispose() {
    _hScroll.dispose();
    _vScroll.dispose();
    super.dispose();
  }

  void _onScaleChanged(double newScale) {
    setState(() {
      _scale = newScale.clamp(0.28, 2.4);
      _scaleMode = _ScaleMode.manual;
    });
  }

  void _onPointerSignal(PointerSignalEvent event) {
    if (event is! PointerScrollEvent) return;
    final delta = event.scrollDelta.dy;
    if (delta == 0) return;
    final factor = delta > 0 ? 0.92 : 1.08;
    _onScaleChanged(_scale * factor);
  }

  Offset _screenToCell(Offset localPosition) {
    final col = (localPosition.dx / _cellWidth).floor();
    final row = (localPosition.dy / _cellHeight).floor();
    return Offset(col.toDouble(), row.toDouble());
  }

  double _fitScaleForWidth(double availableWidth) {
    if (widget.state.cols <= 0 || availableWidth <= 0) {
      return widget.initialScale;
    }
    return (availableWidth / (widget.state.cols * _baseCellWidth)).clamp(
      0.28,
      1.0,
    );
  }

  double _fitScaleForHeight(double availableHeight) {
    if (widget.state.rows <= 0 || availableHeight <= 0) {
      return widget.initialScale;
    }
    return (availableHeight / (widget.state.rows * _baseCellHeight)).clamp(
      0.28,
      2.4,
    );
  }

  void _applyScaleMode(_ScaleMode mode, BoxConstraints constraints) {
    final nextScale = switch (mode) {
      _ScaleMode.fitWidth => _fitScaleForWidth(constraints.maxWidth),
      _ScaleMode.fitHeight => _fitScaleForHeight(constraints.maxHeight),
      _ScaleMode.manual => _scale,
    };
    setState(() {
      _scaleMode = mode;
      _scale = nextScale;
    });
  }

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        if (_scaleMode != _ScaleMode.manual) {
          final fitScale = _scaleMode == _ScaleMode.fitHeight
              ? _fitScaleForHeight(constraints.maxHeight)
              : _fitScaleForWidth(constraints.maxWidth);
          if ((_scale - fitScale).abs() > 0.001) {
            WidgetsBinding.instance.addPostFrameCallback((_) {
              if (!mounted || _scaleMode == _ScaleMode.manual) return;
              setState(() {
                _scale = fitScale;
              });
            });
          }
        }

        final canvasWidth = _totalWidth < constraints.maxWidth
            ? constraints.maxWidth
            : _totalWidth;
        final canvasHeight = _totalHeight < constraints.maxHeight
            ? constraints.maxHeight
            : _totalHeight;

        return Listener(
          onPointerSignal: _onPointerSignal,
          child: GestureDetector(
            behavior: HitTestBehavior.opaque,
            onScaleUpdate: (details) {
              if (details.pointerCount >= 2) {
                _onScaleChanged(_scale * details.scale.clamp(0.8, 1.2));
              }
            },
            onTapUp: (details) {
              if (widget.onTapCell != null) {
                final pos = _screenToCell(details.localPosition);
                widget.onTapCell!(pos.dy.toInt(), pos.dx.toInt());
              }
            },
            child: ColoredBox(
              color: const Color(0xFF1E1E1E),
              child: Stack(
                children: [
                  ClipRect(
                    child: Scrollbar(
                      thumbVisibility: true,
                      controller: _vScroll,
                      child: SingleChildScrollView(
                        controller: _vScroll,
                        scrollDirection: Axis.vertical,
                        child: SingleChildScrollView(
                          controller: _hScroll,
                          scrollDirection: Axis.horizontal,
                          child: SizedBox(
                            width: canvasWidth,
                            height: canvasHeight,
                            child: CustomPaint(
                              painter: TerminalSurfacePainter(
                                state: widget.state,
                                cellWidth: _cellWidth,
                                cellHeight: _cellHeight,
                                fontSize: _fontSize,
                                scale: _scale,
                              ),
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                  Positioned(
                    right: 10,
                    top: 10,
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 8,
                        vertical: 4,
                      ),
                      decoration: BoxDecoration(
                        color: const Color(0xCC111111),
                        borderRadius: BorderRadius.circular(999),
                        border: Border.all(color: const Color(0x33FFFFFF)),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          _overlayButton(
                            label: '宽',
                            active: _scaleMode == _ScaleMode.fitWidth,
                            onTap: () =>
                                _applyScaleMode(_ScaleMode.fitWidth, constraints),
                          ),
                          const SizedBox(width: 4),
                          _overlayButton(
                            label: '高',
                            active: _scaleMode == _ScaleMode.fitHeight,
                            onTap: () =>
                                _applyScaleMode(_ScaleMode.fitHeight, constraints),
                          ),
                          Container(
                            width: 1,
                            height: 18,
                            margin: const EdgeInsets.symmetric(horizontal: 6),
                            color: const Color(0x33FFFFFF),
                          ),
                          Text(
                            '${widget.state.cols}x${widget.state.rows} · ${(_scale * 100).round()}%',
                            style: const TextStyle(
                              color: Colors.white70,
                              fontSize: 10,
                              fontFamily: 'monospace',
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }

  Widget _overlayButton({
    required String label,
    required bool active,
    required VoidCallback onTap,
  }) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(
          color: active ? const Color(0xFF2563EB) : Colors.transparent,
          borderRadius: BorderRadius.circular(999),
          border: Border.all(
            color: active ? const Color(0xFF60A5FA) : const Color(0x33FFFFFF),
          ),
        ),
        child: Text(
          label,
          style: TextStyle(
            color: active ? Colors.white : Colors.white70,
            fontSize: 10,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
    );
  }
}

enum _ScaleMode { fitWidth, fitHeight, manual }
