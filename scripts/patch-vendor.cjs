#!/usr/bin/env node
/**
 * Apply the Linux-specific patches to an extracted app tree.
 *
 * Every patch is an exact-string replacement. A missing pattern is a hard error:
 * it means the upstream build changed and the behaviour must be re-derived
 * instead of silently producing a bundle without window controls.
 *
 * usage: patch-vendor.cjs <extracted-app-dir> [--check]
 *        --check  report the state of every patch without writing
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const PATCHES = [
  {
    id: 'window-controls-overlay',
    file: 'dist-electron/main/index.js',
    summary:
      'request the window controls overlay on Linux so the window manager draws ' +
      'minimize/maximize/close at the top right',
    from: 'function y(e="light",t=36){return"darwin"===process.platform||("win32"===process.platform?w(e,t):void 0)}',
    to: 'function y(e="light",t=36){return"darwin"===process.platform?void 0:w(e,t)}',
  },
  {
    id: 'window-chrome-modern',
    root: 'dist',
    summary:
      'render the in-app window chrome on Linux like on Windows, which reserves the ' +
      'drag region and the space taken by the overlay buttons',
    from: 'H="darwin"===k.H.context.platform,N="win32"===k.H.context.platform,J=',
    to: 'H="darwin"===k.H.context.platform,N=("win32"===k.H.context.platform||"linux"===k.H.context.platform),J=',
  },
  {
    id: 'window-chrome-compat',
    root: 'dist/compat',
    summary:
      'set the windows layout class on Linux as well, so the compat UI offsets dialogs ' +
      'and overlays below the title bar area',
    from: 'document.documentElement.classList.toggle("scnet-platform-windows","win32"===I.h.context.platform)',
    to: 'document.documentElement.classList.toggle("scnet-platform-windows","win32"===I.h.context.platform||"linux"===I.h.context.platform)',
  },
];

const SCAN_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.css']);

/** Resolve the single file under `dir` whose content contains `needle`. */
function findFile(dir, needle) {
  const matches = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (SCAN_EXTENSIONS.has(path.extname(entry.name))) {
        if (fs.readFileSync(full, 'utf8').includes(needle)) matches.push(full);
      }
    }
  };
  walk(dir);
  return matches;
}

function main() {
  const args = process.argv.slice(2);
  const appDir = args.find((arg) => !arg.startsWith('--'));
  const checkOnly = args.includes('--check');
  if (!appDir) {
    console.error('usage: patch-vendor.cjs <extracted-app-dir> [--check]');
    return 2;
  }

  let failures = 0;
  for (const patch of PATCHES) {
    let targets;
    if (patch.file) {
      targets = [path.join(appDir, patch.file)];
    } else {
      targets = findFile(path.join(appDir, patch.root), patch.from);
      if (targets.length === 0) {
        // Already patched? Look for the replacement instead.
        const applied = findFile(path.join(appDir, patch.root), patch.to);
        if (applied.length === 1) {
          console.log(`skip ${patch.id}: already applied`);
          continue;
        }
        console.error(`fail ${patch.id}: pattern not found under ${patch.root}`);
        failures += 1;
        continue;
      }
      if (targets.length !== 1) {
        console.error(`fail ${patch.id}: pattern found in ${targets.length} files`);
        failures += 1;
        continue;
      }
    }

    const target = targets[0];
    const source = fs.readFileSync(target, 'utf8');
    if (!source.includes(patch.from)) {
      if (source.includes(patch.to)) {
        console.log(`skip ${patch.id}: already applied`);
        continue;
      }
      console.error(`fail ${patch.id}: neither the original nor the patched form is present`);
      failures += 1;
      continue;
    }
    if (checkOnly) {
      console.log(`todo ${patch.id}: not applied (${path.relative(appDir, target)})`);
      failures += 1;
      continue;
    }
    if (source.split(patch.from).length !== 2) {
      console.error(`fail ${patch.id}: expected exactly one occurrence`);
      failures += 1;
      continue;
    }
    fs.writeFileSync(target, source.replace(patch.from, patch.to));
    console.log(`ok   ${patch.id}: ${patch.summary}`);
  }

  if (checkOnly && failures === 0) console.log('all patches applied');
  return failures ? 1 : 0;
}

process.exit(main());
