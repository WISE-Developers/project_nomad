#!/usr/bin/env pwsh
#
# Project Nomad - SAN Bare-Metal Installer (Windows)
# Installs Nomad without Docker. FireSTARR runs as a native binary,
# Node runs the backend, and the frontend is served by the same Node
# process via the production build.
#
# REQUIRES PowerShell 7.6 or newer. Run with `pwsh`, not `powershell`.
#   winget install --id Microsoft.PowerShell -e --accept-source-agreements --accept-package-agreements
#
# Usage:
#   pwsh .\install-nomad-san-metal.ps1
#
#   Streamed:
#   pwsh -NoExit -Command "iwr -Uri https://raw.githubusercontent.com/WISE-Developers/project_nomad/dev/scripts/install-nomad-san-metal.ps1 -UseBasicParsing | iex"
#
# By default the installer runs INTERACTIVE — it prompts for install
# directory, dataset path, server port, and hostname, with sensible
# defaults you can accept by pressing Enter. Pass -NonInteractive (or
# set NOMAD_NONINTERACTIVE=1) to silently use the defaults.
#
# Parameters / matching env vars (defaults shown). Anything you supply
# up front skips the matching prompt:
#   -InstallDir            $env:INSTALL_DIR              .\project_nomad
#   -DatasetPath           $env:FIRESTARR_DATASET_PATH   $env:USERPROFILE\firestarr_data
#   -ServerPort            $env:NOMAD_PORT               4901    (one port serves frontend + API)
#   -ServerHostname        $env:NOMAD_SERVER_HOSTNAME    localhost
#   -Version               $env:VERSION                  latest  (Nomad release tag)
#   -FirestarrTag          $env:FIRESTARR_BINARY_TAG     unstable-latest
#   -EnvFile               $env:NOMAD_ENV_FILE           (none)
#   -NonInteractive        $env:NOMAD_NONINTERACTIVE     $false
#   -SkipStart             $env:SKIP_START               $false
#   -SkipNodeInstall       $env:SKIP_NODE_INSTALL        $false
#   -SkipGdalInstall       $env:SKIP_GDAL_INSTALL        $false
#

param(
    [string]$InstallDir = $env:INSTALL_DIR,
    [string]$DatasetPath = $env:FIRESTARR_DATASET_PATH,
    [string]$Version = $env:VERSION,
    [string]$FirestarrTag = $env:FIRESTARR_BINARY_TAG,
    [string]$EnvFile = $env:NOMAD_ENV_FILE,
    [int]$ServerPort = $(if ($env:NOMAD_PORT) { [int]$env:NOMAD_PORT } else { 0 }),
    [string]$ServerHostname = $env:NOMAD_SERVER_HOSTNAME,
    [switch]$NonInteractive = [bool]$env:NOMAD_NONINTERACTIVE,
    [switch]$SkipStart = [bool]$env:SKIP_START,
    [switch]$SkipNodeInstall = [bool]$env:SKIP_NODE_INSTALL,
    [switch]$SkipGdalInstall = [bool]$env:SKIP_GDAL_INSTALL
)

$InstallerVersion = "0.2.3"
$RequiredPSMajor = 7
$RequiredPSMinor = 6
$RequiredNodeMajor = 20
$RepoOwner = "WISE-Developers"
$RepoName = "project_nomad"
$FirestarrRepo = "CWFMF/firestarr-cpp"
$FirestarrAsset = "firestarr-windows-x64-cl-Release.zip"
$OSGeo4WSetupUrl = "https://download.osgeo.org/osgeo4w/v2/osgeo4w-setup.exe"
$OSGeo4WInstallDir = "C:\OSGeo4W"

# Defaults applied later only if the user didn't override and didn't enter
# a value at the prompt. We don't bake them in at param-time so the prompt
# can show the default cleanly.
$DefaultInstallDir   = ".\project_nomad"
$DefaultDatasetPath  = "$env:USERPROFILE\firestarr_data"
$DefaultServerPort   = 4901
$DefaultHostname     = "localhost"
$DefaultFirestarrTag = "unstable-latest"
$DefaultVersion      = "latest"

