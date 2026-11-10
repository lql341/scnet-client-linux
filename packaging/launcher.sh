#!/bin/sh
#
# Launcher for the portable bundle and the Debian package.
#
# Responsibilities, in order: keep client state private, keep the Chromium
# sandbox when the host can provide one, and start the application with the
# remaining arguments.
set -eu

APP="$(dirname "$(readlink -f "$0")")"
SB="$APP/chrome-sandbox"

# Client state is private to the invoking user. config.json carries the session
# token and, when "remember password" is enabled, the remembered-login record;
# Electron writes these files with the ambient umask, which is 0644 on a default
# Debian or Ubuntu installation.
umask 077
for f in "$HOME/.config/scnet-client/config.json" \
         "$HOME/.sclaw/agent/auth.json"; do
  if [ -f "$f" ]; then
    chmod go-rwx "$f" 2>/dev/null || true
  fi
done

# The sandbox is used when one of its two prerequisites is satisfied:
# a setuid-root helper, or unprivileged user namespaces that the distribution
# has not restricted. Otherwise Chromium refuses to start, so the fallback
# keeps the client usable at the cost of the sandbox.
sandbox_usable() {
  # 1. setuid-root chrome-sandbox
  if [ -u "$SB" ] && [ "$(stat -c %u "$SB" 2>/dev/null)" = "0" ]; then
    return 0
  fi
  # 2. unprivileged user namespaces
  [ "$(cat /proc/sys/user/max_user_namespaces 2>/dev/null || echo 0)" -gt 0 ] || return 1
  case "$(cat /proc/sys/kernel/unprivileged_userns_clone 2>/dev/null)" in
    0) return 1 ;;
  esac
  case "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null)" in
    1) return 1 ;;   # Ubuntu 23.10 and later restrict user namespaces to profiles
  esac
  return 0
}

if [ "${SCNET_NO_SANDBOX:-0}" = "1" ] || ! sandbox_usable; then
  exec "$APP/scnet-client" --no-sandbox "$@"
fi
exec "$APP/scnet-client" "$@"
