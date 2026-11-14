param(
 [string]$BuildDirectory='',
 [switch]$CompilePreview,
 [ValidateRange(240,4096)][int]$Width=720,
 [ValidateRange(240,4096)][int]$Height=1280,
 [ValidateRange(80,640)][int]$Density=320,
 [string]$OutputDirectory='',
 [int]$ClickX=-1,
 [int]$ClickY=-1
)
$ErrorActionPreference='Stop'
$workspace=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$out=Join-Path $workspace 'tmp/verification/preview'
if($OutputDirectory){$out=[IO.Path]::GetFullPath($OutputDirectory);if(-not $out.StartsWith([IO.Path]::GetFullPath((Join-Path $workspace 'tmp/verification'))+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Output must be under workspace tmp/verification'}}
New-Item -ItemType Directory -Force $out | Out-Null
# Never attach to an unrelated preview session already using this endpoint.
$portProbe=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,53127)
try {$portProbe.Start()} catch {throw 'Localhost 53127 is already in use; close the other preview session first'} finally {$portProbe.Stop()}
if(-not $BuildDirectory){$BuildDirectory=(Get-Content (Join-Path $workspace 'output/hap/openharmony7/build-manifest.json') -Raw | ConvertFrom-Json).buildDirectory}
if(-not(Test-Path -LiteralPath $BuildDirectory)){throw 'Native temporary build directory does not exist; compile the HAP first'}
if($CompilePreview){
 $compileOut=Join-Path $out 'compile-repro.log'
 $compileErr=Join-Path $out 'compile-repro-error.log'
 $node=(Get-Command node).Source
 $compileArgs=@('node_modules/@ohos/hvigor/bin/hvigor.js','--mode','module','-p','product=default','-p','module=entry@default','-p','previewMode=true','-p','buildRoot=.preview','-p','previewer.replace.page=pages/Index','PreviewBuild','--no-daemon')
 $compiler=Start-Process -FilePath $node -ArgumentList $compileArgs -WorkingDirectory $BuildDirectory -WindowStyle Hidden -RedirectStandardOutput $compileOut -RedirectStandardError $compileErr -PassThru
 try {
  $deadline=[DateTime]::UtcNow.AddSeconds(90)
  $compiled=$false
  while([DateTime]::UtcNow -lt $deadline){
   if((Test-Path $compileOut) -and (Select-String -LiteralPath $compileOut -SimpleMatch 'BUILD SUCCESSFUL' -Quiet)){$compiled=$true;break}
   if($compiler.HasExited){break}
   Start-Sleep -Milliseconds 200
  }
  if(-not $compiled){throw ('Native preview compile failed or timed out; see '+$compileOut)}
 } finally {if(-not $compiler.HasExited){Stop-Process -Id $compiler.Id}}
}
if(-not(Test-Path (Join-Path $BuildDirectory 'entry/.preview/default/intermediates/loader_out/default/ets/modules.abc'))){throw 'Preview bytecode missing; run with -CompilePreview'}
if(-not ('NativePreviewIO' -as [type])){Add-Type -TypeDefinition @'
using System; using System.IO; using System.IO.Pipes; using System.Threading; using System.Threading.Tasks; using System.Net.WebSockets;
public class NativePreviewIO {
 public static async Task Drain(NamedPipeServerStream p,string file) {try {await p.WaitForConnectionAsync(); using(var f=File.Create(file)){var b=new byte[65536];int n;while((n=await p.ReadAsync(b,0,b.Length))>0){await f.WriteAsync(b,0,n);await f.FlushAsync();}}}catch(Exception) {}}
 public static async Task Capture(string file,NamedPipeServerStream commandPipe,int clickX,int clickY) {
  using(var timeout=new CancellationTokenSource(12000)) {
   ClientWebSocket ws=null;
   for(int i=0;i<60;i++){try {ws=new ClientWebSocket();ws.Options.AddSubProtocol("ws");await ws.ConnectAsync(new Uri("ws://127.0.0.1:53127"),timeout.Token);break;}catch {if(ws!=null)ws.Dispose();ws=null;await Task.Delay(100);}}
   if(ws==null)throw new Exception("Native preview websocket did not start");
   using(ws) {
    var b=new byte[65536]; byte[] latest=null; bool clicked=false; var settleUntil=DateTime.UtcNow.AddSeconds(3);
    using(var end=new CancellationTokenSource(7000)) {
     try {while(true) {using(var message=new MemoryStream()) {WebSocketReceiveResult r; do {r=await ws.ReceiveAsync(new ArraySegment<byte>(b),end.Token);message.Write(b,0,r.Count);}while(!r.EndOfMessage);latest=message.ToArray();}
      if(clickX<0){if(DateTime.UtcNow>=settleUntil)break;continue;}
      if(!clicked) {File.WriteAllBytes(file+".before",latest);await Task.Delay(500);foreach(var command in new[]{"MousePress","MouseRelease"}) {var json="{\"version\":\"1.0.1\",\"type\":\"action\",\"command\":\""+command+"\",\"args\":{\"x\":"+clickX+",\"y\":"+clickY+"}}\0";var bytes=System.Text.Encoding.UTF8.GetBytes(json);await commandPipe.WriteAsync(bytes,0,bytes.Length);await commandPipe.FlushAsync();await Task.Delay(150);}clicked=true;}
     }}catch(OperationCanceledException) {}
    }
    if(latest==null)throw new Exception("No native frame received");File.WriteAllBytes(file,latest);
   }
  }
 }
}
'@
}
$bin=Join-Path $workspace 'tmp/sdk/7.0-release/api26/previewer/common/bin'
$root=Join-Path $BuildDirectory 'entry/.preview/default/intermediates'
$commandPipe=[IO.Pipes.NamedPipeServerStream]::new('pengan_preview_commandPipe',[IO.Pipes.PipeDirection]::InOut,1,[IO.Pipes.PipeTransmissionMode]::Message,[IO.Pipes.PipeOptions]::Asynchronous,65536,65536)
$tracePipe=[IO.Pipes.NamedPipeServerStream]::new('pengan_trace',[IO.Pipes.PipeDirection]::InOut,1,[IO.Pipes.PipeTransmissionMode]::Message,[IO.Pipes.PipeOptions]::Asynchronous,65536,65536)
$ct=[NativePreviewIO]::Drain($commandPipe,(Join-Path $out 'capture-command.bin'))
$tt=[NativePreviewIO]::Drain($tracePipe,(Join-Path $out 'capture-trace.bin'))
$p=$null
try {
 $launch=@('-j',($root+'/loader_out/default/ets'),'-ljPath',($root+'/loader/default/loader.json'),'-arp',($root+'/res/default'),'-s','pengan_preview','-ts','pengan_trace','-n','entry','-device','phone','-shape','rect','-sd',"$Density",'-or',"$Width","$Height",'-cr',"$Width","$Height",'-av','ACE_2_0','-url','pages/Index','-pages','main_pages','-pm','Stage','-l','zh_CN','-cm','light','-o','portrait','-lws','53127')
 $p=Start-Process -FilePath ($bin+'/Previewer.exe') -ArgumentList $launch -WorkingDirectory $bin -WindowStyle Hidden -RedirectStandardOutput (Join-Path $out 'capture-render.log') -RedirectStandardError (Join-Path $out 'capture-render-error.log') -PassThru
 $capture=[NativePreviewIO]::Capture((Join-Path $out 'native-frame.bin'),$commandPipe,$ClickX,$ClickY)
 $null=$capture.GetAwaiter().GetResult()
 $frame=[IO.File]::ReadAllBytes((Join-Path $out 'native-frame.bin'))
 $start=-1
 for($i=0;$i -lt $frame.Length-2;$i++){if($frame[$i] -eq 255 -and $frame[$i+1] -eq 216 -and $frame[$i+2] -eq 255){$start=$i;break}}
 if($start -lt 0){throw 'Native frame has no JPEG marker; raw bytes retained'}
 [IO.File]::WriteAllBytes((Join-Path $out "native-${Width}x${Height}.jpg"),$frame[$start..($frame.Length-1)])
 Write-Output ('Native JPEG saved, transport header bytes: '+$start)
} catch {
 $_ | Out-String | Set-Content -LiteralPath (Join-Path $out 'capture-failure.txt') -Encoding utf8
 throw
} finally {
 if($p -and -not $p.HasExited){Stop-Process -Id $p.Id}
 $commandPipe.Dispose();$tracePipe.Dispose()
}
