param()
$ErrorActionPreference='Stop'
$projectRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$rawDir=Join-Path $projectRoot 'openharmony/entry/src/main/resources/rawfile'
$work=Join-Path $projectRoot 'tmp/audio'
New-Item -ItemType Directory -Force $rawDir,$work | Out-Null
$voice=New-Object -ComObject SAPI.SpVoice
$tokens=@($voice.GetVoices() | Where-Object {$_.GetDescription() -match 'Huihui|Chinese'})
if($tokens.Count -eq 0){throw '本机没有离线中文SAPI语音，未生成替代音频'}
$voice.Voice=$tokens[0]
$voice.Rate=0
$clips=[ordered]@{
  co_high='模拟一氧化碳超标，禁止入棚。请先通风，再复测。'
  co2_high='模拟二氧化碳超标，禁止入棚。请先通风，再复测。'
  sensor_invalid='模拟传感数据不可用，禁止入棚。请检查设备连接。'
  emergency='急停已触发，模拟执行器停止。请检查现场。'
  voice_test='棚安演示语音已就绪。当前为模拟模式。'
}
$manifest=@()
try{
  foreach($name in $clips.Keys){
    $wavePath=Join-Path $work ($name+'.wav')
    $stream=New-Object -ComObject SAPI.SpFileStream
    $format=New-Object -ComObject SAPI.SpAudioFormat
    $format.Type=18 # SAPI 16 kHz, 16 bit, mono.
    $stream.Format=$format
    try{
      $stream.Open($wavePath,3,$false)
      $voice.AudioOutputStream=$stream
      [void]$voice.Speak($clips[$name])
    }finally{$stream.Close();[void][Runtime.InteropServices.Marshal]::ReleaseComObject($stream);[void][Runtime.InteropServices.Marshal]::ReleaseComObject($format)}
    $bytes=[IO.File]::ReadAllBytes($wavePath)
    $offset=12;$dataStart=-1;$dataLength=0;$validFormat=$false
    while($offset+8 -le $bytes.Length){
      $kind=[Text.Encoding]::ASCII.GetString($bytes,$offset,4)
      $length=[BitConverter]::ToUInt32($bytes,$offset+4)
      $start=$offset+8
      if($start+$length -gt $bytes.Length){throw '语音WAV数据块越界'}
      if($kind -eq 'fmt '){
        $validFormat=[BitConverter]::ToUInt16($bytes,$start) -eq 1 -and [BitConverter]::ToUInt16($bytes,$start+2) -eq 1 -and [BitConverter]::ToUInt32($bytes,$start+4) -eq 16000 -and [BitConverter]::ToUInt16($bytes,$start+14) -eq 16
      }
      if($kind -eq 'data'){$dataStart=$start;$dataLength=[int]$length}
      $offset=$start+$length+($length%2)
    }
    if(-not $validFormat -or $dataStart -lt 0 -or $dataLength -le 0){throw '语音资源不是预期的PCM16/16kHz/mono'}
    $pcm=New-Object byte[] $dataLength
    [Buffer]::BlockCopy($bytes,$dataStart,$pcm,0,$dataLength)
    $output=Join-Path $rawDir ($name+'.pcm')
    [IO.File]::WriteAllBytes($output,$pcm)
    $manifest+=@{file=$name+'.pcm';text=$clips[$name];bytes=$dataLength;sampleRate=16000;channels=1;bits=16;sha256=(Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash.ToLower()}
  }
}finally{[void][Runtime.InteropServices.Marshal]::ReleaseComObject($voice)}
$manifest | ConvertTo-Json -Depth 4 | Set-Content -Encoding UTF8 (Join-Path $rawDir 'alert-assets.json')
Write-Output ('生成'+$manifest.Count+'段离线中文PCM语音；未播放到扬声器。')
