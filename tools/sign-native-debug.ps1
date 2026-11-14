param(
  [string]$DeviceUdid='',
  [string]$JavaHome='',
  [string]$SdkPath='',
  [string]$HapPath='',
  [string]$OutputPath='',
  [int]$CompatibleVersion=11,
  [switch]$OfflineSelfTest
)
$ErrorActionPreference='Stop'
$projectRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if(-not $SdkPath){$SdkPath=Join-Path $projectRoot 'tmp/sdk/api11'}
$lib=Join-Path (Resolve-Path -LiteralPath $SdkPath).Path 'toolchains/lib'
if(-not $JavaHome){$JavaHome=$env:JAVA_HOME}
if(-not $JavaHome){throw '请指定 -JavaHome，避免误用无效Java启动器'}
$java=Join-Path $JavaHome 'bin/java.exe'
$keytool=Join-Path $JavaHome 'bin/keytool.exe'
if(-not (Test-Path -LiteralPath $java)){throw 'Java路径无效'}
if($OfflineSelfTest){
  $sha=[Security.Cryptography.SHA256]::Create()
  $DeviceUdid=([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes('PENGAN_OFFLINE_SIGNATURE_TEST_ONLY')))).Replace('-','')
  $sha.Dispose()
}elseif($DeviceUdid -notmatch '^[A-Fa-f0-9]{64}$'){
  throw '必须提供实际板子的64位十六进制UDID；离线自测请使用 -OfflineSelfTest。'
}
$work=Join-Path $env:TEMP ('pengan-sign-'+[Guid]::NewGuid().ToString('N').Substring(0,12))
New-Item -ItemType Directory -Force $work | Out-Null
$jar=Join-Path $lib 'hap-sign-tool.jar'
$keystore=Join-Path $lib 'OpenHarmony.p12'
# Only the public SDK test keystore is used. Never use this identity for production.
$sdkPublicPassword='123456'
$profile=Get-Content (Join-Path $lib 'UnsgnedDebugProfileTemplate.json') -Raw | ConvertFrom-Json
foreach($item in @(@('openharmony application ca','ca.pem'),@('openharmony application root ca','root.pem'))){
  & $keytool -exportcert -rfc -alias $item[0] -keystore $keystore -storepass $sdkPublicPassword -file (Join-Path $work $item[1]) 2>&1 | Out-Null
  if($LASTEXITCODE -ne 0){throw '无法导出SDK测试公钥证书'}
}
# The p12 alias exposes a self-signed placeholder certificate; the SDK profile
# contains the CA-signed application certificate for the same public key.
$appChain=$profile.'bundle-info'.'development-certificate'+(Get-Content (Join-Path $work 'ca.pem') -Raw)+(Get-Content (Join-Path $work 'root.pem') -Raw)
$appCert=Join-Path $work 'app-chain.pem'
[IO.File]::WriteAllText($appCert,$appChain)
$profile.uuid=[Guid]::NewGuid().ToString()
$profile.validity.'not-before'=[DateTimeOffset]::UtcNow.AddMinutes(-5).ToUnixTimeSeconds()
$profile.validity.'not-after'=[DateTimeOffset]::UtcNow.AddDays(30).ToUnixTimeSeconds()
$profile.'bundle-info'.'bundle-name'='com.pengan.greenhouse'
$profile.'bundle-info'.apl='normal'
$profile.'debug-info'.'device-ids'=@($DeviceUdid.ToUpper())
$profile.acls.'allowed-acls'=@()
$profile.permissions.'restricted-permissions'=@()
$profileJson=Join-Path $work 'profile.json'
[IO.File]::WriteAllText($profileJson,($profile | ConvertTo-Json -Depth 10))
$signedProfile=Join-Path $work 'profile.p7b'
& $java -jar $jar sign-profile -mode localSign -keyAlias 'openharmony application profile debug' -signAlg SHA256withECDSA -profileCertFile (Join-Path $lib 'OpenHarmonyProfileDebug.pem') -inFile $profileJson -keystoreFile $keystore -outFile $signedProfile -keyPwd $sdkPublicPassword -keystorePwd $sdkPublicPassword
if($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $signedProfile)){throw '开发Profile签名失败'}
$sourceHap=if($HapPath){(Resolve-Path -LiteralPath $HapPath).Path}else{Join-Path $projectRoot 'output/hap/pengan-0.1.0-api11-unsigned.hap'}
$inputHap=Join-Path $work 'input.hap'
Copy-Item -LiteralPath $sourceHap -Destination $inputHap
$signedHap=Join-Path $work 'signed.hap'
& $java -jar $jar sign-app -mode localSign -keyAlias 'openharmony application release' -signAlg SHA256withECDSA -appCertFile $appCert -profileFile $signedProfile -inFile $inputHap -keystoreFile $keystore -outFile $signedHap -keyPwd $sdkPublicPassword -keystorePwd $sdkPublicPassword -compatibleVersion $CompatibleVersion
if($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $signedHap)){throw 'HAP签名失败'}
& $java -jar $jar verify-app -inFile $signedHap -outCertChain (Join-Path $work 'verified-chain.cer') -outProfile (Join-Path $work 'verified-profile.p7b')
if($LASTEXITCODE -ne 0){throw 'HAP签名校验失败'}
if($OfflineSelfTest){
  $outDir=Join-Path $projectRoot 'tmp/verification/signing'
  New-Item -ItemType Directory -Force $outDir | Out-Null
  Copy-Item -LiteralPath $signedHap -Destination (Join-Path $outDir 'OFFLINE-SELFTEST-NOT-FOR-DEVICE.hap') -Force
  Write-Output '离线签名与验签通过；仅绑定虚构自测UDID，不能用于真实设备安装。'
}else{
  $outFile=if($OutputPath){[IO.Path]::GetFullPath($OutputPath)}else{Join-Path $projectRoot 'output/hap/pengan-0.1.0-api11-device-debug.hap'}
  Copy-Item -LiteralPath $signedHap -Destination $outFile -Force
  Write-Output ('设备绑定的开发签名HAP已生成并验签：'+$outFile)
  Write-Output '尚未安装；实际设备是否信任SDK测试证书仍需验证，不修改设备信任配置。'
}
