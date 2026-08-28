[CmdletBinding()]
param(
    [string]$Workspace = "",
    [string]$AppPath = "",
    [switch]$Isolated,
    [switch]$Clean,
    [switch]$NoBuild,
    [switch]$Wait,
    [switch]$Insiders
)

# 启动本地版 Kilo Code（dev 模式），加载的是本仓库 build 出的扩展。
# 下载版（市场版）在正常 VS Code 里完全不受影响；本脚本开的是一个专用 dev 窗口。
# 底层命令：bun --cwd packages/kilo-vscode script/launch.ts
#
# 用法示例：
#   .\dev-local.ps1                       # 本地版，共享真实 Kilo 登录态
#   .\dev-local.ps1 -Isolated             # 本地版，全隔离（VS Code 配置 + Kilo 存储都在 .kilo-dev/）
#   .\dev-local.ps1 -Isolated -Clean      # 清空隔离态后启动
#   .\dev-local.ps1 -Workspace ..\foo -NoBuild -Wait

$Root = Split-Path -Parent $PSScriptRoot

$flags = @()
if ($Isolated) { $flags += "--isolated" }
if ($Clean)    { $flags += "--clean" }
if ($NoBuild)  { $flags += "--no-build" }
if ($Wait)     { $flags += "--wait" }
if ($Insiders) { $flags += "--insiders" }
if ($AppPath)  { $flags += "--app-path"; $flags += $AppPath }
if ($Workspace){ $flags += "--workspace"; $flags += $Workspace }

Push-Location $Root
try {
    & bun --cwd packages/kilo-vscode script/launch.ts @flags
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
finally {
    Pop-Location
}
