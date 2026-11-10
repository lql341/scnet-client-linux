# Changelog

Changes to this repository. Upstream release notes are not reproduced here.

The Debian version is `<upstream version>-<packaging revision>`; the packaging revision restarts at
1 for each upstream release and is set in [`scripts/versions.env`](scripts/versions.env).

## 4.1.2-8

### Fixed

- The first-paint bootstrap in the injected HTML still read `scnet.ext.theme`, the key used before the
  appearance dialog was introduced, so the stored palette was applied only after the bundle ran and a
  restart flashed the default theme. It now reads `scnet.ext.palette` and `scnet.ext.size`.
- The compat renderer, which hosts the sign-in shell and the job-submission page, received neither
  palette nor text size, so those pages reverted to the vendor defaults. It now applies both and skips
  only the menu entry and the dialog.

## 4.1.2-7

### Changed

- The window-control hints follow the interface language instead of always carrying both, matching
  the rest of the window. The settings dialog keeps Chinese as its default, independently of the
  vendor language.

## 4.1.2-6

### Fixed

- The label substitution ran even when the vendor renderer already displayed English, which the
  renderer derives from the account language and rewrites at startup. The result was a mixed
  interface. The table now applies only while the vendor interface is Chinese, which is also what the
  documentation claims.

### Recorded

- The vendor has a language mechanism after all: `localStorage["sacp:client-settings:language"]`
  selects its zh/en bundles, but the value is restored from `userInfo.language` on every start, so a
  local switch does not survive. That is why the setting this build offers covers only the strings it
  contributes.

## 4.1.2-5

### Added

- The English language setting now also covers the sidebar (navigation items, section headers, the
  verification badge) and the account menu, through a substitution table of thirteen labels applied to
  the text nodes of those two containers. The originals are remembered per node, so switching back
  restores them; a `MutationObserver` re-applies the table after the vendor re-renders the menu.

## 4.1.2-4

### Fixed

- The settings dialog kept fixed font sizes, so it did not follow the text-size setting while the
  rest of the interface did. Its font sizes now scale with the same multiplier.

## 4.1.2-3

### Changed

- The extension is reduced to appearance settings. Usage, billing, transfers, connectivity,
  diagnostics, job notifications, console links and the sidebar entry are removed: the data they
  showed either duplicated the console or waited on an API that does not exist yet.
- Palettes: six choices (`system`, `paper`, `sand`, `forest`, `indigo`, `ink`) instead of two, each
  with a dark variant.
- Text size: `小`, `标准` and `大`, applied as a multiplier to the renderer's font tokens.
- Language: `中文` and `English` for the dialog's own strings. The vendor interface has no language
  switch, so its text stays Chinese and the dialog says so.
- The entry lives in the account menu; there is no sidebar item and no floating panel.

## 4.1.2-2

### Fixed

- Dark variants of `paper` and `claude` kept the light text tokens, so text rendered nearly invisible
  on the dark surfaces. The dark blocks now set `--text`, `--text-secondary`, `--text-tertiary`,
  `--color-ink` and the neutral button tokens alongside the surfaces.

## 4.1.2-1

### Target

- Upstream 4.1.2 (`SCNet-4.1.2-x64.zip`, 273,751,227 bytes, SHA-512 verified). Electron remains
  44.7.0 and every pinned native package is unchanged, so nothing was rebuilt for a new ABI. The
  archive grows by 16 MB; the resource tree, the two HTML entry points and every host operation the
  extension uses are unchanged, and no `usage.centers` method was added.

### Changed

- The extension no longer floats over the content. It takes a place in the sidebar navigation, after
  高性能计算, and opens a full-height view aligned with the content area, with its own title bar and
  tabs. Clicking any vendor navigation entry returns to the application.
- The account menu entries remain as shortcuts into the same view.

## 4.1.1-5

### Changed

- Extension entry points moved into the account menu that opens from the avatar, beside 我的资源 and
  费用中心: 用量与账单, 传输任务, 连接诊断 and 主题. The floating corner button is gone.
- Revision 4 is reverted: the desktop entry keeps `Name[en]=SCNet Client` and icon sizes are
  generated as before. Both changes had been made without a request.

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