# Apply non-interactive defaults eagerly so downstream code is never handed
# an empty value. -Version is not prompted because most users want "latest";
# pass -Version dev to pull dev-branch HEAD instead.
if (-not $Version) { $Version = $DefaultVersion }
if (-not $FirestarrTag) { $FirestarrTag = $DefaultFirestarrTag }

# Force UTF-8 console output so glyphs render on default Windows codepages.
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

# Status helpers prefixed so they don't shadow built-in cmdlets.
function Write-NomadHeader  { param($text) Write-Host $text -ForegroundColor Cyan }
function Write-NomadStep    { param($text) Write-Host "▶ $text" -ForegroundColor Green }
function Write-NomadWarn    { param($text) Write-Host "⚠ $text" -ForegroundColor Yellow }
function Write-NomadFail    { param($text) Write-Host "✖ $text" -ForegroundColor Red }
function Write-NomadSuccess { param($text) Write-Host "✔ $text" -ForegroundColor Green }
function Write-NomadInfo    { param($text) Write-Host "ℹ $text" -ForegroundColor Blue }

# Read a value from the user with a default. In -NonInteractive mode the
# default is returned silently. If the caller already passed a value (via
# parameter or env var), that wins and the prompt is skipped.
function Read-NomadValue {
    param(
        [string]$Prompt,
        [string]$Default,
        [string]$Existing
    )
    if ($Existing) { return $Existing }
    if ($NonInteractive) { return $Default }
    $entered = Read-Host -Prompt "$Prompt [$Default]"
    if ([string]::IsNullOrWhiteSpace($entered)) { return $Default }
    return $entered
}

function Read-NomadInt {
    param(
        [string]$Prompt,
        [int]$Default,
        [int]$Existing
    )
    if ($Existing -gt 0) { return $Existing }
    if ($NonInteractive) { return $Default }
    while ($true) {
        $entered = Read-Host -Prompt "$Prompt [$Default]"
        if ([string]::IsNullOrWhiteSpace($entered)) { return $Default }
        $parsed = 0
        if ([int]::TryParse($entered, [ref]$parsed) -and $parsed -gt 0 -and $parsed -lt 65536) {
            return $parsed
        }
        Write-NomadWarn "  Enter a TCP port between 1 and 65535, or press Enter for the default."
    }
}

