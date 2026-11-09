# Verification

What was executed, on which system, and what the result was. Anything not listed here was not
verified. The reference system is Debian 13 (trixie) x86-64 with an X11 session, a single
1200×741-capable display, and no root access during testing (the `.deb` was unpacked with
`dpkg-deb -x` rather than installed with `apt`).

## 0. Version coverage

Sections 1–6 record the initial 4.1.0-3 verification on the reference system (Debian 13). The
4.1.1 build was re-checked end to end on a second machine, Ubuntu 26.04.1 x86-64 with an X11
(XFCE) session:

| Re-checked | Result |
| --- | --- |
| Full pipeline (`scripts/build-linux.sh`) | exits 0, produces `scnet-client_4.1.1-1_amd64.deb` (195 MB) |
| Section 1 smoke test | identical output; all seven checks pass |
| Section 2, sign-in window | renders with title 「计算服务」 and class `scnet-client`, 1200×768; the vendor `.window-tools` cluster shows minimize and close, and the fallback stands down (no duplicates) |
| Section 2, main route | with a copy of an existing 4.1.0 profile the dashboard renders on 4.1.1 (sidebar reports 「SCNet v4.1.1」); `.window-tools` count `0`, fallback mounted with three buttons |
| Section 2, controls | maximize 1200×768 → 2560×1440 and back with the label switching to 还原/Restore; `wmctrl -b add,maximized_vert,maximized_horz` flips the glyph without a click; minimize sets `IsUnMapped` and `wmctrl -i -a` returns `IsViewable` |
| Section 3, icons | `Gtk.IconTheme` resolves `scnet-client` at 16–512 px (1024 px falls back to the 512 px image, as expected) |
| Section 4, sandbox probe | this host sets `kernel.apparmor_restrict_unprivileged_userns=1` and the portable `chrome-sandbox` is not setuid, so the launcher selects `--no-sandbox` as specified |
| Section 5, packaging | `Version: 4.1.1-1`, 13 icon sizes, `desktop-file-validate` exits 0, `apt-get -s install` resolves the dependencies and proposes the 4.1.0-4 → 4.1.1-1 upgrade, and the unpacked tree launches |
| Connector catalogue | the `#/mcp` page lists the service-side connectors (万方数据, Repilot, 智慧芽, BioBuddy, …) without the bundled `Resources/connectors` tree that 4.1.1 removed |

Still not re-executed for 4.1.1: the `apt` install itself (no root on the second machine either) and
the tray indicator interaction. The 4.1.0-3 rows below remain as recorded.

Two observations from the re-check that apply to both versions. Closing the main window through the
vendor channel hides it rather than quitting — the window module installs
`on("close", e => { hide(); e.preventDefault(); })` — so the process keeps running with no window
until the tray icon or a relaunch brings it back; this is the same symptom as the windowless start
in section 8. And the profile written by 4.1.0 loads unchanged in 4.1.1, with no visible migration
prompt.

## 1. Automated checks in the build

`scripts/build-linux.sh` fails the build rather than producing a partial bundle:

| Check | Stage | Behaviour on failure |
| --- | --- | --- |
| Vendor archive SHA-512 | 0 | Aborts; a resumed download is retried once from scratch |
| Patch patterns present exactly once | 2 | Aborts with the patch id |
| Native artifacts present | 6b | Aborts listing the missing artifact |
| `desktop-file-validate` | 8 | Aborts on an invalid desktop entry |
| Native smoke test | 6b | Aborts on the first failing module |

`scripts/smoke-native.cjs` runs inside the Electron runtime with `ELECTRON_RUN_AS_NODE=1` and
checks:

| Item | Assertion |
| --- | --- |
| `node-pty` | spawns `/bin/sh -c "printf pty-ok"`, reads the output, exits 0 |
| `@napi-rs/canvas` | creates a 16×16 canvas, fills it, encodes a PNG |
| `ssh2` | `Client` export is a function |
| `@ubjs/node` | native runtime module loads, `resolveLibPath` exported |
| `@trycua/cua-driver` | Rust SDK loads through `dlopen` from `app.asar.unpacked` |
| `resources/bin/uv` | executes, prints a version |
| `resources/agent-browser/agent-browser` | executes, prints a version |

Observed output on the reference system:

```text
ok   node-pty (spawn/read/exit)
ok   @napi-rs/canvas (16x16, 115 B PNG)
ok   ssh2 (Client export)
ok   @ubjs/node (native runtime loaded)
ok   @trycua/cua-driver (174 exports)
ok   resources/bin/uv (uv 0.9.9)
ok   resources/agent-browser/agent-browser (agent-browser 0.39.0)
all checks passed
```

## 2. Window and layout

Method: launch with an empty configuration directory, poll `xwininfo -root -tree` for the window,
capture it with `xwd`, decode to PNG, and inspect. When an older build is installed system-wide,
only the window of the instance under test is captured by window id, and the previous instance is
terminated first.

| Observation | Result |
| --- | --- |
| Window appears | title 「计算服务」, class `scnet-client`, 1200×741 |
| Time to first window | 5–20 s on first launch |
| Renderer content | sign-in form renders; with a session present the dashboard renders |
| Sign-in window controls | one minimize and one close glyph at the top right, no duplicates |
| Minimize works | simulated XTEST click changes map state to `IsUnMapped` |
| Restore works | `_NET_ACTIVE_WINDOW` returns the window to `IsViewable` |
| Hover state | pointer over a control paints its hover background, confirming hit targets |
| Fallback cluster | `window-controls.js` reported `hasRoot: false` while `.window-tools` was present, i.e. it stands down |
| Main-route cluster | on the current renderer's main route `.window-tools` count is `0` and the fallback is mounted with three buttons |
| Maximize via control | DevTools-protocol click: `window.is-maximized` false→true, viewport 1200×768→1920×1047, glyph/title switch to 还原/Restore |
| Restore via control | second click returns to 1200×768 and the maximize glyph |
| WM-initiated maximize | `wmctrl -b add,maximized_vert,maximized_horz` flips the glyph to 还原 without a click; removing the state restores it |

