param(
  [ValidateSet('deepseek','qwen')][string]$Provider,
  [string]$Model
)
$ErrorActionPreference='Stop'
if(-not $Provider){$Provider=Read-Host '服务商（deepseek 或 qwen）'}
if($Provider -notin @('deepseek','qwen')){throw '服务商不支持'}
if(-not $Model){$Model=Read-Host '模型名称（填写账户实际可用且支持工具调用的模型）'}
if($Model -notmatch '^[A-Za-z0-9._:/-]{1,150}$'){throw '模型名称格式无效'}
$secret=Read-Host 'API密钥（隐藏输入，仅保存到电脑服务端）' -AsSecureString
$pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
try {
  $key=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer).Trim()
  if($key -notmatch '^[A-Za-z0-9._-]{8,500}$'){throw '密钥格式无效；未保存配置'}
  $file=Join-Path $PSScriptRoot '../gateway/.env'
  if(Test-Path -LiteralPath $file){
    $existing=[IO.File]::ReadAllText([IO.Path]::GetFullPath($file))
    $existing=($existing -split "`r?`n" | Where-Object {$_ -notmatch '^\s*PENGAN_AI_(PROVIDER|MODEL|KEY)\s*='}) -join "`n"
  }else{$existing=''}
  $text=$existing.TrimEnd()+"`nPENGAN_AI_PROVIDER=$Provider`nPENGAN_AI_MODEL=$Model`nPENGAN_AI_KEY=$key`n"
  [IO.File]::WriteAllText([IO.Path]::GetFullPath($file),$text,(New-Object Text.UTF8Encoding($false)))
  Write-Output '模型配置已保存到gateway/.env。重启电脑网关后生效；不要分享此文件或密钥。'
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  $key=$null
  $text=$null
}
