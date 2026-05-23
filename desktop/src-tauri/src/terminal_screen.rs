use serde::Serialize;
use std::time::{Duration, Instant};

const KNOWN_TUI_MARKERS: &[&str] = &[
    "Hermes Agent",
    "Type your message",
    "/help for commands",
    "Model Picker",
    "Select Provider",
    "Available Tools",
    "Available Skills",
    "Current:",
    "┌",
    "┐",
    "└",
    "┘",
    "├",
    "┤",
    "┬",
    "┴",
    "┼",
    "│",
    "─",
    "╭",
    "╮",
    "╯",
    "╰",
    "═",
    "║",
];

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub enum TerminalRenderMode {
    #[serde(rename = "text")]
    Text,
    #[serde(rename = "screen")]
    Screen,
}

impl TerminalRenderMode {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Text => "text",
            Self::Screen => "screen",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct TerminalCursor {
    pub row: u16,
    pub col: u16,
    pub visible: bool,
    #[serde(rename = "shape")]
    pub shape: String,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct TerminalCellStyle {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fg: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bg: Option<String>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub bold: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub italic: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub underline: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub inverse: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub dim: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct TerminalCellData {
    pub char: String,
    #[serde(flatten)]
    pub style: TerminalCellStyle,
}

#[derive(Debug, Clone, Serialize)]
pub struct TerminalScreenSnapshot {
    pub session_id: String,
    pub seq: u64,
    pub cols: u16,
    pub rows: u16,
    pub cursor: TerminalCursor,
    pub active_buffer: String,
    pub title: String,
    pub lines: Vec<Vec<TerminalCellData>>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub mouse_support: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct DirtyRow {
    pub row: u16,
    pub cells: Vec<TerminalCellData>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TerminalScreenPatch {
    pub session_id: String,
    pub seq: u64,
    pub cursor: TerminalCursor,
    pub active_buffer: String,
    pub dirty_rows: Vec<DirtyRow>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub mouse_support: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct TerminalScreenModeChange {
    pub session_id: String,
    pub mode: TerminalRenderMode,
    pub reason: String,
    pub seq: u64,
}

pub enum ScreenUpdate {
    None,
    ModeChange(TerminalScreenModeChange),
    Snapshot(TerminalScreenSnapshot),
    Patch(TerminalScreenPatch),
}

/// Internal cell grid for diffing (stores serialized cell state)
#[derive(Clone)]
struct CellGrid {
    cells: Vec<Vec<Option<CellSnapshot>>>,
    rows: u16,
    cols: u16,
}

#[derive(Clone, PartialEq)]
struct CellSnapshot {
    ch: String,
    fg: Option<String>,
    bg: Option<String>,
    bold: bool,
    italic: bool,
    underline: bool,
    inverse: bool,
    dim: bool,
}

impl CellGrid {
    fn new(rows: u16, cols: u16) -> Self {
        Self {
            cells: vec![vec![None; cols as usize]; rows as usize],
            rows,
            cols,
        }
    }
}

/// Screen state engine wrapping vt100 parser
pub struct TerminalScreenEngine {
    parser: vt100::Parser,
    prev_grid: CellGrid,
    mode: TerminalRenderMode,
    mode_reason: String,
    mode_entered_at: Instant,
    seq_counter: u64,
    session_id: String,
    entered_screen: bool,
    has_emitted_snapshot: bool,
    alt_screen_active: bool,
    cursor_move_count: u32,
    cursor_move_window: Instant,
    mouse_support: bool,
}

impl TerminalScreenEngine {
    pub fn new(rows: u16, cols: u16, session_id: String) -> Self {
        Self {
            parser: vt100::Parser::new(rows, cols, 0),
            prev_grid: CellGrid::new(rows, cols),
            mode: TerminalRenderMode::Text,
            mode_reason: "none".to_string(),
            mode_entered_at: Instant::now(),
            seq_counter: 0,
            session_id,
            entered_screen: false,
            has_emitted_snapshot: false,
            alt_screen_active: false,
            cursor_move_count: 0,
            cursor_move_window: Instant::now(),
            mouse_support: false,
        }
    }

    pub fn mode(&self) -> TerminalRenderMode {
        self.mode
    }

    pub fn is_screen_mode(&self) -> bool {
        self.mode == TerminalRenderMode::Screen
    }

    fn next_seq(&mut self) -> u64 {
        self.seq_counter += 1;
        self.seq_counter
    }

    fn fetch_grid(&self) -> CellGrid {
        let screen = self.parser.screen();
        let (rows, cols) = screen.size();
        let mut grid = CellGrid::new(rows, cols);
        for r in 0..rows {
            for c in 0..cols {
                if let Some(cell) = screen.cell(r, c) {
                    let fg_val = match cell.fgcolor() {
                        vt100::Color::Default => None,
                        vt100::Color::Idx(i) => Some(idx_to_hex(i)),
                        vt100::Color::Rgb(rv, gv, bv) => {
                            Some(format!("#{:02x}{:02x}{:02x}", rv, gv, bv))
                        }
                    };
                    let bg_val = match cell.bgcolor() {
                        vt100::Color::Default => None,
                        vt100::Color::Idx(i) => Some(idx_to_hex(i)),
                        vt100::Color::Rgb(rv, gv, bv) => {
                            Some(format!("#{:02x}{:02x}{:02x}", rv, gv, bv))
                        }
                    };
                    grid.cells[r as usize][c as usize] = Some(CellSnapshot {
                        ch: cell.contents().to_string(),
                        fg: fg_val,
                        bg: bg_val,
                        bold: cell.bold(),
                        italic: cell.italic(),
                        underline: cell.underline(),
                        inverse: cell.inverse(),
                        dim: false,
                    });
                }
            }
        }
        grid
    }

    fn find_dirty_rows(&self, current: &CellGrid) -> Vec<u16> {
        let mut dirty = Vec::new();
        let max_r = self.prev_grid.rows.min(current.rows);
        let max_c = self.prev_grid.cols.min(current.cols);
        for r in 0..max_r {
            let mut row_dirty = false;
            for c in 0..max_c {
                if self.prev_grid.cells[r as usize][c as usize]
                    != current.cells[r as usize][c as usize]
                {
                    row_dirty = true;
                    break;
                }
            }
            if row_dirty {
                dirty.push(r);
            }
        }
        dirty
    }

    fn read_cell_data(&self, r: u16, c: u16) -> TerminalCellData {
        let screen = self.parser.screen();
        if let Some(cell) = screen.cell(r, c) {
            let fg_val = match cell.fgcolor() {
                vt100::Color::Default => None,
                vt100::Color::Idx(i) => Some(idx_to_hex(i)),
                vt100::Color::Rgb(rv, gv, bv) => Some(format!("#{:02x}{:02x}{:02x}", rv, gv, bv)),
            };
            let bg_val = match cell.bgcolor() {
                vt100::Color::Default => None,
                vt100::Color::Idx(i) => Some(idx_to_hex(i)),
                vt100::Color::Rgb(rv, gv, bv) => Some(format!("#{:02x}{:02x}{:02x}", rv, gv, bv)),
            };
            TerminalCellData {
                char: cell.contents().to_string(),
                style: TerminalCellStyle {
                    fg: fg_val,
                    bg: bg_val,
                    bold: cell.bold(),
                    italic: cell.italic(),
                    underline: cell.underline(),
                    inverse: cell.inverse(),
                    dim: false,
                },
            }
        } else {
            TerminalCellData {
                char: " ".to_string(),
                style: TerminalCellStyle::default(),
            }
        }
    }

    fn build_snapshot(&self, seq: u64) -> TerminalScreenSnapshot {
        let screen = self.parser.screen();
        let (rows, cols) = screen.size();
        let (cursor_row, cursor_col) = screen.cursor_position();

        let mut lines = Vec::with_capacity(rows as usize);
        for r in 0..rows {
            let mut row = Vec::with_capacity(cols as usize);
            for c in 0..cols {
                row.push(self.read_cell_data(r, c));
            }
            lines.push(row);
        }

        TerminalScreenSnapshot {
            session_id: self.session_id.clone(),
            seq,
            cols,
            rows,
            cursor: TerminalCursor {
                row: cursor_row,
                col: cursor_col,
                visible: !screen.hide_cursor(),
                shape: "block".to_string(),
            },
            active_buffer: if self.alt_screen_active {
                "alternate".to_string()
            } else {
                "normal".to_string()
            },
            title: String::new(),
            mouse_support: self.mouse_support,
            lines,
        }
    }

    fn build_patch(&self, seq: u64, dirty_rows: &[u16]) -> TerminalScreenPatch {
        let screen = self.parser.screen();
        let (cursor_row, cursor_col) = screen.cursor_position();
        let (_, cols) = screen.size();

        let dirty: Vec<DirtyRow> = dirty_rows
            .iter()
            .map(|&r| {
                let cells = (0..cols).map(|c| self.read_cell_data(r, c)).collect();
                DirtyRow { row: r, cells }
            })
            .collect();

        TerminalScreenPatch {
            session_id: self.session_id.clone(),
            seq,
            cursor: TerminalCursor {
                row: cursor_row,
                col: cursor_col,
                visible: !screen.hide_cursor(),
                shape: "block".to_string(),
            },
            active_buffer: if self.alt_screen_active {
                "alternate".to_string()
            } else {
                "normal".to_string()
            },
            mouse_support: self.mouse_support,
            dirty_rows: dirty,
        }
    }

    pub fn process(&mut self, text: &str) -> ScreenUpdate {
        let bytes = text.as_bytes();
        let known_tui = looks_like_known_tui(text);

        // Detect alternate screen sequences
        let detected_alt = text.contains("\x1b[?1049h");
        let detected_exit_alt = text.contains("\x1b[?1049l");
        // Count cursor movement sequences (CSI H and f)
        let cursor_moves = count_cursor_moves(text);

        if detected_alt {
            self.alt_screen_active = true;
        }
        if detected_exit_alt {
            self.alt_screen_active = false;
        }

        // Track cursor move frequency for ansi_repaint detection
        if cursor_moves > 0 {
            let now = Instant::now();
            if now.duration_since(self.cursor_move_window) < Duration::from_millis(50) {
                self.cursor_move_count += cursor_moves as u32;
            } else {
                self.cursor_move_count = cursor_moves as u32;
                self.cursor_move_window = now;
            }
        }

        // Detect mouse protocol enable/disable
        if text.contains("\x1b[?1000h")
            || text.contains("\x1b[?1002h")
            || text.contains("\x1b[?1006h")
        {
            self.mouse_support = true;
        }
        if text.contains("\x1b[?1000l")
            || text.contains("\x1b[?1002l")
            || text.contains("\x1b[?1006l")
        {
            self.mouse_support = false;
        }

        // Feed to parser
        self.parser.process(bytes);

        // Mode detection
        let should_be_screen = self.alt_screen_active || known_tui;

        let mut should_exit_screen = false;
        if self.mode == TerminalRenderMode::Screen && self.entered_screen {
            if detected_exit_alt {
                should_exit_screen = true;
            }
            if !should_be_screen
                && !self.alt_screen_active
                && self.cursor_move_count == 0
                && Instant::now().duration_since(self.mode_entered_at) > Duration::from_secs(2)
            {
                should_exit_screen = true;
            }
        }

        // Enter screen mode
        if !self.entered_screen && should_be_screen && self.mode == TerminalRenderMode::Text {
            self.mode = TerminalRenderMode::Screen;
            self.mode_reason = if self.alt_screen_active {
                "alternate_screen".to_string()
            } else if known_tui {
                "known_tui".to_string()
            } else {
                "ansi_repaint".to_string()
            };
            self.mode_entered_at = Instant::now();
            self.entered_screen = true;
            self.has_emitted_snapshot = false;

            let seq = self.next_seq();
            return ScreenUpdate::ModeChange(TerminalScreenModeChange {
                session_id: self.session_id.clone(),
                mode: TerminalRenderMode::Screen,
                reason: self.mode_reason.clone(),
                seq,
            });
        }

        // Exit screen mode
        if should_exit_screen && self.mode == TerminalRenderMode::Screen {
            self.mode = TerminalRenderMode::Text;
            self.mode_reason = "none".to_string();
            self.entered_screen = false;
            self.has_emitted_snapshot = false;
            let seq = self.next_seq();
            return ScreenUpdate::ModeChange(TerminalScreenModeChange {
                session_id: self.session_id.clone(),
                mode: TerminalRenderMode::Text,
                reason: if detected_exit_alt {
                    "alternate_screen".to_string()
                } else {
                    "timeout".to_string()
                },
                seq,
            });
        }

        // Generate snapshot or patch
        if self.mode == TerminalRenderMode::Screen {
            if !self.has_emitted_snapshot {
                self.has_emitted_snapshot = true;
                let seq = self.next_seq();
                let snapshot = self.build_snapshot(seq);
                self.prev_grid = self.fetch_grid();
                return ScreenUpdate::Snapshot(snapshot);
            }

            let current = self.fetch_grid();
            let dirty = self.find_dirty_rows(&current);

            if !dirty.is_empty() {
                let seq = self.next_seq();
                let patch = self.build_patch(seq, &dirty);
                self.prev_grid = current;
                return ScreenUpdate::Patch(patch);
            }
        }

        ScreenUpdate::None
    }

    pub fn request_snapshot(&mut self) -> TerminalScreenSnapshot {
        self.has_emitted_snapshot = true;
        let seq = self.next_seq();
        let snapshot = self.build_snapshot(seq);
        self.prev_grid = self.fetch_grid();
        snapshot
    }

    pub fn resize(&mut self, cols: u16, rows: u16) {
        self.parser = vt100::Parser::new(rows, cols, 0);
        self.prev_grid = CellGrid::new(rows, cols);
        self.has_emitted_snapshot = false;
        self.entered_screen = false;
        self.mode = TerminalRenderMode::Text;
        self.alt_screen_active = false;
        self.cursor_move_count = 0;
    }
}

fn count_cursor_moves(text: &str) -> u32 {
    let mut count = 0u32;
    let mut in_escape = false;
    let mut in_csi = false;
    let mut saw_param = false;
    for b in text.bytes() {
        if b == 0x1b {
            in_escape = true;
            in_csi = false;
            saw_param = false;
            continue;
        }
        if in_escape {
            if !in_csi {
                if b == b'[' {
                    in_csi = true;
                    continue;
                }
                in_escape = false;
                continue;
            }

            if b == b';' || (b >= b'0' && b <= b'9') {
                saw_param = true;
                continue;
            }

            if (b == b'H' || b == b'f') && saw_param {
                count += 1;
            }
            in_escape = false;
            in_csi = false;
        }
    }
    count
}

fn looks_like_known_tui(text: &str) -> bool {
    KNOWN_TUI_MARKERS.iter().any(|marker| text.contains(marker))
}

fn idx_to_hex(index: u8) -> String {
    let i = index as u16;
    if i < 16 {
        match i {
            0 => "#000000",
            1 => "#800000",
            2 => "#008000",
            3 => "#808000",
            4 => "#000080",
            5 => "#800080",
            6 => "#008080",
            7 => "#c0c0c0",
            8 => "#808080",
            9 => "#ff0000",
            10 => "#00ff00",
            11 => "#ffff00",
            12 => "#0000ff",
            13 => "#ff00ff",
            14 => "#00ffff",
            15 => "#ffffff",
            _ => "#000000",
        }
        .to_string()
    } else if i < 232 {
        let idx = i - 16;
        let r = (idx / 36) as u8;
        let g = ((idx % 36) / 6) as u8;
        let b = (idx % 6) as u8;
        let rv = if r > 0 { r * 40 + 55 } else { 0 };
        let gv = if g > 0 { g * 40 + 55 } else { 0 };
        let bv = if b > 0 { b * 40 + 55 } else { 0 };
        format!("#{:02x}{:02x}{:02x}", rv, gv, bv)
    } else {
        let v = (i - 232) * 10 + 8;
        format!("#{:02x}{:02x}{:02x}", v as u8, v as u8, v as u8)
    }
}
