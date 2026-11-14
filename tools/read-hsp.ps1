#Requires -Version 7.0
[CmdletBinding(DefaultParameterSetName='Serial')]
param(
 [Parameter(ParameterSetName='Serial')][ValidatePattern('^COM[0-9]+$')][string]$Port='COM7',
 [Parameter(ParameterSetName='Serial')][ValidateRange(1200,3000000)][int]$BaudRate=115200,
 [Parameter(ParameterSetName='Serial')][switch]$Reconnect,
 [Parameter(ParameterSetName='Serial')][ValidateRange(1000,30000)][int]$ReconnectDelayMs=3000,
 [Parameter(Mandatory,ParameterSetName='Replay')][string]$ReplayFile,
 [Parameter(Mandatory,ParameterSetName='Replay')][string]$ReplayOutput,
 [Parameter(ParameterSetName='Replay')][ValidateRange(1,65536)][int]$ChunkSize=37
)
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'hsp-reader-core.psm1') -Force
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$state=New-HspParser
if($PSCmdlet.ParameterSetName -eq 'Replay'){
 $file=[IO.Path]::GetFullPath($ReplayOutput)
 $runtime=[IO.Path]::GetFullPath((Join-Path $root 'tmp/runtime')).TrimEnd('\')+'\'
 $tempRoot=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')+'\'
 # Replay is an offline test: never replace the real hardware sample.
 if($file.StartsWith($runtime,[StringComparison]::OrdinalIgnoreCase) -or -not $file.StartsWith($tempRoot,[StringComparison]::OrdinalIgnoreCase)){throw '回放输出必须在系统临时测试目录内，禁止覆盖真实采样目录'}
 $cursor=$file
 while($cursor.Length -ge $tempRoot.TrimEnd('\').Length){
  if(Test-Path -LiteralPath $cursor){if((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){throw '回放输出不能通过链接或联接写入其他目录'}}
  $cursor=[IO.Path]::GetDirectoryName($cursor)
  if(-not $cursor){break}
 }
 $inputStream=[IO.File]::OpenRead((Resolve-Path -LiteralPath $ReplayFile).Path)
 try{$bytes=[byte[]]::new($ChunkSize);while(($count=$inputStream.Read($bytes,0,$bytes.Length)) -gt 0){$part=[byte[]]::new($count);[Array]::Copy($bytes,$part,$count);Add-HspBytes $state $part {param($frame) Save-HspSample $frame $file}}}
 finally{$inputStream.Dispose()}
 Write-Output ('离线回放：accepted='+$state.Accepted+' rejected='+$state.Rejected+' duplicate='+$state.Duplicates)
 return
}
$file=Join-Path $root 'tmp/runtime/hsp-latest.json'
$connectedOnce=$false
while($true){
 $serial=[IO.Ports.SerialPort]::new($Port,$BaudRate,[IO.Ports.Parity]::None,8,[IO.Ports.StopBits]::One)
 $serial.ReadTimeout=1000
 $transportFailure=$false
 try{
  try{$serial.Open()}catch{$transportFailure=$true;throw}
  # A new transport must not join a partial old line or UTF8 sequence.
  # Retain duplicate suppression for the last successfully persisted sample.
  $lastUptime=$state.LastUptime;$state=New-HspParser;$state.LastUptime=$lastUptime
  $label=if($connectedOnce){'已重新连接，只读采集 '}else{'只读采集 '}
  Write-Output ($label+$Port+' / '+$BaudRate+'，Ctrl+C结束；不发送控制命令。')
  $connectedOnce=$true
  $bytes=[byte[]]::new(4096)
  while($true){
   try{$count=$serial.Read($bytes,0,$bytes.Length)}catch [TimeoutException]{continue}catch{$transportFailure=$true;throw}
   if($count -gt 0){$part=[byte[]]::new($count);[Array]::Copy($bytes,$part,$count);Add-HspBytes $state $part {param($frame) Save-HspSample $frame $file}}
  }
 }catch{
  if($_.Exception -is [Management.Automation.PipelineStoppedException] -or -not $Reconnect -or -not $transportFailure){throw}
  Write-Output ('串口 '+$Port+' 未连接或已断开；'+$ReconnectDelayMs+'ms后只重试此端口。旧读数按时效转未知。')
 }finally{
  try{if($serial.IsOpen){$serial.Close()}}finally{$serial.Dispose()}
 }
 Start-Sleep -Milliseconds $ReconnectDelayMs
}
