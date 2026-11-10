# Design

Analysis of the vendor package and the reasoning behind each substitution. All observations refer
to SCNet desktop client **4.1.1** as published for macOS x64
(`SCNet-4.1.1-x64.zip`). File-level evidence is quoted inline; conclusions that were not verified
are marked as such in [`verification.md`](verification.md).

## 1. Distribution

The client is distributed through an `electron-updater` generic feed:

| Channel | Manifest |
| --- | --- |
| macOS | `https://dlcdn.scnet.cn/client/mac/latest-mac.yml` |
| Windows | `https://dlcdn.scnet.cn/client/win/latest.yml` |

`latest-mac.yml` for 4.1.1 lists four artifacts, all with base64-encoded SHA-512:

| File | Size (bytes) |
| --- | --- |
| `SCNet-4.1.1-x64.zip` | 257,627,218 |
| `SCNet-4.1.1-arm64.zip` | 247,902,758 |
| `SCNet-4.1.1-x64.dmg` | 258,195,702 |
| `SCNet-4.1.1-arm64.dmg` | 248,542,343 |

There is no Linux entry, and the download page advertises macOS 13+, Windows 10+ and Android only.

### Truncated archives

A partially downloaded zip keeps its local file headers but loses the central directory. `unzip`
reports `End-of-central-directory signature not found`, while `7z l` still lists the entries found
before the truncation point. `curl -C -` against the same URL resumes correctly; the resulting
file matches the SHA-512 in the manifest byte for byte.

## 2. Package layout

```text
计算服务.app/Contents/
├── Info.plist                    CFBundleIdentifier com.sugon.sacp, 4.1.1, LSMinimumSystemVersion 13.0
├── MacOS/计算服务                Electron launcher stub
├── Frameworks/Electron Framework.framework    CFBundleVersion 44.7.0
└── Resources/
    ├── app.asar                  135 MB
    ├── app.asar.unpacked/        node_modules (partially unpacked)
    ├── bin/uv                    macOS x86-64 executable
    ├── agent-browser/agent-browser   macOS x86-64, version 0.39.0
    ├── agent-skills/             bundled skills
    ├── agent-plugins/            bundled plugins (documents, pdf, spreadsheets, media)
    ├── cli/index.js              bundled CLI entry
    ├── cua/worker.mjs            computer-use worker
    ├── scnet-wordmark.png, oauth-app-icons.png, oauth-return.ps1
    ├── tray*.png, icon.icns
    └── app-update.yml            provider: generic, url: .../client/mac
```

`app.asar` is an `electron-vite` build: `dist-electron/main/*.js` (multiple chunks, minified but
not obfuscated), `dist/` (React renderer assets), and the runtime dependencies:

```json
{ "name": "scnet-client", "version": "4.1.1",
  "main": "dist-electron/main/index.js", "type": "module",
  "packageManager": "bun@1.4.0",
  "engines": { "bun": ">=1.4.0", "node": ">=24.18.1" },
  "dependencies": {
    "@napi-rs/canvas": "1.0.2", "@trycua/cua-driver": "0.34.1", "node-pty": "1.1.0",
    "ssh2": "^1.17.0", "electron-updater": "^6.8.9", "@larksuiteoapi/node-sdk": "^1.74.0",
    "docx": "9.9.0", "exceljs": "4.4.0", "mammoth": "1.13.0", "msedge-tts": "2.1.0",
    "unpdf": "1.8.1", "ws": "^8.22.0" },
  "patchedDependencies": { "@earendil-works/pi-ai@1.1.0": "…",
                          "@earendil-works/pi-coding-agent@1.1.0": "…",
                          "exceljs@4.4.0": "…" },
  "scnetBuild": { "commit": "c5b623c", "channel": "release", "baseVersion": "4.1.1" } }
```

Two consequences matter for this repository:

- The agent runtime is bundled and runs inside the Electron main process; no platform-specific
  server is involved in the conversation, tool or skill path.
- The `@earendil-works/pi-*` packages are patched, so a rebuild from npm sources is not equivalent
  to the shipped bundle. The vendor `app.asar` is therefore reused rather than reconstructed.

The dependency block is unchanged since 4.1.0: the pinned native versions (section 4.3), `node-pty`
and the two standalone binaries (sections 4.4, 4.5) all carry over, so the 4.1.1 bump is a version
and checksum change only.

### Bundled resource directories

4.1.1 dropped two top-level `Resources/` trees that 4.1.0 shipped and added three files:

