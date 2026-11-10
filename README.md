# scnet-client-linux

[中文](README.zh-CN.md) | English

Build pipeline that produces a Linux x64 variant of the official SCNet desktop client
(application name 计算服务, bundle identifier `com.sugon.sacp`) from the vendor's macOS
Electron distribution.

Current target: **4.1.2** (Electron **44.7.0**), see [`VERSION`](VERSION). Packaging revision
**2**, see [`CHANGELOG.md`](CHANGELOG.md).

```bash
scripts/check-upstream.sh   # compare this repository's target with the live vendor feed
```

The vendor publishes Windows, macOS and Android builds only. The application itself is
platform-neutral Electron code — its main process already carries Linux code paths for the
runtime provisioner, clipboard, tray, storage and terminal — so the platform-specific parts can
be replaced rather than reimplemented. This repository contains that replacement procedure, the
resulting Debian package definition, and the evidence used to justify it.

## Scope

In scope:

- replacing the Electron runtime, native node modules and standalone binaries with Linux builds;
- repacking `app.asar` so the Linux native artifacts resolve correctly;
- packaging: portable bundle, `.deb`, desktop entry, unprivileged launcher;
- documenting what was verified, how, and what remains unknown.

Out of scope:

- modification of the vendor's JavaScript: every vendor file is used as shipped, the only additions
  being one `<script>` tag in the two HTML entry points and the file it loads;
- reimplementation of application features;
- support commitments. The build serves internal testing during the Linux port.

The repository tree contains no vendor binaries and no build outputs. The vendor archive is
fetched from the vendor CDN at build time and verified against the SHA-512 published in
`latest-mac.yml`. No prebuilt package is published: the pipeline is the only source of an
installable `.deb`, which contains the vendor client and is unsigned.

## Requirements

| Component | Version / notes |
| --- | --- |
| Host | Debian 12/13 or Ubuntu 22.04/24.04, x86-64 |
| Build tools | `bash curl unzip python3 nodejs npm gcc g++ make dpkg-deb fakeroot` |
| Disk | ~3 GB for `build/work` and `build/cache`, ~750 MB for the bundle |
| Network | vendor CDN (`dlcdn.scnet.cn`), npm registry, PyPI mirror, Electron mirror |

Windows and macOS hosts are not supported as build hosts.

## Build

```bash
git clone https://github.com/lql341/scnet-client-linux.git
cd scnet-client-linux
scripts/build-linux.sh                 # full pipeline, ~5 min with warm caches
scripts/build-linux.sh --portable-only # skip the .deb
scripts/build-linux.sh --clean         # discard build/ first
```

The pipeline is idempotent: downloads are cached in `build/cache/`, intermediate trees in
`build/work/`, and each stage is skipped when its output already exists.

| Stage | Action |
| --- | --- |
| 0 | fetch `SCNet-<version>-x64.zip`, verify SHA-512, extract |
| 1 | fetch `electron-v44.7.0-linux-x64.zip` |
| 2 | extract `app.asar`, apply the window-decoration patches |
| 3 | install `@napi-rs/canvas`, `@trycua/cua-driver`, `@ubjs/node` Linux builds |
| 4 | compile `node-pty` against the Electron ABI |
| 5 | fetch the `uv` and `agent-browser` Linux binaries |
| 6 | repack `app.asar` (`--unpack-dir node_modules`), copy resources, self-check |
| 7 | extract the icon set (16–1024 px), write `launcher.sh` |
| 8 | build the Debian package |

Outputs:

```text
build/linux/                                portable bundle
├── scnet-client                            Electron 44.7.0 runtime
├── launcher.sh                             sandbox-aware launcher
└── resources/
    ├── app.asar                            repacked, JavaScript unmodified
    ├── app.asar.unpacked/                  node_modules with Linux native modules
    ├── bin/uv                              uv 0.9.9 (static)
    ├── agent-browser/agent-browser          agent-browser 0.39.0
    └── agent-skills/ agent-plugins/ cli/ cua/
scnet-client_4.1.2-4_amd64.deb
```

### Run

```bash
build/linux/launcher.sh                          # portable
sudo apt install ./scnet-client_4.1.2-4_amd64.deb  # then start "SCNet 计算服务" from the menu
```

