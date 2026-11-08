#!/usr/bin/env bash
#
# Build an unofficial Linux x64 port of the SCNet desktop client (计算服务)
# from the official macOS Electron distribution.
#
# Pipeline
#   0. fetch the official macOS zip (SHA-512 verified) and extract it
#   1. fetch the matching Electron Linux runtime
#   2. extract app.asar
#   3. install the Linux builds of the bundled native node modules
#   4. compile node-pty against the Electron ABI
#   5. fetch the two standalone platform binaries (uv, agent-browser)
#   6. repack app.asar with node_modules unpacked, assemble resources, self-check
#   7. extract the icon and write the launcher
#   8. build the Debian package
#
# Outputs: build/linux/ (portable bundle) and scnet-client_<version>_amd64.deb
#
# Requirements: bash curl unzip python3 node npm gcc g++ make dpkg-deb fakeroot
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD="$ROOT/build"
CACHE="$BUILD/cache"
WORK="$BUILD/work"
DIST="$BUILD/linux"

# Versions. Everything except APP_VERSION can be overridden from the environment.
APP_VERSION="${APP_VERSION:-$(cat "$ROOT/VERSION")}"
DEB_REVISION="${DEB_REVISION:-2}"   # packaging revision, independent of the upstream version
ELECTRON_VERSION="${ELECTRON_VERSION:-44.7.0}"
CANVAS_VERSION="${CANVAS_VERSION:-1.0.2}"
CUA_DRIVER_VERSION="${CUA_DRIVER_VERSION:-0.34.1}"
UBJS_VERSION="${UBJS_VERSION:-0.31.0-3}"
NODE_PTY_VERSION="${NODE_PTY_VERSION:-1.1.0}"
AGENT_BROWSER_VERSION="${AGENT_BROWSER_VERSION:-0.39.0}"
UV_VERSION="${UV_VERSION:-0.9.9}"

MAC_BASE_URL="${MAC_BASE_URL:-https://dlcdn.scnet.cn/client/mac}"
MAC_ZIP_URL="$MAC_BASE_URL/SCNet-$APP_VERSION-x64.zip"
# SHA-512 of SCNet-<version>-x64.zip, as published in latest-mac.yml (base64 decoded).
MAC_ZIP_SHA512="${MAC_ZIP_SHA512:-158429d9124ce6ec566482e162d7091def40a1022d89155281d24d4f0b6b3b87bed198ca95ae04c931b13ccd6b1900a8be54c495a8b891f692a9ad9776cf4629}"
ELECTRON_MIRROR="${ELECTRON_MIRROR:-https://npmmirror.com/mirrors/electron}"
UV_INDEX="${UV_INDEX:-https://pypi.tuna.tsinghua.edu.cn/simple/uv/}"

MAC_ZIP="$ROOT/mac-x64.zip"
APP_RES="$ROOT/app/计算服务.app/Contents/Resources"
BUILD_DEB=1

usage() {
  cat <<'EOF'
Usage: scripts/build-linux.sh [options]

Options:
  --portable-only   Build the portable bundle only; skip the .deb
  --clean           Remove build/ before starting
  -h, --help        Show this help
EOF
}

log() { printf '\n==> %s\n' "$*"; }
note() { printf '    %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --portable-only) BUILD_DEB=0 ;;
    --clean) rm -rf "$BUILD" ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; die "unknown option: $1" ;;
  esac
  shift
done

command -v curl >/dev/null || die "curl is required"
command -v unzip >/dev/null || die "unzip is required"
command -v node >/dev/null || die "node is required"
command -v npm >/dev/null || die "npm is required"

mkdir -p "$CACHE" "$WORK"

# ---------------------------------------------------------------- 0. macOS zip
log "0/8 vendor archive"
zip_valid() {
  [ -f "$MAC_ZIP" ] && [ "$(sha512sum "$MAC_ZIP" | cut -d' ' -f1)" = "$MAC_ZIP_SHA512" ]
}
if ! zip_valid; then
  note "downloading $MAC_ZIP_URL"
  curl -fsSL -C - --retry 3 -o "$MAC_ZIP" "$MAC_ZIP_URL" || true
  if ! zip_valid; then
    note "local copy unusable, restarting download"
    rm -f "$MAC_ZIP"
    curl -fsSL --retry 3 -o "$MAC_ZIP" "$MAC_ZIP_URL"
  fi
  zip_valid || die "SHA-512 mismatch for $MAC_ZIP (upstream changed? see scripts/check-upstream.sh)"
