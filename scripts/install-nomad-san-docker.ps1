#!/usr/bin/env pwsh
#
# Project Nomad - SAN + Docker Headless Installer (Windows)
# Quick install for SAN mode with Docker infrastructure on Windows.
#
# REQUIRES PowerShell 7.6 or newer. Run with `pwsh`, not `powershell`.
#   winget install --id Microsoft.PowerShell -e --accept-source-agreements --accept-package-agreements
#
# Usage:
#   pwsh .\install-nomad-san-docker.ps1
#
#   Streamed (use -NoExit so the window stays open on errors):
#   pwsh -NoExit -Command "iwr -Uri https://raw.githubusercontent.com/WISE-Developers/project_nomad/dev/scripts/install-nomad-san-docker.ps1 -UseBasicParsing | iex"
#
# Parameters / matching env vars (defaults shown):
#   -InstallDir          $env:INSTALL_DIR              .\project_nomad
#   -DatasetPath         $env:FIRESTARR_DATASET_PATH   $env:USERPROFILE\firestarr_data
#   -Version             $env:VERSION                  latest
#   -EnvFile             $env:NOMAD_ENV_FILE           (none — uses .env.example)
#   -SkipStart           $env:SKIP_START               $false
#   -AutoInstallDataset  $env:AUTO_INSTALL_DATASET     $false
#
# Honors an existing .env in two ways:
#   1. Pass -EnvFile pointing at your custom file, OR
#   2. Place .env adjacent to -InstallDir (one level up). The installer
#      preserves user-set keys and only overwrites installer-controlled
#      ones (paths, ports, image tags).
#

param(
    [string]$InstallDir = $env:INSTALL_DIR,
    [string]$DatasetPath = $env:FIRESTARR_DATASET_PATH,
    [string]$Version = $env:VERSION,
    [string]$EnvFile = $env:NOMAD_ENV_FILE,
    [switch]$SkipStart = [bool]$env:SKIP_START,
    [switch]$AutoInstallDataset = [bool]$env:AUTO_INSTALL_DATASET
)

$InstallerVersion = "1.1.0"
$RequiredPSMajor = 7
$RequiredPSMinor = 6
$RepoOwner = "WISE-Developers"
$RepoName = "project_nomad"

# Force UTF-8 console output so box-drawing + status glyphs render instead
# of `?` on default Windows codepages (cp437/1252).
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

# Set defaults if not provided
if (-not $InstallDir) { $InstallDir = ".\project_nomad" }
if (-not $DatasetPath) { $DatasetPath = "$env:USERPROFILE\firestarr_data" }
if (-not $Version) { $Version = "latest" }
$NomadPort = if ($env:NOMAD_PORT) { $env:NOMAD_PORT } else { 4901 }
$FrontendPort = if ($env:NOMAD_FRONTEND_HOST_PORT) { $env:NOMAD_FRONTEND_HOST_PORT } else { 3901 }
$BackendPort = if ($env:NOMAD_BACKEND_HOST_PORT) { $env:NOMAD_BACKEND_HOST_PORT } else { 4901 }
$Hostname = if ($env:NOMAD_SERVER_HOSTNAME) { $env:NOMAD_SERVER_HOSTNAME } else { "localhost" }
$NomadDataPath = if ($env:NOMAD_DATA_PATH) { $env:NOMAD_DATA_PATH } else { $DatasetPath }
$SimsPath = if ($env:SIMS_OUTPUT_PATH) { $env:SIMS_OUTPUT_PATH } else { "$DatasetPath\sims" }

# FireSTARR image config
$FirestarrRegistry = "ghcr.io/cwfmf/firestarr-cpp"
$FirestarrImageName = "firestarr"
$FirestarrImageTag = "unstable-latest"

