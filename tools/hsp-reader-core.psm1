#Requires -Version 7.0
Set-StrictMode -Version Latest
function Test-HspInteger($Value,$Min,$Max) {
 if($null -eq $Value -or $Value -is [bool] -or $Value -is [string]){return $false}
 if($Value -isnot [ValueType]){return $false}
 try{$n=[double]$Value;return [double]::IsFinite($n) -and $n -ge $Min -and $n -le $Max -and [Math]::Floor($n) -eq $n}catch{return $false}
}
function Test-HspFrame($Frame) {
 if($null -eq $Frame -or $Frame -isnot [System.Collections.IDictionary]){return $false}
 foreach($key in @('schemaVersion','deviceId','simulated','controlSupported','coValid','co2Valid','coPpm','co2Ppm','uptime_ms','th_ok','gas_ok','th_sample_age_ms','gas_sample_age_ms')){if(-not $Frame.Contains($key)){return $false}}
 if(-not(Test-HspInteger $Frame.schemaVersion 1 1) -or $Frame.deviceId -isnot [string] -or $Frame.deviceId -cne 'hh-hsp101-001'){return $false}
 foreach($key in @('simulated','controlSupported','coValid','co2Valid')){if($Frame[$key] -isnot [bool] -or $Frame[$key]){return $false}}
 if($null -ne $Frame.coPpm -or $null -ne $Frame.co2Ppm){return $false}
 foreach($key in @('uptime_ms','th_sample_age_ms','gas_sample_age_ms')){if(-not(Test-HspInteger $Frame[$key] 0 4294967295)){return $false}}
 foreach($key in @('th_ok','gas_ok')){if($Frame[$key] -isnot [bool]){return $false}}
 if($Frame.th_ok){if(-not $Frame.Contains('temperature10') -or -not $Frame.Contains('humidity10') -or -not(Test-HspInteger $Frame.temperature10 -400 850) -or -not(Test-HspInteger $Frame.humidity10 0 1000)){return $false}}
 if($Frame.gas_ok){if(-not $Frame.Contains('gas_raw') -or -not $Frame.Contains('gas_mv') -or -not(Test-HspInteger $Frame.gas_raw 0 4095) -or -not(Test-HspInteger $Frame.gas_mv 0 7200)){return $false}}
 return $true
}
function New-HspParser {
 return @{Buffer=[Text.StringBuilder]::new();Discarding=$false;LastUptime=$null;Accepted=0;Rejected=0;Duplicates=0;Decoder=[Text.UTF8Encoding]::new($false,$true).GetDecoder()}
}
function Add-HspText {
 param([Parameter(Mandatory)]$State,[AllowEmptyString()][string]$Text,[Parameter(Mandatory)][scriptblock]$OnFrame)
 foreach($char in $Text.ToCharArray()){
  if($char -ne "`n"){
   if(-not $State.Discarding){
    if($State.Buffer.Length -ge 8192){$State.Buffer.Clear()|Out-Null;$State.Discarding=$true;$State.Rejected++}
    else{$State.Buffer.Append($char)|Out-Null}
   }
   continue
  }
  if($State.Discarding){$State.Discarding=$false;$State.Buffer.Clear()|Out-Null;continue}
  $line=$State.Buffer.ToString().TrimEnd("`r");$State.Buffer.Clear()|Out-Null
  if(-not $line.StartsWith('PENGAN_TELEMETRY ',[StringComparison]::Ordinal)){continue}
  try{$frame=ConvertFrom-Json -InputObject $line.Substring(17) -AsHashtable -ErrorAction Stop;if(-not(Test-HspFrame $frame)){$State.Rejected++;continue}}
  catch{$State.Rejected++;continue}
  if($null -ne $State.LastUptime -and $frame.uptime_ms -eq $State.LastUptime){$State.Duplicates++;continue}
  # Commit identity only after a successful sink; failed writes may be retried.
  & $OnFrame $frame
  $State.LastUptime=$frame.uptime_ms;$State.Accepted++
 }
}
function Add-HspBytes {
 param([Parameter(Mandatory)]$State,[byte[]]$Bytes,[Parameter(Mandatory)][scriptblock]$OnFrame)
 try{$chars=[char[]]::new([Text.Encoding]::UTF8.GetMaxCharCount($Bytes.Length));$count=$State.Decoder.GetChars($Bytes,0,$Bytes.Length,$chars,0,$false)}
 catch{$State.Decoder.Reset();$State.Buffer.Clear()|Out-Null;$State.Discarding=$true;$State.Rejected++;return}
 Add-HspText -State $State -Text ([string]::new($chars,0,$count)) -OnFrame $OnFrame
}
function Save-HspSample {
 param([Parameter(Mandatory)]$Frame,[Parameter(Mandatory)][string]$File,[long]$ReceivedAt=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
 if(-not(Test-HspFrame $Frame)){throw 'invalid_hsp_frame'}
 $folder=[IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($File));[IO.Directory]::CreateDirectory($folder)|Out-Null
 $temp=Join-Path $folder ('hsp-'+[Guid]::NewGuid().ToString('N')+'.tmp')
 try{[IO.File]::WriteAllText($temp,(@{receivedAt=$ReceivedAt;frame=$Frame}|ConvertTo-Json -Depth 8 -Compress),[Text.UTF8Encoding]::new($false));[IO.File]::Move($temp,[IO.Path]::GetFullPath($File),$true)}
 finally{if(Test-Path -LiteralPath $temp){Remove-Item -LiteralPath $temp}}
}
Export-ModuleMember -Function New-HspParser,Add-HspText,Add-HspBytes,Test-HspFrame,Save-HspSample
