#Requires -Version 7.0
param([string]$ServerAddress='http://127.0.0.1:5187')
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$uri=$null;$ip=$null
if(-not [Uri]::TryCreate($ServerAddress,[UriKind]::Absolute,[ref]$uri) -or $uri.Scheme -ne 'http' -or $uri.UserInfo -or $uri.Query -or $uri.Fragment -or $uri.AbsolutePath -ne '/' -or -not [Net.IPAddress]::TryParse($uri.Host,[ref]$ip) -or $ip.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork){throw 'server_address_must_be_private_http_ipv4'}
$octets=$ip.GetAddressBytes()
if(-not ($octets[0] -eq 127 -or $octets[0] -eq 10 -or ($octets[0] -eq 192 -and $octets[1] -eq 168) -or ($octets[0] -eq 172 -and $octets[1] -ge 16 -and $octets[1] -le 31))){throw 'server_address_must_be_private_http_ipv4'}
$base=$uri.GetLeftPart([UriPartial]::Authority)
function Read-Endpoint([string]$Endpoint,[scriptblock]$Select){
 try{$data=Invoke-RestMethod -Uri ($base+$Endpoint) -TimeoutSec 3 -Method Get;return @{state='success';data=(& $Select $data)}}catch{return @{state='unknown';code='http_read_failed'}}
}
function Invoke-BoundedHdc([string[]]$Arguments){
 $info=[Diagnostics.ProcessStartInfo]::new();$info.FileName=$hdc;$info.UseShellExecute=$false;$info.CreateNoWindow=$true;$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true
 foreach($argument in $Arguments){$info.ArgumentList.Add($argument)}
 $child=[Diagnostics.Process]::new();$child.StartInfo=$info;$started=$false
 try{
  if(-not $child.Start()){return @{ok=$false;code='hdc_start_failed'}}
  $started=$true
  $stdout=$child.StandardOutput.ReadToEndAsync();$stderr=$child.StandardError.ReadToEndAsync()
  if(-not $child.WaitForExit(3000)){$child.Kill();$child.WaitForExit(500)|Out-Null;return @{ok=$false;code='hdc_timeout'}}
  if($child.ExitCode -ne 0){return @{ok=$false;code='hdc_read_failed'}}
  if(-not $stdout.IsCompleted -and -not $stdout.Wait(200)){return @{ok=$false;code='hdc_output_timeout'}}
  return @{ok=$true;text=$stdout.GetAwaiter().GetResult()}
 }catch{return @{ok=$false;code='hdc_read_failed'}}finally{try{if($started -and -not $child.HasExited){$child.Kill();$child.WaitForExit(500)|Out-Null}}finally{$child.Dispose()}}
}
$report=[ordered]@{schemaVersion=1;at=[DateTimeOffset]::Now.ToString('o');readOnly=$true;serverAddress=$base}
$report.health=Read-Endpoint '/api/health' {param($d) @{ok=$d.ok;mode=$d.mode;simulated=$d.simulated;hardwareConnected=$d.hardwareConnected}}
$report.model=Read-Endpoint '/api/agent/status' {param($d) @{configured=$d.configured;provider=$d.provider;model=$d.model;executesDevices=$d.executesDevices}}
$report.hardware=Read-Endpoint '/api/hardware' {param($d) @{deviceOnline=$d.deviceOnline;reason=$d.reason;receivedAt=$d.receivedAt;sampleAgeMs=$d.sampleAgeMs;values=$d.values;quality=$d.quality;actuationAvailable=$d.actuationAvailable;admission=$d.admission}}
try{$ports=@(Get-PnpDevice -Class Ports -PresentOnly -ErrorAction Stop|ForEach-Object {@{name=$_.FriendlyName;status=[string]$_.Status}});$report.serial=@{state='success';portCount=$ports.Count;ports=$ports}}catch{$report.serial=@{state='unknown';code='ports_not_available';portCount=0;ports=@()}}
$hdc=Join-Path $root 'tmp/sdk/7.0-release/api26/toolchains/hdc.exe'
$report.hdc=@{state='unknown';toolAvailable=(Test-Path -LiteralPath $hdc);targetCount=0;code='hdc_not_available'}
if($report.hdc.toolAvailable){
 $listed=Invoke-BoundedHdc @('list','targets')
 if($listed.ok){
  # IDs remain in process memory only, never in reports or console output.
  $targets=@($listed.text -split '\r?\n'|ForEach-Object {$_.Trim()}|Where-Object {$_ -match '^[A-Za-z0-9_.:-]+$' -and $_ -notin @('ConnectKey','Status')})
  $report.hdc=@{state=$(if($targets.Count){'success'}else{'unknown'});toolAvailable=$true;targetCount=$targets.Count;code=$(if($targets.Count){'targets_present'}else{'no_authorized_target'})}
  if($targets.Count -eq 1){
   $api=Invoke-BoundedHdc @('-t',$targets[0],'shell','param','get','const.ohos.apiversion')
   $version=Invoke-BoundedHdc @('-t',$targets[0],'shell','param','get','const.ohos.fullname')
   $report.device=@{state='unknown';code='device_version_read_failed'}
   if($api.ok -and $version.ok -and $api.text.Trim() -match '^\d+(\.\d+){0,2}$' -and $version.text.Trim() -match '^OpenHarmony[- A-Za-z0-9._()]{1,180}$'){$report.device=@{state='success';api=$api.text.Trim();system=$version.text.Trim();installedCandidateVerified=$false}}
  }
 }else{$report.hdc.code=$listed.code}
}
try{
 $build=Get-Content -Raw -LiteralPath (Join-Path $root 'output/hap/openharmony7/build-manifest.json')|ConvertFrom-Json
 $report.candidate=@{state='success';artifact=$build.artifact;sha256=$build.sha256;bytes=$build.bytes;targetApi=$build.targetApi;sdk=$build.sdk;signed=($build.signed -eq $true);installedOnDevice=($build.installedOnDevice -eq $true);note='build_manifest_only_not_installation_evidence'}
}catch{$report.candidate=@{state='unknown';code='build_manifest_unavailable'}}
$out=Join-Path $root 'output/diagnostics';New-Item -ItemType Directory -Force -Path $out|Out-Null
$stem='pengan-diagnostics-'+(Get-Date -Format 'yyyyMMdd-HHmmss')
$jsonFile=Join-Path $out ($stem+'.json');$mdFile=Join-Path $out ($stem+'.md')
$report|ConvertTo-Json -Depth 8|Set-Content -LiteralPath $jsonFile -Encoding utf8
$md=@"
# 棚安只读就绪诊断