# Colors for output. Prefixed with "Nomad-" so they don't shadow the
# built-in cmdlets (Write-Error, Write-Warning) — overriding those swallows
# real errors that ride ErrorAction Stop.
function Write-NomadHeader  { param($text) Write-Host $text -ForegroundColor Cyan }
function Write-NomadStep    { param($text) Write-Host "▶ $text" -ForegroundColor Green }
function Write-NomadWarn    { param($text) Write-Host "⚠ $text" -ForegroundColor Yellow }
function Write-NomadFail    { param($text) Write-Host "✖ $text" -ForegroundColor Red }
function Write-NomadSuccess { param($text) Write-Host "✔ $text" -ForegroundColor Green }
function Write-NomadInfo    { param($text) Write-Host "ℹ $text" -ForegroundColor Blue }

function Show-Header {
    Write-Host ""
    Write-NomadHeader "╔════════════════════════════════════════════════════════════╗"
    Write-NomadHeader "║   Project Nomad - SAN + Docker Installer v$InstallerVersion       ║"
    Write-NomadHeader "║              Headless / Non-Interactive Mode             ║"
    Write-NomadHeader "╚════════════════════════════════════════════════════════════╝"
    Write-Host ""
}

# Enforce PowerShell 7.6+. Old PS5 users see cryptic later-stage failures
# (different cmdlet behaviour, syntax differences, json handling) so we
# stop here with a clear upgrade path.
function Assert-PowerShellVersion {
    $v = $PSVersionTable.PSVersion
    $tooOld = ($v.Major -lt $RequiredPSMajor) -or
              ($v.Major -eq $RequiredPSMajor -and $v.Minor -lt $RequiredPSMinor)
    if ($tooOld) {
        Write-NomadFail "PowerShell $v detected. PowerShell $RequiredPSMajor.$RequiredPSMinor+ is required."
        Write-Host ""
        Write-Host "  Install via winget:"
        Write-Host "    winget install --id Microsoft.PowerShell -e --accept-source-agreements --accept-package-agreements"
        Write-Host ""
        Write-Host "  Or download:"
        Write-Host "    https://learn.microsoft.com/en-us/powershell/scripting/install/installing-powershell-on-windows"
        Write-Host ""
        Write-Host "  Then re-run with the pwsh shell, not the legacy one:"
        Write-Host "    pwsh .\install-nomad-san-docker.ps1"
        Write-Host ""
        exit 1
    }
    Write-NomadSuccess "PowerShell $v"
}

# Check prerequisites
function Test-Prerequisites {
    Write-NomadStep "Checking prerequisites..."

    Assert-PowerShellVersion

    # Check Docker
    try {
        $dockerVersion = docker version --format '{{.Server.Version}}' 2>$null
        if (-not $dockerVersion) {
            throw "Docker not running"
        }
        Write-NomadSuccess "Docker available (v$dockerVersion)"
    } catch {
        Write-NomadFail "Docker Desktop is required but not available"
        Write-Host "Install from: https://docs.docker.com/desktop/install/windows/"
        exit 1
    }

    # Check Docker Compose
    try {
        $composeVersion = docker compose version --short 2>$null
        if (-not $composeVersion) {
            throw "Docker Compose not available"
        }
        Write-NomadSuccess "Docker Compose available (v$composeVersion)"
    } catch {
        Write-NomadFail "Docker Compose v2 is required"
        exit 1
    }

    # Check curl
    if (Get-Command curl.exe -ErrorAction SilentlyContinue) {
        Write-NomadSuccess "curl available"
    } else {
        Write-NomadWarn "curl.exe not found, will fall back to Invoke-WebRequest"
    }

    Write-NomadSuccess "Prerequisites satisfied"
}

# Get latest version from GitHub
function Get-LatestVersion {
    if ($Version -ne "latest") {
        Write-NomadInfo "Using specified version: $Version"
        return $Version
    }

    Write-NomadStep "Fetching latest release version..."
    $apiUrl = "https://api.github.com/repos/$RepoOwner/$RepoName/releases/latest"

    try {
        $response = Invoke-RestMethod -Uri $apiUrl -Method Get -ErrorAction Stop
        $Version = $response.tag_name
        Write-NomadSuccess "Latest version: $Version"
        return $Version
    } catch {
        Write-NomadWarn "Could not fetch latest version, using 'main'"
        return "main"
    }
}