| Path | 4.1.0 | 4.1.1 |
| --- | --- | --- |
| `connectors/` | bundled connector catalogue (`catalog.json` plus release zips), read from `join(process.resourcesPath, "connectors")` | removed; the packed lookup is gone and the catalogue is `userData/resource-catalog-v3.json`, filled through `connectors.refresh-resources` |
| `home-scenarios/` | bundled scenario catalogue | removed; the store is `userData/home-scenarios`, file `home-scenarios-replay.json` |
| `scnet-wordmark.png`, `oauth-app-icons.png` | absent | artwork for the retained OAuth window (`background`/`logo`), read from `process.resourcesPath` |
| `oauth-return.ps1` | absent | PowerShell helper, only invoked when `process.platform === "win32"` |

The build copies the two PNGs, omits the PowerShell script, and no longer attempts to copy
`connectors/` or `home-scenarios/`, so the assembled resource set matches what upstream still
reads at runtime.

## 3. Why Linux is viable

The main process is platform-neutral and already contains Linux branches. Representative
extracts from `dist-electron/main/index.js`:

```js
// Runtime provisioner: platform + arch directory
join(app.isPackaged ? process.resourcesPath : …, "…")
"darwin" === process.platform ? "mac" : "win32" === process.platform ? "win" : "linux"

// Supported platform list for connector runtimes
if (!m || !["darwin", "linux", "win32"].includes(process.platform))
  throw Error("Unsupported runtime platform")

// Badge, clipboard, terminal, storage
y.showBadge && ["darwin", "linux"].includes(process.platform) && (app.badgeCount = s.size)
"linux" === t && (r.WAYLAND_DISPLAY ? … : xclip/xsel …)
isEncryptionAvailable() && ("linux" !== process.platform || "basic_text" !== …)

// Connector/plugin manifests declare platforms: ["darwin","win32","linux"]
```

The macOS-only behaviour is limited to the four areas enumerated below. Everything else is shared
code that already handles a Linux host.

## 4. Platform-specific surface

| Area | Item | Replacement strategy |
| --- | --- | --- |
| Runtime | Electron 44.7.0 darwin | same version, Linux x64 build |
| Native modules | `node-pty`, `@napi-rs/canvas`, `@trycua/cua-driver`, `@ubjs/node` | published `linux-x64-gnu` builds; `node-pty` compiled |
| Standalone binaries | `resources/bin/uv`, `resources/agent-browser/agent-browser` | Linux builds of the same tools |
| Packaging | `Info.plist`, `icon.icns`, `app-update.yml` | `.desktop`, PNG icon set, launcher, unchanged update feed |
| Window chrome | macOS traffic lights (left), Windows overlay | window controls overlay, right-aligned |

### 4.1 Electron runtime

`Frameworks/Electron Framework.framework/Versions/A/Resources/Info.plist` reports
`CFBundleVersion 44.7.0`, and `electron-v44.7.0-linux-x64.zip` is available from the standard
mirrors. Using a different Electron major would break the native module ABI compiled here; the
version is therefore pinned and asserted by construction (the addon is compiled against the same
header tree).

### 4.2 node-pty

`node-pty@1.1.0` ships prebuilds for darwin and win32 only, and its loader order is:

```js
const dirs = ['build/Release', 'build/Debug', `prebuilds/${process.platform}-${process.arch}`];
```

The addon is therefore compiled against the Electron 44.7.0 header tree and installed at
`node_modules/node-pty/prebuilds/linux-x64/pty.node`. Linux uses `forkpty`; the darwin
`spawn-helper` has no Linux counterpart and is not needed.

Header acquisition detail: `node-gyp --dist-url=https://npmmirror.com/mirrors/electron/` fails
checksum verification because the mirror's `SHASUMS256.txt` has no entry for the Electron header
tarball (`remote undefined`). The build therefore downloads
`node-v<version>-headers.tar.gz` directly into `~/.cache/node-gyp/<version>`, writes the
`installVersion` marker, and builds with `--nodedir`.

### 4.3 canvas, cua-driver, ubjs

All three are pinned exactly in the vendor manifest, so the Linux packages must match those
versions rather than `latest`:

| Module | Linux package | Notes |
| --- | --- | --- |
| `@napi-rs/canvas@1.0.2` | `@napi-rs/canvas-linux-x64-gnu@1.0.2` | N-API, no ABI rebuild |
| `@trycua/cua-driver@0.34.1` | `@trycua/cua-driver-linux-x64-gnu@0.34.1` | ships `libcua_driver_sdk.so` + `cua_driver_node_runtime.node` |
| `@ubjs/node@0.31.0-3` | `@ubjs/node-linux-x64-gnu@0.31.0-3` | uniffi N-API runtime used by cua-driver |

The upstream `@trycua/cua-driver` manifest already declares the Linux optional dependencies:

```json
"optionalDependencies": {
  "@trycua/cua-driver-linux-x64-gnu": "0.34.1",
  "@trycua/cua-driver-linux-arm64-gnu": "0.34.1", … }
```