The launcher keeps the Chromium sandbox whenever the system can provide one — a setuid-root
`chrome-sandbox`, or unprivileged user namespaces including the Ubuntu 23.10+
`apparmor_restrict_unprivileged_userns` restriction — and falls back to `--no-sandbox` only when
neither is available. `SCNET_NO_SANDBOX=1` forces the fallback.

Configuration is written to `~/.sclaw/`, the same location as the macOS and Windows builds.

## Credentials at rest

The vendor client writes three secrets into the user profile. This build changes their file
permissions, not the mechanism — the vendor `app.asar` stays untouched:

| File | Content | Protection |
| --- | --- | --- |
| `~/.sclaw/agent/scnet-credentials/<hash>.json` | SCNet API key (`sk-…`) | plaintext, created 0600 by the client |
| `~/.sclaw/agent/mcp-oauth.json` | OAuth tokens for third-party MCP servers | plaintext, `umask`-dependent |
| `~/.config/scnet-client/config.json` | session token, plus the account password if "记住密码 / Remember password" was used | see below |

The remembered-login value is `local-v1:` + base64(iv‖tag‖AES-256-GCM), and the AES key is
`sha256(JSON.stringify(["local-v1:", baseUrl, userId]))` — derived from two fields stored in the
same JSON object. Anyone who can read the file can recover the password offline; it is obfuscation,
not encryption, and the code is identical on macOS and Windows.

What this build does about it: the launcher sets `umask 077` before starting the client and
re-`chmod`s an existing `config.json`/`auth.json` to 0600, so a default-`umask` install no longer
leaves them world-readable. What it cannot do is fix the derivation itself — on a shared machine
leave "记住密码" off and rely on the API-key path, and revoke keys from the SCNet console when a
machine is retired.

## Appearance settings

One dialog, injected into the renderer without editing vendor code and reachable from the account menu
under the avatar: six palettes (`system`, `paper`, `sand`, `forest`, `indigo`, `ink`, each with a dark
variant), three text sizes (`小`, `标准`, `大`) and a language switch for the dialog itself
(`中文` / `English`; the vendor interface is Chinese only). See
[`docs/extension-design.md`](docs/extension-design.md).

## Replaced components

| Component | Vendor macOS artifact | Linux replacement | Source |
| --- | --- | --- | --- |
| Electron runtime | 44.7.0 darwin | `electron-v44.7.0-linux-x64` | Electron mirror |
| `node-pty` 1.1.0 | `prebuilds/darwin-*` | compiled addon in `prebuilds/linux-x64/` | Electron headers |
| `@napi-rs/canvas` 1.0.2 | `canvas-darwin-*` | `@napi-rs/canvas-linux-x64-gnu` | npm |
| `@trycua/cua-driver` 0.34.1 | `cua-driver-darwin-*` | `@trycua/cua-driver-linux-x64-gnu` | npm |
| `@ubjs/node` 0.31.0-3 | `node-darwin-*` | `@ubjs/node-linux-x64-gnu` | npm |
| `agent-browser` 0.39.0 | Mach-O executable | `bin/agent-browser-linux-x64` | npm, same version |
| `uv` | Mach-O executable | `uv` 0.9.9 static binary | PyPI wheel |
| `ssh2` native acceleration | `sshcrypto.node` (darwin) | omitted; pure-JS fallback | — |
| `app.asar` | partial unpack list | repacked with `--unpack-dir node_modules` | `@electron/asar` |
| Icon and entry point | `icon.icns`, `Info.plist` | extracted PNG, `.desktop`, launcher | — |

The `ssh2` addon is optional in the upstream module (`try { require(...) } catch {}`), so no
functionality is lost beyond throughput on bulk transfers.

## Window controls and vendor patches

The vendor draws its own minimize/maximize/close cluster (`WindowTools`) inside the application
shell, and only asks the platform for buttons on macOS (traffic lights) and Windows
(`titleBarOverlay`). Linux has neither a system title bar nor platform buttons, and the vendor
cluster only renders in the sign-in page (`AuthShell`, with `showMax=false`) and in the legacy
`compat` shell's `AppWindowHeader`; the current renderer's main route does not render it, so both
the sign-in and the main window can end up without controls.

