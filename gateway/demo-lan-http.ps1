# 局域网演示：把云端网关临时开放到私有局域网明文HTTP（仅演示，勿用于公网）
# 用法：powershell -ExecutionPolicy Bypass -File gateway\demo-lan-http.ps1 -LanIp 192.168.1.20 -Config D:/PenganLocal/cloud-config.json
param(
  [Parameter(Mandatory=$true)][string]$LanIp,
  [Parameter(Mandatory=$true)][string]$Config,
  [int]$Port = 5201
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if ($LanIp -notmatch '^(10\.|127\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)\d{1,3}(\.\d{1,3}){2}$') {
  throw "只允许私有局域网IPv4，收到：$LanIp"
}
if (-not (Test-Path -LiteralPath $Config)) { throw "缺少部署配置：$Config（先用 setup_cloud.py 生成）" }
$Config = (Resolve-Path -LiteralPath $Config).Path
$json = Get-Content -LiteralPath $Config -Raw -Encoding UTF8 | ConvertFrom-Json
$json | Add-Member -NotePropertyName publicOrigin -NotePropertyValue "http://$LanIp`:$Port" -Force
$json | Add-Member -NotePropertyName publicOriginHost -NotePropertyValue $LanIp -Force
$json | Add-Member -NotePropertyName port -NotePropertyValue $Port -Force
$demo = Join-Path (Split-Path -Parent $Config) 'cloud-config.demo-lan.json'
# 演示配置含真实口令哈希与设备令牌摘要，只允许本机账户读取。
[IO.File]::WriteAllText($demo, ($json | ConvertTo-Json -Depth 12), [Text.UTF8Encoding]::new($false))
Write-Host "演示原站：$($json.publicOrigin)"
Write-Host "Web 访问：http://$LanIp`:$Port"
Write-Host '注意：明文HTTP，令牌与数据不加密，仅限本次演示，结束后删除该配置。'
node (Join-Path $root 'gateway\cloud-main.mjs') --config $demo