`cua-driver` resolves its native library at import time via `@ubjs/node`'s `resolveLibPath` with
`npmPackageBase: "@trycua/cua-driver-"` and `tripleStyle: "node"`, which yields the package name
above.

### 4.4 agent-browser

The client spawns `resources/agent-browser/agent-browser` with `mcp --tools core` when the browser
tool is used:

```js
if (app.isPackaged)
  return join(process.resourcesPath, "agent-browser",
              "win32" === process.platform ? "agent-browser.exe" : "agent-browser")
```

The path is fixed, so the Linux executable is installed at that location. The npm package
`agent-browser@0.39.0` (the version printed by the shipped macOS binary) provides
`bin/agent-browser-linux-x64`.

### 4.5 uv

In a packaged build the provisioner uses `resources/bin` as its `uv` directory and executes
`uv`/`python3` from the directories recorded in its own `ready.json` metadata; the binary itself is
only a tool entry point, and no version is asserted by the client. The build installs the static
`uv 0.9.9` Linux binary. If a stricter match to the vendor binary is desired, the version string of
the macOS `uv` should be read first and the closest Linux release selected.

### 4.6 ssh2

`ssh2` loads its native acceleration optionally:

```js
try { binding = require('./crypto/build/Release/sshcrypto.node'); } catch {}
```

No Linux addon is built. The pure-JS path is used, which is functionally complete and only slower
for bulk transfers.

### 4.7 Window controls

The vendor creates the window with `titleBarStyle: "hidden"`, so the application draws its own
title bar and relies on the platform for the window buttons:

```js
{ …, titleBarStyle: "hidden", trafficLightPosition: { x: 14, y: 16 }, titleBarOverlay: y(), … }

function w(e="light",t=36){return{color:"#00000000",height:t,symbolColor:"dark"===e?"#ffffff":"#1a1c1f"}}
function y(e="light",t=36){return"darwin"===process.platform||("win32"===process.platform?w(e,t):void 0)}
```

macOS draws traffic lights, Windows uses the `titleBarOverlay` mechanism so Chromium draws the
buttons, and Linux gets neither. The application compensates with an in-page control cluster,
`WindowTools`, which renders unless `darwin || (win32 && isMainWindow)`:

```js
let a="darwin"===s.H.context.platform, t="win32"===s.H.context.platform&&s.H.context.isMainWindow
…
return (s,b) => a||t ? null : h("div", {class:"window-tools …"}, [ … min / max / close … ])
```

On Linux that cluster is therefore rendered wherever the component is mounted — the sign-in
`AuthShell` (with `showMax=false`) and the legacy `compat` shell's `AppWindowHeader`. It does
provide working buttons there, but the current renderer's main route mounts no `WindowTools` at
all, so both the main window and the sign-in window could end up without controls on Linux.

**Attempted and rejected: the Chromium overlay.** Enabling `titleBarOverlay` for Linux (and the
in-app chrome that reserves 36 px for it in both renderers) produced two overlapping sets of
controls: Chromium's own circular buttons on top of the vendor's `WindowTools` glyphs. The
transparent overlay colour means nothing clears the strip, so the vendor glyphs showed through
beside the platform buttons. Removing the vendor cluster instead breaks the main window, where
`WindowTools` is the only implementation the vendor has for Linux.

**Implemented:** leave the vendor path untouched — no overlay, `WindowTools` stays visible and
remains the primary control surface — and add a fallback only where the cluster is absent:

| Patch | Target | Change |
| --- | --- | --- |
| `login-window-controls` | `dist/index.html`, `dist/compat/index.html` | loads `window-controls.js` |

[`scripts/window-controls.js`](../scripts/window-controls.js) watches the document and renders
minimize, maximize/restore and close **only while no `.window-tools` element exists**, and removes
itself as soon as the shell renders the vendor cluster. The maximize glyph and label follow
`host.invoke('window.is-maximized')`: they are refreshed after a click and on resize, so a maximize
performed by the window manager (double-click on the drag strip, Super+Up) is reflected too. The
script is inactive on other platforms and adds no controls to windows that already have them, which
keeps the number of clusters at one.

The result on Linux: on the current main route, where the vendor cluster is absent, the fallback
provides minimize/maximize/close at the top right (verified: 1200×768 → 1920×1047 and back). Where
the vendor `WindowTools` is mounted — the sign-in `AuthShell` and the legacy compat header — the
fallback stands down and the vendor glyphs remain the only controls; the sign-in window shows
minimize and close because the vendor passes `showMax=false` there.

## 5. asar repacking

The vendor asar marks a specific set of packages as unpacked (`@napi-rs/canvas*`, `@trycua/*`,
`@ubjs/*`, `jszip`, `node-pty`, `ssh2`). The rebuild unpacks the whole of `node_modules` instead,
for three reasons:

