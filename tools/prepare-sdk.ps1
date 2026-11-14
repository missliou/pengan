param()
$ErrorActionPreference='Stop'
$projectRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$sdkRoot=Join-Path $projectRoot 'tmp/sdk'
New-Item -ItemType Directory -Force $sdkRoot | Out-Null
$archive=Join-Path $sdkRoot 'ohos-sdk-windows_linux-public.tar.gz'
$expected='67d532368880bef8a11ef2c7caa812501f19922c5815e59d1ca46b4460e1bdf9'
if(-not (Test-Path -LiteralPath $archive)){
  Write-Output '下载官方OpenHarmony4.1 SDK，约2.35GB，存放于项目tmp/sdk。'
  Invoke-WebRequest -Uri 'https://repo.huaweicloud.com/openharmony/os/4.1-Release/ohos-sdk-windows_linux-public.tar.gz' -OutFile $archive
}
if((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLower() -ne $expected){throw 'SDK校验失败，停止，不运行或解压该文件'}
$packages=Join-Path $sdkRoot 'packages'
$destination=Join-Path $sdkRoot 'api11'
New-Item -ItemType Directory -Force $packages,$destination | Out-Null
$tar=Join-Path $env:SystemRoot 'System32/tar.exe'
$selected=@('toolchains','ets','js')
$archiveEntries=@($selected | ForEach-Object {'ohos-sdk/windows/'+$_+'-windows-x64-4.1.7.5-Release.zip'})
& $tar -xzf $archive -C $packages @archiveEntries
if($LASTEXITCODE -ne 0){throw 'SDK组件提取失败'}
Add-Type -AssemblyName System.IO.Compression.FileSystem
foreach($component in $selected){
  $zipPath=Join-Path $packages ('ohos-sdk/windows/'+$component+'-windows-x64-4.1.7.5-Release.zip')
  $zip=[IO.Compression.ZipFile]::OpenRead($zipPath)
  try{
    foreach($entry in $zip.Entries){
      $target=[IO.Path]::GetFullPath((Join-Path $destination $entry.FullName))
      if(-not $target.StartsWith($destination+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw '归档包含越界路径'}
      if($entry.FullName.EndsWith('/')){New-Item -ItemType Directory -Force $target | Out-Null;continue}
      New-Item -ItemType Directory -Force ([IO.Path]::GetDirectoryName($target)) | Out-Null
      [IO.Compression.ZipFileExtensions]::ExtractToFile($entry,$target,$true)
    }
  }finally{$zip.Dispose()}
}
Write-Output ('已校验并准备官方API11 SDK：'+$destination)
