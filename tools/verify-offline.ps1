#Requires -Version 7.0
[CmdletBinding()]
param([ValidateRange(5,60)][int]$StepTimeoutSeconds=60)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$logDir=Join-Path $root ('tmp/verification/offline-suite/'+(Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
[IO.Directory]::CreateDirectory($logDir)|Out-Null
$results=[Collections.Generic.List[object]]::new()
function Invoke-Check([string]$Name,[string]$Program,[string[]]$Arguments){
 $startedAt=[DateTimeOffset]::UtcNow
 $process=[Diagnostics.Process]::new()
 $process.StartInfo=[Diagnostics.ProcessStartInfo]::new()
 $process.StartInfo.FileName=$Program
 $process.StartInfo.WorkingDirectory=$root
 $process.StartInfo.UseShellExecute=$false
 $process.StartInfo.CreateNoWindow=$true
 $process.StartInfo.RedirectStandardOutput=$true
 $process.StartInfo.RedirectStandardError=$true
 foreach($argument in $Arguments){$process.StartInfo.ArgumentList.Add($argument)}
 $code=-1;$timedOut=$false;$message='';$outTask=$null;$errTask=$null
 try{
  if(-not $process.Start()){throw 'Unable to start check'}
  $outTask=$process.StandardOutput.ReadToEndAsync()
  $errTask=$process.StandardError.ReadToEndAsync()
  if(-not $process.WaitForExit($StepTimeoutSeconds*1000)){
   $timedOut=$true
   $process.Kill($true)
   if(-not $process.WaitForExit(5000)){throw 'Check process did not stop after timeout'}
  }
  $code=$process.ExitCode
 }catch{$message=$_.Exception.Message}finally{
  $stdout=if($null -ne $outTask -and $outTask.Wait(5000)){$outTask.Result}else{''}
  $stderr=if($null -ne $errTask -and $errTask.Wait(5000)){$errTask.Result}else{''}
  $process.Dispose()
 }
 $log=Join-Path $logDir ($Name+'.log')
 [IO.File]::WriteAllText($log,($stdout+"`n"+$stderr+"`n"+$message),[Text.UTF8Encoding]::new($false))
 $row=[ordered]@{name=$Name;startedAt=$startedAt.ToString('o');finishedAt=[DateTimeOffset]::UtcNow.ToString('o');exitCode=$code;timedOut=$timedOut;passed=($code -eq 0 -and -not $timedOut -and $message -eq '');log=$log}
 $results.Add($row)
 Write-Host ($Name+': '+$(if($row.passed){'PASS'}else{'FAIL'})+' — '+$log)
}
Push-Location $root
try{
 Invoke-Check 'project' 'node' @('tools/check-project.mjs')
 $tests=@(Get-ChildItem -LiteralPath (Join-Path $root 'tests'),(Join-Path $root 'gateway/test'),(Join-Path $root 'admin-ui/test') -Filter '*.test.mjs' -File | Sort-Object FullName | ForEach-Object FullName)
 Invoke-Check 'node-tests' 'node' (@('--test')+$tests)
 Invoke-Check 'hap' 'node' @('tools/check-hap.mjs','output/hap/openharmony7/build-manifest.json')
 Invoke-Check 'serial-parser' 'pwsh' @('-NoProfile','-File','tools/test-hsp-reader.ps1')
 $summary=[ordered]@{generatedAt=[DateTimeOffset]::UtcNow.ToString('o');scope='offline-host-checks';deviceAcceptance=$false;realProviderInvoked=$false;passed=(@($results|Where-Object {-not $_.passed}).Count -eq 0);steps=@($results.ToArray())}
 $summaryPath=Join-Path $logDir 'summary.json'
 [IO.File]::WriteAllText($summaryPath,($summary|ConvertTo-Json -Depth 6),[Text.UTF8Encoding]::new($false))
 Write-Host ('Summary: '+$summaryPath)
 if(-not $summary.passed){exit 1}
}finally{Pop-Location}
