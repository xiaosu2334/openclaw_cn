# OpenClaw CN 魔改版 Windows 安装脚本
# GitHub: https://github.com/xiaosu2334/openclaw_cn (cn-main 分支)
#
# 用法:
#   powershell -c "irm https://raw.githubusercontent.com/xiaosu2334/openclaw_cn/cn-main/scripts/install-cn.ps1 | iex"
#   powershell -c "& ([scriptblock]::Create((irm https://raw.githubusercontent.com/xiaosu2334/openclaw_cn/cn-main/scripts/install-cn.ps1))) -Branch cn-main -NoOnboard -DryRun"

param(
    [string]$Branch = "cn-main",
    [string]$GitDir,
    [switch]$NoOnboard,
    [switch]$NoGitUpdate,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$script:InstallExitCode = 0
$RepoUrl = "https://github.com/xiaosu2334/openclaw_cn.git"
$PackageName = "openclaw-cn"
$WrapperName = "openclaw-cn.cmd"

function Fail-Install { param([int]$Code = 1); $script:InstallExitCode = $Code; return $false }

function Complete-Install {
    param([bool]$Succeeded)
    if ($Succeeded) { return }
    if ($PSCommandPath) { exit $script:InstallExitCode }
    throw "OpenClaw CN 安装失败，错误码 $($script:InstallExitCode)。"
}

function Remove-MatchingQuotes {
    param([string]$Value)
    if ([string]::IsNullOrEmpty($Value) -or $Value.Length -lt 2) { return $Value }
    $first = $Value[0]; $last = $Value[$Value.Length - 1]
    if (($first -eq '"' -and $last -eq '"') -or ($first -eq "'" -and $last -eq "'")) {
        return $Value.Substring(1, $Value.Length - 2)
    }
    return $Value
}

function Resolve-NodeOptionsWithMinOldSpace {
    param([string]$NodeOptions, [int]$MinOldSpaceMb = 8192)
    $parts = @($NodeOptions -split '\s+' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    $resolved = New-Object System.Collections.Generic.List[string]
    $foundOldSpace = $false
    for ($index = 0; $index -lt $parts.Count; $index++) {
        $part = $parts[$index]
        $normalizedPart = Remove-MatchingQuotes -Value $part
        if ($normalizedPart -match '^--max[-_]old[-_]space[-_]size=(?<value>.+)$') {
            $parsed = 0; $parsedValue = Remove-MatchingQuotes -Value $Matches["value"]
            if (-not [int]::TryParse($parsedValue, [ref]$parsed)) { $parsed = $MinOldSpaceMb }
            $foundOldSpace = $true
            $value = [Math]::Max($parsed, $MinOldSpaceMb)
            $resolved.Add("--max-old-space-size=$value"); continue
        }
        if ($normalizedPart -match '^--max[-_]old[-_]space[-_]size$') {
            $foundOldSpace = $true
            $next = if ($index + 1 -lt $parts.Count) { $parts[$index + 1] } else { $null }
            $parsed = 0; $parsedNext = Remove-MatchingQuotes -Value $next
            if (-not [int]::TryParse($parsedNext, [ref]$parsed)) { $parsed = $MinOldSpaceMb }
            $value = [Math]::Max($parsed, $MinOldSpaceMb)
            $resolved.Add("--max-old-space-size=$value")
            if ($next) { $index += 1 }; continue
        }
        $resolved.Add($part)
    }
    if (-not $foundOldSpace) { $resolved.Add("--max-old-space-size=$MinOldSpaceMb") }
    return ($resolved -join " ")
}

Write-Host ""
Write-Host "  OpenClaw CN 魔改版 安装向导" -ForegroundColor Cyan
Write-Host "  仓库: $RepoUrl" -ForegroundColor DarkGray
Write-Host "  分支: $Branch" -ForegroundColor DarkGray
Write-Host ""

# PowerShell version check
if ($PSVersionTable.PSVersion.Major -lt 5) {
    Write-Host "错误: 需要 PowerShell 5+" -ForegroundColor Red
    Complete-Install -Succeeded:$false; return
}
Write-Host "[OK] Windows 环境已就绪" -ForegroundColor Green

# Default GitDir
if (-not $PSBoundParameters.ContainsKey("GitDir")) {
    if (-not [string]::IsNullOrWhiteSpace($env:OPENCLAW_GIT_DIR)) { $GitDir = $env:OPENCLAW_GIT_DIR }
}
if ([string]::IsNullOrWhiteSpace($GitDir)) {
    $GitDir = Join-Path ([Environment]::GetFolderPath("UserProfile")) "openclaw-cn"
}

# ─── Node.js ──────────────────────────────────────────
function Check-Node {
    try {
        $nodeVersion = (node -v 2>$null)
        if ($nodeVersion) {
            $versionMatch = [regex]::Match($nodeVersion, '^v(?<major>\d+)\.(?<minor>\d+)\.')
            $major = if ($versionMatch.Success) { [int]$versionMatch.Groups["major"].Value } else { 0 }
            $minor = if ($versionMatch.Success) { [int]$versionMatch.Groups["minor"].Value } else { 0 }
            if (($major -gt 22) -or (($major -eq 22) -and ($minor -ge 19))) {
                Write-Host "[OK] Node.js $nodeVersion" -ForegroundColor Green; return $true
            }
            Write-Host "[!] Node.js $nodeVersion 但需要 v22.19+" -ForegroundColor Yellow; return $false
        }
    } catch { Write-Host "[!] Node.js 未找到" -ForegroundColor Yellow }
    return $false
}

function Install-Node {
    Write-Host "[*] 正在安装 Node.js..." -ForegroundColor Yellow
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        winget install OpenJS.NodeJS.LTS --source winget --accept-package-agreements --accept-source-agreements
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
        if (Check-Node) { Write-Host "[OK] Node.js 已通过 winget 安装" -ForegroundColor Green; return $true }
    }
    if (Get-Command choco -ErrorAction SilentlyContinue) {
        choco install nodejs-lts -y
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
        Write-Host "[OK] Node.js 已通过 Chocolatey 安装" -ForegroundColor Green; return $true
    }
    Write-Host "错误: 请手动安装 Node.js 22+:" -ForegroundColor Red
    Write-Host "  https://nodejs.org" -ForegroundColor Cyan
    return $false
}

# ─── Git ──────────────────────────────────────────────
function Check-Git {
    try { $null = Get-Command git -ErrorAction Stop; return $true } catch { return $false }
}

function Ensure-Git {
    if (Check-Git) { return $true }
    Write-Host ""
    Write-Host "错误: 需要 Git 来安装 OpenClaw CN。" -ForegroundColor Red
    Write-Host "请安装 Git for Windows 后重新运行此安装脚本:" -ForegroundColor Yellow
    Write-Host "  https://git-scm.com/download/win" -ForegroundColor Cyan
    return $false
}

# ─── pnpm ─────────────────────────────────────────────
function Get-PnpmCommandPath {
    return (Get-Command pnpm.cmd -ErrorAction SilentlyContinue) ?? (Get-Command pnpm -ErrorAction SilentlyContinue) ?? $null
}

function Ensure-Pnpm {
    param([string]$RepoDir)
    $pnpmCommand = Get-PnpmCommandPath
    if ($pnpmCommand) {
        Write-Host "[OK] pnpm 已就绪" -ForegroundColor Green; return
    }
    Write-Host "[*] 正在安装 pnpm..." -ForegroundColor Yellow
    npm install -g pnpm
    if ($LASTEXITCODE -ne 0) {
        throw "pnpm 安装失败"
    }
    Write-Host "[OK] pnpm 安装完成" -ForegroundColor Green
}

# ─── PATH 管理 ────────────────────────────────────────
function Add-ToUserPath {
    param([string]$PathEntry)
    if ([string]::IsNullOrWhiteSpace($PathEntry)) { return $false }
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if ($userPath -like "*$PathEntry*") { return $false }
    $newUserPath = if ([string]::IsNullOrWhiteSpace($userPath)) { $PathEntry } else { "$userPath;$PathEntry" }
    [Environment]::SetEnvironmentVariable("Path", $newUserPath, "User")
    $env:Path = "$PathEntry;$env:Path"
    return $true
}

# ─── Git 安装 ─────────────────────────────────────────
function Install-OpenClawFromGit {
    param([string]$RepoDir, [switch]$SkipUpdate)

    if (-not (Ensure-Git)) { return $false }
    Write-Host "[*] 从 GitHub 安装 OpenClaw CN ($RepoUrl)..." -ForegroundColor Yellow

    if (-not (Test-Path $RepoDir)) {
        Write-Host "  正在克隆仓库..." -ForegroundColor Gray
        git clone -b $Branch $RepoUrl $RepoDir
        if ($LASTEXITCODE -ne 0) {
            Write-Host "错误: 克隆失败，请检查网络连接" -ForegroundColor Red
            return $false
        }
    } else {
        if (-not $SkipUpdate) {
            $dirty = $null
            try { $dirty = git -C $RepoDir status --porcelain 2>$null } catch {}
            if (-not $dirty) {
                Write-Host "  正在更新仓库..." -ForegroundColor Gray
                try { git -C $RepoDir checkout $Branch 2>$null } catch {}
                try { git -C $RepoDir pull origin $Branch 2>$null } catch {}
            } else {
                Write-Host "[!] 仓库有未提交改动，跳过 git pull" -ForegroundColor Yellow
            }
        }
    }

    Ensure-Pnpm -RepoDir $RepoDir
    $pnpmCommand = Get-PnpmCommandPath
    if (-not $pnpmCommand) { throw "pnpm 未找到" }

    $prevScriptShell = $env:NPM_CONFIG_SCRIPT_SHELL
    $prevNodeOptions = $env:NODE_OPTIONS
    $env:NPM_CONFIG_SCRIPT_SHELL = "cmd.exe"

    $pushedLocation = $false
    try {
        Push-Location -LiteralPath $RepoDir
        $pushedLocation = $true

        Write-Host "  正在安装依赖 (pnpm install)..." -ForegroundColor Gray
        & $pnpmCommand install --prefer-offline --no-frozen-lockfile
        if ($LASTEXITCODE -ne 0) {
            Write-Host "[!] pnpm install 失败，清除 node_modules 后重试..." -ForegroundColor Yellow
            Remove-Item -Recurse -Force node_modules -ErrorAction SilentlyContinue
            & $pnpmCommand install --prefer-offline --no-frozen-lockfile
            if ($LASTEXITCODE -ne 0) {
                Write-Host "错误: pnpm install 失败" -ForegroundColor Red; return $false
            }
        }

        Write-Host "  正在构建项目..." -ForegroundColor Gray
        $env:NODE_OPTIONS = Resolve-NodeOptionsWithMinOldSpace -NodeOptions $prevNodeOptions -MinOldSpaceMb 8192
        & $pnpmCommand build
        if ($LASTEXITCODE -ne 0) {
            Write-Host "错误: 构建失败" -ForegroundColor Red; return $false
        }
    } finally {
        if ($pushedLocation) { Pop-Location }
        $env:NPM_CONFIG_SCRIPT_SHELL = $prevScriptShell
        $env:NODE_OPTIONS = $prevNodeOptions
    }

    # Create wrapper
    $binDir = Join-Path $env:USERPROFILE ".local\bin"
    if (-not (Test-Path $binDir)) { New-Item -ItemType Directory -Force -Path $binDir | Out-Null }

    $entryPath = Join-Path $RepoDir "openclaw.mjs"
    if (-not (Test-Path $entryPath)) {
        Write-Host "错误: 未找到 $entryPath" -ForegroundColor Red; return $false
    }

    $cmdPath = Join-Path $binDir $WrapperName
    $cmdContents = "@echo off`r`nnode ""$entryPath"" %*`r`n"
    Set-Content -Path $cmdPath -Value $cmdContents -NoNewline

    if (Add-ToUserPath $binDir) {
        Write-Host "[!] 已将 $binDir 添加到用户 PATH（重新打开终端生效）" -ForegroundColor Yellow
    }

    Write-Host "[OK] 快捷命令已创建: openclaw-cn" -ForegroundColor Green
    return $true
}

# ─── Get-OpenClawCommandPath ──────────────────────────
function Get-OpenClawCommandPath {
    $cmd = Get-Command $WrapperName -ErrorAction SilentlyContinue
    if ($cmd -and $cmd.Source) { return $cmd.Source }
    $cmd = Get-Command openclaw-cn -ErrorAction SilentlyContinue
    if ($cmd -and $cmd.Source) { return $cmd.Source }
    return $null
}

function Invoke-OpenClawCommand {
    param([string[]]$Arguments)
    $commandPath = Get-OpenClawCommandPath
    if (-not $commandPath) { throw "openclaw-cn 命令未在 PATH 中找到。" }
    & $commandPath @Arguments
}

function Ensure-OpenClawOnPath {
    if (Get-OpenClawCommandPath) { return $true }
    $binDir = Join-Path $env:USERPROFILE ".local\bin"
    if (Add-ToUserPath $binDir) {
        Write-Host "[!] 已将 $binDir 添加到用户 PATH" -ForegroundColor Yellow
    }
    return (Get-OpenClawCommandPath) -ne $null
}

# ─── Doctor ───────────────────────────────────────────
function Run-Doctor {
    if (-not (Get-OpenClawCommandPath)) { return }
    Write-Host "[*] 运行 doctor 检测环境..." -ForegroundColor Yellow
    try {
        Invoke-OpenClawCommand doctor --non-interactive
    } catch { /* doctor errors are non-fatal */ }
    Write-Host "[OK] 环境检测完成" -ForegroundColor Green
}

# ─── Main ─────────────────────────────────────────────
function Main {
    if ($DryRun) {
        Write-Host "[DRY RUN] 仅预览，不执行实际操作" -ForegroundColor DarkYellow
        Write-Host "  仓库: $RepoUrl" -ForegroundColor Gray
        Write-Host "  分支: $Branch" -ForegroundColor Gray
        Write-Host "  目录: $GitDir" -ForegroundColor Gray
        return $true
    }

    # Step 1: Node.js
    if (-not (Check-Node)) {
        if (-not (Install-Node)) { return (Fail-Install) }
        if (-not (Check-Node)) {
            Write-Host "错误: Node.js 安装后需要重启终端" -ForegroundColor Red
            Write-Host "请重新打开 PowerShell 后再次运行安装脚本。" -ForegroundColor Yellow
            return (Fail-Install)
        }
    }

    # Step 2: Git install
    $gitInstallResults = @(Install-OpenClawFromGit -RepoDir $GitDir -SkipUpdate:$NoGitUpdate)
    if ($gitInstallResults[-1] -ne $true) { return (Fail-Install) }

    # Step 3: PATH
    if (-not (Ensure-OpenClawOnPath)) {
        Write-Host "安装完成，但 openclaw-cn 尚未在 PATH 中。" -ForegroundColor Yellow
        Write-Host "请重新打开终端后运行: openclaw-cn doctor" -ForegroundColor Cyan
        return
    }

    # Step 4: Doctor
    Run-Doctor

    # Done!
    $entryPath = Join-Path $GitDir "openclaw.mjs"
    $wrapperPath = Join-Path $env:USERPROFILE ".local\bin\$WrapperName"

    Write-Host ""
    Write-Host "╔══════════════════════════════════════════╗" -ForegroundColor Green
    Write-Host "║  OpenClaw CN 魔改版 安装完成！            ║" -ForegroundColor Green
    Write-Host "╚══════════════════════════════════════════╝" -ForegroundColor Green
    Write-Host ""
    Write-Host "  启动命令:  openclaw-cn" -ForegroundColor Cyan
    Write-Host "  或进入目录:  cd $GitDir && node openclaw.mjs" -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "  源码位置:  $GitDir" -ForegroundColor DarkGray
    Write-Host "  快捷方式:  $wrapperPath" -ForegroundColor DarkGray
    Write-Host ""

    # Update instructions
    Write-Host "  ── 更新命令 ──" -ForegroundColor DarkGray
    Write-Host "  cd $GitDir" -ForegroundColor Gray
    Write-Host "  git checkout cn-main && git pull origin cn-main" -ForegroundColor Gray
    Write-Host "  pnpm install && pnpm build" -ForegroundColor Gray
    Write-Host ""

    # Maintenance commands
    Write-Host "  ── 常用命令 ──" -ForegroundColor DarkGray
    Write-Host "  openclaw-cn doctor         检测环境与迁移配置" -ForegroundColor Gray
    Write-Host "  openclaw-cn onboard        初始化配置向导" -ForegroundColor Gray
    Write-Host "  openclaw-cn gateway status 查看网关状态" -ForegroundColor Gray
    Write-Host ""

    if ($NoOnboard) {
        Write-Host "  已跳过初始化向导。稍后运行: openclaw-cn onboard" -ForegroundColor Yellow
    } else {
        Write-Host "  正在启动初始化向导..." -ForegroundColor Cyan
        Write-Host ""
        $process = Start-Process -FilePath (Get-OpenClawCommandPath) -ArgumentList @("onboard") -NoNewWindow -Wait -PassThru
    }

    Write-Host ""
    return $true
}

$mainResults = @(Main)
$installSucceeded = ($mainResults[-1] -eq $true)
Complete-Install -Succeeded:$installSucceeded
