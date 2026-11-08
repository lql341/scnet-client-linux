#!/usr/bin/env bash
# Build a Linux x64 port of the SCNet desktop client (计算服务 / SCNet Client)
# from the official macOS Electron build.
#
# Inputs (auto-downloaded, cached in build/cache):
#   * mac-x64.zip ........ official macOS x64 zip (electron-updater feed)
#   * Electron 44.7.0 .... Linux runtime matching the macOS build's Electron
#   * agent-browser ...... Linux binary of the same version shipped inside the app
#   * uv .................. Linux binary replacing Resources/bin/uv (mac only)
#   * @napi-rs/canvas-linux-x64-gnu, @trycua/cua-driver-linux-x64-gnu,
#     @ubjs/node-linux-x64-gnu ... Linux builds of the app's native modules
#   * node-pty ............ compiled here against Electron 44.7.0 ABI
#
# Outputs:
#   build/linux/ ................ portable app directory (run build/linux/scnet-client)
#   scnet-client_4.1.0_amd64.deb . Debian/Ubuntu package
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
BUILD="$ROOT/build"
CACHE="$BUILD/cache"
APP_SRC="$ROOT/app/计算服务.app/Contents/Resources"
WORK="$BUILD/work"

MAC_ZIP="$ROOT/mac-x64.zip"
MAC_ZIP_URL="https://dlcdn.scnet.cn/client/mac/SCNet-4.1.0-x64.zip"
# sha512 from https://dlcdn.scnet.cn/client/mac/latest-mac.yml (base64 decoded)
MAC_ZIP_SHA512="158429d9124ce6ec566482e162d7091def40a1022d89155281d24d4f0b6b3b87bed198ca95ae04c931b13ccd6b1900a8be54c495a8b891f692a9ad9776cf4629"
ELECTRON_VERSION="44.7.0"
ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron"
AGENT_BROWSER_VERSION="0.39.0"
UV_VERSION="0.9.9"
APP_VERSION="4.1.0"

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

mkdir -p "$CACHE" "$WORK"

zip_ok() { [ -f "$MAC_ZIP" ] && [ "$(sha512sum "$MAC_ZIP" | cut -d' ' -f1)" = "$MAC_ZIP_SHA512" ]; }

# ---------------------------------------------------------------- 0. macOS zip
if ! zip_ok; then
  say "downloading official macOS zip (resumable)"
  curl -sSL -C - --retry 3 -o "$MAC_ZIP" "$MAC_ZIP_URL"
  if ! zip_ok; then          # truncated / stale local copy: start over once
    rm -f "$MAC_ZIP"
    curl -sSL --retry 3 -o "$MAC_ZIP" "$MAC_ZIP_URL"
  fi
  zip_ok || { echo "!! sha512 mismatch for $MAC_ZIP" >&2; exit 1; }
fi
if [ ! -d "$APP_SRC" ]; then
  say "extracting macOS zip"
  mkdir -p "$ROOT/app"
  unzip -q -o "$MAC_ZIP" -d "$ROOT/app"
fi

# ------------------------------------------------------------- 1. Electron run
if [ ! -x "$WORK/electron/electron" ]; then
  say "fetching Electron $ELECTRON_VERSION linux-x64"
  [ -f "$CACHE/electron-v$ELECTRON_VERSION-linux-x64.zip" ] || \
    curl -sSL --retry 3 -o "$CACHE/electron-v$ELECTRON_VERSION-linux-x64.zip" \
      "$ELECTRON_MIRROR/$ELECTRON_VERSION/electron-v$ELECTRON_VERSION-linux-x64.zip"
  mkdir -p "$WORK/electron"
  unzip -q -o "$CACHE/electron-v$ELECTRON_VERSION-linux-x64.zip" -d "$WORK/electron"
fi

# ------------------------------------------------------- 2. unpack the app.asar
say "extracting app.asar"
rm -rf "$WORK/app"
npx --yes @electron/asar extract "$APP_SRC/app.asar" "$WORK/app"

# --------------------------------- 3. Linux builds of the native node modules
say "installing Linux native modules"
mkdir -p "$WORK/pkgs"
(cd "$WORK/pkgs" && npm pack --silent \
  "@napi-rs/canvas-linux-x64-gnu@1.0.2" \
  "@trycua/cua-driver-linux-x64-gnu@0.34.1" \
  "@ubjs/node-linux-x64-gnu@0.31.0-3" >/dev/null)

