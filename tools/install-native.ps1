param(
  [string]$JavaHome='',
  [string]$Target='',
  [switch]$EnableDebugGateway
)
$ErrorActionPreference='Stop'
$projectRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$sdk=Join-Path $projectRoot 'tmp/sdk/api11'
$hdc=Join-Path $sdk 'toolchains/hdc.exe'
if(-not (Test-Path -LiteralPath $hdc)){throw '未找到项目官方SDK中的hdc'}
if(-not $JavaHome){$JavaHome=$env:JAVA_HOME}
if(-not $JavaHome){throw '请指定-JavaHome用于离线验签'}
$java=Join-Path $JavaHome 'bin/java.exe'
$targets=@(& $hdc list targets | Where-Object {$_ -and $_ -notmatch '\[Empty\]' -and $_ -notmatch 'Unauthorized' } | ForEach-Object {$_.Trim()})
if($LASTEXITCODE -ne 0 -or $targets.Count -eq 0){throw 'hdc没有发现可用的已授权设备，未执行安装'}
if(-not $Target){if($targets.Count -ne 1){throw '连接了多个设备，请显式指定-Target'};$Target=$targets[0]}
if($targets -notcontains $Target){throw '指定设备不在已授权目标列表中'}
$apiText=(& $hdc -t $Target shell param get const.ohos.apiversion | Out-String).Trim()
if($apiText -notmatch '^\d+$' -or [int]$apiText -lt 11){throw '尚不能确认设备支持API11，未执行安装'}
$signed=Join-Path $projectRoot 'output/hap/pengan-0.1.0-api11-device-debug.hap'
if(-not (Test-Path -LiteralPath $signed)){throw '尚未生成绑定该设备的开发签名HAP，先读取真实UDID并运行签名脚本'}
$work=Join-Path $env:TEMP ('pengan-install-'+[Guid]::NewGuid().ToString('N').Substring(0,12))
New-Item -ItemType Directory -Force $work | Out-Null
$asciiHap=Join-Path $work 'pengan.hap'
Copy-Item -LiteralPath $signed -Destination $asciiHap
$profile=Join-Path $work 'profile.p7b'
& $java -jar (Join-Path $sdk 'toolchains/lib/hap-sign-tool.jar') verify-app -inFile $asciiHap -outCertChain (Join-Path $work 'chain.cer') -outProfile $profile
if($LASTEXITCODE -ne 0){throw '本地HAP验签失败，未执行安装'}
$decoded=Join-Path $work 'profile.json'
& $java -jar (Join-Path $sdk 'toolchains/lib/hap-sign-tool.jar') verify-profile -inFile $profile -outFile $decoded
if($LASTEXITCODE -ne 0){throw '开发Profile验签失败，未执行安装'}
$verification=Get-Content -LiteralPath $decoded -Raw | ConvertFrom-Json
if($verification.verifiedPassed -ne $true){throw 'Profile未通过验证'}
$provision=$verification.content
if($provision.type -ne 'debug' -or $provision.'bundle-info'.'bundle-name' -ne 'com.pengan.greenhouse' -or $provision.'bundle-info'.apl -ne 'normal'){throw '开发Profile与棚安普通应用不匹配'}
$udidText=(& $hdc -t $Target shell bm get --udid | Out-String)
$udidMatches=[regex]::Matches($udidText,'(?i)\b[a-f0-9]{64}\b')
if($udidMatches.Count -ne 1){throw '无法确认目标设备UDID，未执行安装'}
if($provision.'debug-info'.'device-ids' -notcontains $udidMatches[0].Value.ToUpper()){throw 'HAP未绑定当前设备，未执行安装'}
Write-Output ('本地验签、设备绑定与API检查通过；开始安装棚安原生应用。API='+$apiText)
$installed=(& $hdc -t $Target install -r $asciiHap 2>&1 | Out-String)
Write-Output $installed
if($LASTEXITCODE -ne 0 -or $installed -notmatch '(?i)success'){throw '设备未明确确认安装成功，停止后续步骤'}
if($EnableDebugGateway){
  & $hdc -t $Target rport tcp:5187 tcp:5187
  if($LASTEXITCODE -ne 0){throw '应用已安装，但调试网关转发未成功'}
}
& $hdc -t $Target shell aa start -a EntryAbility -b com.pengan.greenhouse
if($LASTEXITCODE -ne 0){throw '应用安装后启动未确认，请查看板子和日志'}
Write-Output '启动命令已发出；页面、摄像头与业务验收仍需实际查看板子。'
