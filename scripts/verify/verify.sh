#!/usr/bin/env bash
# Verify the site. Read-only: never submits the contact form.
# Exit 0 means every check passed.
#
#   ./verify.sh            Check the live site (https://farhadbaloch.com/).
#   ./verify.sh --local    Serve this repo and check that copy.
#   SITE_URL=http://127.0.0.1:8080/ ./verify.sh
set -u
cd "$(dirname "$0")"

if [ "${1:-}" = "--local" ]; then
  PORT="${PORT:-4173}"
  ROOT="$(cd ../.. && pwd)"
  LOG="${TMPDIR:-/tmp}/farhadbaloch-verify-${PORT}.log"
  python3 -m http.server --bind 127.0.0.1 --directory "$ROOT" "$PORT" >"$LOG" 2>&1 &
  SERVER_PID=$!
  cleanup() { kill "$SERVER_PID" 2>/dev/null || true; }
  trap cleanup EXIT
  export SITE_URL="http://127.0.0.1:${PORT}/"
  ready=0
  for _ in $(seq 1 50); do
    if curl -fsS "$SITE_URL" >/dev/null 2>&1; then
      ready=1
      break
    fi
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
      break
    fi
    sleep 0.2
  done
  if [ "$ready" -ne 1 ]; then
    echo "The local site did not start at ${SITE_URL}." >&2
    cat "$LOG" >&2 || true
    exit 1
  fi
  echo "Serving ${ROOT} at ${SITE_URL}"
fi

if [ ! -d node_modules/playwright ]; then
  npm install
fi

# GitHub Actions sets CI=true and does not rely on a system Chrome.
# A laptop with Google Chrome keeps using that, matching the original script.
need_bundled=0
if [ -n "${CHROME:-}" ]; then
  need_bundled=0
elif [ "${CI:-}" = "true" ]; then
  need_bundled=1
elif [ ! -x /usr/bin/google-chrome ] && [ ! -x /usr/bin/google-chrome-stable ] && [ ! -x /usr/bin/chromium-browser ] && [ ! -x /usr/bin/chromium ]; then
  need_bundled=1
fi
# The workflow installs Chromium in its own step, then sets
# VERIFY_SKIP_BROWSER_INSTALL so this script does not install it again.
if [ "$need_bundled" -eq 1 ] && [ "${VERIFY_SKIP_BROWSER_INSTALL:-}" != "1" ]; then
  if [ "${CI:-}" = "true" ]; then
    npx playwright install --with-deps chromium
  else
    npx playwright install chromium
  fi
fi

export EVIDENCE_DIR="${EVIDENCE_DIR:-$PWD/evidence}"
mkdir -p "$EVIDENCE_DIR"
echo "Running checks against ${SITE_URL:-https://farhadbaloch.com/}"
node verify.mjs 2>&1 | tee "$EVIDENCE_DIR/run.log"
exit "${PIPESTATUS[0]}"
