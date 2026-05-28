#!/usr/bin/env pwsh

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

# package-consent-server.ps1
# Download, configure, and stage the default consent server into distribution.
#
# Usage: .\scripts\package-consent-server.ps1 -GoOS <os> -GoArch <arch> -DistOutputPath <path>
#
# Arguments:
#   GoOS           - Target OS in Go env format (linux, darwin, windows)
#   GoArch         - Target architecture in Go env format (amd64, arm64)
#   DistOutputPath - Absolute path to the distribution product folder
#                    (a 'consent' subdirectory will be created inside this)

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string]$GoOS,
    [Parameter(Mandatory = $true)] [string]$GoArch,
    [Parameter(Mandatory = $true)] [string]$DistOutputPath
)

$ErrorActionPreference = "Stop"

# Consent server release coordinates
$CONSENT_SERVER_VERSION = "0.2.0"
$CONSENT_SERVER_DOWNLOAD_URL = "https://github.com/wso2/openfgc/releases/download"
$CONSENT_SERVER_PORT = 9090

# Map Go env OS/ARCH names to release artifact naming
$PACKAGE_OS = $GoOS
$PACKAGE_ARCH = $GoArch

if ($GoOS -eq "darwin") {
    $PACKAGE_OS = "macos"
}
elseif ($GoOS -eq "windows") {
    $PACKAGE_OS = "win"
}

if ($GoArch -eq "amd64") {
    $PACKAGE_ARCH = "x64"
}

$ARCHIVE_NAME = "consent-server-${CONSENT_SERVER_VERSION}-${PACKAGE_OS}-${PACKAGE_ARCH}.zip"
$ARCHIVE_URL = "${CONSENT_SERVER_DOWNLOAD_URL}/v${CONSENT_SERVER_VERSION}/${ARCHIVE_NAME}"
$EXTRACTED_FOLDER = "consent-server-${CONSENT_SERVER_VERSION}-${PACKAGE_OS}-${PACKAGE_ARCH}"

$TMP_DIR = Join-Path ([System.IO.Path]::GetTempPath()) ([System.IO.Path]::GetRandomFileName())
New-Item -Path $TMP_DIR -ItemType Directory -Force | Out-Null

try {
    Write-Host "================================================================"
    Write-Host "Packaging consent server ${CONSENT_SERVER_VERSION} for ${PACKAGE_OS}/${PACKAGE_ARCH}..."
    Write-Host "Downloading from: $ARCHIVE_URL"
    Write-Host "================================================================"

    $archivePath = Join-Path $TMP_DIR $ARCHIVE_NAME
    try {
        Invoke-WebRequest -Uri $ARCHIVE_URL -OutFile $archivePath -ErrorAction Stop
    }
    catch {
        Write-Host "Error: Failed to download consent server from $ARCHIVE_URL"
        Write-Host $_.Exception.Message
        exit 1
    }

    # Verify archive integrity using SHA256 checksum if available
    $checksumUrl = "${ARCHIVE_URL}.sha256"
    $checksumPath = Join-Path $TMP_DIR "${ARCHIVE_NAME}.sha256"
    try {
        Invoke-WebRequest -Uri $checksumUrl -OutFile $checksumPath -ErrorAction Stop
        Write-Host "Verifying archive checksum..."
        $expectedHash = (Get-Content $checksumPath -Raw).Trim().Split()[0]
        $actualHash = (Get-FileHash -Path $archivePath -Algorithm SHA256).Hash.ToLower()
        if ($expectedHash -ne $actualHash) {
            Write-Host "Error: Checksum verification failed for $ARCHIVE_NAME"
            Write-Host "  Expected: $expectedHash"
            Write-Host "  Actual:   $actualHash"
            exit 1
        }
        Write-Host "Checksum verification passed."
    }
    catch {
        Write-Host "Warning: No .sha256 checksum file found for $ARCHIVE_NAME, skipping verification."
    }

    Write-Host "Extracting consent server archive..."
    Expand-Archive -Path $archivePath -DestinationPath $TMP_DIR -Force

    $WORK_DIR = Join-Path $TMP_DIR $EXTRACTED_FOLDER
    if (-not (Test-Path $WORK_DIR)) {
        Write-Host "Error: Expected extracted directory '$EXTRACTED_FOLDER' not found in archive."
        exit 1
    }

    Write-Host "Initializing SQLite database..."
    $dbDir = Join-Path $WORK_DIR "repository/database"
    New-Item -Path $dbDir -ItemType Directory -Force | Out-Null
    $dbPath = Join-Path $dbDir "consentdb.db"
    $sqlScriptPath = Join-Path $WORK_DIR "dbscripts/db_schema_sqlite.sql"

    if (-not (Get-Command sqlite3 -ErrorAction SilentlyContinue)) {
        Write-Host "Error: 'sqlite3' CLI not found. Install sqlite3 and re-run the build."
        exit 1
    }

    $sqlScriptPathForSqlite = $sqlScriptPath.Replace('\', '/')
    & sqlite3 $dbPath ".read `"$sqlScriptPathForSqlite`""
    if ($LASTEXITCODE -ne 0) { throw "Failed to initialize consent DB with exit code $LASTEXITCODE" }

    & sqlite3 $dbPath "PRAGMA journal_mode=WAL;"
    if ($LASTEXITCODE -ne 0) { throw "Failed to enable WAL mode for consent DB with exit code $LASTEXITCODE" }

    Write-Host "Writing SQLite deployment configuration..."
    $confPath = Join-Path $WORK_DIR "repository/conf/deployment.yaml"
    $deploymentYaml = @"
server:
  hostname: localhost
  port: $CONSENT_SERVER_PORT
  readTimeout: 30s
  writeTimeout: 30s
  idleTimeout: 120s

database:
  consent:
    type: sqlite
    path: repository/database/consentdb.db
    options: "_pragma=journal_mode(WAL)&_pragma=cache_size(-16000)"

logging:
  level: info

consent:
  status_mappings:
    active_status: ACTIVE
    expired_status: EXPIRED
    revoked_status: REVOKED
    created_status: CREATED
    rejected_status: REJECTED
  auth_status_mappings:
    approved_state: APPROVED
    rejected_state: REJECTED
    created_state: CREATED
    system_expired_state: SYS_EXPIRED
    system_revoked_state: SYS_REVOKED
"@
    Set-Content -Path $confPath -Value $deploymentYaml -Encoding Ascii

    Write-Host "Staging consent server into distribution..."
    $consentDest = Join-Path $DistOutputPath "consent"
    New-Item -Path $consentDest -ItemType Directory -Force | Out-Null
    Copy-Item -Path (Join-Path $WORK_DIR "*") -Destination $consentDest -Recurse -Force

    Write-Host "================================================================"
    Write-Host "Consent server packaged successfully at: $consentDest"
    Write-Host "================================================================"
}
finally {
    Remove-Item -Path $TMP_DIR -Recurse -Force -ErrorAction SilentlyContinue
}
