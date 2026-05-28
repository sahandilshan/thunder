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

# Starts the four Wayfinder sample services on Windows: travel REST API,
# MCP server, AI chat agent, and React frontend. Logs go to .\logs\*.log.

if ($PSVersionTable.PSVersion.Major -lt 7) {
    Write-Host "ERROR: ThunderID requires PowerShell 7 (Core) or later. Install from https://github.com/PowerShell/PowerShell" -ForegroundColor Red
    exit 1
}

$ApiPort = 8787
$McpPort = 8000
$AgentPort = 8790
$FrontendPort = 5173

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $ScriptDir

New-Item -ItemType Directory -Force -Path (Join-Path $ScriptDir "logs") | Out-Null

function Stop-Port {
    param([int]$Port)
    try {
        $conns = Get-NetTCPConnection -LocalPort $Port -ErrorAction Stop
        $pidsToKill = $conns | Select-Object -Unique -ExpandProperty OwningProcess
        foreach ($p in $pidsToKill) {
            if ($p -and $p -ne $PID) { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue }
        }
    } catch {}
}

foreach ($p in @($ApiPort, $McpPort, $AgentPort, $FrontendPort)) { Stop-Port -Port $p }

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: npm is not installed. Please install Node.js 20+ and npm." -ForegroundColor Red
    exit 1
}

function Ensure-Install {
    param([string]$Dir)
    if (-not (Test-Path (Join-Path $Dir "node_modules"))) {
        Write-Host "Installing dependencies in $Dir..."
        Push-Location $Dir
        try { npm install --silent } finally { Pop-Location }
    }
}

Ensure-Install -Dir "api"
Ensure-Install -Dir "mcp"
Ensure-Install -Dir "ai-agent"
Ensure-Install -Dir "frontend"

if (-not (Test-Path (Join-Path "api" "wayfinder.sqlite"))) {
    Write-Host "Seeding API database..."
    Push-Location "api"
    try { npm run seed } finally { Pop-Location }
}

function Start-Service-Process {
    param([string]$Dir, [string]$Script, [string]$Log)
    $logPath = Join-Path $ScriptDir "logs/$Log"
    
    $npmExecutable = if ($IsWindows -or $env:OS -match "Windows") { "npm.cmd" } else { "npm" }

    return Start-Process -FilePath $npmExecutable `
        -ArgumentList @("run", $Script) `
        -WorkingDirectory (Join-Path $ScriptDir $Dir) `
        -PassThru `
        -NoNewWindow `
        -RedirectStandardOutput $logPath `
        -RedirectStandardError "$logPath.err"
}

Write-Host "Starting Wayfinder services..."
$apiProc      = Start-Service-Process -Dir "api"      -Script "start" -Log "api.log"
$mcpProc      = Start-Service-Process -Dir "mcp"      -Script "start" -Log "mcp.log"
$agentProc    = Start-Service-Process -Dir "ai-agent" -Script "start" -Log "ai-agent.log"
$frontendProc = Start-Service-Process -Dir "frontend" -Script "dev"   -Log "frontend.log"

Write-Host ""
Write-Host "Wayfinder sample is starting up. Logs under .\logs\"
Write-Host "  - Travel REST API: http://localhost:$ApiPort"
Write-Host "  - MCP server:      http://localhost:$McpPort/mcp"
Write-Host "  - AI chat agent:   http://localhost:$AgentPort/chat"
Write-Host "  - Frontend:        http://localhost:$FrontendPort"
Write-Host ""
Write-Host "Press Ctrl+C to stop all services."

try {
    Wait-Process -Id $apiProc.Id, $mcpProc.Id, $agentProc.Id, $frontendProc.Id
} finally {
    Write-Host "Stopping Wayfinder services..."
    foreach ($p in @($apiProc, $mcpProc, $agentProc, $frontendProc)) {
        if ($p -and -not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
    }
    foreach ($p in @($ApiPort, $McpPort, $AgentPort, $FrontendPort)) { Stop-Port -Port $p }
}
