[CmdletBinding()]
param(
    [string]$Workspace = "",
    [string]$AppPath = ""
)

# 用下载版（市场版）：正常打开 VS Code，不加载本地 dev 版本。
# dev 模式只在 dev-local.ps1 打开的窗口里生效；正常窗口永远是下载版，无需任何回退。
#
# 用法示例：
#   .\use-marketplace.ps1                 # 打开正常 VS Code（下载版）
#   .\use-marketplace.ps1 -Workspace ..\foo

$code = $AppPath
if (-not $code) {
    $code = (Get-Command code -ErrorAction SilentlyContinue).Source
}
if (-not $code) {
    $code = @(
        "$env:LOCALAPPDATA\Programs\Microsoft VS Code\Code.exe",
        "$env:ProgramFiles\Microsoft VS Code\Code.exe"
    ) | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $code) {
    Write-Error "找不到 VS Code。请安装 shell 命令（code），或用 -AppPath 指定 Code.exe 路径。"
    exit 1
}

if ($Workspace) { & $code $Workspace } else { & $code }
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
