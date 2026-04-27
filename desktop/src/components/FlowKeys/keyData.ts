export interface KeyDef {
    id: string;
    label: string;
    width?: number;
}

export interface KeyRow {
    keys: KeyDef[];
}

export interface KeySection {
    id: string;
    rows: KeyRow[];
    marginLeft?: number;
}

export interface KeyboardLayout {
    id: string;
    name: string;
    sections: KeySection[];
}

// ─── Shared Row Definitions ───

const F_ROW: KeyRow = {
    keys: [
        { id: "Escape", label: "Esc", width: 1 },
        { id: "F1", label: "F1", width: 1 },
        { id: "F2", label: "F2", width: 1 },
        { id: "F3", label: "F3", width: 1 },
        { id: "F4", label: "F4", width: 1 },
        { id: "F5", label: "F5", width: 1 },
        { id: "F6", label: "F6", width: 1 },
        { id: "F7", label: "F7", width: 1 },
        { id: "F8", label: "F8", width: 1 },
        { id: "F9", label: "F9", width: 1 },
        { id: "F10", label: "F10", width: 1 },
        { id: "F11", label: "F11", width: 1 },
        { id: "F12", label: "F12", width: 1 },
    ],
};

const NUM_ROW: KeyRow = {
    keys: [
        { id: "Backquote", label: "`", width: 1 },
        { id: "Digit1", label: "1", width: 1 },
        { id: "Digit2", label: "2", width: 1 },
        { id: "Digit3", label: "3", width: 1 },
        { id: "Digit4", label: "4", width: 1 },
        { id: "Digit5", label: "5", width: 1 },
        { id: "Digit6", label: "6", width: 1 },
        { id: "Digit7", label: "7", width: 1 },
        { id: "Digit8", label: "8", width: 1 },
        { id: "Digit9", label: "9", width: 1 },
        { id: "Digit0", label: "0", width: 1 },
        { id: "Minus", label: "-", width: 1 },
        { id: "Equal", label: "=", width: 1 },
        { id: "Backspace", label: "⌫", width: 2 },
    ],
};

const QWERTY_ROW: KeyRow = {
    keys: [
        { id: "Tab", label: "Tab", width: 1.5 },
        { id: "KeyQ", label: "Q", width: 1 },
        { id: "KeyW", label: "W", width: 1 },
        { id: "KeyE", label: "E", width: 1 },
        { id: "KeyR", label: "R", width: 1 },
        { id: "KeyT", label: "T", width: 1 },
        { id: "KeyY", label: "Y", width: 1 },
        { id: "KeyU", label: "U", width: 1 },
        { id: "KeyI", label: "I", width: 1 },
        { id: "KeyO", label: "O", width: 1 },
        { id: "KeyP", label: "P", width: 1 },
        { id: "BracketLeft", label: "[", width: 1 },
        { id: "BracketRight", label: "]", width: 1 },
        { id: "Backslash", label: "\\", width: 1.5 },
    ],
};

const HOME_ROW: KeyRow = {
    keys: [
        { id: "CapsLock", label: "Caps", width: 1.75 },
        { id: "KeyA", label: "A", width: 1 },
        { id: "KeyS", label: "S", width: 1 },
        { id: "KeyD", label: "D", width: 1 },
        { id: "KeyF", label: "F", width: 1 },
        { id: "KeyG", label: "G", width: 1 },
        { id: "KeyH", label: "H", width: 1 },
        { id: "KeyJ", label: "J", width: 1 },
        { id: "KeyK", label: "K", width: 1 },
        { id: "KeyL", label: "L", width: 1 },
        { id: "Semicolon", label: ";", width: 1 },
        { id: "Quote", label: "'", width: 1 },
        { id: "Enter", label: "Enter", width: 2.25 },
    ],
};