# Resolve all user-config values, prompting interactively where the user
# hasn't supplied a parameter / env var. Sets script-scoped variables
# the rest of the installer reads.
function Get-UserConfig {
    Write-Host ""
    Write-NomadHeader "── Configuration ──────────────────────────────────────────"
    Write-Host "Press Enter to accept the default shown in [brackets]."
    Write-Host ""

    $script:InstallDir    = Read-NomadValue -Prompt "Install directory" -Default $DefaultInstallDir   -Existing $InstallDir
    $script:DatasetPath   = Read-NomadValue -Prompt "FireSTARR dataset path"  -Default $DefaultDatasetPath  -Existing $DatasetPath
    $script:ServerPort    = Read-NomadInt   -Prompt "Server port (one port serves frontend + API in bare-metal)" -Default $DefaultServerPort -Existing $ServerPort
    $script:ServerHostname = Read-NomadValue -Prompt "Server hostname" -Default $DefaultHostname -Existing $ServerHostname

    # Home time zone (#332). IANA zone used to stamp local timestamps in the
    # usage log. The backend is fail-fast on this: it will not start if the key
    # is missing or invalid, because the container's own clock is UTC and a
    # fallback would record every local time silently wrong.
    $script:HomeTimezone = Read-NomadValue -Prompt "Home time zone (IANA, e.g. America/Edmonton)" `
        -Default "America/Edmonton" -Existing $env:NOMAD_HOME_TIMEZONE

    # Validate here, so a typo fails next to the mistake rather than at first boot.
    if ($script:HomeTimezone -match '^[+-]') {
        throw "NOMAD_HOME_TIMEZONE is '$($script:HomeTimezone)', a fixed UTC offset. A fixed offset cannot observe DST. Use an IANA zone name, for example America/Edmonton."
    }
    if ($script:HomeTimezone -notmatch '/') {
        throw "NOMAD_HOME_TIMEZONE is '$($script:HomeTimezone)', which is not an IANA zone name. Expected Area/Location, for example America/Edmonton."
    }

    if (-not $FirestarrTag) { $script:FirestarrTag = $DefaultFirestarrTag }

    # Derived values
    $script:NomadDataPath = if ($env:NOMAD_DATA_PATH)  { $env:NOMAD_DATA_PATH }  else { $script:DatasetPath }
    $script:SimsPath      = if ($env:SIMS_OUTPUT_PATH) { $env:SIMS_OUTPUT_PATH } else { (Join-Path $script:DatasetPath "sims") }

    Write-Host ""
    Write-NomadInfo "Configuration:"
    Write-Host "  Install directory:    $($script:InstallDir)"
    Write-Host "  Dataset path:         $($script:DatasetPath)"
    Write-Host "  Server port:          $($script:ServerPort)"
    Write-Host "  Hostname:             $($script:ServerHostname)"
    Write-Host "  Access URL:           http://$($script:ServerHostname):$($script:ServerPort)/"
    Write-Host ""
    if (-not $NonInteractive) {
        $confirm = Read-Host -Prompt "Proceed with this configuration? [Y/n]"
        if ($confirm -match '^(n|no)$') {
            Write-NomadInfo "Cancelled by user."
            exit 0
        }
    }
}

function Show-Header {
    Write-Host ""
    Write-NomadHeader "╔════════════════════════════════════════════════════════════╗"
    Write-NomadHeader "║   Project Nomad - SAN Bare-Metal Installer v$InstallerVersion        ║"
    Write-NomadHeader "║              No Docker required                            ║"
    Write-NomadHeader "╚════════════════════════════════════════════════════════════╝"
    Write-Host ""
}

function Assert-PowerShellVersion {
    $v = $PSVersionTable.PSVersion
    $tooOld = ($v.Major -lt $RequiredPSMajor) -or
              ($v.Major -eq $RequiredPSMajor -and $v.Minor -lt $RequiredPSMinor)
    if ($tooOld) {
        Write-NomadFail "PowerShell $v detected. PowerShell $RequiredPSMajor.$RequiredPSMinor+ is required."
        Write-Host ""
        Write-Host "  winget install --id Microsoft.PowerShell -e --accept-source-agreements --accept-package-agreements"
        Write-Host "  Then re-run with: pwsh .\install-nomad-san-metal.ps1"
        Write-Host ""
        exit 1
    }
    Write-NomadSuccess "PowerShell $v"
}

function Assert-Architecture {
    $arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture
    if ($arch -ne 'X64') {
        Write-NomadFail "Detected $arch architecture. The bare-metal Windows installer ships an x64 FireSTARR binary only."
        Write-Host "  ARM64 Windows is not supported in this release. Use the Docker installer or run x64 Windows."
        exit 1
    }
    Write-NomadSuccess "Architecture: $arch"
}

# Add a directory to the current process PATH (idempotent).
function Add-ToPath {
    param($dir)
    if (-not (Test-Path $dir)) { return }
    $resolved = (Resolve-Path $dir).Path
    $existing = $env:Path -split ';'
    if ($existing -notcontains $resolved) {
        $env:Path = "$resolved;$env:Path"
    }
}

function Install-NodeIfMissing {
    if ($SkipNodeInstall) {
        Write-NomadInfo "Skipping Node install per -SkipNodeInstall."
        return
    }

    $node = Get-Command node -ErrorAction SilentlyContinue
    if ($node) {
        $nodeVer = (& node --version) -replace '^v', ''
        $major = [int]($nodeVer.Split('.')[0])
        if ($major -ge $RequiredNodeMajor) {
            Write-NomadSuccess "Node $nodeVer (>= $RequiredNodeMajor)"
            return
        }
        Write-NomadWarn "Node $nodeVer detected; need >= $RequiredNodeMajor. Upgrading."
    } else {
        Write-NomadStep "Installing Node.js 22 LTS via winget..."
    }

    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        Write-NomadFail "winget not available. Install Node.js 22 LTS manually from https://nodejs.org/ and re-run."
        exit 1
    }

    & winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements --silent
    if ($LASTEXITCODE -ne 0) {
        Write-NomadFail "winget failed to install Node (exit $LASTEXITCODE). Install manually and re-run with -SkipNodeInstall."
        exit 1
    }

    # winget updates the persistent PATH but not the current session's. Refresh.
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
                [System.Environment]::GetEnvironmentVariable("Path", "User")

    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        Write-NomadFail "Node still not on PATH after install. Restart the shell and re-run."
        exit 1
    }
    Write-NomadSuccess "Node $((& node --version))"
}

# Locate GDAL_DATA and PROJ data directories. firestarr.exe and the
# Node backend's gdal-async bindings both initialize PROJ at startup; if
# proj.db cannot be found, PROJ_LIB/PROJ_DATA falls through and the
# binary crashes hard (Windows status 0xC0000409).
function Get-GdalDataPaths {
    $candidates = @(
        Join-Path $OSGeo4WInstallDir "share"
    )
    # If gdalinfo is on PATH from a non-OSGeo4W install, look near its exe.
    $gdalCmd = Get-Command gdalinfo -ErrorAction SilentlyContinue
    if ($gdalCmd) {
        $exeDir = Split-Path -Parent $gdalCmd.Source
        $candidates += @(
            (Join-Path (Split-Path -Parent $exeDir) "share"),
            (Join-Path $exeDir "..\share"),
            (Join-Path $exeDir "..\..\share")
        )
    }

    $gdalData = $null
    $projData = $null
    foreach ($base in $candidates) {
        if (-not (Test-Path $base)) { continue }
        $g = Join-Path $base "gdal"
        $p = Join-Path $base "proj"
        # GDAL: marker files vary by version (gdalvrt.xsd, header.dxf, gt_datum.csv,
        # pcs.csv all appear in different builds). Treat the directory as valid if
        # it exists and contains any file.
        if (-not $gdalData -and (Test-Path $g) -and
            (Get-ChildItem -Path $g -File -ErrorAction SilentlyContinue | Select-Object -First 1)) {
            $gdalData = (Resolve-Path $g).Path
        }
        if (-not $projData -and (Test-Path (Join-Path $p "proj.db"))) { $projData = (Resolve-Path $p).Path }
    }

    return @{ GdalData = $gdalData; ProjData = $projData }
}

function Install-GdalIfMissing {
    if ($SkipGdalInstall) {
        Write-NomadInfo "Skipping GDAL install per -SkipGdalInstall. Backend will fail at runtime if gdalinfo is not on PATH."
        return
    }

    if (Get-Command gdalinfo -ErrorAction SilentlyContinue) {
        $ver = (& gdalinfo --version) 2>&1 | Select-Object -First 1
        Write-NomadSuccess "GDAL CLI present: $ver"
        return
    }

    # Check OSGeo4W bin even if not on PATH yet
    $osgeoBin = Join-Path $OSGeo4WInstallDir "bin"
    if (Test-Path (Join-Path $osgeoBin "gdalinfo.exe")) {
        Add-ToPath $osgeoBin
        Write-NomadSuccess "GDAL found at $osgeoBin (added to session PATH)"
        return
    }

    Write-NomadStep "Installing GDAL via OSGeo4W (this is ~200 MB and may take several minutes)..."
    $setupExe = Join-Path $env:TEMP "osgeo4w-setup.exe"
    Invoke-WebRequest -Uri $OSGeo4WSetupUrl -OutFile $setupExe -UseBasicParsing
    if (-not (Test-Path $setupExe)) {
        Write-NomadFail "Failed to download OSGeo4W setup."
        exit 1
    }

    # OSGeo4W silent install: -A advanced, -k keep, -q quiet, -P package, -s site
    $args = @(
        "-A", "-k", "-q",
        "-P", "gdal",
        "-s", "https://download.osgeo.org/osgeo4w/v2/",
        "-R", $OSGeo4WInstallDir
    )
    & $setupExe @args | Out-Null

    if (-not (Test-Path (Join-Path $osgeoBin "gdalinfo.exe"))) {
        Write-NomadFail "OSGeo4W install completed but gdalinfo.exe is not at $osgeoBin"
        Write-Host "  Try the OSGeo4W GUI installer manually: $setupExe"
        exit 1
    }

    Add-ToPath $osgeoBin
    # Persist for future sessions too
    $userPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
    if ($userPath -notlike "*$osgeoBin*") {
        [System.Environment]::SetEnvironmentVariable("Path", "$userPath;$osgeoBin", "User")
    }
    $ver = (& gdalinfo --version) 2>&1 | Select-Object -First 1
    Write-NomadSuccess "GDAL CLI installed: $ver"
}

function Test-Prerequisites {
    Write-NomadStep "Checking prerequisites..."
    Assert-PowerShellVersion
    Assert-Architecture
    Install-NodeIfMissing
    Install-GdalIfMissing
    Write-NomadSuccess "Prerequisites satisfied"
}

function Get-LatestNomadVersion {
    if ($Version -ne "latest") {
        Write-NomadInfo "Using specified Nomad version: $Version"
        return $Version
    }
    Write-NomadStep "Fetching latest Nomad release..."
    try {
        $r = Invoke-RestMethod -Uri "https://api.github.com/repos/$RepoOwner/$RepoName/releases/latest" -ErrorAction Stop
        Write-NomadSuccess "Latest Nomad: $($r.tag_name)"
        return $r.tag_name
    } catch {
        Write-NomadWarn "Could not fetch latest tag; falling back to 'main'"
        return "main"
    }
}

function Get-NomadRelease {
    param($version)
    Write-NomadStep "Downloading Nomad $version source..."
    # GitHub's `/archive/<ref>.tar.gz` accepts tags, branches, and commits.
    # That lets users pass -Version dev / -Version main to pull a branch
    # head without us needing branch-vs-tag detection logic.
    $url = "https://github.com/$RepoOwner/$RepoName/archive/$version.tar.gz"
    $tmp = [System.IO.Path]::GetTempFileName() + ".tar.gz"
    Invoke-WebRequest -Uri $url -OutFile $tmp -UseBasicParsing
    if (-not (Test-Path $tmp) -or (Get-Item $tmp).Length -eq 0) {
        Write-NomadFail "Failed to download Nomad $version"
        exit 1
    }
    Write-NomadSuccess "Downloaded Nomad $version"
    return $tmp
}

function Expand-NomadArchive {
    param($tarball, $destination)
    Write-NomadStep "Extracting Nomad to $destination..."
    if (Test-Path $destination) {
        $bk = "$destination.backup.$(Get-Date -Format 'yyyyMMdd_HHmmss')"
        Move-Item $destination $bk -Force
        Write-NomadInfo "Backed up existing install to $bk"
    }
    New-Item -ItemType Directory -Path $destination -Force | Out-Null
    $tmp = Join-Path $env:TEMP ([System.Guid]::NewGuid().ToString())
    New-Item -ItemType Directory -Path $tmp -Force | Out-Null
    & tar -xzf $tarball -C $tmp
    $inner = Get-ChildItem $tmp | Select-Object -First 1
    if (-not $inner) {
        Write-NomadFail "Tarball was empty"
        exit 1
    }
    Move-Item "$($inner.FullName)\*" $destination -Force
    Remove-Item $tmp -Recurse -Force
    Write-NomadSuccess "Extracted to $destination"
    return (Resolve-Path $destination).Path
}

function Get-FirestarrBinary {
    param($installRoot)
    Write-NomadStep "Downloading FireSTARR Windows binary ($FirestarrTag)..."
    $url = "https://github.com/$FirestarrRepo/releases/download/$FirestarrTag/$FirestarrAsset"
    $zip = Join-Path $env:TEMP $FirestarrAsset
    Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
    if (-not (Test-Path $zip) -or (Get-Item $zip).Length -eq 0) {
        Write-NomadFail "Failed to download $url"
        exit 1
    }
    $dest = Join-Path $installRoot "firestarr"
    if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
    Expand-Archive -Path $zip -DestinationPath $dest -Force
    Remove-Item $zip -Force

    # Locate the executable inside the extracted tree.
    $exe = Get-ChildItem $dest -Recurse -Filter "firestarr.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $exe) {
        Write-NomadFail "Could not find firestarr.exe inside the extracted archive at $dest"
        exit 1
    }
    Write-NomadSuccess "FireSTARR binary at $($exe.FullName)"
    return $exe.FullName
}

function New-EnvironmentFile {
    param($projectDir, $firestarrBinary)
    Write-NomadStep "Generating .env..."
    $envFile = Join-Path $projectDir ".env"
    $envExample = Join-Path $projectDir ".env.example"

    $userEnv = $null
    if ($EnvFile -and (Test-Path $EnvFile)) {
        $userEnv = (Resolve-Path $EnvFile).Path
        Write-NomadInfo "Using user-supplied env file: $userEnv"
    } else {
        $adjacent = Join-Path (Split-Path $projectDir -Parent) ".env"
        if (Test-Path $adjacent) {
            $userEnv = $adjacent
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
        param($k, $v)
        $pattern = "^$k=.*"
        $line = "$k=$v"
        $content = Get-Content $envFile -Raw
        if ($content -match $pattern) {
            (Get-Content $envFile) -replace $pattern, $line | Set-Content $envFile
        } elseif ($content -match "^#.*$k=") {
            (Get-Content $envFile) -replace "^#.*$k=.*", $line | Set-Content $envFile
        } else {
            Add-Content $envFile $line
        }
    }

    Update-EnvValue "NOMAD_DEPLOYMENT_MODE"      "SAN"
    Update-EnvValue "NOMAD_HOME_TIMEZONE"        $script:HomeTimezone
    Update-EnvValue "FIRESTARR_DATASET_PATH"     $DatasetPath
    Update-EnvValue "FIRESTARR_EXECUTION_MODE"   "binary"
    Update-EnvValue "FIRESTARR_BINARY_PATH"      $firestarrBinary
    Update-EnvValue "NOMAD_DATA_PATH"            $NomadDataPath
    Update-EnvValue "SIMS_OUTPUT_PATH"           $SimsPath
    # Bare-metal: one Node process serves both the API and the built
    # frontend on a single port. There is no separate frontend host port.
    Update-EnvValue "PORT"                       $ServerPort
    Update-EnvValue "NOMAD_BACKEND_HOST_PORT"    $ServerPort
    Update-EnvValue "VITE_API_PORT"              $ServerPort
    Update-EnvValue "VITE_API_BASE_URL"          "http://${ServerHostname}:$ServerPort"
    Update-EnvValue "NOMAD_SERVER_HOSTNAME"      $ServerHostname
    Update-EnvValue "NOMAD_AUTH_MODE"            "simple"
    Update-EnvValue "VITE_AUTH_MODE"             "simple"

    # GDAL/PROJ data dirs. The Node backend inherits these via process.env
    # and passes them to firestarr.exe on spawn; without PROJ_DATA pointing
    # at proj.db the FireSTARR binary fast-fails with Windows status
    # 0xC0000409 right after start (PROJ init failure).
    $paths = Get-GdalDataPaths
    if ($paths.GdalData) {
        Update-EnvValue "GDAL_DATA" $paths.GdalData
        Write-NomadInfo "GDAL_DATA -> $($paths.GdalData)"
    } else {
        Write-NomadWarn "Could not locate GDAL data directory. Set GDAL_DATA in .env manually if backend errors at startup."
    }
    if ($paths.ProjData) {
        # PROJ_DATA is the modern name (PROJ 9+); PROJ_LIB is the legacy
        # alias still respected by older builds. Set both to be safe.
        Update-EnvValue "PROJ_DATA" $paths.ProjData
        Update-EnvValue "PROJ_LIB"  $paths.ProjData
        Write-NomadInfo "PROJ_DATA -> $($paths.ProjData)"
    } else {
        Write-NomadWarn "Could not locate PROJ data directory (proj.db). Set PROJ_DATA in .env manually — firestarr.exe will crash without it."
    }

    Write-NomadSuccess ".env written to $envFile"
}

function Install-NomadDependencies {
    param($projectDir)
    Write-NomadStep "Installing Node dependencies (this can take 5-10 minutes)..."
    Push-Location $projectDir
    try {
        $env:NODE_ENV = "development"
        & npm install --include=dev --workspaces --include-workspace-root
        if ($LASTEXITCODE -ne 0) {
            Write-NomadFail "npm install failed (exit $LASTEXITCODE)"
            Write-Host ""
            Write-Host "Common Windows causes:"
            Write-Host "  - Native modules (better-sqlite3, gdal-async) failed to download a prebuilt binary"
            Write-Host "    for your Node ABI; npm fell back to source compile and you don't have MSVC build tools."
            Write-Host "    Install with: winget install Microsoft.VisualStudio.2022.BuildTools --override `"--add Microsoft.VisualStudio.Workload.VCTools --includeRecommended`""
            Write-Host "  - PATH too long; move install dir closer to drive root."
            exit 1
        }
        & npm rebuild
        & npm run build --workspaces
        if ($LASTEXITCODE -ne 0) {
            Write-NomadFail "npm run build failed (exit $LASTEXITCODE)"
            exit 1
        }
    } finally {
        Pop-Location
    }
    Write-NomadSuccess "Dependencies installed and built"
}

