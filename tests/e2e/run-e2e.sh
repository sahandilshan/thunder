#!/usr/bin/env bash
# ----------------------------------------------------------------------------
# Copyright (c) 2026, WSO2 LLC. (https://www.wso2.com).
#
# WSO2 LLC. licenses this file to you under the Apache License,
# Version 2.0 (the "License"); you may not use this file except
# in compliance with the License.
# You may obtain a copy of the License at
#
# http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing,
# software distributed under the License is distributed on an
# "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
# KIND, either express or implied. See the License for the
# specific language governing permissions and limitations
# under the License.
# ----------------------------------------------------------------------------
#
# run-e2e.sh - Local E2E test runner for ThunderID.
#
# Starts the ThunderID server with security disabled to import declarative
# resources, restarts it with security enabled, builds and starts the sample
# app, then runs the Playwright test suite.
#
# Usage:
#   ./run-e2e.sh [playwright-args...]
#
# Examples:
#   ./run-e2e.sh
#   ./run-e2e.sh --project=chromium
#   ./run-e2e.sh --grep @accessibility
#
# Requirements: curl, jq, python3, npm, lsof

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SAMPLE_APP_DIR="$PROJECT_ROOT/samples/apps/react-sdk-sample"
SERVER_URL="${BASE_URL:-https://localhost:8090}"
SAMPLE_URL="${SAMPLE_APP_URL:-https://localhost:3000}"
_p="${SERVER_URL##*:}"; SERVER_PORT="${_p%%/*}"
_p="${SAMPLE_URL##*:}"; SAMPLE_PORT="${_p%%/*}"
unset _p

kill_port() {
    lsof -ti tcp:"$1" | xargs kill -9 2>/dev/null || true
}

wait_for_url() {
    local url="$1" label="$2" i=0
    echo "Waiting for $label at $url..."
    while [ $i -lt 60 ]; do
        if curl -skf "$url" > /dev/null 2>&1; then
            echo "$label is ready."
            return 0
        fi
        i=$((i + 1))
        sleep 2
    done
    echo "ERROR: $label did not become ready after 120s."
    return 1
}

cleanup() {
    echo "Cleaning up..."
    kill_port $SAMPLE_PORT
    kill_port $SERVER_PORT
}
trap cleanup EXIT

# Abort if a server is already running to avoid silently disrupting it.
if curl -sk "$SERVER_URL/health/liveness" > /dev/null 2>&1; then
    echo "A ThunderID server is already running at $SERVER_URL."
    echo "Stop it before running this script, which needs to manage the server lifecycle."
    echo "To run tests against an already-running server: cd tests/e2e && npx playwright test"
    exit 1
fi

# 1. Start backend with security disabled so resource import requires no auth.
echo "Starting ThunderID server (security disabled for setup)..."
cd "$PROJECT_ROOT"
SKIP_SECURITY=true ./build.sh run_backend &
wait_for_url "$SERVER_URL/health/liveness" "ThunderID server"

# 2. Import declarative resources for all sample apps.
echo "Importing declarative resources..."
for sample in react-vanilla-sample react-sdk-sample; do
    config="$PROJECT_ROOT/samples/apps/$sample/thunderid-config/thunderid-config.yaml"
    vars_file="$PROJECT_ROOT/samples/apps/$sample/thunderid-config/thunderid.env"

    [ -f "$config" ] || { echo "  No config for $sample, skipping."; continue; }

    vars_json="{}"
    if [ -f "$vars_file" ]; then
        vars_json=$(python3 - "$vars_file" <<'PYEOF'
import sys, json
pairs = {}
for line in open(sys.argv[1]):
    line = line.rstrip()
    if '=' in line and not line.startswith('#'):
        k, _, v = line.partition('=')
        try:
            pairs[k.strip()] = json.loads(v.strip())
        except (ValueError, json.JSONDecodeError):
            pairs[k.strip()] = v.strip()
print(json.dumps(pairs))
PYEOF
)
    fi

    content=$(jq -Rs . < "$config")
    http_status=$(curl -sk -o /tmp/import_response.json -w "%{http_code}" \
        -X POST "$SERVER_URL/import" \
        -H "Content-Type: application/json" \
        -d "{\"content\": $content, \"variables\": $vars_json, \"options\": {\"upsert\": true}}")

    if [ "$http_status" = "200" ]; then
        echo "  Imported $sample resources."
    else
        echo "  ERROR: import returned HTTP $http_status for $sample:"
        cat /tmp/import_response.json
        echo ""
        exit 1
    fi
done

# 3. Restart server with security enabled.
echo "Restarting server with security enabled..."
kill_port $SERVER_PORT
sleep 2
./build.sh run_backend &
wait_for_url "$SERVER_URL/health/liveness" "ThunderID server (secured)"

# 4. Build sample app (if not already built) and start it.
echo "Setting up sample app..."
cd "$SAMPLE_APP_DIR"
if [ ! -d "dist" ]; then
    echo "Building sample app..."
    npm install --silent
    npm run build
fi
./start.sh &
wait_for_url "$SAMPLE_URL" "Sample app"

# 5. Install E2E dependencies and run Playwright tests.
echo "Running Playwright E2E tests..."
cd "$SCRIPT_DIR"
npm ci
npx playwright test "$@"
