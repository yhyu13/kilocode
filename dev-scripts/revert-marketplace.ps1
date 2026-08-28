[CmdletBinding()]
param(
    [string]$AppPath = ""
)

# 回退到下载版：仅当你用过 `bun run snapshot:install` 把本地快照装进正式扩展目录时才需要。
# 本脚本从市场重新安装正式版，覆盖快照版。
# 若一直用 dev-local.ps1（dev 模式），下载版从未被动过，不需要跑本脚本。

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

& $code --install-extension kilocode.kilo-code --force
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host "已重新安装市场版 kilocode.kilo-code，重启 VS Code 后生效。"
