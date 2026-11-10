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
| Quota and pricing | `scnet.read` | `storage.usage`, `queues.list`, `resources.list`, `prices.quote` | on demand |
| Console pages | `auth.open-authenticated-route` | `{ route }` | event |
| Diagnostics | `diagnostics.list-files`, `diagnostics.read-file`, `app.get-version`, `environment.get-context` | as defined by the host | on demand |
| Task notifications | `notifications.set-task-state` | `{ tasks: [...] }` | on state change |

State-changing operations (job cancellation, transfers, orders) are deliberately out of scope for the
first version. They pass through the vendor approval flow (`operations.approve`), which the extension
cannot drive without duplicating vendor logic.

## 4. Features

### 4.1 Account and quota card

A compact block in the sidebar footer: wallet balance, the cluster accounts with their balances, and
the expiry date when the platform reports one. Values are formatted with the platform currency; a
missing field is omitted rather than shown as zero. Failure collapses the block to a single line with
a retry action.

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

### 4.5 Console entry points

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

Contrast is held at 4.5:1 or better for body text and at 3:1 for the accent against the canvas.
Focus rings are drawn from the accent token so they remain visible in every theme.

## 6. Configuration and packaging

The extension is a single directory inside `app.asar`, packed rather than unpacked: no native code, no
runtime dependencies. `SCNET_EXT_DISABLE=1` disables it for triage, and `localStorage` keys under
`scnet.ext.*` hold the theme and panel preferences. Nothing else is written.

## 7. Verification plan

| Area | Method |
| --- | --- |
| Module registry | load with a host operation stubbed out; the module must skip and the shell must render |
| Account card | one `scnet.read` call observed through the DevTools protocol, values rendered, failure state rendered when the call is rejected |
| Billing panel and export | list renders, export produces a CSV with the loaded rows |
| Job notifications | a state transition injected through `notifications.set-task-state` raises one notification, not one per poll |
| Diagnostics | report contains version, platform and the log tail; no credential material |
| Connectivity | three probes run in parallel, each with an independent timeout |
| Themes | three screenshots per theme at 1200×768; contrast measured on the tokens |
| Regression | the seven native smoke checks and the window-controls behaviour remain unchanged |

Items that cannot be verified in this environment: real job transitions, live billing data,
notification delivery in a desktop session with a notification daemon, and OpenAPI console routes
until the platform team confirms them.

## 8. Boundaries

Out of scope for the first version, with the reason:

- tray badge and tray menu: main-process only;
- `scnet://` deep links: require `setAsDefaultProtocolClient` in the main process;
- embedded console pages: require a window with a shared session;
- job submission and cancellation UI: require the vendor approval flow;
- theme for the native title bar: no main-process hook on Linux.
