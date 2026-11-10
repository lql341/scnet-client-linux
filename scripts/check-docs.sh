#!/usr/bin/env bash
#
# Verify that documentation stays in step with the repository's sources of truth:
# VERSION, scripts/versions.env, the packaging revision and the current package
# file name. Intended for CI and for use before a commit that touches prose.
#
# Checks
#   1. every document exists
#   2. VERSION, the packaging revision and the package file name appear where expected
#   3. every pinned dependency version appears in the README and in the design document
#   4. each English document and its translation have the same number of sections
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# shellcheck source=scripts/versions.env
. scripts/versions.env

VERSION_VALUE="$(cat VERSION)"
DEB_FILE="scnet-client_${VERSION_VALUE}-${DEB_REVISION}_amd64.deb"
failures=0

fail() { printf 'fail %s\n' "$*" >&2; failures=$((failures + 1)); }
ok() { printf 'ok   %s\n' "$*"; }

# 1. documents exist
for f in README.md README.zh-CN.md CHANGELOG.md docs/README.md \
         docs/design.md docs/design.zh-CN.md \
         docs/verification.md docs/verification.zh-CN.md \
         docs/extension-design.md docs/extension-design.zh-CN.md \
         docs/assets/screenshot-linux.png; do
  [ -f "$f" ] || fail "missing $f"
done
[ "$failures" -eq 0 ] && ok "all documents present"

# 2. version references
for f in README.md README.zh-CN.md docs/design.md docs/design.zh-CN.md; do
  grep -qF "$VERSION_VALUE" "$f" || fail "$f does not mention upstream $VERSION_VALUE"
done
for f in README.md README.zh-CN.md; do
  grep -qF "$DEB_FILE" "$f" || fail "$f does not name the current package $DEB_FILE"
done
grep -qF "## ${VERSION_VALUE}-${DEB_REVISION}" CHANGELOG.md \
  || fail "CHANGELOG.md has no entry for ${VERSION_VALUE}-${DEB_REVISION}"
ok "version references"

# 3. pinned dependency versions
for name in ELECTRON_VERSION CANVAS_VERSION CUA_DRIVER_VERSION UBJS_VERSION \
            NODE_PTY_VERSION AGENT_BROWSER_VERSION UV_VERSION; do
  value="${!name}"
  for f in README.md docs/design.md; do
    grep -qF "$value" "$f" || fail "$f does not mention $name ($value)"
  done
done
ok "pinned versions"

# 4. translation parity
for pair in "README.md README.zh-CN.md" \
            "docs/design.md docs/design.zh-CN.md" \
            "docs/verification.md docs/verification.zh-CN.md" \
            "docs/extension-design.md docs/extension-design.zh-CN.md"; do
  # shellcheck disable=SC2086
  set -- $pair
  en="$(grep -c '^## ' "$1" || true)"
  zh="$(grep -c '^## ' "$2" || true)"
  [ "$en" = "$zh" ] || fail "section count differs: $1 has $en, $2 has $zh"
done
ok "translation parity"

if [ "$failures" -ne 0 ]; then
  printf '\n%d check(s) failed\n' "$failures" >&2
  exit 1
fi
printf '\nall documentation checks passed\n'
