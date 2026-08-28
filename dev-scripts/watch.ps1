[CmdletBinding()]
param()

# 增量构建：改动 extension/webview 源码后自动重编。
# 配合 dev-local.ps1 打开的 dev 窗口使用：改完在窗口里 Ctrl+Shift+P -> Developer: Reload Window 重读 dist/。
# 底层命令：bun --cwd packages/kilo-vscode run watch

$Root = Split-Path -Parent $PSScriptRoot

Push-Location $Root
try {
    & bun --cwd packages/kilo-vscode run watch
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
finally {
    Pop-Location
}
