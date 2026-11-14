#Requires -Version 7.0
param(
 [Parameter(Mandatory=$true)][string]$JavaHome,
 [string]$Target=''
)
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$hdc=Join-Path $root 'tmp/sdk/7.0-release/api26/toolchains/hdc.exe'
$sdk=Join-Path $root 'tmp/sdk/7.0-release/api26'
$manifestPath=Join-Path $root 'output/hap/openharmony7/build-manifest.json'
$manifest=Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if($manifest.targetApi -ne '26.0.0' -or $manifest.minApi -ne '26.0.0'){throw '不是预期API26构建清单'}
$sourceFingerprint=& node (Join-Path $root 'tools/native-source.mjs') | ConvertFrom-Json
if($LASTEXITCODE -ne 0 -or -not $manifest.nativeSourceSha256 -or $sourceFingerprint.sha256 -ne $manifest.nativeSourceSha256){throw '当前源码与待安装候选不一致，请先重新构建'}
if([IO.Path]::GetFileName($manifest.artifact) -ne $manifest.artifact){throw '清单路径无效'}
$hap=Join-Path ([IO.Path]::GetDirectoryName($manifestPath)) $manifest.artifact
if((Get-FileHash -LiteralPath $hap -Algorithm SHA256).Hash.ToLower() -ne $manifest.sha256 -or (Get-Item -LiteralPath $hap).Length -ne $manifest.bytes){throw 'HAP不匹配最新构建清单'}
function Invoke-PenganHdc([string[]]$Arguments,[int]$TimeoutMs=15000){
 $info=New-Object Diagnostics.ProcessStartInfo
 $info.FileName=$hdc;$info.UseShellExecute=$false;$info.CreateNoWindow=$true
 $info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true
 foreach($arg in $Arguments){$info.ArgumentList.Add($arg)}
 $process=New-Object Diagnostics.Process
 $process.StartInfo=$info
 try{
  if(-not $process.Start()){throw 'HDC启动失败'}
  $stdout=$process.StandardOutput.ReadToEndAsync();$stderr=$process.StandardError.ReadToEndAsync()
  if(-not $process.WaitForExit($TimeoutMs)){$process.Kill($true);throw 'HDC超时，结果未确认；未卸载或重刷，请先检查状态'}
  $text=$stdout.GetAwaiter().GetResult()+$stderr.GetAwaiter().GetResult()
  if($process.ExitCode -ne 0){throw ('HDC失败：'+$text)}
  return $text.Trim()
 }finally{$process.Dispose()}
}
$targets=@((Invoke-PenganHdc @('list','targets')) -split "`r?`n" | Where-Object {$_ -and $_ -notmatch '\[Empty\]|Unauthorized'})
if(-not $Target){if($targets.Count -ne 1){throw '需要连接且仅连接一个已授权设备，或指定-Target'};$Target=$targets[0].Trim()}
if($targets -notcontains $Target){throw '指定设备不在HDC目标中'}
$api=Invoke-PenganHdc @('-t',$Target,'shell','param','get','const.ohos.apiversion')
if($api -notmatch '^\d+$' -or [int]$api -lt 26){throw '无法确认板子API26兼容，未执行安装'}
$udidText=Invoke-PenganHdc @('-t',$Target,'shell','bm','get','--udid')
$matches=[regex]::Matches($udidText,'(?i)\b[a-f0-9]{64}\b')
if($matches.Count -ne 1){throw '无法确认真实设备UDID，未签名安装'}
$signed=Join-Path ([IO.Path]::GetDirectoryName($manifestPath)) 'pengan-0.1.0-api26.0.0-device-debug.hap'
& (Join-Path $PSScriptRoot 'sign-native-debug.ps1') -DeviceUdid $matches[0].Value -JavaHome $JavaHome -SdkPath $sdk -HapPath $hap -OutputPath $signed -CompatibleVersion 26
$temporary=Join-Path ([IO.Path]::GetTempPath()) ('pengan-oh7-install-'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temporary | Out-Null
$asciiHap=Join-Path $temporary 'pengan.hap'
Copy-Item -LiteralPath $signed -Destination $asciiHap
$result=Invoke-PenganHdc @('-t',$Target,'install','-r',$asciiHap) 45000
Write-Output $result
if($result -notmatch 'install bundle successfully'){throw '没有明确安装成功；不会卸载旧应用，签名不一致时请先核实身份'}
$started=Invoke-PenganHdc @('-t',$Target,'shell','aa','start','-a','EntryAbility','-b','com.pengan.greenhouse')
Write-Output $started
if($started -notmatch 'start ability successfully'){throw '安装成功但启动未确认'}
[ordered]@{at=[DateTimeOffset]::Now.ToString('o');unsignedSha256=$manifest.sha256;signedSha256=(Get-FileHash -LiteralPath $signed -Algorithm SHA256).Hash.ToLower();deviceApi=[int]$api;installConfirmed=$true;startCommandConfirmed=$true;visualAcceptanceConfirmed=$false} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path ([IO.Path]::GetDirectoryName($manifestPath)) 'install-receipt.json') -Encoding utf8
Write-Output '安装和启动命令已确认；仍需板上查看页面，不等于视觉/传感器验收。'