DOM inspection through the DevTools protocol confirmed that the sign-in window renders the vendor
`.window-tools` element (`.min item … size-30px`) and that no Chromium overlay is active
(`function y()` returns `undefined` on Linux in the shipped bundle). The main route of the current
renderer mounts no vendor cluster, so the fallback is the control surface there; its maximize state
is read from `window.is-maximized` and re-queried on resize.

The maximize/restore rows were verified on a stage-6 repacked `app.asar` containing the updated
script (the same artifact the pipeline produces), not on a rebuilt `.deb`; section 5 refers to the
4.1.0-3 package. Section 0 records the same rows re-verified on the 4.1.1 bundle.

Not verified: appearance under a tiling window manager and fractional scaling. The sign-in window
legitimately shows two controls rather than three: the vendor passes `showMax=false` and the window
is created with `maximizable: false`. Section 0 records the 4.1.1 re-check of the window and
sign-in-control rows.

## 3. Icon integration

Method: extract the package into a temporary root with `dpkg-deb -x`, add the standard
`index.theme`, regenerate the cache with `gtk-update-icon-cache`, then resolve `scnet-client`
through `Gtk.IconTheme` at several sizes.

| Size requested | Resolved file |
| --- | --- |
| 16 | `16x16/apps/scnet-client.png` |
| 24 | `24x24/apps/scnet-client.png` |
| 32 | `32x32/apps/scnet-client.png` |
| 48 | `48x48/apps/scnet-client.png` |
| 64 | `64x64/apps/scnet-client.png` |
| 128 | `128x128/apps/scnet-client.png` |
| 256 | `256x256/apps/scnet-client.png` |

`desktop-file-validate` exits 0 for the installed entry. Installation through `apt` itself was not
exercised on the reference system because root access was unavailable; `postinst`/`postrm` are
plain `chown`/`chmod`/cache-refresh actions that were reviewed but not executed by `dpkg`.

## 4. Sandbox

Method: run the launcher with a clean configuration directory and inspect the main process argv,
then force the fallback with `SCNET_NO_SANDBOX=1`.

| Case | argv | Result |
| --- | --- | --- |
| Default on the reference system | no `--no-sandbox` | window appears; unprivileged user namespaces are enabled here |
| `SCNET_NO_SANDBOX=1` | `--no-sandbox` | window appears |
| Installed package | setuid `chrome-sandbox` after `postinst` | not executed (no root); the launcher's setuid branch was reviewed only |

## 5. Packaging

| Check | Result |
| --- | --- |
| `dpkg-deb -c` layout | `/opt/scnet-client`, `/usr/bin/scnet-client` symlink, desktop entry, 13 icon sizes |
| Unpack and launch | window appears from the unpacked tree |
| Version | `4.1.0-3` (`4.1.1-1` in the re-check) |
| Dependencies | both `t64` and pre-`t64` names, so Debian 12/13 and Ubuntu 22.04/24.04 resolve |

## 6. Reproducibility

The pipeline was executed repeatedly during development. Cached stages are reused; a cold run
downloads ~390 MB (vendor archive, Electron runtime, three npm packages, two binaries) and takes
about five minutes on the reference system.

## 7. macOS packaging

`scripts/build-macos.sh` was executed on the Ubuntu host, which exercises everything except the
macOS-only steps (`codesign`, `xattr`, `ditto`, `hdiutil`). Those are guarded by `uname -s` and were
reviewed only; **no macOS hardware was available**, so gatekeeper behaviour, the vendor signature
verification and the `.dmg` path are unverified.

| Check | Result |
| --- | --- |
| `--arch x64` against 4.1.1 | SHA-512 matches the pin, bundle reports 4.1.1 / `com.sugon.sacp`, main binary is Mach-O x86_64 |
| `--arch arm64` against 4.1.1 | SHA-512 matches the arm64 pin, main binary is Mach-O arm64 |
| Bundle contents | `Info.plist` still carries the vendor `ElectronAsarIntegrity` value, `app.asar` untouched |
| Archive | 14 symlink entries preserved (same count as the vendor zip); a round-trip `unzip` restores `Versions/Current -> A` |
| Version guard | a bundle whose `CFBundleShortVersionString` differs from `VERSION` aborts the build |
| `--dmg` off macOS | exits before any packaging with `--dmg needs hdiutil` |
| `--arch all` | builds both architectures in one run |

## 8. Not verified

- Sign-in, HPC job submission, SSH sessions, file transfer, notebook lifecycle;
- computer use (CUA): the library loads, but pointer and screenshot actions were not exercised,
  and the driver needs X11/Wayland access plus `libXtst`;
- auto-update: the feed carries no Linux artifacts and `electron-updater` cannot replace this
  layout, so the feature is inert;
- tray icon: needs `libayatana-appindicator3`/`libappindicator3`, not installed here;
- multiple instances sharing one configuration directory: a windowless start was observed
  occasionally during testing, caused by the single-instance lock combined with session restore.
  Terminating remaining instances and relaunching restores normal behaviour; this was not
  investigated further;
- ARM64: the pipeline is x86-64 only, although upstream ships an arm64 macOS build and all four
  native packages exist for `linux-arm64-gnu`.