1. `@trycua/cua-driver` `dlopen`s `libcua_driver_sdk.so`. A path inside `app.asar` fails with
   `cannot open shared object file: Not a directory`, because only file contents — not shared
   library loading — are emulated for asar paths.
2. The client forks its computer-use worker from a path that hardcodes the unpacked directory:
   `join(process.resourcesPath, "app.asar.unpacked", "node_modules/@trycua/cua-driver/dist/index.js")`.
3. The added Linux packages are not present in the vendor asar header. Files added only to
   `app.asar.unpacked` are invisible to module resolution inside the archive.

Alternative considered and rejected: shipping the application as a plain `resources/app/`
directory. It would remove the asar layer, but `app.isPackaged` stays true, so the hardcoded
`app.asar.unpacked` path in (2) would have to be patched inside the vendor JavaScript. Repacking
keeps the vendor code byte-identical, which is the stronger invariant.

Asar integrity validation (`EnableEmbeddedAsarIntegrityValidation`) is not enabled in this build —
the repacked archive loads, and `ELECTRON_RUN_AS_NODE` works, so `RunAsNode` is available too.

## 6. Launcher policy

`chrome-sandbox` cannot be setuid in a portable, non-root installation. The launcher therefore
probes, in order:

1. setuid-root `chrome-sandbox`;
2. unprivileged user namespaces: `user.max_user_namespaces > 0`,
   `kernel.unprivileged_userns_clone != 0` when the sysctl exists, and
   `kernel.apparmor_restrict_unprivileged_userns != 1`;
3. otherwise `--no-sandbox`.

`SCNET_NO_SANDBOX=1` forces step 3. The `.deb` `postinst` additionally sets
`root:root 4755` on `chrome-sandbox` so an installed package takes path 1.

The launcher also sets `umask 077` before `exec`, and re-`chmod`s an already existing
`~/.config/scnet-client/config.json` / `~/.sclaw/agent/auth.json` to 0600. This is the only place
where credentials at rest can be improved without touching the vendor code: the client writes its
store with the ambient umask (0644 on Debian and Ubuntu by default), and `config.json` holds both the
session token and — when "记住密码" is used — the remembered-login blob. That blob is
`local-v1:` + base64(iv‖tag‖AES-256-GCM) with the key derived from `baseUrl` and `userId`, both
stored in the same record, so it is obfuscation rather than encryption; the vendor would have to
switch to `safeStorage`/Keychain for a real fix. Documented in the README, unchanged in code.

## 7. Packaging

The package metadata is maintained as files rather than generated inline: `packaging/launcher.sh`
is installed as the launcher, and `packaging/debian/` holds the `control` template, the desktop
entry and the maintainer scripts. The build substitutes the version, the upstream version and the
installed size, then runs `dpkg-deb`.

```text
/opt/scnet-client/                      bundle from build/linux
/usr/bin/scnet-client -> /opt/scnet-client/launcher.sh
/usr/share/applications/scnet-client.desktop
/usr/share/icons/hicolor/1024x1024/apps/scnet-client.png
```

Icons: `icon.icns` is a sequence of typed chunks; the PNG representations are extracted as-is
and the missing sizes are produced by a premultiplied box filter
(`scripts/extract-icons.py`). Thirteen sizes (16 to 1024) are installed into
`/usr/share/icons/hicolor/<size>x<size>/apps/scnet-client.png`, and `postinst`/`postrm` refresh
the icon cache.

Installing a single 1024×1024 image is not sufficient on Linux: menu implementations resolve
`Icon=` against the theme index, and a theme that cannot satisfy the requested size (or a stale
`icon-theme.cache`) renders no icon at all. Providing the full size ladder plus a cache refresh is
what makes the entry appear in application menus and panels.
Dependencies list both `t64` and pre-`t64` package names so the package installs on Debian 12/13
and Ubuntu 22.04/24.04.

`app-update.yml` is copied unchanged. On Linux `electron-updater` cannot apply an update to a
non-AppImage layout and the feed carries no Linux artifacts, so the update entry point is
non-functional by design rather than by patch.

## 8. Invariants

- No vendor JavaScript file is edited. The archive is repacked with the whole of `node_modules`
  unpacked, and the only additions are one `<script>` tag in each of the two HTML entry points plus
  the script file it loads, both declared in `scripts/patch-vendor.cjs`.
- Native module versions equal the versions pinned by the vendor manifest, which are held once in
  `scripts/versions.env`.
- Every platform-specific artifact is verified at build time (`scripts/smoke-native.cjs`).
- The repository tree carries no vendor binaries; the vendor archive is fetched and checksum
  verified at build time.
