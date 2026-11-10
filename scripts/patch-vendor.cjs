#!/usr/bin/env node
/**
 * Apply the Linux-specific patches to an extracted app tree.
 *
 * Patches are exact and idempotent: a replacement whose source pattern is gone
 * but whose replacement is present counts as already applied, anything else is
 * a hard error, so an upstream change surfaces as a failed build instead of a
 * silently degraded bundle.
 *
 * usage: patch-vendor.cjs <extracted-app-dir> [--check]
 *        --check  report patch state without writing
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const HERE = __dirname;

/**
 * `append-script` patches inject a local script tag before </body> of every
 * index.html under `root` and copy `script` next to it. Used for behaviours that
 * are additive (the vendor code stays untouched).
 *
 * `extension` patches copy a whole directory into the renderer, add a stylesheet
 * link and an inline head bootstrap (so the first paint already carries the
 * stored theme), then load the entry script. See docs/extension-design.md.
 */
const PATCHES = [
  {
    id: 'login-window-controls',
    kind: 'append-script',
    target: 'dist/index.html',
    additionalTargets: ['dist/compat/index.html'],
    script: path.join(HERE, 'window-controls.js'),
    tag: '<script src="./window-controls.js"></script>',
    summary:
      'load the Linux fallback window controls (minimize, maximize/restore, close); ' +
      'the script removes itself once the application shell renders its own cluster',
  },
  {
    id: 'extensions',
    kind: 'extension',
    target: 'dist/index.html',
    additionalTargets: ['dist/compat/index.html'],
    source: path.join(HERE, '..', 'extensions'),
    dest: 'dist/scnet-ext',
    entry: 'main.js',
    stylesheet: 'theme.css',
    headBootstrap:
      "<script>(function(){try{var t=localStorage.getItem('scnet.ext.theme');" +
      "if(t&&t!=='system')document.documentElement.dataset.scnetTheme=t;}catch(e){}})();</script>",
    summary:
      'load the extension bundle (usage, billing, job notifications, diagnostics, themes) ' +
      'and apply the stored theme before first paint',
  },
];

const SCAN_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.css']);

function findFileByContent(dir, needle) {
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

function applyAppendScript(appDir, patch, checkOnly) {
  const targets = [patch.target, ...(patch.additionalTargets || [])]
    .map((relative) => path.join(appDir, relative))
    .filter((file) => fs.existsSync(file));

  if (targets.length === 0) {
    throw new Error(`no HTML entry points found for ${patch.target}`);
  }

  let changed = 0;
  for (const file of targets) {
    const html = fs.readFileSync(file, 'utf8');
    const scriptName = path.basename(patch.script);
    const scriptTarget = path.join(path.dirname(file), scriptName);

    if (html.includes(patch.tag)) {
      // Keep the injected script in sync even when the tag was added by an
      // earlier run (an updated script must not be silently ignored).
      const expected = fs.readFileSync(patch.script);
      const current = fs.existsSync(scriptTarget) ? fs.readFileSync(scriptTarget) : null;
      if (current && current.equals(expected)) continue;
      if (checkOnly) {
        console.log(`todo ${patch.id}: ${path.relative(appDir, scriptTarget)} is stale`);
        changed += 1;
        continue;
      }
      fs.copyFileSync(patch.script, scriptTarget);
      continue;
    }

    const closing = html.lastIndexOf('</body>');
    if (closing === -1) throw new Error(`no </body> in ${file}`);
    if (checkOnly) {
      changed += 1;
      continue;
    }

    fs.writeFileSync(file, html.slice(0, closing) + '  ' + patch.tag + '\n' + html.slice(closing));
    fs.copyFileSync(patch.script, scriptTarget);
    changed += 1;
  }

  if (checkOnly && changed > 0) {
    console.log(`todo ${patch.id}: ${changed} file(s) not patched`);
    return 1;
  }
  console.log(`ok   ${patch.id}: ${patch.summary}`);
  return 0;
}

function copyTree(source, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyTree(from, to);
    else fs.copyFileSync(from, to);
  }
}

