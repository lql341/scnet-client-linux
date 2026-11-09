#!/usr/bin/env bash
#
# Package the official SCNet desktop client (计算服务) for macOS.
#
# Unlike the Linux build, this does not replace or patch anything: the vendor
# distribution is already a native, signed macOS application, so all that is
# needed is fetching the right archive for the requested architecture, verifying
# it against the feed and repackaging it under a stable name.
#
# Repacking the vendor app.asar was deliberately left out. It would invalidate
# two vendor guarantees at once — the code signature and the
# `ElectronAsarIntegrity` hash in Info.plist — and that hash is not a plain
# SHA-256 of the file (verified against 4.1.1: the plist records 9f4fdcdc… for
# an archive whose SHA-256 is 3d0bdba3…), so it cannot be recomputed from a shell
# pipeline. The Linux-only window-controls patch is also inert on macOS, which
# draws real traffic lights.
#
# Outputs: build/macos/<arch>/计算服务.app and
#          build/macos/scnet-client_<version>_macos-<arch>.{zip,dmg}
#
# Requirements: bash curl unzip python3, plus ditto/codesign/hdiutil when run on
# macOS. Running it elsewhere is supported for the archive and copy stages only.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_VERSION="${APP_VERSION:-$(cat "$ROOT/VERSION")}"
OUT="$ROOT/build/macos"

MAC_BASE_URL="${MAC_BASE_URL:-https://dlcdn.scnet.cn/client/mac}"

# SHA-512 of SCNet-<version>-{x64,arm64}.zip as published in latest-mac.yml,
# base64 decoded. Overridable for a version bump or a vendor re-upload.
MAC_SHA512_X64="${MAC_SHA512_X64:-a81c7fd1b28c3e2f52105c48dbb290a821705f55deed347bc66c1a8dfab0eb574e0f8f05d16ded94e31d7be9d34adee3f3eb9106ec386afb25129a0e8f79dcd2}"
MAC_SHA512_ARM64="${MAC_SHA512_ARM64:-6bdcd4cea66ffb23abd434f78a2269f1d2f20097a029520f863f32a11724689404f48eb2ab18aeb337778f421041b58bd2a09fd88b882f77642e3cf46882d9b4}"

BUILD_DMG=0

usage() {
  cat <<'EOF'
Usage: scripts/build-macos.sh [options]

Options:
  --arch <arch>       x64, arm64 or all (default: this host's machine type)
  --dmg               Also build a .dmg (requires hdiutil, i.e. macOS)
  --clean             Remove build/macos/ before starting
  -h, --help          Show this help

Works on macOS; other hosts can run it for the fetch/verify/copy stages only.
EOF
}

log() { printf '\n==> %s\n' "$*"; }
note() { printf '    %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

default_arch() {
  case "$(uname -m)" in
    arm64|aarch64) echo arm64 ;;
    x86_64|amd64)  echo x64 ;;
    *)             die "unsupported machine type $(uname -m); pass --arch x64|arm64" ;;
  esac
}

ARCH="$(default_arch)"

while [ $# -gt 0 ]; do
  case "$1" in
    --arch)   [ $# -ge 2 ] || die "--arch needs a value"; ARCH="$2"; shift ;;
    --dmg)    BUILD_DMG=1 ;;
    --clean)  rm -rf "$OUT" ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; die "unknown option: $1" ;;
  esac
  shift
done

# --arch all: build every architecture in turn by re-invoking this script.
if [ "$ARCH" = all ]; then
  for one in x64 arm64; do
    args=(--arch "$one")
    [ "$BUILD_DMG" -eq 1 ] && args+=(--dmg)
    "$0" "${args[@]}"
  done
  exit 0
fi

if [ "$BUILD_DMG" -eq 1 ] && ! command -v hdiutil >/dev/null; then
  die "--dmg needs hdiutil, i.e. macOS"
fi

case "$ARCH" in
  x64)   SHA_REF="$MAC_SHA512_X64" ;;
  arm64) SHA_REF="$MAC_SHA512_ARM64" ;;
  *) die "unsupported architecture $ARCH (expected x64, arm64 or all)" ;;
esac

command -v curl >/dev/null || die "curl is required"
command -v unzip >/dev/null || die "unzip is required"
command -v python3 >/dev/null || die "python3 is required"

HOST_MACOS=0
[ "$(uname -s)" = Darwin ] && HOST_MACOS=1

WORK="$OUT/work-$ARCH"
APP="$OUT/$ARCH/计算服务.app"
ZIP_LOCAL="$ROOT/mac-$ARCH.zip"

# ------------------------------------------------------------ 0. vendor archive
log "0/3 vendor archive ($ARCH)"
if [ ! -f "$ZIP_LOCAL" ] || [ "$(sha512sum "$ZIP_LOCAL" | cut -d' ' -f1)" != "$SHA_REF" ]; then
  note "downloading $MAC_BASE_URL/SCNet-$APP_VERSION-$ARCH.zip"
  curl -fsSL --retry 3 -o "$ZIP_LOCAL" "$MAC_BASE_URL/SCNet-$APP_VERSION-$ARCH.zip"