function Test-Dataset {
    Write-NomadStep "Checking FireSTARR dataset..."
    $grid = Join-Path $DatasetPath "generated\grid"
    if (Test-Path $grid) {
        Write-NomadSuccess "Dataset present at $DatasetPath"
        return
    }
    Write-NomadWarn "Dataset not found at $DatasetPath (about 3 GB per fuel year required for real fire modeling)."
    Write-Host "  Acquire it via your usual FireSTARR dataset distribution channel and place it at:"
    Write-Host "    $DatasetPath"
    Write-Host "  Until then, only the test mode (synthetic fuel grids) will work."
}

function Wait-NomadHealthy {
    param([int]$TimeoutSeconds = 90)
    Write-NomadStep "Verifying backend came up healthy..."
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $url = "http://${ServerHostname}:$ServerPort/api/v1/health"
    while ((Get-Date) -lt $deadline) {
        try {
            $resp = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
            if ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 500) {
                Write-NomadSuccess "Backend reachable at $url (HTTP $($resp.StatusCode))"
                return $true
            }
        } catch { }
        Start-Sleep -Seconds 3
    }
    Write-NomadFail "Backend did not respond on $url within $TimeoutSeconds seconds."
    Write-Host "  Inspect the npm-start window for stack traces."
    return $false
}

