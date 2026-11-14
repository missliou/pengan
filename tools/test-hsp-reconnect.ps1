#Requires -Version 7.0
$ErrorActionPreference='Stop'
$scriptFile=Join-Path $PSScriptRoot 'read-hsp.ps1'
$sets=(Get-Command -Name $scriptFile).ParameterSets
if(($sets|Where-Object Name -eq 'Replay').Parameters.Name -contains 'Reconnect'){throw 'Replay must not accept Reconnect'}
function Run-MissingPort([bool]$Retry){
 $info=[Diagnostics.ProcessStartInfo]::new()
 $info.FileName=(Get-Process -Id $PID).Path
 $info.UseShellExecute=$false;$info.CreateNoWindow=$true
 $info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true
 foreach($arg in @('-NoProfile','-File',$scriptFile,'-Port','COM9999')){$info.ArgumentList.Add($arg)}
 if($Retry){$info.ArgumentList.Add('-Reconnect');$info.ArgumentList.Add('-ReconnectDelayMs');$info.ArgumentList.Add('1000')}
 $child=[Diagnostics.Process]::new();$child.StartInfo=$info
 try{
  if(-not $child.Start()){throw 'test child did not start'}
  $stdout=$child.StandardOutput.ReadToEndAsync();$stderr=$child.StandardError.ReadToEndAsync()
  $ended=$child.WaitForExit($(if($Retry){4200}else{5000}))
  if($Retry){
   if($ended){throw 'Reconnect exited instead of retrying'}
   $child.Kill($true);$child.WaitForExit()
   # Match stable ASCII fields: redirected PowerShell uses the host code page.
   $count=([regex]::Matches($stdout.GetAwaiter().GetResult(),'COM9999 .*1000ms')).Count
   if($count -lt 3){throw 'Missing-port retries not observed'}
   Write-Output ('PASS: bounded missing-port retries='+$count+'; owned child terminated')
  }else{
   if(-not $ended -or $child.ExitCode -eq 0){throw 'Without Reconnect, missing port must fail promptly'}
   $null=$stdout.GetAwaiter().GetResult();$null=$stderr.GetAwaiter().GetResult()
   Write-Output 'PASS: missing port without Reconnect exits with failure'
  }
 }finally{if($child.Id -and -not $child.HasExited){$child.Kill($true);$child.WaitForExit()};$child.Dispose()}
}
Run-MissingPort $false
Run-MissingPort $true
Write-Output 'PASS: replay parameters remain isolated; no real serial port opened'
