#!/usr/bin/env bash
#
# Report the upstream client version and compare it with the version this
# repository builds, so a version bump has a single obvious entry point.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MAC_YML="${MAC_YML:-https://dlcdn.scnet.cn/client/mac/latest-mac.yml}"
WIN_YML="${WIN_YML:-https://dlcdn.scnet.cn/client/win/latest.yml}"

local_version="$(cat "$ROOT/VERSION")"
electron_version="$(sed -n 's/^ELECTRON_VERSION="\${ELECTRON_VERSION:-\(.*\)}"$/\1/p' "$ROOT/scripts/build-linux.sh")"

upstream_mac="$(curl -fsSL --max-time 30 "$MAC_YML" | sed -n 's/^version: *//p' | head -1)"
upstream_win="$(curl -fsSL --max-time 30 "$WIN_YML" | sed -n 's/^version: *//p' | head -1)"

printf '%-18s %s\n' 'upstream macOS:' "${upstream_mac:-unknown}"
printf '%-18s %s\n' 'upstream Windows:' "${upstream_win:-unknown}"
printf '%-18s %s\n' 'repository build:' "$local_version (Electron ${electron_version:-unknown})"
echo

if [ "${upstream_mac:-}" = "$local_version" ]; then
  echo "No action required: the repository targets the current macOS release."
  exit 0
fi

cat <<'EOF'
The upstream macOS build differs from this repository. A bump requires:

  1. VERSION                             -> new version
  2. scripts/build-linux.sh              -> MAC_ZIP_SHA512 (sha512 of the x64 zip)
  3. scripts/build-linux.sh              -> ELECTRON_VERSION, if the bundled
                                            Electron framework version changed
                                            (Frameworks/Electron Framework.framework/
                                             Versions/A/Resources/Info.plist)
  4. scripts/build-linux.sh              -> CANVAS_VERSION / CUA_DRIVER_VERSION /
                                            UBJS_VERSION / NODE_PTY_VERSION /
                                            AGENT_BROWSER_VERSION / UV_VERSION, per
                                            the new app.asar/package.json
  5. scripts/build-linux.sh              -> rebuild and rerun the smoke test

Current upstream file list:
EOF
echo
curl -fsSL --max-time 30 "$MAC_YML" | sed -n '/^files:/,/^path:/p'