# Download Nomad
function Get-NomadRelease {
    param($version)

    Write-NomadStep "Downloading Nomad $version..."

    $tarballUrl = "https://github.com/$RepoOwner/$RepoName/archive/refs/tags/$version.tar.gz"
    $tempFile = [System.IO.Path]::GetTempFileName() + ".tar.gz"

    try {
        # Try curl first, then Invoke-WebRequest
        if (Get-Command curl -ErrorAction SilentlyContinue) {
            curl -fsSL "$tarballUrl" -o "$tempFile"
        } else {
            Invoke-WebRequest -Uri $tarballUrl -OutFile $tempFile -UseBasicParsing
        }

        if (-not (Test-Path $tempFile) -or (Get-Item $tempFile).Length -eq 0) {
            throw "Download failed"
        }

        Write-NomadSuccess "Downloaded Nomad $version"
        return $tempFile
    } catch {
        Write-NomadFail "Failed to download Nomad $version"
        Write-Host "Error: $_"
        if (Test-Path $tempFile) { Remove-Item $tempFile -Force }
        exit 1
    }
}

# Extract Nomad
function Expand-NomadArchive {
    param($tarball, $destination)

    Write-NomadStep "Extracting to $destination..."

    # Resolve full path
    $destination = Resolve-Path -Path $destination -ErrorAction SilentlyContinue
    if (-not $destination) {
        $destination = Join-Path (Get-Location) $InstallDir
    }

    # Backup existing
    if (Test-Path $destination) {
        Write-NomadWarn "Directory exists: $destination"
        $backupPath = "$destination.backup.$(Get-Date -Format 'yyyyMMdd_HHmmss')"
        Move-Item $destination $backupPath -Force
        Write-NomadInfo "Backed up to $backupPath"
    }

    New-Item -ItemType Directory -Path $destination -Force | Out-Null

    # Extract using tar (available in Windows 10+)
    try {
        $tempExtract = [System.IO.Path]::GetTempPath() + [System.Guid]::NewGuid().ToString()
        New-Item -ItemType Directory -Path $tempExtract -Force | Out-Null

        tar -xzf "$tarball" -C "$tempExtract"

        # Find extracted folder
        $extractedDir = Get-ChildItem $tempExtract | Select-Object -First 1
        if (-not $extractedDir) {
            throw "No folder found after extraction"
        }

        Move-Item "$($extractedDir.FullName)\*" $destination -Force
        Remove-Item $tempExtract -Recurse -Force

        Write-NomadSuccess "Extracted to $destination"
        return $destination
    } catch {
        Write-NomadFail "Failed to extract archive"
        Write-Host "Error: $_"
        exit 1
    }
}

