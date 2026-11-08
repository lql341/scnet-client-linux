#!/usr/bin/env bash
# 检查官方上游是否有新版本，并与 build-linux.sh 里固定的版本/校验和对比。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
MAC_YML="https://dlcdn.scnet.cn/client/mac/latest-mac.yml"
WIN_YML="https://dlcdn.scnet.cn/client/win/latest.yml"

current_mac="$(curl -sSL --max-time 30 "$MAC_YML" | sed -n 's/^version: *//p' | head -1)"
current_win="$(curl -sSL --max-time 30 "$WIN_YML" | sed -n 's/^version: *//p' | head -1)"
script_ver="$(sed -n 's/^APP_VERSION="\(.*\)"$/\1/p' "$ROOT/build-linux.sh")"
electron_ver="$(sed -n 's/^ELECTRON_VERSION="\(.*\)"$/\1/p' "$ROOT/build-linux.sh")"

echo "官方 macOS   : $current_mac"
echo "官方 Windows : $current_win"
echo "脚本构建版本 : $script_ver (Electron $electron_ver)"
echo

if [ "$current_mac" != "$script_ver" ]; then
  echo "上游有更新，需要同步："
  echo
  curl -sSL --max-time 30 "$MAC_YML" | sed -n '/^files:/,/^path:/p'
  echo
  echo "步骤："
  echo "  1. build-linux.sh: MAC_ZIP_URL / APP_VERSION / MAC_ZIP_SHA512（上面 url 对应的 sha512）"
  echo "  2. 解包后看 Frameworks/Electron Framework.framework/Versions/A/Resources/Info.plist"
  echo "     的 CFBundleVersion，若变化则同步 ELECTRON_VERSION 并重编 node-pty"
  echo "  3. 对照新 app.asar/package.json 更新 canvas / cua-driver / ubjs / agent-browser 版本"
  echo "  4. ./build-linux.sh 重新构建并回归"
else
  echo "已是最新（$script_ver），无需处理。"
fi
