param(
  [Parameter(Mandatory=$true)][string]$SdkPath,
  [Parameter(Mandatory=$true)][string]$JavaHome,
  [string]$BuildToolsPath=''
)
$ErrorActionPreference='Stop'
$projectRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$sourceRoot=Join-Path $projectRoot 'openharmony'
$sourceFingerprint=& node (Join-Path $projectRoot 'tools/native-source.mjs') | ConvertFrom-Json
if($LASTEXITCODE -ne 0 -or -not $sourceFingerprint.sha256){throw '原生源码指纹计算失败'}
$SdkPath=(Resolve-Path -LiteralPath $SdkPath).Path
if(-not $BuildToolsPath){$BuildToolsPath=Join-Path $projectRoot 'tmp/build-tools/7.0'}
$BuildToolsPath=(Resolve-Path -LiteralPath $BuildToolsPath).Path
$metadata=Get-Content -LiteralPath (Join-Path $SdkPath 'ets/oh-uni-package.json') -Raw | ConvertFrom-Json
foreach($component in @('ets','js','toolchains')){
  $part=Get-Content -LiteralPath (Join-Path $SdkPath ($component+'/oh-uni-package.json')) -Raw | ConvertFrom-Json
  if($part.apiVersion -ne $metadata.apiVersion -or $part.version -ne $metadata.version){throw 'SDK组件版本不一致'}
}
if($metadata.version -notmatch '^(7\.|26\.)'){throw '请提供官方OpenHarmony7.0对应SDK，不能只修改API数字'}
$api=[string]$metadata.platformVersion
if(-not $api){throw 'API26 SDK缺少platformVersion，停止猜测配置'}
if($api -notmatch '^\d+(\.\d+\.\d+)?$'){throw 'SDK apiVersion格式未知，请先核对元数据'}
$hvigorPackage=Join-Path $BuildToolsPath 'node_modules/@ohos/hvigor/package.json'
$pluginPackage=Join-Path $BuildToolsPath 'node_modules/@ohos/hvigor-ohos-plugin/package.json'
$hvigor=Get-Content -LiteralPath $hvigorPackage -Raw | ConvertFrom-Json
$plugin=Get-Content -LiteralPath $pluginPackage -Raw | ConvertFrom-Json
if($hvigor.version -ne $plugin.version){throw 'Hvigor与插件版本不一致'}
if(-not(Test-Path -LiteralPath (Join-Path $JavaHome 'bin/java.exe'))){throw 'JDK路径无效'}
$env:JAVA_HOME=$JavaHome
$env:PATH=(Join-Path $JavaHome 'bin')+';'+$env:PATH
$buildRoot=Join-Path $env:TEMP ('pengan-oh7-'+[Guid]::NewGuid().ToString('N').Substring(0,12))
New-Item -ItemType Directory -Force $buildRoot,(Join-Path $buildRoot 'sdk') | Out-Null
Get-ChildItem -LiteralPath $sourceRoot -Force | Where-Object Name -NotIn @('node_modules','.hvigor','local.properties','build') | Copy-Item -Destination $buildRoot -Recurse -Force
New-Item -ItemType Junction -Path (Join-Path $buildRoot 'node_modules') -Target (Join-Path $BuildToolsPath 'node_modules') | Out-Null
# Keep executable toolchains under an actual ASCII build path. A/B verification
# showed identical restool fails from the original project location but succeeds
# from an ASCII copy; do not modify the user's SDK or disable system protections.
$isolatedSdk=Join-Path $buildRoot ('sdk/'+$api)
New-Item -ItemType Directory -Path $isolatedSdk | Out-Null
foreach($sdkEntry in Get-ChildItem -LiteralPath $SdkPath -Force){
 if($sdkEntry.Name -eq 'ets' -and $sdkEntry.PSIsContainer){
  $isolatedEts=Join-Path $isolatedSdk 'ets';New-Item -ItemType Directory -Path $isolatedEts | Out-Null
  foreach($etsEntry in Get-ChildItem -LiteralPath $sdkEntry.FullName -Force){
   if($etsEntry.PSIsContainer -and $etsEntry.Name -ne 'build-tools'){
    New-Item -ItemType Junction -Path (Join-Path $isolatedEts $etsEntry.Name) -Target $etsEntry.FullName | Out-Null
   }else{Copy-Item -LiteralPath $etsEntry.FullName -Destination $isolatedEts -Recurse -Force}
  }
 }elseif($sdkEntry.PSIsContainer -and $sdkEntry.Name -ne 'toolchains'){
  New-Item -ItemType Junction -Path (Join-Path $isolatedSdk $sdkEntry.Name) -Target $sdkEntry.FullName | Out-Null
 }else{Copy-Item -LiteralPath $sdkEntry.FullName -Destination $isolatedSdk -Recurse -Force}
}
$utf8=New-Object System.Text.UTF8Encoding($false)
$writeJson={param($relative,$value) [IO.File]::WriteAllText((Join-Path $buildRoot $relative),($value | ConvertTo-Json -Depth 15),$utf8)}
$profile=Get-Content -LiteralPath (Join-Path $buildRoot 'build-profile.json5') -Raw | ConvertFrom-Json
$profile.app.products[0].compileSdkVersion=$api
$profile.app.products[0].compatibleSdkVersion=$api
$profile.app.products[0] | Add-Member -NotePropertyName targetSdkVersion -NotePropertyValue $api -Force
& $writeJson 'build-profile.json5' $profile
[IO.File]::WriteAllText((Join-Path $buildRoot 'entry/src/main/ets/model/AppBuildInfo.ets'),("export const COMPILE_API: string = '"+$api+"';`nexport const COMPILE_SDK: string = '"+$metadata.version+"';`n"),$utf8)
$modelVersion='6.0.0'
$config=Get-Content -LiteralPath (Join-Path $buildRoot 'hvigor/hvigor-config.json5') -Raw | ConvertFrom-Json
$config.modelVersion=$modelVersion
& $writeJson 'hvigor/hvigor-config.json5' $config
$package=Get-Content -LiteralPath (Join-Path $buildRoot 'oh-package.json5') -Raw | ConvertFrom-Json
$package.modelVersion=$modelVersion
& $writeJson 'oh-package.json5' $package
[IO.File]::WriteAllText((Join-Path $buildRoot 'local.properties'),('sdk.dir='+(Join-Path $buildRoot 'sdk').Replace('\','/')+"`n"),$utf8)
$output=Join-Path $projectRoot 'output/hap/openharmony7'
New-Item -ItemType Directory -Force $output | Out-Null
Push-Location -LiteralPath $buildRoot
try {
  & node 'node_modules/@ohos/hvigor/bin/hvigor.js' --mode module -p product=default -p module=entry@default assembleHap --no-daemon 2>&1 | Tee-Object -FilePath (Join-Path $output 'build-native.log')
  if($LASTEXITCODE -ne 0){throw ('7.0构建失败，保留构建副本：'+$buildRoot)}
  $built=Join-Path $buildRoot 'entry/build/default/outputs/default/entry-default-unsigned.hap'
  if(-not(Test-Path -LiteralPath $built)){throw '未产生HAP，不能报告成功'}
  $sourceAfter=& node (Join-Path $projectRoot 'tools/native-source.mjs') | ConvertFrom-Json
  if($LASTEXITCODE -ne 0 -or $sourceAfter.sha256 -ne $sourceFingerprint.sha256){throw '编译期间原生源码已变化，拒绝发布此候选，请重新构建'}
  $name='pengan-0.1.0-api'+$api+'-unsigned.hap'
  Copy-Item -LiteralPath $built -Destination (Join-Path $output $name) -Force
  [ordered]@{artifact=$name;sha256=(Get-FileHash -LiteralPath $built -Algorithm SHA256).Hash.ToLower();bytes=(Get-Item -LiteralPath $built).Length;builtAt=[DateTimeOffset]::Now.ToString('o');buildDirectory=$buildRoot;bundleName='com.pengan.greenhouse';minApi=$api;targetApi=$api;sdk=$metadata.version;hvigor=$hvigor.version;nativeSourceSha256=$sourceFingerprint.sha256;nativeSourceFiles=$sourceFingerprint.files;signed=$false;installedOnDevice=$false} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $output 'build-manifest.json') -Encoding utf8
  Write-Output ('7.0原生编译成功，未签名：'+(Join-Path $output $name))
} finally {Pop-Location}
