param([string]$HdcPath='')
$ErrorActionPreference='Stop'
if(-not $HdcPath){
  $candidate=Get-Command hdc -ErrorAction SilentlyContinue
  if($candidate){$HdcPath=$candidate.Source}
}
if(-not $HdcPath -or -not (Test-Path -LiteralPath $HdcPath -PathType Leaf)){
  Write-Output '未找到 hdc。请使用 -HdcPath 指定官方 SDK 中 hdc.exe 的路径。'
  exit 2
}
Write-Output '只读检查：设备列表、系统版本和 API；不安装、不重刷、不修改设置。'
& $HdcPath list targets
& $HdcPath shell param get const.ohos.apiversion
& $HdcPath shell param get const.ohos.fullname
& $HdcPath shell param get const.product.software.version
