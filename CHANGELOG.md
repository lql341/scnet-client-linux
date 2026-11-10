# Changelog

Changes to this repository. Upstream release notes are not reproduced here.

The Debian version is `<upstream version>-<packaging revision>`; the packaging revision restarts at
1 for each upstream release and is set in [`scripts/versions.env`](scripts/versions.env).

## 4.1.1-4

### Fixed

- The desktop entry shows `SCNet 计算服务` in every locale. The previous entry carried
  `Name[en]=SCNet Client`, and a session whose `LANGUAGE` is `en_US` — the default on the test
  machines — displayed `SCNet Client`, which does not match the window title.
- Icon sizes up to 48 px are cut to the red wordmark and scaled to fill the canvas. The vendor
  artwork is a white tile with a small wordmark, which read as a blank square in menus and panels.

## 4.1.1-3

### Added

- Extension bundle injected by `scripts/patch-vendor.cjs` from `extensions/`: per-centre usage with a
  fallback to the account payload, a billing panel with CSV export, a transfer and file-task list, a
  connectivity check, a diagnostics report, console entry points, and three themes (`system`, `paper`,
  `claude`, each with a dark variant). The extension is inactive in the compat renderer that hosts
  the sign-in shell.
- `usage.centers` contract documented in [`docs/extension-design.md`](docs/extension-design.md);
  consumption columns appear as soon as the platform provides the method.
- CI checks the extension bundle's syntax and the presence of its files.

## 4.1.1-2

### Security

- The launcher sets `umask 077` before starting the client and resets an existing
  `~/.config/scnet-client/config.json` and `~/.sclaw/agent/auth.json` to mode 0600. Electron writes
  its store with the ambient umask, so a default Debian or Ubuntu installation left both files
  readable by other local users. `config.json` carries the session token and, when "remember
  password" is enabled, the remembered-login record.
- Documentation states that the remembered-login record is reversible: its AES key is derived from
  `baseUrl` and `userId`, both stored beside the ciphertext. The construction is unchanged; the
  client would have to adopt `safeStorage` or a platform keychain for a substantive fix.

### Packaging

- `Recommends` gained `libayatana-appindicator3-1 | libappindicator3-1`. Without the indicator
  library, closing the main window leaves a running process without a window and without a way back.
- `xdg-utils` moved from `Recommends` to `Depends`, so `shell.openExternal` (connector
  authorisation, external links) has `xdg-open` available on a minimal installation.

### Documentation

- New section on credentials at rest, covering the three secret-bearing files and their protection.
- MCP OAuth behaviour on Linux: the consent flow uses a `127.0.0.1` loopback redirect and completes,
  but the browser tab is only closed and raised on macOS and Windows, where the vendor implements it.

## 4.1.1-1

### Target

- Upstream 4.1.1 (`SCNet-4.1.1-x64.zip`, SHA-512 verified). Electron 44.7.0 and every pinned native
  package are unchanged, so no component was rebuilt for a new ABI; the window-decoration patch
  applies without modification.

### Packaging

- The copied resource set follows upstream: `Resources/connectors` and `Resources/home-scenarios`
  were removed upstream, and `scnet-wordmark.png` with `oauth-app-icons.png` were added for the
  retained OAuth window. The build copies the artwork and no longer attempts the removed trees.
- The `oauth-return.ps1` helper shipped by upstream is Windows-only and is not installed.

### Verification

- Automated checks, the sign-in window, the logged-in main route, window controls, icon resolution,
  connector catalogue and packaging were re-checked on Ubuntu 26.04.1 x64/X11. See
  [`docs/verification.md`](docs/verification.md).

## 4.1.0-4

### Fixed

- The window-controls fallback gained maximize and restore. The current renderer's main route mounts
  no vendor `WindowTools` cluster, so on Linux the fallback is the only control surface there; it
  previously offered minimize and close only.
- `patch-vendor.cjs` re-synchronises an already injected script instead of keeping a stale copy, and
  reports the condition under `--check`.

## 4.1.0-3

First published package: Linux x64 build of upstream 4.1.0, covering the build pipeline, the portable
bundle, the Debian package, the icon set, the desktop entry and the window-controls fallback.