# Generate .env file
function New-EnvironmentFile {
    param($projectDir)

    Write-NomadStep "Generating configuration..."

    $envFile = Join-Path $projectDir ".env"
    $envExample = Join-Path $projectDir ".env.example"

    # Source-of-truth precedence:
    #   1. -EnvFile parameter / $env:NOMAD_ENV_FILE — explicit user override, copy verbatim
    #   2. .env adjacent to the install dir (one level up) — preserve from previous run
    #   3. .env.example bundled in the release
    #   4. fresh empty file
    # The script then layers installer-derived values (paths, ports, image
    # tags) on top via Update-EnvValue, so user-set keys are preserved unless
    # the installer needs to set them deterministically.
    $userEnv = $null
    if ($EnvFile -and (Test-Path $EnvFile)) {
        $userEnv = (Resolve-Path $EnvFile).Path
        Write-NomadInfo "Using user-supplied env file: $userEnv"
    } else {
        $adjacentEnv = Join-Path (Split-Path $projectDir -Parent) ".env"
        if (Test-Path $adjacentEnv) {
            $userEnv = $adjacentEnv
            Write-NomadInfo "Found adjacent .env, preserving user config: $userEnv"
        }
    }

    if ($userEnv) {
        Copy-Item $userEnv $envFile -Force
    } elseif (Test-Path $envExample) {
        Copy-Item $envExample $envFile -Force
    } else {
        New-Item $envFile -ItemType File -Force | Out-Null
    }

    function Update-EnvValue {
        param($key, $value)
        $pattern = "^$key=.*"
        $replacement = "$key=$value"

        if (Get-Content $envFile -Raw | Select-String -Pattern $pattern) {
            (Get-Content $envFile) -replace $pattern, $replacement | Set-Content $envFile
        } elseif (Get-Content $envFile -Raw | Select-String -Pattern "^#.*$key=") {
            (Get-Content $envFile) -replace "^#.*$key=.*", $replacement | Set-Content $envFile
        } else {
            Add-Content $envFile "$key=$value"
        }
    }

    # Detect architecture for FireSTARR image
    $arch = [System.Environment]::Is64BitProcess
    $FirestarrImage = "$FirestarrRegistry/$FirestarrImageName`:$FirestarrImageTag"

    # Core settings
    Update-EnvValue "NOMAD_DEPLOYMENT_MODE" "SAN"
    Update-EnvValue "FIRESTARR_DATASET_PATH" $DatasetPath
    Update-EnvValue "FIRESTARR_EXECUTION_MODE" "docker"
    Update-EnvValue "NOMAD_DATA_PATH" $NomadDataPath

    # Port configuration
    Update-EnvValue "PORT" $NomadPort
    Update-EnvValue "NOMAD_FRONTEND_HOST_PORT" $FrontendPort
    Update-EnvValue "NOMAD_BACKEND_HOST_PORT" $BackendPort
    Update-EnvValue "VITE_API_PORT" $BackendPort
    Update-EnvValue "VITE_API_BASE_URL" "http://${Hostname}:$BackendPort"
    Update-EnvValue "NOMAD_SERVER_HOSTNAME" $Hostname

    # FireSTARR image
    Update-EnvValue "FIRESTARR_IMAGE" $FirestarrImage

    # Auth mode
    Update-EnvValue "NOMAD_AUTH_MODE" "simple"
    Update-EnvValue "VITE_AUTH_MODE" "simple"

    Write-NomadSuccess "Configuration saved to $envFile"
}

# Check dataset
function Test-Dataset {
    Write-NomadStep "Checking FireSTARR dataset..."

    $gridPath = Join-Path $DatasetPath "generated\grid"

    if (Test-Path $gridPath) {
        Write-NomadSuccess "Existing dataset found at $DatasetPath"
        return
    }

    Write-NomadWarn "Dataset not found at $DatasetPath"
    Write-Host ""
    Write-Host "The FireSTARR dataset (about 3 GB per fuel year) is required for fire modeling."
    Write-Host ""

    if (-not $AutoInstallDataset) {
        Write-Host "To auto-download, run with AUTO_INSTALL_DATASET=1:"
        Write-Host "  `$env:AUTO_INSTALL_DATASET = 1; .\install-nomad-san-docker.ps1"
        Write-Host ""
        Write-Host "Or download manually later:"
        Write-Host "  cd $InstallDir; .\scripts\install-firestarr-dataset.sh"
    } else {
        Write-NomadStep "Auto-downloading dataset..."
        Set-Location $InstallDir
        & .\scripts\install-firestarr-dataset.ps1
    }
}

# Setup Docker
function Initialize-DockerEnvironment {
    param($projectDir)

    Write-NomadStep "Setting up Docker environment..."

    Set-Location $projectDir

    # Create sims directory
    New-Item -ItemType Directory -Path $SimsPath -Force | Out-Null

    # Pull FireSTARR image
    Write-NomadStep "Pulling FireSTARR image..."
    docker compose pull firestarr-app 2>$null

    # Build Nomad
    Write-NomadStep "Building Nomad containers..."
    docker compose build
    if ($LASTEXITCODE -ne 0) {
        Write-NomadFail "Docker build failed (exit code $LASTEXITCODE)"
        Write-Host ""
        Write-Host "Common fixes:"
        Write-Host "  - Check Docker Desktop is running"
        Write-Host "  - Check disk space: docker system df"
        Write-Host "  - Clean up: docker system prune -a"
        Write-Host "  - Review build output above for errors"
        Write-Host ""
        $script:BuildFailed = $true
        return
    }

    Write-NomadSuccess "Docker setup complete"
}