fi
note "sha512 verified, $(stat -c %s "$MAC_ZIP") bytes"
if [ ! -d "$APP_RES" ]; then
  note "extracting"
  mkdir -p "$ROOT/app"
  unzip -q -o "$MAC_ZIP" -d "$ROOT/app"
fi

# ------------------------------------------------------------- 1. Electron
log "1/8 Electron $ELECTRON_VERSION runtime"
ELECTRON_ZIP="$CACHE/electron-v$ELECTRON_VERSION-linux-x64.zip"
if [ ! -x "$WORK/electron/electron" ]; then
  [ -f "$ELECTRON_ZIP" ] || curl -fsSL --retry 3 -o "$ELECTRON_ZIP" \
    "$ELECTRON_MIRROR/$ELECTRON_VERSION/electron-v$ELECTRON_VERSION-linux-x64.zip"
  mkdir -p "$WORK/electron"
  unzip -q -o "$ELECTRON_ZIP" -d "$WORK/electron"
fi
note "ok"

# --------------------------------------------------------------- 2. app.asar
log "2/8 extract app.asar"
rm -rf "$WORK/app"
npx --yes @electron/asar extract "$APP_RES/app.asar" "$WORK/app"
node "$ROOT/scripts/patch-vendor.cjs" "$WORK/app" | sed 's/^/    /'
note "ok"

# ------------------------------------------------- 3. Linux native node modules
log "3/8 native node modules"
mkdir -p "$WORK/pkgs"
(cd "$WORK/pkgs" && npm pack --silent \
  "@napi-rs/canvas-linux-x64-gnu@$CANVAS_VERSION" \
  "@trycua/cua-driver-linux-x64-gnu@$CUA_DRIVER_VERSION" \
  "@ubjs/node-linux-x64-gnu@$UBJS_VERSION" >/dev/null)