Enabling the Chromium overlay for Linux was tried and rejected: it draws a second set of buttons
on top of the vendor glyphs, and because the overlay colour is fully transparent the vendor glyphs
show through beside them.

The shipped fix leaves the vendor path untouched and adds a fallback only where the cluster is
missing:

| Patch | Target | Change |
| --- | --- | --- |
| `login-window-controls` | `dist/index.html`, `dist/compat/index.html` | loads `window-controls.js` |

[`scripts/window-controls.js`](scripts/window-controls.js) renders minimize, maximize/restore and
close **only while no `.window-tools` element exists**, and removes itself once the shell renders
the vendor cluster. The maximize state is read through `host.invoke('window.is-maximized')` and
re-queried after a click and on resize, so a maximize performed by the window manager (double-click
on the drag strip, Super+Up) does not leave a stale glyph. The script is inactive on other
platforms, which keeps the number of control clusters at one.

Every other file in `app.asar` is reused as shipped. The modification is additive: one `<script>`
tag in each of the two HTML entry points, plus the file it loads.

## Icons

`icon.icns` provides PNG representations at 32/64/128/256/512/1024 px. The build extracts them and
resamples the missing sizes, installing 13 sizes (16–1024) into
`/usr/share/icons/hicolor/<size>x<size>/apps/`, and refreshes the icon cache in `postinst`/`postrm`.

A single 1024 px image is not enough: menu and panel implementations resolve `Icon=` through the
theme index, and a theme that cannot satisfy the requested size — or a stale `icon-theme.cache` —
renders nothing. This accounted for the absence of a menu icon in the earlier package.

See [`docs/design.md`](docs/design.md) for the reasoning behind each substitution.

## Repository structure

```text
scnet-client-linux/
├── VERSION                        Target upstream version
├── CHANGELOG.md                   Repository changes per packaging revision
├── README.md / README.zh-CN.md    Overview, English / Chinese
├── scripts/
│   ├── build-linux.sh             Build pipeline (stages 0–8, idempotent)
│   ├── versions.env               Pinned dependency versions, packaging revision
│   ├── check-upstream.sh          Compare the target with the live vendor feed
│   ├── check-docs.sh              Assert documentation matches the version sources
│   ├── patch-vendor.cjs           Window-decoration patch (exact match, fails on drift)
│   ├── window-controls.js         Linux fallback window controls (min/max/close)
│   ├── smoke-native.cjs           Native artifact smoke test (runs inside the build)
│   └── extract-icons.py           Icon set extraction and resampling from .icns
├── packaging/
│   ├── launcher.sh                Sandbox-aware launcher, installed as launcher.sh
│   └── debian/                    control.in, desktop entry, postinst, postrm
├── docs/
│   ├── README.md                  Documentation index and editing rules
│   ├── design.md / design.zh-CN.md         Package analysis, substitutions, packaging decisions
│   ├── verification.md / verification.zh-CN.md   Procedure, observed results, unknowns
│   └── assets/screenshot-linux.png             Linux window with the fallback controls
└── .github/workflows/check.yml    Lint and policy checks (no vendor binaries in tree)
```

`build/`, `app/`, the vendor archive and the `.deb` are ignored by Git; nothing in the tree is
derived from the vendor package.

## Verification

The build fails if any of the four native artifacts is missing, and then runs
[`scripts/smoke-native.cjs`](scripts/smoke-native.cjs), which loads every platform-specific
artifact and exercises the ones testable without a display (`node-pty` spawn/read/exit,
`@napi-rs/canvas` PNG encode, `ssh2`, `@ubjs/node`, `@trycua/cua-driver` Rust `dlopen`, plus the
`uv` and `agent-browser` executables).

Interactive verification was performed on Debian 13 x64/X11 for 4.1.0 and repeated on Ubuntu 26.04.1
x64/X11 for 4.1.1: window titled 计算服务 at 1200×768 with minimize, maximize/restore and close at
the top right; maximize was verified both through the control and through the window manager, with
the glyph following the state, on the sign-in route and on the logged-in main route. Minimize was
verified by simulated click, the icon resolved through `Gtk.IconTheme` at the seven requested
sizes, and the same behaviour after unpacking the `.deb`. Procedure, commands and results:
[`docs/verification.md`](docs/verification.md).

## Known limitations