fi
actual="$(sha512sum "$ZIP_LOCAL" | cut -d' ' -f1)"
[ "$actual" = "$SHA_REF" ] || die "SHA-512 mismatch for $ZIP_LOCAL
  expected $SHA_REF
  actual   $actual
the vendor re-uploaded the archive or the pins are stale; see scripts/check-upstream.sh"
note "sha512 verified, $(stat -c %s "$ZIP_LOCAL" 2>/dev/null || stat -f %z "$ZIP_LOCAL") bytes"

# ------------------------------------------------------------------ 1. unpack
log "1/3 unpack"
rm -rf "$WORK" "$OUT/$ARCH"
mkdir -p "$WORK" "$OUT/$ARCH"
unzip -q -o "$ZIP_LOCAL" -d "$WORK"
[ -d "$WORK/计算服务.app" ] || die "archive does not contain 计算服务.app"
cp -a "$WORK/计算服务.app" "$APP"
rm -rf "$WORK"
note "bundle $APP"

vendor_version="$(python3 - "$APP/Contents/Info.plist" <<'PY'
import plistlib, sys
with open(sys.argv[1], 'rb') as fh:
    print(plistlib.load(fh).get('CFBundleShortVersionString', 'unknown'))
PY
)"
electron_version="$(python3 - "$APP/Contents/Frameworks/Electron Framework.framework/Versions/A/Resources/Info.plist" <<'PY'
import plistlib, sys
with open(sys.argv[1], 'rb') as fh:
    print(plistlib.load(fh).get('CFBundleVersion', 'unknown'))
PY
)"
bundle_id="$(python3 - "$APP/Contents/Info.plist" <<'PYBUNDLE'
import plistlib, sys
with open(sys.argv[1], 'rb') as fh:
    print(plistlib.load(fh).get('CFBundleIdentifier', 'unknown'))
PYBUNDLE
)"
note "vendor $vendor_version, Electron $electron_version, $bundle_id"
[ "$vendor_version" = "$APP_VERSION" ] || die "bundle reports $vendor_version, expected $APP_VERSION"
[ "$bundle_id" = "com.sugon.sacp" ] || die "unexpected bundle identifier $bundle_id"

# ------------------------------------------------------------------ 2. sign
log "2/3 signature and quarantine"
if [ "$HOST_MACOS" -eq 1 ]; then
  # Nothing inside the bundle was modified, so the vendor signature is still
  # valid; verify it rather than replacing it.
  if codesign --verify --deep --strict "$APP" 2>/dev/null; then
    note "vendor signature verifies"
  else
    note "vendor signature does not verify; ad-hoc signing the copy"
    codesign --force --deep --sign - "$APP"
  fi
  if xattr -p com.apple.quarantine "$ZIP_LOCAL" >/dev/null 2>&1; then
    note "clearing com.apple.quarantine from the downloaded archive"
    xattr -d com.apple.quarantine "$ZIP_LOCAL" || true
  fi
else
  note "not running on macOS: skipping codesign/xattr (the bundle is unmodified,"
  note "so the vendor signature still applies; keep it that way by not editing it)"
fi

# ------------------------------------------------------------- 3. package
log "3/3 package"
ZIP_OUT="$OUT/scnet-client_${APP_VERSION}_macos-${ARCH}.zip"
if [ "$HOST_MACOS" -eq 1 ]; then
  ditto -c -k --sequesterRsrc --keepParent "$APP" "$ZIP_OUT"
else
  # -y keeps the framework symlinks, -X drops extra attributes.
  (cd "$OUT/$ARCH" && zip -qry -X "$ZIP_OUT" "计算服务.app")
fi
note "$ZIP_OUT"
if command -v sha256sum >/dev/null; then
  (cd "$OUT" && sha256sum "$(basename "$ZIP_OUT")" > "$(basename "$ZIP_OUT").sha256")
else
  (cd "$OUT" && shasum -a 256 "$(basename "$ZIP_OUT")" > "$(basename "$ZIP_OUT").sha256")
fi
note "$(cat "$ZIP_OUT.sha256")"

if [ "$BUILD_DMG" -eq 1 ]; then
  command -v hdiutil >/dev/null || die "--dmg needs hdiutil, i.e. macOS"
  DMG_OUT="$OUT/scnet-client_${APP_VERSION}_macos-${ARCH}.dmg"
  hdiutil create -quiet -volname "计算服务" -srcfolder "$APP" -ov -format UDZO "$DMG_OUT"
  note "$DMG_OUT"
fi

log "done"
cat <<EOF

Install: drag 计算服务.app into /Applications.
First launch of an unsigned or ad-hoc signed copy:
  xattr -dr com.apple.quarantine "/Applications/计算服务.app"
EOF