# Summary and start
function Show-Summary {
    Write-Host ""
    Write-NomadHeader "════════════════════════════════════════════════════════════"
    Write-NomadHeader "              Installation Summary"
    Write-NomadHeader "════════════════════════════════════════════════════════════"
    Write-Host ""
    Write-Host "  Deployment Mode:   SAN (Stand Alone Nomad)"
    Write-Host "  Infrastructure:      Docker"
    Write-Host "  Install Directory:   $InstallDir"
    Write-Host "  Dataset Path:        $DatasetPath"
    Write-Host "  Access URL:          http://${Hostname}:$FrontendPort"
    Write-Host ""
}

function Wait-NomadHealthy {
    param(
        [string]$projectDir,
        [int]$TimeoutSeconds = 90
    )

    Write-NomadStep "Verifying containers came up healthy..."

    Set-Location $projectDir
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $url = "http://${Hostname}:$FrontendPort"

    while ((Get-Date) -lt $deadline) {
        # Containers must be in Running state with no restarts
        $running = docker compose ps --format json 2>$null |
            ForEach-Object { $_ | ConvertFrom-Json -ErrorAction SilentlyContinue } |
            Where-Object { $_.State -eq 'running' }

        if ($running.Count -gt 0) {
            try {
                $resp = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
                if ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 500) {
                    Write-NomadSuccess "Frontend reachable at $url (HTTP $($resp.StatusCode))"
                    return $true
                }
            } catch {
                # Not reachable yet — keep waiting until deadline
            }
        }
        Start-Sleep -Seconds 3
    }

    Write-NomadFail "Containers did not become healthy within $TimeoutSeconds seconds."
    Write-Host ""
    Write-Host "Diagnose:"
    Write-Host "  cd $projectDir"
    Write-Host "  docker compose ps"
    Write-Host "  docker compose logs --tail=200"
    return $false
}

function Start-Nomad {
    param($projectDir)

    if ($script:BuildFailed) {
        Write-NomadFail "Skipping start — Docker build failed. Fix the errors above and re-run."
        exit 1
    }

    Set-Location $projectDir

    if ($SkipStart) {
        Write-NomadInfo "Skip start requested. To start manually:"
        Write-Host "  cd $projectDir"
        Write-Host "  docker compose up -d"
        return
    }

    Write-NomadStep "Starting Project Nomad..."
    docker compose up -d
    if ($LASTEXITCODE -ne 0) {
        Write-NomadFail "Failed to start containers (exit code $LASTEXITCODE)"
        exit 1
    }

    if (-not (Wait-NomadHealthy -projectDir $projectDir)) {
        exit 1
    }

    Write-NomadSuccess "Project Nomad is up."
    Write-Host ""
    Write-Host "Access Nomad at: http://${Hostname}:$FrontendPort"
    Write-Host ""
    Write-Host "View logs: docker compose logs -f"
    Write-Host "Stop:      docker compose down"
}

# Main
function Main {
    $script:BuildFailed = $false

    Show-Header

    Test-Prerequisites

    $version = Get-LatestVersion
    $tarball = Get-NomadRelease -version $version
    $projectDir = Expand-NomadArchive -tarball $tarball -destination $InstallDir
    Remove-Item $tarball -Force

    New-EnvironmentFile -projectDir $projectDir
    Test-Dataset
    Initialize-DockerEnvironment -projectDir $projectDir
    Show-Summary
    Start-Nomad -projectDir $projectDir
}

# Run main
Main