| Area | Status |
| --- | --- |
| Login, HPC job submission, SSH sessions, file transfer | Not exercised end to end |
| Computer use (CUA) | Library loads; pointer/screenshot actions untested; requires X11/Wayland access and `libXtst` |
| Auto-update | Not functional: the update feed serves macOS/Windows artifacts, and `electron-updater` cannot replace a Linux bundle. Upgrade by rebuilding |
| Code signing | None |
| Tray icon | Declared as `Recommends: libayatana-appindicator3-1 | libappindicator3-1`; the indicator is registered when the library is present, otherwise "close" leaves a windowless process |
| Closing the main window | Hides to the tray instead of quitting (vendor `close` handler); on a host without an indicator the process keeps running windowless |
| Tiling window managers, fractional scaling | Not verified; the maximize control relies on how the window manager treats a frameless window |
| Multiple instances in one profile | Occasional windowless start due to the single-instance lock and session restore; terminate remaining instances and retry |
| MCP OAuth (third-party servers) | The consent flow uses a `127.0.0.1` loopback redirect and completes, but the vendor only closes and raises the browser tab on macOS (AppleScript) and Windows (`oauth-return.ps1`); on Linux the tab stays open. First-party connectors authorise with the SCNet session and need no OAuth |
| Support | Internal test build; no support commitment |

## Updating to a new upstream release

1. `scripts/check-upstream.sh` reports the new version and the file list of the live feed.
2. Update `VERSION`, and `MAC_ZIP_SHA512` in [`scripts/versions.env`](scripts/versions.env)
   (SHA-512 of the x64 zip, base64-decoded from `latest-mac.yml`).
3. If the bundled Electron version changed (`Frameworks/Electron Framework.framework/Versions/A/
   Resources/Info.plist`), update `ELECTRON_VERSION` in the same file; `node-pty` is recompiled
   automatically. Confirm that the patch patterns in `scripts/patch-vendor.cjs` still match: a
   missing pattern fails the build, and the window code has to be re-derived from the new bundle.
4. Reconcile the native module and binary versions with the new `app.asar/package.json`
   (`CANVAS_VERSION`, `CUA_DRIVER_VERSION`, `UBJS_VERSION`, `NODE_PTY_VERSION`,
   `AGENT_BROWSER_VERSION`, `UV_VERSION`), all in `scripts/versions.env`.
5. Diff the new `Resources/` tree against the previous one. Stage 6 copies `agent-plugins`,
   `agent-skills`, `cli`, `cua`, `en.lproj`, `tray*.png`, `app-update.yml` and the OAuth artwork;
   entries that upstream adds, renames or drops (4.1.1 dropped `connectors/` and `home-scenarios/`
   and added the OAuth PNGs) have to be reconciled with that list, otherwise `cp -a` aborts the build.
6. Add an entry for `<version>-1` to [`CHANGELOG.md`](CHANGELOG.md).
7. Rebuild; the bundled smoke test must pass. Then run `scripts/check-docs.sh` and repeat the
   interactive checks in [`docs/verification.md`](docs/verification.md).

New native dependencies (`.node`, `.so`) require the matching official `linux-x64-gnu` variant,
otherwise the dependent feature fails at runtime.

## Documentation

- [`docs/README.md`](docs/README.md) — documentation index, translation rules and screenshot
  regeneration
- [`CHANGELOG.md`](CHANGELOG.md) — repository changes per packaging revision
- [`docs/design.md`](docs/design.md) — upstream package analysis, substitution rationale, asar
  and ABI decisions, packaging layout
- [`docs/verification.md`](docs/verification.md) — verification procedure, observed results,
  remaining unknowns
- [`docs/extension-design.md`](docs/extension-design.md) — additions beyond the port: per-centre
  usage, billing, notifications, diagnostics, theming; mechanism, verification and boundaries

## Status

Internal evaluation build for the Linux port of the desktop client, used during the test phase.
The repository carries no vendor binaries: build outputs are generated locally from the vendor's
own distribution. Distribution of those outputs outside the organisation requires authorisation,
and compliance with the vendor's terms remains with whoever builds or installs the result.

## License

Scripts and documentation in this repository are MIT-licensed — see [LICENSE](LICENSE). The
upstream client remains the property of its owners and is not covered by that license.
