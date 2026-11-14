#Requires -Version 7.0
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'hsp-reader-core.psm1') -Force
function Assert($condition,$message){if(-not $condition){throw $message}}
function Frame([long]$uptime=1){return @{schemaVersion=1;deviceId='hh-hsp101-001';simulated=$false;controlSupported=$false;coValid=$false;co2Valid=$false;coPpm=$null;co2Ppm=$null;uptime_ms=$uptime;th_ok=$true;gas_ok=$true;temperature10=253;humidity10=621;gas_raw=500;gas_mv=880;th_sample_age_ms=100;gas_sample_age_ms=200;note='汉字'}}
function Line($frame){return 'PENGAN_TELEMETRY '+($frame|ConvertTo-Json -Compress)}
$frames=[Collections.Generic.List[object]]::new();$sink={param($f)$frames.Add($f)}
$line=Line (Frame)
$state=New-HspParser
Add-HspText $state ('sdk boot'+"`r`n"+$line.Substring(0,30)) $sink
Add-HspText $state ($line.Substring(30)+"`r`r`n") $sink
Assert ($frames.Count -eq 1) '分片CRCRLF未正确重组'
Add-HspText $state ($line+"`n") $sink;Assert ($state.Duplicates -eq 1 -and $frames.Count -eq 1) '重复uptime刷新了样本'
foreach($patch in @(@{simulated='false'},@{coValid=$true},@{schemaVersion='1'},@{controlSupported=$true},@{gas_raw=4096},@{temperature10=-401},@{th_sample_age_ms=-1},@{coPpm=0},@{th_ok='true'})){
 $f=Frame 2;foreach($k in $patch.Keys){$f[$k]=$patch[$k]};Add-HspText $state ((Line $f)+"`n") $sink
}
Assert ($frames.Count -eq 1) '非法帧通过校验'
Add-HspText $state ('PENGAN_TELEMETRY {'+"`n") $sink
Add-HspText $state ('x'*8193) $sink
Add-HspText $state ((Line (Frame 2))+"`n") $sink
Assert ($frames.Count -eq 1) '超长行尾部被当作新帧'
Add-HspText $state ((Line (Frame 2))+"`n") $sink
Assert ($frames.Count -eq 2) '超长行后未正确恢复'
$byteState=New-HspParser;$bytes=[Text.Encoding]::UTF8.GetBytes($line+"`n");foreach($b in $bytes){Add-HspBytes $byteState ([byte[]]@($b)) $sink};Assert ($byteState.Accepted -eq 1) 'UTF8字节分片失败'
$failed=New-HspParser;try{Add-HspText $failed ($line+"`n") {throw 'sink_failure'}}catch{Assert ($_.Exception.Message -eq 'sink_failure') '未保留写入错误'}
Assert ($null -eq $failed.LastUptime) '写入失败仍更新重复状态'
$dir=Join-Path ([IO.Path]::GetTempPath()) ('pengan-hsp-test-'+[Guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($dir)|Out-Null
try{
 $file=Join-Path $dir 'latest.json';Save-HspSample (Frame) $file 1000;Save-HspSample (Frame 2) $file 2000
 $saved=Get-Content -Raw -LiteralPath $file|ConvertFrom-Json
 Assert ($saved.receivedAt -eq 2000 -and $saved.frame.uptime_ms -eq 2) 'File.Move覆盖未生效'
 $before=[IO.File]::ReadAllText($file);$writeState=New-HspParser;Add-HspText $writeState "PENGAN_TELEMETRY {`n" {param($f) Save-HspSample $f $file};Assert ([IO.File]::ReadAllText($file) -eq $before) '非法JSON覆盖最后有效样本'
 $input=Join-Path $dir 'replay.txt';$output=Join-Path $dir 'replay.json';[IO.File]::WriteAllText($input,($line+"`r`r`n"+$line+"`n"+'SDK LOG'+"`n"+(Line (Frame 2))+"`n"),[Text.UTF8Encoding]::new($false))
 & (Join-Path $PSScriptRoot 'read-hsp.ps1') -ReplayFile $input -ReplayOutput $output -ChunkSize 7
 Assert ((Get-Content -Raw -LiteralPath $output|ConvertFrom-Json).frame.uptime_ms -eq 2) '离线回放结果错误'
}finally{
 $resolved=[IO.Path]::GetFullPath($dir);$testRoot=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')+'\';if(-not $resolved.StartsWith($testRoot,[StringComparison]::OrdinalIgnoreCase)){throw '测试清理路径异常'};Remove-Item -LiteralPath $resolved -Recurse -Force
}
Write-Output 'PASS: 分片/UTF8/CRCRLF/SDK日志/超长丢弃/严格校验/重复uptime/写入失败/原子覆盖/离线回放'