const BOTTOM_ROW: KeyRow = {
    keys: [
        { id: "ShiftLeft", label: "Shift", width: 2.25 },
        { id: "KeyZ", label: "Z", width: 1 },
        { id: "KeyX", label: "X", width: 1 },
        { id: "KeyC", label: "C", width: 1 },
        { id: "KeyV", label: "V", width: 1 },
        { id: "KeyB", label: "B", width: 1 },
        { id: "KeyN", label: "N", width: 1 },
        { id: "KeyM", label: "M", width: 1 },
        { id: "Comma", label: ",", width: 1 },
        { id: "Period", label: ".", width: 1 },
        { id: "Slash", label: "/", width: 1 },
        { id: "ShiftRight", label: "Shift", width: 2.75 },
    ],
};

const SPACE_ROW: KeyRow = {
    keys: [
        { id: "ControlLeft", label: "Ctrl", width: 1.25 },
        { id: "MetaLeft", label: "Win", width: 1.25 },
        { id: "AltLeft", label: "Alt", width: 1.25 },
        { id: "Space", label: "Space", width: 6.25 },
        { id: "AltRight", label: "Alt", width: 1.25 },
        { id: "MetaRight", label: "Win", width: 1.25 },
        { id: "ContextMenu", label: "Menu", width: 1.25 },
        { id: "ControlRight", label: "Ctrl", width: 1.25 },
    ],
};

const MAIN_SECTION: KeySection = {
    id: "main",
    rows: [F_ROW, NUM_ROW, QWERTY_ROW, HOME_ROW, BOTTOM_ROW, SPACE_ROW],
};

const NAV_SECTION: KeySection = {
    id: "nav",
    rows: [
        {
            keys: [
                { id: "PrintScreen", label: "PrtSc", width: 1 },
                { id: "ScrollLock", label: "ScrLk", width: 1 },
                { id: "Pause", label: "Pause", width: 1 },
            ],
        },
        {
            keys: [
                { id: "Insert", label: "Ins", width: 1 },
                { id: "Home", label: "Home", width: 1 },
                { id: "PageUp", label: "PgUp", width: 1 },
            ],
        },
        {
            keys: [
                { id: "Delete", label: "Del", width: 1 },
                { id: "End", label: "End", width: 1 },
                { id: "PageDown", label: "PgDn", width: 1 },
            ],
        },
        { keys: [] },
        {
            keys: [
                { id: "_blank_arrow_spacer1", label: "", width: 1 },
                { id: "ArrowUp", label: "↑", width: 1 },
                { id: "_blank_arrow_spacer2", label: "", width: 1 },
            ],
        },
        {
            keys: [
                { id: "ArrowLeft", label: "←", width: 1 },
                { id: "ArrowDown", label: "↓", width: 1 },
                { id: "ArrowRight", label: "→", width: 1 },
            ],
        },
    ],
    marginLeft: 1,
};

const NUMPAD_SECTION: KeySection = {
    id: "numpad",
    rows: [
        { keys: [] },
        {
            keys: [
                { id: "NumLock", label: "Num", width: 1 },
                { id: "NumpadDivide", label: "/", width: 1 },
                { id: "NumpadMultiply", label: "*", width: 1 },
                { id: "NumpadSubtract", label: "-", width: 1 },
            ],
        },
        {
            keys: [
                { id: "Numpad7", label: "7", width: 1 },
                { id: "Numpad8", label: "8", width: 1 },
                { id: "Numpad9", label: "9", width: 1 },
                { id: "NumpadAdd", label: "+", width: 1 },
            ],
        },
        {
            keys: [
                { id: "Numpad4", label: "4", width: 1 },
                { id: "Numpad5", label: "5", width: 1 },
                { id: "Numpad6", label: "6", width: 1 },
                { id: "_blank_np_add_spacer", label: "", width: 1 },
            ],
        },
        {
            keys: [
                { id: "Numpad1", label: "1", width: 1 },
                { id: "Numpad2", label: "2", width: 1 },
                { id: "Numpad3", label: "3", width: 1 },
                { id: "NumpadEnter", label: "Ent", width: 1 },
            ],
        },
        {
            keys: [
                { id: "Numpad0", label: "0", width: 2 },
                { id: "NumpadDecimal", label: ".", width: 1 },
                { id: "_blank_np_enter_spacer", label: "", width: 1 },
            ],
        },
    ],
    marginLeft: 1,
};

