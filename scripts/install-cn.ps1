# OpenClaw CN 魔改版 Windows 一键安装脚本
# 用法: iwr -useb https://raw.githubusercontent.com/xiaosu2334/openclaw_cn/cn-main/scripts/install-cn.ps1 | iex
# 或: powershell -ExecutionPolicy Bypass -File install-cn.ps1

param(
    [string]$Branch = "cn-main",
    [string]$GitDir = "$env:USERPROFILE\openclaw-cn",
    [switch]$NoBuild = $false,
    [switch]$DryRun = $false
)

$ErrorActionPreference = "Stop"
$RepoUrl = "https://github.com/xiaosu2334/openclaw_cn.git"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  OpenClaw CN 魔改版 - 安装向导" -ForegroundColor Cyan
Write-Host "  https://github.com/xiaosu2334/openclaw_cn" -ForegroundColor DarkGray
Write-Host "  分支: $Branch" -ForegroundColor DarkGray
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

function Write-Step { Write-Host ">>> $args" -ForegroundColor Yellow }
function Write-OK   { Write-Host "  OK  $args" -ForegroundColor Green }
function Write-Warn { Write-Host "  WARN $args" -ForegroundColor Magenta }

if ($DryRun) {
    Write-Host "[DRY RUN] 仅打印操作，不实际执行" -ForegroundColor DarkYellow
    Write-Host "  仓库: $RepoUrl"
    Write-Host "  分支: $Branch"
    Write-Host "  目录: $GitDir"
    exit 0
}

# 1. 检查 Node.js
Write-Step "检查 Node.js..."
try {
    $nodeVer = node --version 2>$null
    if ($LASTEXITCODE -ne 0 -or !$nodeVer) { throw }
    Write-OK "Node.js $nodeVer 已就绪"
} catch {
    Write-Warn "未找到 Node.js，正在通过 winget 安装..."
    winget install OpenJS.NodeJS.LTS --silent 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  请手动安装 Node.js: https://nodejs.org (需要 v22+)" -ForegroundColor Red
        exit 1
    }
    # Refresh PATH
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
}

# 2. 检查 pnpm
Write-Step "检查 pnpm..."
try {
    $pnpmVer = pnpm --version 2>$null
    if ($LASTEXITCODE -ne 0 -or !$pnpmVer) { throw }
    Write-OK "pnpm $pnpmVer 已就绪"
} catch {
    Write-Host "  正在安装 pnpm..." -ForegroundColor Yellow
    npm install -g pnpm 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  pnpm 安装失败，请手动安装: npm install -g pnpm" -ForegroundColor Red
        exit 1
    }
}

# 3. 检查 Git
Write-Step "检查 Git..."
try {
    $gitVer = git --version 2>$null
    if ($LASTEXITCODE -ne 0 -or !$gitVer) { throw }
    Write-OK "$gitVer"
} catch {
    Write-Warn "未找到 Git，正在通过 winget 安装..."
    winget install Git.Git --silent 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  请手动安装 Git: https://git-scm.com/download/win" -ForegroundColor Red
        exit 1
    }
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
}

# 4. 克隆/更新仓库
if (Test-Path "$GitDir\.git") {
    Write-Step "更新已有仓库: $GitDir"
    Push-Location $GitDir
    git fetch origin $Branch 2>$null
    git checkout $Branch 2>$null
    git pull origin $Branch 2>$null
    Pop-Location
    Write-OK "仓库已更新"
} else {
    Write-Step "克隆仓库到: $GitDir"
    git clone -b $Branch $RepoUrl $GitDir 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  克隆失败，请检查网络连接" -ForegroundColor Red
        exit 1
    }
    Write-OK "克隆完成"
}

# 5. 安装依赖
Write-Step "安装依赖 (pnpm install)..."
Push-Location $GitDir
pnpm install --frozen-lockfile 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Warn "frozen-lockfile 安装失败，尝试无锁文件安装..."
    pnpm install 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  依赖安装失败" -ForegroundColor Red
        Pop-Location
        exit 1
    }
}
Write-OK "依赖安装完成"

# 6. 构建
if (-not $NoBuild) {
    Write-Step "正在构建..."
    pnpm build 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Warn "构建有警告，但继续..."
    }
    Write-OK "构建完成"
}

# 7. 创建快捷运行脚本
$binDir = "$env:USERPROFILE\.local\bin"
if (-not (Test-Path $binDir)) {
    New-Item -ItemType Directory -Force -Path $binDir | Out-Null
}

$wrapperPath = "$binDir\openclaw-cn.cmd"
@"
@echo off
cd /d "$GitDir"
node openclaw.mjs %*
"@ | Out-File -FilePath $wrapperPath -Encoding ASCII
Write-OK "已创建快捷命令: openclaw-cn"

# 8. 添加到 PATH
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*$binDir*") {
    [Environment]::SetEnvironmentVariable("Path", "$userPath;$binDir", "User")
    $env:Path = "$env:Path;$binDir"
    Write-OK "已将 $binDir 添加到用户 PATH"
} else {
    Write-OK "$binDir 已在 PATH 中"
}

Pop-Location

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  OpenClaw CN 安装完成！" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  运行:  openclaw-cn" -ForegroundColor Yellow
Write-Host "  或:    cd $GitDir && node openclaw.mjs" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  仓库位置: $GitDir" -ForegroundColor DarkGray
Write-Host "  更新命令: cd $GitDir && git pull origin cn-main && pnpm install && pnpm build" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  ⚠ 重新打开终端以使用 openclaw-cn 命令" -ForegroundColor Magenta
Write-Host ""