function Start-Nomad {
    param($projectDir)
    if ($SkipStart) {
        Write-NomadInfo "Skip start requested. To launch manually:"
        Write-Host "  cd $projectDir"
        Write-Host "  npm start"
        return
    }

    Write-NomadStep "Starting Nomad backend in a new window..."
    # Foreground server in its own pwsh window so this installer can do
    # a health check without blocking. TODO: install as a Windows Service
    # via NSSM for production deployments.
    $startCmd = "Set-Location '$projectDir'; npm start"
    Start-Process -FilePath "pwsh" -ArgumentList "-NoExit", "-Command", $startCmd -WorkingDirectory $projectDir | Out-Null

    if (-not (Wait-NomadHealthy)) {
        exit 1
    }

    Write-NomadSuccess "Project Nomad is up."
    Write-Host ""
    Write-Host "Access Nomad at: http://${ServerHostname}:$ServerPort/"
    Write-Host ""
    Write-Host "The server is running in a separate pwsh window — close that window to stop."
}

function Show-Summary {
    param($projectDir, $firestarrBinary)
    Write-Host ""
    Write-NomadHeader "════════════════════════════════════════════════════════════"
    Write-NomadHeader "              Installation Summary"
    Write-NomadHeader "════════════════════════════════════════════════════════════"
    Write-Host ""
    Write-Host "  Deployment Mode:    SAN bare-metal (no Docker)"
    Write-Host "  Install Directory:  $projectDir"
    Write-Host "  FireSTARR Binary:   $firestarrBinary"
    Write-Host "  Dataset Path:       $DatasetPath"
    Write-Host "  Access URL:         http://${ServerHostname}:$ServerPort/"
    Write-Host ""
}

function Main {
    Show-Header
    Test-Prerequisites
    Get-UserConfig
    $version = Get-LatestNomadVersion
    $tarball = Get-NomadRelease -version $version
    $projectDir = Expand-NomadArchive -tarball $tarball -destination $InstallDir
    Remove-Item $tarball -Force
    $firestarrBinary = Get-FirestarrBinary -installRoot $projectDir
    New-EnvironmentFile -projectDir $projectDir -firestarrBinary $firestarrBinary
    Install-NomadDependencies -projectDir $projectDir
    Test-Dataset
    Show-Summary -projectDir $projectDir -firestarrBinary $firestarrBinary
    Start-Nomad -projectDir $projectDir
}

Main