const MAIN_NO_F_SECTION: KeySection = {
    id: "main_nof",
    rows: [NUM_ROW, QWERTY_ROW, HOME_ROW, BOTTOM_ROW, SPACE_ROW],
};

// ─── Layout Definitions ───

export const KEYBOARD_LAYOUTS: KeyboardLayout[] = [
    {
        id: "ansi",
        name: "ANSI 全尺寸",
        sections: [MAIN_SECTION, NAV_SECTION, NUMPAD_SECTION],
    },
    {
        id: "tkl",
        name: "TKL (87键)",
        sections: [MAIN_SECTION, NAV_SECTION],
    },
    {
        id: "60",
        name: "60%",
        sections: [MAIN_NO_F_SECTION],
    },
];

// ─── Key Categories for List View ───

export interface KeyCategory {
    id: string;
    labelKey: string;
    keys: KeyDef[];
}

export const KEY_CATEGORIES: KeyCategory[] = [
    {
        id: "function",
        labelKey: "flowkeys.cat_function",
        keys: [
            { id: "Escape", label: "Esc" },
            { id: "F1", label: "F1" }, { id: "F2", label: "F2" }, { id: "F3", label: "F3" },
            { id: "F4", label: "F4" }, { id: "F5", label: "F5" }, { id: "F6", label: "F6" },
            { id: "F7", label: "F7" }, { id: "F8", label: "F8" }, { id: "F9", label: "F9" },
            { id: "F10", label: "F10" }, { id: "F11", label: "F11" }, { id: "F12", label: "F12" },
        ],
    },
    {
        id: "modifier",
        labelKey: "flowkeys.cat_modifier",
        keys: [
            { id: "ShiftLeft", label: "Shift (L)" }, { id: "ShiftRight", label: "Shift (R)" },
            { id: "ControlLeft", label: "Ctrl (L)" }, { id: "ControlRight", label: "Ctrl (R)" },
            { id: "AltLeft", label: "Alt (L)" }, { id: "AltRight", label: "Alt (R)" },
            { id: "MetaLeft", label: "Win (L)" }, { id: "MetaRight", label: "Win (R)" },
            { id: "CapsLock", label: "CapsLock" }, { id: "ContextMenu", label: "Menu" },
        ],
    },
    {
        id: "letters",
        labelKey: "flowkeys.cat_letters",
        keys: "QWERTYUIOPASDFGHJKLZXCVBNM".split("").map((c) => ({
            id: `Key${c}`, label: c,
        })),
    },
    {
        id: "numbers",
        labelKey: "flowkeys.cat_numbers",
        keys: [
            { id: "Digit1", label: "1" }, { id: "Digit2", label: "2" },
            { id: "Digit3", label: "3" }, { id: "Digit4", label: "4" },
            { id: "Digit5", label: "5" }, { id: "Digit6", label: "6" },
            { id: "Digit7", label: "7" }, { id: "Digit8", label: "8" },
            { id: "Digit9", label: "9" }, { id: "Digit0", label: "0" },
            { id: "Backquote", label: "`" }, { id: "Minus", label: "-" },
            { id: "Equal", label: "=" }, { id: "Backslash", label: "\\" },
        ],
    },
    {
        id: "numpad",
        labelKey: "flowkeys.cat_numpad",
        keys: [
            { id: "NumLock", label: "NumLock" },
            { id: "NumpadDivide", label: "Num /" }, { id: "NumpadMultiply", label: "Num *" },
            { id: "NumpadSubtract", label: "Num -" }, { id: "NumpadAdd", label: "Num +" },
            { id: "NumpadEnter", label: "Num Enter" },
            { id: "NumpadDecimal", label: "Num ." },
            { id: "Numpad0", label: "Num 0" }, { id: "Numpad1", label: "Num 1" },
            { id: "Numpad2", label: "Num 2" }, { id: "Numpad3", label: "Num 3" },
            { id: "Numpad4", label: "Num 4" }, { id: "Numpad5", label: "Num 5" },
            { id: "Numpad6", label: "Num 6" }, { id: "Numpad7", label: "Num 7" },
            { id: "Numpad8", label: "Num 8" }, { id: "Numpad9", label: "Num 9" },
        ],
    },
    {
        id: "navigation",
        labelKey: "flowkeys.cat_navigation",
        keys: [
            { id: "Tab", label: "Tab" }, { id: "Enter", label: "Enter" },
            { id: "Backspace", label: "Backspace" }, { id: "Delete", label: "Delete" },
            { id: "Insert", label: "Insert" }, { id: "Home", label: "Home" },
            { id: "End", label: "End" }, { id: "PageUp", label: "PageUp" },
            { id: "PageDown", label: "PageDown" },
            { id: "ArrowUp", label: "↑" }, { id: "ArrowDown", label: "↓" },
            { id: "ArrowLeft", label: "←" }, { id: "ArrowRight", label: "→" },
        ],
    },
    {
        id: "media",
        labelKey: "flowkeys.cat_media",
        keys: [
            { id: "MediaPlayPause", label: "Play/Pause" },
            { id: "MediaTrackNext", label: "Next" },
            { id: "MediaTrackPrevious", label: "Prev" },
            { id: "MediaStop", label: "Stop" },
            { id: "AudioVolumeUp", label: "Vol +" },
            { id: "AudioVolumeDown", label: "Vol -" },
            { id: "AudioVolumeMute", label: "Mute" },
        ],
    },
    {
        id: "special",
        labelKey: "flowkeys.cat_special",
        keys: [
            { id: "PrintScreen", label: "PrtSc" },
            { id: "ScrollLock", label: "ScrLk" },
            { id: "Pause", label: "Pause" },
            { id: "Power", label: "Power" },
            { id: "Sleep", label: "Sleep" },
            { id: "WakeUp", label: "Wake" },
            { id: "Fn", label: "Fn" },
            { id: "Eject", label: "Eject" },
        ],
    },
    {
        id: "mobile",
        labelKey: "flowkeys.cat_mobile",
        keys: [
            { id: "MobileBack", label: "Back" },
            { id: "MobileMenu", label: "Menu" },
            { id: "MobileSearch", label: "Search" },
            { id: "MobileHome", label: "Home" },
            { id: "MobileRecent", label: "Recent" },
            { id: "MobileNotification", label: "Notify" },
        ],
    },
    {
        id: "mouse",
        labelKey: "flowkeys.cat_mouse",
        keys: [
            { id: "MouseBtn1", label: "Left Click" },
            { id: "MouseBtn2", label: "Right Click" },
            { id: "MouseBtn3", label: "Middle Click" },
            { id: "MouseBtn4", label: "Side 1" },
            { id: "MouseBtn5", label: "Side 2" },
            { id: "WheelUp", label: "Wheel Up" },
            { id: "WheelDown", label: "Wheel Down" },
        ],
    },
];

export const MODIFIER_KEYS = ["Ctrl", "Alt", "Shift", "Win"] as const;
export type ModifierKey = (typeof MODIFIER_KEYS)[number];

export const MODIFIER_KEY_MAP: Record<string, string> = {
    ControlLeft: "Ctrl",
    ControlRight: "Ctrl",
    AltLeft: "Alt",
    AltRight: "Alt",
    ShiftLeft: "Shift",
    ShiftRight: "Shift",
    MetaLeft: "Win",
    MetaRight: "Win",
};