function applyExtension(appDir, patch, checkOnly) {
  const targets = [patch.target, ...(patch.additionalTargets || [])]
    .map((relative) => path.join(appDir, relative))
    .filter((file) => fs.existsSync(file));
  if (targets.length === 0) throw new Error(`no HTML entry points found for ${patch.target}`);
  if (!fs.existsSync(patch.source)) throw new Error(`extension source missing: ${patch.source}`);

  const scriptTag = `<script src="./scnet-ext/${patch.entry}"></script>`;
  const styleTag = `<link rel="stylesheet" href="./scnet-ext/${patch.stylesheet}">`;
  const markers = [patch.headBootstrap, styleTag, scriptTag];
  let pending = 0;

  for (const file of targets) {
    const html = fs.readFileSync(file, 'utf8');
    const complete = markers.every((marker) => html.includes(marker));
    if (complete) continue;
    if (checkOnly) {
      console.log(`todo ${patch.id}: ${path.relative(appDir, file)} is not patched`);
      pending += 1;
      continue;
    }

    let next = html;
    if (!next.includes(patch.headBootstrap)) {
      const head = next.indexOf('</head>');
      if (head === -1) throw new Error(`no </head> in ${file}`);
      next = next.slice(0, head) + '  ' + patch.headBootstrap + '\n' + next.slice(head);
    }
    if (!next.includes(styleTag)) {
      const head = next.indexOf('</head>');
      if (head === -1) throw new Error(`no </head> in ${file}`);
      next = next.slice(0, head) + '  ' + styleTag + '\n' + next.slice(head);
    }
    if (!next.includes(scriptTag)) {
      const closing = next.lastIndexOf('</body>');
      if (closing === -1) throw new Error(`no </body> in ${file}`);
      next = next.slice(0, closing) + '  ' + scriptTag + '\n' + next.slice(closing);
    }
    fs.writeFileSync(file, next);
  }

  const dest = path.join(appDir, patch.dest);
  if (!checkOnly) {
    fs.rmSync(dest, { recursive: true, force: true });
    copyTree(patch.source, dest);
  }

  if (checkOnly && pending > 0) {
    console.log(`todo ${patch.id}: ${pending} file(s) not patched`);
    return 1;
  }
  console.log(`ok   ${patch.id}: ${patch.summary}`);
  return 0;
}

function applyReplace(appDir, patch, checkOnly) {
  let targets;
  if (patch.file) {
    targets = [path.join(appDir, patch.file)];
  } else {
    targets = findFileByContent(path.join(appDir, patch.root), patch.from);
    if (targets.length === 0) {
      const applied = findFileByContent(path.join(appDir, patch.root), patch.to);
      if (applied.length === 1) {
        console.log(`skip ${patch.id}: already applied`);
        return 0;
      }
      console.error(`fail ${patch.id}: pattern not found under ${patch.root}`);
      return 1;
    }
    if (targets.length !== 1) {
      console.error(`fail ${patch.id}: pattern found in ${targets.length} files`);
      return 1;
    }
  }

  const target = targets[0];
  const source = fs.readFileSync(target, 'utf8');
  if (!source.includes(patch.from)) {
    if (source.includes(patch.to)) {
      console.log(`skip ${patch.id}: already applied`);
      return 0;
    }
    console.error(`fail ${patch.id}: neither the original nor the patched form is present`);
    return 1;
  }
  if (checkOnly) {
    console.log(`todo ${patch.id}: not applied (${path.relative(appDir, target)})`);
    return 1;
  }
  if (source.split(patch.from).length !== 2) {
    console.error(`fail ${patch.id}: expected exactly one occurrence`);
    return 1;
  }
  fs.writeFileSync(target, source.replace(patch.from, patch.to));
  console.log(`ok   ${patch.id}: ${patch.summary}`);
  return 0;
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
    try {
      if (patch.kind === 'append-script') failures += applyAppendScript(appDir, patch, checkOnly);
      else if (patch.kind === 'extension') failures += applyExtension(appDir, patch, checkOnly);
      else failures += applyReplace(appDir, patch, checkOnly);
    } catch (error) {
      console.error(`fail ${patch.id}: ${error.message}`);
      failures += 1;
    }
  }

  if (checkOnly && failures === 0) console.log('all patches applied');
  return failures ? 1 : 0;
}

process.exit(main());
