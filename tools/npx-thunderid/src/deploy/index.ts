/**
 * Copyright (c) 2026, WSO2 LLC. (https://www.wso2.com).
 *
 * WSO2 LLC. licenses this file to you under the Apache License,
 * Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied. See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import {spawnSync, execSync} from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {intro, outro, select, text, confirm, spinner, note, isCancel, cancel} from '@clack/prompts';
import colors from 'picocolors';
import {loadRecipes} from './recipes/index';
import Product from '../constants/Product';
import {getLatestThunderVersion} from '../download';
import type {DbType} from '../models/db';
import type {Recipe} from '../models/deploy';
import {readState} from '../state';

function getDeploymentYamlContent(): string {
  return (
    [
      'server:',
      '  hostname: "0.0.0.0"',
      '  port: __SERVER_PORT__',
      '  http_only: true',
      '  public_url: "__PUBLIC_URL__"',
      '',
      'gate_client:',
      '  hostname: "__PUBLIC_HOST__"',
      '  port: __GATE_PORT__',
      '  scheme: "__GATE_SCHEME__"',
      '  path: "/gate"',
      '',
      'cors:',
      '  allowed_origins:',
      '    - "__PUBLIC_URL__"',
      '',
      'passkey:',
      '  allowed_origins:',
      '    - "__PUBLIC_URL__"',
    ].join('\n') + '\n'
  );
}

function getDockerfileContent(version: string): string {
  const dirName = `thunder-${version}-linux-x64`;
  return `FROM alpine:3.19
RUN apk add --no-cache sqlite openssl ca-certificates bash curl unzip lsof

RUN mkdir -p /app \\
    && curl -fsSL -o /tmp/thunder.zip \\
       "https://github.com/asgardeo/thunder/releases/download/v${version}/${dirName}.zip" \\
    && unzip /tmp/thunder.zip -d /app \\
    && rm /tmp/thunder.zip

WORKDIR /app/${dirName}

# Replace the bundled deployment.yaml with a cloud-ready template.
# Placeholders are substituted at runtime by entrypoint.sh using provider env vars.
COPY .thunderdeploy/deployment.yaml repository/conf/deployment.yaml

RUN addgroup -S thunder && adduser -S thunder -G thunder \\
    && chown -R thunder:thunder .

COPY .thunderdeploy/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

USER thunder
EXPOSE 8090
ENTRYPOINT ["/entrypoint.sh"]
`;
}

function getEntrypointContent(): string {
  return `#!/bin/bash
set -e

# Resolve the public URL from provider-injected environment variables.
# Each platform sets a different variable; we normalise them into PUBLIC_URL.
# Users can also set PUBLIC_URL explicitly to override auto-detection.
if [ -z "$PUBLIC_URL" ]; then
  if [ -n "$RAILWAY_PUBLIC_DOMAIN" ]; then
    PUBLIC_URL="https://$RAILWAY_PUBLIC_DOMAIN"
  elif [ -n "$RENDER_EXTERNAL_URL" ]; then
    PUBLIC_URL="$RENDER_EXTERNAL_URL"
  elif [ -n "$FLY_APP_NAME" ]; then
    PUBLIC_URL="https://$FLY_APP_NAME.fly.dev"
  fi
fi

# Railway (and other platforms) inject PORT — use it so the proxy routes to the right port.
SERVER_PORT="\${PORT:-8090}"

# Fill in deployment.yaml placeholders with the resolved public URL and port.
DEPLOY_YAML="repository/conf/deployment.yaml"
if [ -n "$PUBLIC_URL" ]; then
  PUBLIC_HOST=$(echo "$PUBLIC_URL" | sed 's|https://||; s|http://||; s|[:/].*||')
  if echo "$PUBLIC_URL" | grep -q "^https://"; then
    GATE_SCHEME="https"
    GATE_PORT="443"
  else
    GATE_SCHEME="http"
    GATE_PORT="$SERVER_PORT"
  fi
else
  PUBLIC_URL="http://localhost:$SERVER_PORT"
  PUBLIC_HOST="localhost"
  GATE_SCHEME="http"
  GATE_PORT="$SERVER_PORT"
fi
sed -i "s|__PUBLIC_URL__|$PUBLIC_URL|g" "$DEPLOY_YAML"
sed -i "s|__PUBLIC_HOST__|$PUBLIC_HOST|g" "$DEPLOY_YAML"
sed -i "s|__GATE_SCHEME__|$GATE_SCHEME|g" "$DEPLOY_YAML"
sed -i "s|__GATE_PORT__|$GATE_PORT|g" "$DEPLOY_YAML"
sed -i "s|__SERVER_PORT__|$SERVER_PORT|g" "$DEPLOY_YAML"

# Use /data as sentinel location when a volume is mounted (e.g. Fly.io SQLite),
# otherwise fall back to WORKDIR (resets on redeploy, which is correct since the DB does too).
if [ -d "/data" ]; then
  SENTINEL="/data/.thunder-setup-complete"
else
  SENTINEL=".setup-complete"
fi

if [ ! -f "$SENTINEL" ]; then
  # setup.sh reads hostname from deployment.yaml to build its BASE_URL for health polling.
  # "0.0.0.0" is the right binding address for the server but is not a valid client destination —
  # curl to http://0.0.0.0:8090 fails or times out on every retry, stalling setup for minutes.
  # Swap to localhost just for the setup phase, then restore the binding address afterwards.
  sed -i 's|hostname: "0.0.0.0"|hostname: "localhost"|g' "$DEPLOY_YAML"
  THUNDER_SKIP_SECURITY=true bash setup.sh
  sed -i 's|hostname: "localhost"|hostname: "0.0.0.0"|g' "$DEPLOY_YAML"
  touch "$SENTINEL"
  # In newer Thunder versions, setup.sh invokes start.sh internally and captures that PID.
  # Killing start.sh leaves the Thunder binary and the embedded OpenFGA server as orphans.
  # start.sh refuses to run if either port is occupied, which exits the container → 502.
  lsof -ti tcp:"$SERVER_PORT" 2>/dev/null | xargs kill -9 2>/dev/null || true
  lsof -ti tcp:9090 2>/dev/null | xargs kill -9 2>/dev/null || true
  sleep 1
fi

# Patch config.js files AFTER setup so that setup.sh cannot overwrite the changes.
# Only patch when the public domain is actually resolved (RAILWAY_PUBLIC_DOMAIN etc. may not be
# injected on the very first container start for a brand-new service). Track the last-patched
# hostname in a stamp file so we re-apply whenever the domain changes between restarts.
if [ -d "/data" ]; then
  DOMAIN_STAMP="/data/.thunder-patched-domain"
else
  DOMAIN_STAMP=".thunder-patched-domain"
fi
LAST_DOMAIN=$(cat "$DOMAIN_STAMP" 2>/dev/null || echo "")

if [ "$PUBLIC_HOST" != "localhost" ] && [ "$PUBLIC_HOST" != "$LAST_DOMAIN" ]; then
  for CONFIG_FILE in apps/console/config.js apps/gate/config.js; do
    if [ -f "$CONFIG_FILE" ]; then
      # Replace any quoted hostname value (handles localhost and previously-patched domains).
      sed -i "s|hostname: '[^']*'|hostname: '$PUBLIC_HOST'|g" "$CONFIG_FILE"
      # Replace any numeric port value in the server block.
      sed -i "s|port: [0-9]*|port: $GATE_PORT|g" "$CONFIG_FILE"
      # Set http_only to match the actual scheme (Thunder now ships with http_only: true).
      if [ "$GATE_SCHEME" = "https" ]; then
        sed -i "s|http_only: true|http_only: false|g" "$CONFIG_FILE"
      else
        sed -i "s|http_only: false|http_only: true|g" "$CONFIG_FILE"
      fi
    fi
  done
  echo "$PUBLIC_HOST" > "$DOMAIN_STAMP"
fi

# Forward the resolved port to start.sh so Thunder binds on Railway's expected port.
export BACKEND_PORT="$SERVER_PORT"
exec bash start.sh
`;
}

function isCLIAvailable(cliName: string | undefined): boolean {
  if (!cliName) return true;
  const result = spawnSync(cliName, ['--version'], {stdio: 'pipe'});
  return !result.error && result.status === 0;
}

async function ensureCLI(recipe: Recipe): Promise<void> {
  if (!recipe.cliName || isCLIAvailable(recipe.cliName)) return;

  note(
    `${colors.cyan(recipe.cliName)} is not installed.\n\nInstall command:\n  ${colors.bold(recipe.installCmd)}`,
    `${recipe.displayName} — setup needed`,
  );

  const shouldInstall = await confirm({
    message: `Install ${colors.cyan(recipe.cliName)} now?`,
    initialValue: true,
  });

  if (isCancel(shouldInstall) || !shouldInstall) {
    cancel(`Install ${recipe.cliName} and re-run to continue.`);
    process.exit(0);
  }

  if (!recipe.installCmd) return;

  const s = spinner();
  s.start(`Installing ${recipe.cliName}...`);
  try {
    execSync(recipe.installCmd, {stdio: 'pipe'});
    s.stop(`${recipe.cliName} installed`);
  } catch (err) {
    s.stop(`Install failed: ${(err as Error).message}`);
    note(`Run this manually, then re-run deploy:\n  ${colors.bold(recipe.installCmd)}`, 'Manual install needed');
    process.exit(1);
  }

  if (recipe.postInstallPath) {
    process.env['PATH'] = `${recipe.postInstallPath}${path.delimiter}${process.env['PATH']}`;
  }

  if (!isCLIAvailable(recipe.cliName)) {
    note(
      `Installed but ${colors.cyan(recipe.cliName)} isn't on PATH yet.\n\nRestart your terminal, then run:\n  ${colors.bold('npx thunderid deploy')}`,
      'Restart terminal needed',
    );
    process.exit(0);
  }
}

export async function deploy(): Promise<void> {
  // eslint-disable-next-line no-console
  console.clear();

  intro(colors.bold(`⚡ ${Product.NAME}`) + colors.dim(' — Deploy'));

  let version: string;
  const localState = readState();
  if (localState.lastUsedVersion) {
    version = localState.lastUsedVersion;
    note(`Deploying the version you tested locally: v${version}`, 'Version');
  } else {
    const s = spinner();
    s.start('Fetching latest Thunder release...');
    try {
      version = await getLatestThunderVersion();
      s.stop(`Thunder v${version}`);
    } catch (err) {
      s.stop('Could not fetch latest Thunder release.');
      process.stderr.write(`\nError: ${(err as Error).message}\n`);
      process.exit(1);
    }
  }

  const recipes = loadRecipes();

  const availability: Record<string, boolean> = Object.fromEntries(
    recipes.map((r) => [r.id, isCLIAvailable(r.cliName)]),
  );

  const recipeId = await select({
    message: 'Deploy to which platform?',
    initialValue: 'railway',
    options: [
      ...recipes
        .filter((r) => !r.comingSoon)
        .map((r) => ({
          value: r.id,
          label: r.displayName,
          hint: availability[r.id] ? r.description : `${r.description} — ${colors.yellow(`needs ${r.cliName}`)}`,
        })),
      ...recipes
        .filter((r) => r.comingSoon)
        .map((r) => ({
          value: r.id,
          label: colors.dim(r.displayName),
          hint: colors.dim('Coming soon'),
          disabled: true,
        })),
    ],
  });

  if (isCancel(recipeId)) {
    cancel('Deploy cancelled.');
    process.exit(0);
  }

  const recipe = recipes.find((r) => r.id === recipeId);
  if (!recipe) {
    cancel('Unknown recipe selected.');
    process.exit(1);
  }

  await ensureCLI(recipe);

  try {
    await recipe.preflight();
  } catch (err) {
    process.stderr.write(`\n${colors.red('Preflight failed:')} ${(err as Error).message}\n`);
    process.exit(1);
  }

  const dbType = await select({
    message: 'Which database?',
    options: [
      {value: 'sqlite', label: 'SQLite', hint: 'Embedded, zero-config (recommended)'},
      {value: 'postgres', label: 'PostgreSQL / Supabase', hint: 'External managed database'},
    ],
  });

  if (isCancel(dbType)) {
    cancel('Deploy cancelled.');
    process.exit(0);
  }

  let dbUrl: string | undefined;
  if (dbType === 'postgres') {
    const dbUrlInput = await text({
      message: 'DATABASE_URL:',
      placeholder: 'postgresql://user:pass@db.example.com/dbname',
      validate: (v) => (v ? undefined : 'DATABASE_URL is required'),
    });
    if (isCancel(dbUrlInput)) {
      cancel('Deploy cancelled.');
      process.exit(0);
    }
    dbUrl = dbUrlInput;
  }

  let appName: string | undefined;
  if (recipe.needsAppName !== false) {
    const defaultName = `thunder-${Math.random().toString(36).slice(2, 7)}`;
    const appNameInput = await text({
      message: 'App name:',
      placeholder: defaultName,
      defaultValue: defaultName,
    });

    if (isCancel(appNameInput)) {
      cancel('Deploy cancelled.');
      process.exit(0);
    }

    appName = appNameInput || defaultName;
  }

  const deployDir = path.join(process.cwd(), '.thunderdeploy');
  fs.mkdirSync(deployDir, {recursive: true});
  fs.writeFileSync(path.join(deployDir, 'deployment.yaml'), getDeploymentYamlContent(), 'utf8');
  fs.writeFileSync(path.join(deployDir, 'entrypoint.sh'), getEntrypointContent(), 'utf8');

  const dockerfilePath = path.join(process.cwd(), 'Dockerfile');
  if (fs.existsSync(dockerfilePath)) {
    note('Existing Dockerfile found — it will be overwritten.', 'Warning');
  }
  fs.writeFileSync(dockerfilePath, getDockerfileContent(version), 'utf8');

  try {
    await recipe.deploy({appName, dbType: dbType as DbType, dbUrl, thunderVersion: version});
  } catch (err) {
    process.stderr.write(`\n${colors.red('Deploy failed:')} ${(err as Error).message}\n`);
    process.exit(1);
  }

  outro(colors.green(`${Product.NAME} v${version} deployed${appName ? ` as ${colors.bold(appName)}` : ''}`));
}
