# Release Assets

This directory is the single source of truth for distributable release packages in this repository.

Rule:
- Keep all final release-ready packages under `F:\Download\GitHub\YiboVibe\.release-assets`.
- Tool default build outputs may stay in their original build directories, but the package intended for delivery should always be copied here.
- Do not rely on scattered `build/`, `dist/`, or temporary output folders as the final handoff location.

Naming convention:
- `YiboVibe-desktop-v<version>-windows-x64-setup.exe`
- `YiboVibe-mobile-v<version>-android-release.apk`
- `YiboVibe-server-v<version>-linux-amd64-docker.tar`

Examples:
- `YiboVibe-desktop-v0.9.7-windows-x64-setup.exe`
- `YiboVibe-mobile-v0.9.8-android-release.apk`
- `YiboVibe-server-v0.9.7-linux-amd64-docker.tar`

Recommended workflow:
1. Build with the platform's normal command.
2. Copy the final distributable into this directory.
3. Keep the filename versioned and platform-specific.
4. Treat this directory as the place to inspect before sharing or publishing artifacts.

Helper script:
- `scripts/stage-release-asset.ps1`
