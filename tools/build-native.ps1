param(
  [string]$SdkPath='',
  [string]$JavaHome=''
)
$ErrorActionPreference='Stop'
$projectRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$sourceRoot=Join-Path $projectRoot 'openharmony'
if(-not $SdkPath){$SdkPath=Join-Path $projectRoot 'tmp/sdk/api11'}
$SdkPath=(Resolve-Path -LiteralPath $SdkPath).Path
foreach($component in @('ets','js','toolchains')){
  if(-not (Test-Path -LiteralPath (Join-Path $SdkPath ($component+'/oh-uni-package.json')))){
    throw ('SDK组件不完整：'+$component)
  }
}
$node=(Get-Command node -ErrorAction Stop).Source
if(-not (Test-Path -LiteralPath (Join-Path $sourceRoot 'node_modules/@ohos/hvigor/bin/hvigor-simple.js'))){
  throw '先在 openharmony 目录执行 npm ci --ignore-scripts 安装构建依赖。'
}
if($JavaHome){
  if(-not (Test-Path -LiteralPath (Join-Path $JavaHome 'bin/java.exe'))){throw 'Java路径无效'}
  $env:JAVA_HOME=$JavaHome
  $env:PATH=(Join-Path $JavaHome 'bin')+';'+$env:PATH
}
# Fresh ASCII build directory avoids Hvigor's Chinese-path restriction and stale source files.
$buildId='pengan-native-'+[Guid]::NewGuid().ToString('N').Substring(0,12)
$buildRoot=Join-Path $env:TEMP $buildId
$sdkContainer=Join-Path $buildRoot 'sdk'
New-Item -ItemType Directory -Force $buildRoot,$sdkContainer | Out-Null
Get-ChildItem -LiteralPath $sourceRoot -Force |
  Where-Object Name -NotIn @('node_modules','.hvigor','local.properties','build') |
  Copy-Item -Destination $buildRoot -Recurse -Force
New-Item -ItemType Junction -Path (Join-Path $buildRoot 'node_modules') -Target (Join-Path $sourceRoot 'node_modules') | Out-Null
New-Item -ItemType Junction -Path (Join-Path $sdkContainer '11') -Target $SdkPath | Out-Null
[IO.File]::WriteAllText((Join-Path $buildRoot 'local.properties'),('sdk.dir='+$sdkContainer.Replace('\','/')+"`n"))
$outputDir=Join-Path $projectRoot 'output/hap'
New-Item -ItemType Directory -Force $outputDir | Out-Null
$buildLog=Join-Path $outputDir 'build-native.log'
Push-Location -LiteralPath $buildRoot
try{
  & $node 'node_modules/@ohos/hvigor/bin/hvigor-simple.js' --mode module -p product=default -p module=entry@default assembleHap --no-daemon 2>&1 | Tee-Object -FilePath $buildLog
  if($LASTEXITCODE -ne 0){throw ('原生编译失败，日志：'+$buildLog)}
  $builtHap=Join-Path $buildRoot 'entry/build/default/outputs/default/entry-default-unsigned.hap'
  if(-not (Test-Path -LiteralPath $builtHap)){throw '未找到编译产物，不能报告构建成功'}
  $artifact=Join-Path $outputDir 'pengan-0.1.0-api11-unsigned.hap'
  Copy-Item -LiteralPath $builtHap -Destination $artifact -Force
  $manifest=[ordered]@{
    artifact='pengan-0.1.0-api11-unsigned.hap'
    sha256=(Get-FileHash -LiteralPath $artifact -Algorithm SHA256).Hash.ToLower()
    bytes=(Get-Item -LiteralPath $artifact).Length
    builtAt=[DateTimeOffset]::Now.ToString('o')
    buildDirectory=$buildRoot
    bundleName='com.pengan.greenhouse'
    minApi=11
    targetApi=11
    sdk='4.1.7.5'
    hvigor='4.1.2'
    signed=$false
    installedOnDevice=$false
  }
  $manifest | ConvertTo-Json -Depth 4 | Set-Content -Encoding UTF8 (Join-Path $outputDir 'build-manifest.json')
  Write-Output ('原生HAP编译成功（未签名）：'+$artifact)
  Write-Output ('构建副本保留在：'+$buildRoot)
} finally {Pop-Location}