install_pkg() { # install_pkg <tarball> <node_modules dir>
  local tgz="$1" nm="$2" tmp name version
  tmp="$(mktemp -d)"
  tar xzf "$tgz" -C "$tmp"
  name="$(node -p "require('$tmp/package/package.json').name")"
  version="$(node -p "require('$tmp/package/package.json').version")"
  rm -rf "${nm:?}/${name:?}"
  mkdir -p "$(dirname "$nm/$name")"
  cp -a "$tmp/package" "$nm/$name"
  rm -rf "$tmp"
  note "$name@$version"
}
for tarball in "$WORK"/pkgs/*.tgz; do install_pkg "$tarball" "$WORK/app/node_modules"; done

# ------------------------------------------------------------- 4. node-pty
log "4/8 node-pty $NODE_PTY_VERSION for the Electron ABI"
GYP_CACHE="$HOME/.cache/node-gyp/$ELECTRON_VERSION"
if [ ! -f "$GYP_CACHE/include/node/node.h" ]; then
  # node-gyp cannot verify checksums against the Electron mirror, so the header
  # tarball is installed directly and marked as a complete dev dir.
  mkdir -p "$GYP_CACHE"
  curl -fsSL --retry 3 -o "$WORK/headers.tar.gz" \
    "https://cdn.npmmirror.com/binaries/electron/v$ELECTRON_VERSION/node-v$ELECTRON_VERSION-headers.tar.gz"
  tar xzf "$WORK/headers.tar.gz" --strip-components=1 -C "$GYP_CACHE"
  printf '11' > "$GYP_CACHE/installVersion"
fi
PTY_ADDON="$WORK/ptybuild/node_modules/node-pty/build/Release/pty.node"
if [ ! -f "$PTY_ADDON" ]; then
  mkdir -p "$WORK/ptybuild"
  (cd "$WORK/ptybuild" && npm init -y >/dev/null && \
    npm i "node-pty@$NODE_PTY_VERSION" --ignore-scripts --no-audit --no-fund >/dev/null)
  (cd "$WORK/ptybuild/node_modules/node-pty" && \
    npx --yes node-gyp@11 rebuild --nodedir="$GYP_CACHE" \
      --target="$ELECTRON_VERSION" --arch=x64 >/dev/null)
fi
mkdir -p "$WORK/app/node_modules/node-pty/prebuilds/linux-x64"
cp -f "$PTY_ADDON" "$WORK/app/node_modules/node-pty/prebuilds/linux-x64/pty.node"
note "ok"

# ------------------------------------------------- 5. standalone binaries
log "5/8 standalone binaries"
if [ ! -x "$CACHE/agent-browser" ]; then
  (cd "$WORK" && npm pack --silent "agent-browser@$AGENT_BROWSER_VERSION" >/dev/null && \
    tar xzf "agent-browser-$AGENT_BROWSER_VERSION.tgz" package/bin/agent-browser-linux-x64 && \
    cp -f package/bin/agent-browser-linux-x64 "$CACHE/agent-browser")
  chmod +x "$CACHE/agent-browser"
fi
note "agent-browser $( "$CACHE/agent-browser" --version )"

if [ ! -x "$CACHE/uv" ]; then
  UV_WHL_URL="$(curl -fsSL "$UV_INDEX" | \
    grep -oE 'href="[^"#]*uv-'"$UV_VERSION"'-py3-none-manylinux[^"#]*x86_64[^"#]*\.whl' | \
    tail -1 | sed 's/href="//;s|^\.\./\.\./|https://pypi.tuna.tsinghua.edu.cn/|')"
  [ -n "$UV_WHL_URL" ] || die "uv $UV_VERSION wheel not found on $UV_INDEX"
  curl -fsSL --retry 3 -o "$WORK/uv.whl" "$UV_WHL_URL"
  rm -rf "$WORK/uvx" && mkdir -p "$WORK/uvx" && unzip -q "$WORK/uv.whl" -d "$WORK/uvx"
  cp -f "$WORK"/uvx/uv-*.data/scripts/uv "$CACHE/uv"
  chmod +x "$CACHE/uv"
fi
note "uv $( "$CACHE/uv" --version )"

# ------------------------------------------------------- 6. assemble resources
log "6/8 assemble bundle"
rm -rf "$DIST"
cp -a "$WORK/electron" "$DIST"
rm -f "$DIST/resources/default_app.asar"
# node_modules is fully unpacked: the CUA Rust SDK is dlopen'ed and the client
# forks its worker from resources/app.asar.unpacked, both need real paths.
npx --yes @electron/asar pack "$WORK/app" "$DIST/resources/app.asar" --unpack-dir node_modules
note "app.asar $(stat -c %s "$DIST/resources/app.asar") bytes"

for dir in agent-plugins agent-skills connectors home-scenarios cli cua en.lproj; do
  cp -a "$APP_RES/$dir" "$DIST/resources/"
done
cp -a "$APP_RES"/tray*.png "$APP_RES/app-update.yml" "$DIST/resources/"
mkdir -p "$DIST/resources/bin" "$DIST/resources/agent-browser"
cp -f "$CACHE/uv" "$DIST/resources/bin/uv"
cp -f "$CACHE/agent-browser" "$DIST/resources/agent-browser/agent-browser"
chmod +x "$DIST/resources/bin/uv" "$DIST/resources/agent-browser/agent-browser"
mv "$DIST/electron" "$DIST/scnet-client"
chmod +x "$DIST/scnet-client"
note "ok"

log "6b/8 verify bundle"
for artifact in \
  "@napi-rs/canvas-linux-x64-gnu/skia.linux-x64-gnu.node" \
  "@trycua/cua-driver-linux-x64-gnu/libcua_driver_sdk.so" \
  "@ubjs/node-linux-x64-gnu/uniffi-runtime-napi.linux-x64-gnu.node" \
  "node-pty/prebuilds/linux-x64/pty.node"; do
  [ -f "$DIST/resources/app.asar.unpacked/node_modules/$artifact" ] || \
    die "missing native artifact: $artifact"
done
ELECTRON_RUN_AS_NODE=1 "$DIST/scnet-client" "$ROOT/scripts/smoke-native.cjs" "$DIST" | sed 's/^/    /'
[ "${PIPESTATUS[0]}" -eq 0 ] || die "native smoke test failed"

# ------------------------------------------------------- 7. icon and launcher
log "7/8 icon and launcher"
rm -rf "$BUILD/assets/icons"
python3 "$ROOT/scripts/extract-icons.py" "$APP_RES/icon.icns" "$BUILD/assets/icons" | sed 's/^/    /'
cp "$BUILD/assets/icons/1024.png" "$BUILD/assets/icon.png"
cat > "$DIST/launcher.sh" <<'LAUNCHER'
#!/bin/sh
# Launcher: keep the Chromium sandbox whenever the system can provide one.
APP="$(dirname "$(readlink -f "$0")")"
SB="$APP/chrome-sandbox"

sandbox_usable() {
  # 1) setuid-root chrome-sandbox
  if [ -u "$SB" ] && [ "$(stat -c %u "$SB" 2>/dev/null)" = "0" ]; then
    return 0
  fi
  # 2) unprivileged user namespaces (Chromium's userns sandbox)
  [ "$(cat /proc/sys/user/max_user_namespaces 2>/dev/null || echo 0)" -gt 0 ] || return 1
  case "$(cat /proc/sys/kernel/unprivileged_userns_clone 2>/dev/null)" in
    0) return 1 ;;
  esac
  case "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null)" in
    1) return 1 ;;   # Ubuntu 23.10+ restricts userns to profiled binaries
  esac
  return 0
}

if [ "${SCNET_NO_SANDBOX:-0}" = "1" ] || ! sandbox_usable; then
  exec "$APP/scnet-client" --no-sandbox "$@"
fi
exec "$APP/scnet-client" "$@"
LAUNCHER
chmod +x "$DIST/launcher.sh"
note "ok"

# ----------------------------------------------------------------- 8. .deb
if [ "$BUILD_DEB" -eq 1 ]; then
  log "8/8 Debian package"
  PKG="$BUILD/pkg"
  rm -rf "$PKG"
  mkdir -p "$PKG/DEBIAN" "$PKG/opt" "$PKG/usr/bin" "$PKG/usr/share/applications"
  cp -a "$DIST" "$PKG/opt/scnet-client"
  for icon in "$BUILD"/assets/icons/*.png; do
    size="$(basename "$icon" .png)"
    mkdir -p "$PKG/usr/share/icons/hicolor/${size}x${size}/apps"
    cp "$icon" "$PKG/usr/share/icons/hicolor/${size}x${size}/apps/scnet-client.png"
  done
  ln -sf /opt/scnet-client/launcher.sh "$PKG/usr/bin/scnet-client"
  cat > "$PKG/usr/share/applications/scnet-client.desktop" <<'DESKTOP'
[Desktop Entry]
Type=Application
Name=SCNet 计算服务
Name[en]=SCNet Client
GenericName=Science Compute Workspace
Comment=国家超算互联网客户端
Comment[en]=SCNet (National Supercomputing Internet) desktop client
Exec=/opt/scnet-client/launcher.sh %U
Icon=scnet-client
Terminal=false
Categories=Science;
Keywords=scnet;hpc;supercomputing;compute;计算;
StartupWMClass=scnet-client
DESKTOP
  if command -v desktop-file-validate >/dev/null 2>&1; then
    desktop-file-validate "$PKG/usr/share/applications/scnet-client.desktop" || die "invalid desktop entry"
  fi
  cat > "$PKG/DEBIAN/control" <<CONTROL
Package: scnet-client
Version: $APP_VERSION-$DEB_REVISION
Section: science
Priority: optional
Architecture: amd64
Installed-Size: 490000
Maintainer: local rebuild <local@localhost>
Depends: libgtk-3-0t64 | libgtk-3-0, libnss3, libasound2t64 | libasound2, libx11-xcb1, libxss1, libxtst6, libgbm1, libdrm2, libatspi2.0-0t64 | libatspi2.0-0, libcups2t64 | libcups2, fonts-noto-cjk
Recommends: xdg-utils, libu2f-udev
Description: SCNet Client (计算服务) - unofficial Linux build
 Unofficial Linux port of the official SCNet desktop client, assembled from
 the upstream macOS Electron build $APP_VERSION with Linux-native replacements
 for the platform-specific components. Includes the AI workspace, skills,
 connectors, HPC job tooling, local terminal and file handling.
CONTROL
  cat > "$PKG/DEBIAN/postinst" <<'POSTINST'
#!/bin/sh
set -e
if [ -f /opt/scnet-client/chrome-sandbox ]; then
  chown root:root /opt/scnet-client/chrome-sandbox || true
  chmod 4755 /opt/scnet-client/chrome-sandbox || true
fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -f -q /usr/share/icons/hicolor || true
fi
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database -q /usr/share/applications || true
fi
exit 0
POSTINST
  cat > "$PKG/DEBIAN/postrm" <<'POSTRM'
#!/bin/sh
set -e
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -f -q /usr/share/icons/hicolor || true
fi
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database -q /usr/share/applications || true
fi
exit 0
POSTRM
  chmod 755 "$PKG/DEBIAN/postinst" "$PKG/DEBIAN/postrm"
  fakeroot dpkg-deb --build -Zxz "$PKG" "$ROOT/scnet-client_${APP_VERSION}-${DEB_REVISION}_amd64.deb" >/dev/null
  note "$ROOT/scnet-client_${APP_VERSION}-${DEB_REVISION}_amd64.deb"
else
  log "8/8 Debian package (skipped)"
fi

log "done"
du -sh "$DIST"
[ "$BUILD_DEB" -eq 1 ] && du -sh "$ROOT/scnet-client_${APP_VERSION}-${DEB_REVISION}_amd64.deb"