时间：$($report.at)

- 服务地址：$base
- 服务读取：$($report.health.state)
- 模型状态读取：$($report.model.state)；已配置：$($report.model.data.configured)
- 真实采集读取：$($report.hardware.state)；在线：$($report.hardware.data.deviceOnline)
- 串口枚举：$($report.serial.state)；数量：$($report.serial.portCount)
- HDC工具可用：$($report.hdc.toolAvailable)；已授权目标数量：$($report.hdc.targetCount)
- 候选清单：$($report.candidate.state)

未打开串口，未提交模型请求，未安装、签名或刷写。未记录目标ID、UDID或密钥。候选清单不证明已装机；缺设备或服务时状态为未知。细节见同名JSON。
"@
$md|Set-Content -LiteralPath $mdFile -Encoding utf8
$files=@($jsonFile,$mdFile)|ForEach-Object {[ordered]@{file=[IO.Path]::GetFileName($_);bytes=(Get-Item -LiteralPath $_).Length;sha256=(Get-FileHash -LiteralPath $_ -Algorithm SHA256).Hash.ToLowerInvariant()}}
[ordered]@{at=$report.at;readOnly=$true;files=$files}|ConvertTo-Json -Depth 4|Set-Content -LiteralPath (Join-Path $out 'manifest.json') -Encoding utf8
Write-Output ('诊断文件：'+$jsonFile)
Write-Output ('诊断说明：'+$mdFile)
