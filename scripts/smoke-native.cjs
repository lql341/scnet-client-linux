#!/usr/bin/env node
/**
 * Native smoke test for a built portable bundle.
 *
 * Loads every platform-specific artifact the client needs and exercises the
 * ones that are testable without a display, then exits non-zero on failure.
 *
 * Usage: ELECTRON_RUN_AS_NODE=1 <bundle>/scnet-client scripts/smoke-native.cjs <bundle>
 */
'use strict';

const { execFileSync } = require('node:child_process');
const path = require('node:path');

const bundle = process.argv[2];
if (!bundle) {
  console.error('usage: smoke-native.cjs <portable-bundle-dir>');
  process.exit(2);
}

const resources = path.join(path.resolve(bundle), 'resources');
const packed = path.join(resources, 'app.asar');
const unpacked = path.join(resources, 'app.asar.unpacked');

let failures = 0;

function check(name, fn) {
  try {
    const detail = fn();
    console.log(`ok   ${name}${detail ? ` (${detail})` : ''}`);
  } catch (error) {
    failures += 1;
    console.log(`fail ${name}: ${error.message}`);
  }
}

async function checkAsync(name, fn) {
  try {
    const detail = await fn();
    console.log(`ok   ${name}${detail ? ` (${detail})` : ''}`);
  } catch (error) {
    failures += 1;
    console.log(`fail ${name}: ${error.message}`);
  }
}

function load(...segments) {
  return require(path.join(...segments));
}

async function main() {
  // node-pty is the only packed module compiled for the Electron ABI here.
  await checkAsync('node-pty', () => new Promise((resolve, reject) => {
    const pty = load(packed, 'node_modules', 'node-pty');
    const child = pty.spawn('/bin/sh', ['-c', 'printf pty-ok'], { cols: 80, rows: 24 });
    let output = '';
    child.onData((chunk) => { output += chunk; });
    child.onExit(({ exitCode }) => {
      if (exitCode !== 0 || !output.includes('pty-ok')) {
        reject(new Error(`unexpected pty result: exit=${exitCode} output=${JSON.stringify(output)}`));
        return;
      }
      resolve('spawn/read/exit');
    });
    setTimeout(() => reject(new Error('pty did not exit within 5s')), 5000).unref();
  }));

  check('@napi-rs/canvas', () => {
    const { createCanvas } = load(packed, 'node_modules', '@napi-rs', 'canvas');
    const canvas = createCanvas(16, 16);
    const context = canvas.getContext('2d');
    context.fillStyle = '#123456';
    context.fillRect(0, 0, 16, 16);
    const png = canvas.toBuffer('image/png');
    if (png.length < 50) throw new Error('empty PNG');
    return `${canvas.width}x${canvas.height}, ${png.length} B PNG`;
  });

  check('ssh2', () => {
    const ssh2 = load(packed, 'node_modules', 'ssh2');
    if (typeof ssh2.Client !== 'function') throw new Error('Client export missing');
    return 'Client export';
  });

  check('@ubjs/node', () => {
    const ubjs = load(unpacked, 'node_modules', '@ubjs', 'node');
    if (typeof ubjs.resolveLibPath !== 'function') throw new Error('resolveLibPath missing');
    return 'native runtime loaded';
  });

  check('@trycua/cua-driver', () => {
    // The Rust SDK is dlopen'ed, so it must be resolved from the unpacked tree.
    const driver = load(unpacked, 'node_modules', '@trycua', 'cua-driver');
    const exports = Object.keys(driver).length;
    if (!exports) throw new Error('no exports');
    return `${exports} exports`;
  });

  check('resources/bin/uv', () => {
    const version = execFileSync(path.join(resources, 'bin', 'uv'), ['--version'], {
      encoding: 'utf8',
    }).trim();
    return version;
  });

  check('resources/agent-browser/agent-browser', () => {
    const version = execFileSync(path.join(resources, 'agent-browser', 'agent-browser'), ['--version'], {
      encoding: 'utf8',
    }).trim();
    return version;
  });

  console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
