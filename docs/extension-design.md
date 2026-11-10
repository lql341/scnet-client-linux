# Appearance settings

The build adds one dialog with three settings: palette, text size and the language of the dialog
itself. Everything is applied through the CSS custom properties the renderer already uses, so no
vendor code is modified.

## Mechanism

`extensions/main.js` is injected into the renderer by `scripts/patch-vendor.cjs`, together with
`theme.css`. The entry appears in the account menu under the avatar, beside 设置 and 帮助; the menu is
rendered by the vendor on every open and its styles are scoped with a `data-v` attribute, which the
injected item copies at runtime instead of hard-coding a hash. The extension stays out of the compat
renderer that hosts the sign-in shell, and does nothing when `window.host` is unavailable.

Choices are stored in `localStorage` under `scnet.ext.*` and applied at first paint by an inline head
script, so a restart does not flash the default palette.

## Palettes

Six choices. `system` leaves the vendor tokens untouched; the other five override surface, ink,
border and accent tokens, and carry a dark variant that follows the vendor's own `.dark` class.

| Value | Canvas | Accent |
| --- | --- | --- |
| `system` | vendor | vendor |
| `paper` | `#fbfaf7` | `#2f6feb` |
| `sand` | `#faf9f5` | `#d97757` |
| `forest` | `#f7f8f6` | `#2f7d54` |
| `indigo` | `#f8f8fc` | `#4a54c8` |
| `ink` | `#17171a` | `#ffb454` |

The renderer writes `--color-accent` and `--color-accent-hover` as inline styles on `<html>` and
`<body>` at runtime, so those two declarations carry `!important`; every other token is left to the
cascade, which keeps the vendor free to change its own values.

## Text size

`小`, `标准` and `大` set a multiplier of 0.92, 1 and 1.08, applied with `calc()` to the font and line
height tokens the renderer defines (`--font-size-*`, `--line-height-*`, `--chat-font-size`). Full page
zoom would be the alternative, but `display.set-client-zoom-factor` is a vendor operation with its
own persistence, and a multiplier keeps the layout proportions intact.

## Language

`中文` and `English` switch the strings this extension contributes: the menu entry, the dialog title,
the group labels, the palette and size names, and the footnote. The vendor interface is Chinese only
— the shipped renderer has no language switch, and `en.lproj` covers macOS menu labels rather than
application text — so the dialog states that its scope is limited to these strings.

## Verification

Executed on Ubuntu 26.04.1 x64/X11 against the packaged build, driven through the DevTools protocol
with real mouse events.

| Check | Result |
| --- | --- |
| Menu entry | `外观` injected before 退出登录, beside the vendor items, with the vendor's icon size and spacing |
| Dialog | opens from the entry, closes on the backdrop or Escape, three groups rendered |
| Palette | `forest` applies `#2f7d54` as the accent and repaints the sidebar; `ink` switches the surface tokens to a dark set |
| Text size | `大` yields `calc(14px * 1.08)` for `--font-size-base`; `小` yields `0.92` |
| Language | `English` renames the entry, the title, the groups, the chips and the footnote |
| Persistence | the choice is restored after a restart and applied before first paint |

Not verified: how the palettes interact with every vendor surface (charts, code blocks, embedded
console pages), and the visual result of `ink` on dialogs the vendor draws itself.
