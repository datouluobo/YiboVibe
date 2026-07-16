# Tool Icon Registry

Last updated: 2026-06-24

This file is the source of truth for tool/IDE/agent icon selection in YiboVibe mobile.

Rule:

1. Prefer the vendor's official downloadable brand assets page.
2. If a vendor explicitly forbids partner-style branded usage, do not invent or mimic a product logo.
3. If no public reusable asset is clearly provided, fall back to a neutral in-product glyph until we import an approved asset.
4. Do not guess from product names alone. Update this registry first, then update UI mappings.

## Canonical entries

| Canonical tool | Typical aliases / source strings | Asset policy | Official source |
| --- | --- | --- | --- |
| Visual Studio Code | `vscode`, `vs code`, `visual studio code` | Use the official **stable** icon only. Do **not** use Insiders, Exploration, or OS app icons. | https://code.visualstudio.com/brand |
| Cursor | `cursor` | Use Cursor brand assets from the public brand page. Prefer the 2D app icon/avatar for compact UI. | https://cursor.com/brand |
| Windsurf | `windsurf`, `codeium`, `devin desktop` | Use the Windsurf **symbol** for compact tool chips. | https://windsurf.com/brand |
| Zed | `zed` | Use the stable Zed app icon or logomark from the brand page. Do not use preview unless the source is explicitly preview. | https://zed.dev/brand |
| JetBrains IDEs | `jetbrains`, `idea`, `intellij`, `pycharm`, `webstorm`, `goland`, `datagrip`, `rubymine`, `clion`, `rider` | Use official JetBrains product icons from JetBrains brand assets or product downloads. | https://www.jetbrains.com/company/brand/ |
| Android Studio | `android studio` | Use the official Android Studio product/app icon only after importing an approved Google-provided asset. Do not substitute a generic JetBrains logo. | https://developer.android.com/studio |
| Xcode | `xcode` | Use the official Xcode app icon from Apple-provided product resources. Do not redraw it. | https://developer.apple.com/xcode/ |
| OpenAI / Codex | `codex`, `openai codex` | OpenAI logos may be used only when directly related to OpenAI services and only exactly as provided. | https://openai.com/brand/ |
| Claude Code | `claude code`, `claude agent` | Anthropic docs explicitly say partner integrations must not label themselves `Claude Code` or use Claude Code-branded visual elements. Use a neutral terminal/agent glyph until Anthropic provides a reusable integration asset. | https://code.claude.com/docs/en/sdk |
| Gemini CLI | `gemini cli`, `gemini` | Gemini CLI is official and open source, but we do not currently have a public Google brand-asset page for a reusable CLI logo in this app. Use a neutral Gemini/AI glyph until an approved asset is imported. | https://github.com/google-gemini/gemini-cli |
| Aider | `aider` | Use the official Aider logo from the upstream project if we decide to import assets. | https://github.com/Aider-AI/aider |
| Terminal | `terminal`, `powershell`, `bash`, `zsh`, `cmd`, `shell` | Always use a neutral terminal glyph. This is not a brand slot. | n/a |

## Current mobile policy

Until branded assets are imported into Flutter assets and cleared for usage, the mobile app should:

- show neutral in-app glyphs for all tools,
- avoid pretending a Material icon is an official vendor logo,
- keep brand-sensitive tools (`Claude Code`, `Gemini CLI`, `OpenAI/Codex`) on neutral symbols unless we have approved assets.

## Import checklist

Before adding a branded icon to the app:

1. Confirm the source URL is official.
2. Confirm the asset type we are using is allowed for product UI.
3. Record the exact file source and variant choice in this registry.
4. Update the Flutter asset manifest and the mobile tool-icon mapper together.