install_pkg() { # install_pkg <tgz> <dest node_modules dir>
  local tgz="$1" nm="$2" tmp
  tmp="$(mktemp -d)"
  tar xzf "$tgz" -C "$tmp"
  local name ver
  name="$(node -p "require('$tmp/package/package.json').name")"
  ver="$(node -p "require('$tmp/package/package.json').version")"
  local rel="$name"   # e.g. @scope/pkg or pkg
  rm -rf "$nm/$rel"
  mkdir -p "$(dirname "$nm/$rel")"
  cp -a "$tmp/package" "$nm/$rel"
  echo "    $name@$ver"
  rm -rf "$tmp"
}
for t in "$WORK"/pkgs/*.tgz; do install_pkg "$t" "$WORK/app/node_modules"; done

# ------------------------------------------- 4. node-pty for the Electron ABI
say "building node-pty for Electron $ELECTRON_VERSION"
GYP_CACHE="$HOME/.cache/node-gyp/$ELECTRON_VERSION"
if [ ! -f "$GYP_CACHE/include/node/node.h" ]; then
  mkdir -p "$GYP_CACHE"
  # node-gyp checksum verification does not work with the Electron mirror, so
  # headers are fetched directly and marked as an installed dev dir.
  curl -sSL --retry 3 -o "$WORK/headers.tar.gz" \
    "https://cdn.npmmirror.com/binaries/electron/v$ELECTRON_VERSION/node-v$ELECTRON_VERSION-headers.tar.gz"
  tar xzf "$WORK/headers.tar.gz" --strip-components=1 -C "$GYP_CACHE"
  printf '11' > "$GYP_CACHE/installVersion"
fi
if [ ! -f "$WORK/ptybuild/node_modules/node-pty/build/Release/pty.node" ]; then
  mkdir -p "$WORK/ptybuild"
  (cd "$WORK/ptybuild" && npm init -y >/dev/null && \
    npm i node-pty@1.1.0 --ignore-scripts --no-audit --no-fund >/dev/null)
  (cd "$WORK/ptybuild/node_modules/node-pty" && \
    npx --yes node-gyp@11 rebuild --nodedir="$GYP_CACHE" \
      --target="$ELECTRON_VERSION" --arch=x64 >/dev/null)
fi
mkdir -p "$WORK/app/node_modules/node-pty/prebuilds/linux-x64"
cp -f "$WORK/ptybuild/node_modules/node-pty/build/Release/pty.node" \
      "$WORK/app/node_modules/node-pty/prebuilds/linux-x64/pty.node"

# --------------------------------------------------------- 5. platform binaries
say "fetching Linux platform binaries (agent-browser, uv)"
if [ ! -x "$CACHE/agent-browser" ]; then
  (cd "$WORK" && npm pack --silent "agent-browser@$AGENT_BROWSER_VERSION" >/dev/null && \
    tar xzf "agent-browser-$AGENT_BROWSER_VERSION.tgz" package/bin/agent-browser-linux-x64 && \
    cp -f package/bin/agent-browser-linux-x64 "$CACHE/agent-browser" && chmod +x "$CACHE/agent-browser")
fi
if [ ! -x "$CACHE/uv" ]; then
  # uv wheel from a PyPI mirror: the wheel ships the static Linux binary
  UV_WHL_URL="$(curl -sS https://pypi.tuna.tsinghua.edu.cn/simple/uv/ | \
      grep -oE 'href="[^"#]*uv-'"$UV_VERSION"'-py3-none-manylinux[^"#]*x86_64[^"#]*\.whl' | \
      tail -1 | sed 's/href="//;s|^\.\./\.\./|https://pypi.tuna.tsinghua.edu.cn/|')"
  curl -sSL --retry 3 -o "$WORK/uv.whl" "$UV_WHL_URL"
  rm -rf "$WORK/uvx" && mkdir -p "$WORK/uvx" && unzip -q "$WORK/uv.whl" -d "$WORK/uvx"
  cp -f "$WORK"/uvx/uv-*.data/scripts/uv "$CACHE/uv" && chmod +x "$CACHE/uv"
fi

# ------------------------------------------------------------ 6. pack resources
say "packing resources"
DIST="$BUILD/linux"
rm -rf "$DIST"
cp -a "$WORK/electron" "$DIST"
rm -f "$DIST/resources/default_app.asar"
# node_modules is unpacked on disk: the CUA Rust SDK (dlopen) and the asar-unpack
# paths used by the app require real files, not virtual asar paths.
npx --yes @electron/asar pack "$WORK/app" "$DIST/resources/app.asar" --unpack-dir node_modules

for d in agent-plugins agent-skills connectors home-scenarios cli cua en.lproj; do
  cp -a "$APP_SRC/$d" "$DIST/resources/"
done
cp -a "$APP_SRC"/tray*.png "$APP_SRC/app-update.yml" "$DIST/resources/"
mkdir -p "$DIST/resources/bin" "$DIST/resources/agent-browser"
cp -f "$CACHE/uv" "$DIST/resources/bin/uv"
cp -f "$CACHE/agent-browser" "$DIST/resources/agent-browser/agent-browser"
chmod +x "$DIST/resources/bin/uv" "$DIST/resources/agent-browser/agent-browser"
mv "$DIST/electron" "$DIST/scnet-client"
chmod +x "$DIST/scnet-client"

# --------------------------------------------------- 6b. self-check the bundle
say "self-check"
for p in "@napi-rs/canvas-linux-x64-gnu/skia.linux-x64-gnu.node" \
         "@trycua/cua-driver-linux-x64-gnu/libcua_driver_sdk.so" \
         "@ubjs/node-linux-x64-gnu/uniffi-runtime-napi.linux-x64-gnu.node" \
         "node-pty/prebuilds/linux-x64/pty.node"; do
  f="$DIST/resources/app.asar.unpacked/node_modules/$p"
  if [ ! -f "$f" ]; then echo "!! missing native artifact: $p" >&2; exit 1; fi
  echo "    ok $p"
done
for f in "$DIST/resources/bin/uv" "$DIST/resources/agent-browser/agent-browser"; do
  [ -x "$f" ] || { echo "!! missing or not executable: $f" >&2; exit 1; }
  echo "    ok ${f#$DIST/}"
done

# ------------------------------------------------------------------- 7. launcher
cat > "$DIST/launcher.sh" <<'EOS'
#!/bin/sh
APP="$(dirname "$(readlink -f "$0")")"
SB="$APP/chrome-sandbox"
if [ -u "$SB" ] && [ "$(stat -c %u "$SB" 2>/dev/null)" = "0" ]; then
  exec "$APP/scnet-client" "$@"
fi
exec "$APP/scnet-client" --no-sandbox "$@"
EOS
chmod +x "$DIST/launcher.sh"

# ------------------------------------------------------------ 8. icon/desktop
say "preparing icon and desktop entry"
mkdir -p "$BUILD/assets"
if [ ! -f "$BUILD/assets/icon.png" ]; then
  python3 - "$APP_SRC/icon.icns" "$BUILD/assets/icon.png" <<'EOP'
import struct, sys
data = open(sys.argv[1], 'rb').read()
i, best = 8, None
while i < len(data):
    ln = struct.unpack('>I', data[i+4:i+8])[0]
    payload = data[i+8:i+ln]
    if payload[:8] == b'\x89PNG\r\n\x1a\n':
        w = struct.unpack('>I', payload[16:20])[0]
        if best is None or w > best[0]:
            best = (w, payload)
    i += ln
open(sys.argv[2], 'wb').write(best[1])
EOP
fi

# ------------------------------------------------------------------- 9. deb
say "building .deb"
rm -rf "$BUILD/pkg"
mkdir -p "$BUILD/pkg/DEBIAN" "$BUILD/pkg/opt" "$BUILD/pkg/usr/bin" \
         "$BUILD/pkg/usr/share/applications" \
         "$BUILD/pkg/usr/share/icons/hicolor/1024x1024/apps"
cp -a "$DIST" "$BUILD/pkg/opt/scnet-client"
cp "$BUILD/assets/icon.png" "$BUILD/pkg/usr/share/icons/hicolor/1024x1024/apps/scnet-client.png"
ln -sf /opt/scnet-client/launcher.sh "$BUILD/pkg/usr/bin/scnet-client"
cat > "$BUILD/pkg/usr/share/applications/scnet-client.desktop" <<'EOD'
[Desktop Entry]
Type=Application
Name=SCNet 计算服务
Name[en]=SCNet Client
GenericName=Science Compute Workspace
Comment=国家超算互联网客户端
Comment[en]=SCNET (National Supercomputing Internet) desktop client
Exec=/opt/scnet-client/launcher.sh %U
Icon=scnet-client
Terminal=false
Categories=Science;Development;Utility;
StartupWMClass=scnet-client
EOD
cat > "$BUILD/pkg/DEBIAN/control" <<EOC
Package: scnet-client
Version: $APP_VERSION
Section: science
Priority: optional
Architecture: amd64
Installed-Size: 490000
Maintainer: local rebuild <local@localhost>
Depends: libgtk-3-0t64 | libgtk-3-0, libnss3, libasound2t64 | libasound2, libx11-xcb1, libxss1, libxtst6, libgbm1, libdrm2, libatspi2.0-0t64 | libatspi2.0-0, libcups2t64 | libcups2, fonts-noto-cjk
Recommends: xdg-utils, libu2f-udev
Description: SCNet Client (计算服务) - unofficial Linux build
 Unofficial Linux port of the official SCNet desktop client, packaged from the
 upstream macOS Electron build $APP_VERSION with Linux-native replacements for
 the platform-specific parts. AI workspace, skills, connectors, HPC job tools,
 local terminal and file handling.
EOC
cat > "$BUILD/pkg/DEBIAN/postinst" <<'EOI'
#!/bin/sh
set -e
if [ -f /opt/scnet-client/chrome-sandbox ]; then
  chown root:root /opt/scnet-client/chrome-sandbox || true
  chmod 4755 /opt/scnet-client/chrome-sandbox || true
fi
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database -q /usr/share/applications || true
fi
exit 0
EOI
chmod 755 "$BUILD/pkg/DEBIAN/postinst"
fakeroot dpkg-deb --build -Zxz "$BUILD/pkg" "$ROOT/scnet-client_${APP_VERSION}_amd64.deb"

say "done"
du -sh "$DIST" "$ROOT/scnet-client_${APP_VERSION}_amd64.deb"
