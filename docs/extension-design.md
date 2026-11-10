# Extension design

Additions to the Linux build beyond the port itself: account and quota information, billing, job
monitoring, transfer visibility, diagnostics, and theme switching. This document defines the
mechanism, the data paths and the boundaries. Implementation follows it incrementally.

## 1. Constraints

The repository keeps the vendor `app.asar` free of edits. Additions are therefore limited to:

- one script and one stylesheet placed in `dist/`, injected into the two HTML entry points by
  `scripts/patch-vendor.cjs`;
- the renderer-to-main bridge that the vendor preload already exposes (`window.host`);
- files assembled into the bundle by `scripts/build-linux.sh`.

Three consequences shape the design. The extension cannot add main-process behaviour, so no tray
badge, no protocol handler and no new window type. It cannot rely on vendor class names, which are
minified and change between releases. And it must fail closed: if a host operation disappears, the
affected module disables itself and the client keeps the vendor behaviour.

## 2. Mechanism

```text
dist/scnet-ext/main.js        entry point, module registry, bridge wrappers
dist/scnet-ext/theme.css      theme tokens, applied by attribute selector
dist/index.html               <script> tag appended by the login-shell patch
dist/compat/index.html        same, for the legacy renderer
```

`main.js` runs one module per feature. A module declares the host operations it needs; the registry
probes them once and skips the module when a probe fails, leaving a single warning in the console.
Every module is wrapped so that an exception during mount removes its own DOM and does not disturb
the shell.

The bridge is the existing preload surface:

```js
window.host.invoke(operation, payload)   // validated in the main process, rejects with a code
window.host.on(event, handler)           // host events, returns an unsubscribe function
window.host.context                      // { platform, arch, version, isMainWindow }
```

## 3. Data paths

The main process already exposes the read side of the platform client as one operation, `scnet.read`,
with a method per resource. Amounts, identifiers and dates arrive as the platform returns them; the
extension formats and displays, never caches to disk.

| Surface | Operation | Method / payload | Refresh |
| --- | --- | --- | --- |
| Account and quota card | `scnet.read` | `account.get` | 60 s, and on window focus |
| Billing list | `scnet.read` | `billing.list` with paging | on open, manual refresh |
| Billing detail | `scnet.read` | `billing.get` | on selection |
| Job list and state | `scnet.read` | `jobs.list`, `jobs.get` | 30 s while the panel is open |
| Job metrics | `scnet.read` | `jobs.metrics` | on demand |
| Transfers and file tasks | `scnet.read` | `transfers.list`, `file-tasks.list` | 15 s while visible |
| Centre usage | `scnet.read` | `usage.centers` (to be provided), falling back to `account.get` | 60 s |
| Console pages | `auth.open-authenticated-route` | `{ route }` | event |
| Diagnostics | `diagnostics.list-files`, `diagnostics.read-file`, `app.get-version`, `environment.get-context` | as defined by the host | on demand |
| Task notifications | `notifications.set-task-state` | `{ tasks: [...] }` | on state change |

State-changing operations (job cancellation, transfers, orders) are deliberately out of scope for the
first version. They pass through the vendor approval flow (`operations.approve`), which the extension
cannot drive without duplicating vendor logic.

## 4. Features

### 4.1 Centre usage

The panel answers one question per centre: which centres the account belongs to, which clusters sit
in each, and how much has been consumed there.

Two payloads feed it. `account.get` exists today and returns a wallet, a special balance and one entry
per cluster account whose `centerNames` and `clusterIds` are parallel arrays; the module expands those
into one row per centre and reports the account balance once, at account level. `usage.centers` is the
payload the platform team is adding for consumption figures, in the shape the panel already accepts:

```json
{ "currency": "CNY",
  "centres": [
    { "centerName": "华东一区【昆山】", "clusterIds": ["11250"],
      "cpuCoreHours": 1234.5, "gpuCardHours": 87.25, "storageGiB": 512, "jobCount": 42 } ] }
```

Fields the platform does not return are rendered as an em dash; the table gains its consumption
columns as soon as the payload arrives, with no client change. Until then the panel states that the
per-centre API is not yet available, so the limitation is visible rather than implied.

### 4.2 Billing panel

A panel opened from the account card: paginated list, one row per bill, with the fields the platform
returns. Selecting a row loads `billing.get` into a detail area. Export writes the currently loaded
pages to CSV in the renderer; no upload, no storage.

### 4.3 Job monitoring

A list of queued and running jobs with state, queue, elapsed time and exit code. Transitions from
running to finished, failed or cancelled raise a desktop notification through the renderer
`Notification` API and are mirrored into the vendor task indicator through
`notifications.set-task-state`. A tray badge would need main-process support and is not part of this
design.

### 4.4 Transfer visibility

Running uploads and downloads with direction, size and progress, read from `transfers.list` and
`file-tasks.list`. The panel is read-only in the first version.

### 4.5 Entry points and console links

The extension takes a place in the application's own navigation, after 高性能计算, and renders a
full-height view aligned with the content area. The account menu under the avatar carries the same
four shortcuts — 用量与账单, 传输任务, 连接诊断 and 主题 — into that view. The menu is rendered by the vendor on every open and its styles
are scoped with a `data-v` attribute, so the injected items copy that attribute from an existing item
rather than hard-coding a hash; a `MutationObserver` inserts them once per opening, before 退出登录.

The same menu carries the console destinations that already exist in the renderer: fee summary,
resource centre, resource application, feedback and profile.

The account card carries the console destinations that already exist in the renderer: fee summary,
resource centre, resource application, feedback and profile. Each is a route string handed to
`auth.open-authenticated-route`, which exchanges the desktop token for a console session in the
default browser. The OpenAPI console belongs in the same list once the platform team confirms the
route and that the token redirect applies to it.

### 4.6 Diagnostics

One action produces a report for a test-cycle bug report: client and Electron versions, platform and
session type, the sandbox decision taken by the launcher, connector and skill counts, the last 200
log lines from `diagnostics.read-file`, and the connectivity results of section 4.7. The report is
copied to the clipboard and can be saved to a file. Log contents are not uploaded anywhere.

### 4.7 Connectivity self-check

Head requests against `api.scnet.cn`, `www.scnet.cn` and the download host, with a three-second
timeout each, reporting status, latency and the proxy configuration in effect. The check distinguishes
a broken client from an unreachable network, which is the common failure during early testing.

## 5. Theming

Themes are CSS custom-property overrides plus a small structural ruleset, applied by the extension
and switched from the account menu. The vendor default remains available as `system`.

| Token | `system` | `paper` | `claude` |
| --- | --- | --- | --- |
| canvas | vendor | `#FBFAF7` | `#FAF9F5` |
| surface | vendor | `#FFFFFF` | `#F0EEE6` |
| text | vendor | `#1C1B1A` | `#141413` |
| muted text | vendor | `#6B6862` | `#6C6A64` |
| accent | vendor | `#2F6FEB` | `#D97757` |
| border | vendor | `#E4E1DA` | `#E5E2D9` |
| radius | vendor | 8 px | 12 px |

The `claude` theme follows the proportions of the Claude desktop client: warm off-white canvas,
sand-coloured surfaces, near-black text, a terracotta accent, generous corner radius, one-pixel warm
borders and a serif face for headings where the vendor already uses a display face.

Rules follow tokens rather than vendor utility classes, so a redesign degrades the theme to the
vendor appearance instead of breaking the layout. The choice is stored in `localStorage`
(`scnet.ext.theme`) and applied by an inline script in `<head>` so the first paint is already
themed. `prefers-color-scheme` drives `system`; the two explicit themes are fixed light themes.

The renderer writes `--color-accent` and `--color-accent-hover`, along with the font stacks, as
inline styles on `<html>` and `<body>` at runtime. A stylesheet rule of normal weight cannot replace
them, so the accent is declared with `!important` on both elements; every other token is left to the
cascade, which keeps the vendor free to change its own values.

Contrast is held at 4.5:1 or better for body text and at 3:1 for the accent against the canvas.
Focus rings are drawn from the accent token so they remain visible in every theme.

## 6. Configuration and packaging

The extension is a single directory inside `app.asar`, packed rather than unpacked: no native code, no
runtime dependencies. `SCNET_EXT_DISABLE=1` disables it for triage, and `localStorage` keys under
`scnet.ext.*` hold the theme and panel preferences. Nothing else is written.

## 7. Verification plan

Executed on Ubuntu 26.04.1 x64/X11 against the 4.1.1 bundle, using the DevTools protocol with a copy
of an existing profile.

| Area | Method and result |
| --- | --- |
| Extension loads | `window.__scnetExt` present, launcher button mounted, stylesheet applied |
| Centre usage | 1 account expanded into 12 rows (华东一区【昆山】, 西北二区【甘肃】, …) with wallet and special balance; `usage.centers` rejected by the host schema, fallback recorded and reported in the panel |
| Billing | 20 rows loaded, total 612, no error; paging and CSV export wired to the loaded rows |
| Diagnostics | report of 12,270 characters containing platform, version, theme and the log tail |
| Themes | `claude` resolves canvas `#faf9f5`, accent `#d97757`, border `#e5e2d9`, radius 12 px; sidebar background measured as `rgb(240, 238, 230)` |
| Failure path | with a credential state the platform rejects, the panel shows `SCNet account information is unavailable` and the shell keeps working |

Not verified: notification delivery on state transitions (no job transitions occurred during the
test), CSV file contents beyond the loaded rows, and the OpenAPI console route, which is not part of
this scope.

## 8. Boundaries

Out of scope for the first version, with the reason:

- tray badge and tray menu: main-process only;
- `scnet://` deep links: require `setAsDefaultProtocolClient` in the main process;
- embedded console pages: require a window with a shared session;
- job submission and cancellation UI: require the vendor approval flow;
- theme for the native title bar: no main-process hook on Linux.

## 9. Implementation status

Implemented in this repository: the injector patch, the module registry, centre usage with its
fallback, the billing panel with CSV export, job notification polling, the diagnostics report, and
three themes. Outstanding from the platform side: the `usage.centers` payload of section 4.1. The
extension ships disabled by removing the patch, and stops per module when a host operation disappears.
