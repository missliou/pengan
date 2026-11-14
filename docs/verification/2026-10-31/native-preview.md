# OpenHarmony 7 / API26 原生离线预览验证

2026-10-31 已实测成功。`native-720x1280.jpg` 来自 SDK `Previewer.exe` 的 ArkUI 原生渲染输出，经其 localhost WebSocket 接收，移除官方 40 字节传输头后直接保存 JPEG；不是 HTML 仿图，也未对图片内容进行修改。

最终验证对象：`C:/Users/ASUS/AppData/Local/Temp/pengan-oh7-fe7c2bab533d`，对应原生候选 `0e55f110f22c358d9af7bf8b381ba00591b0ae5321940ec96fdbfc38de26d1b5` 的构建副本，包含相机短写修复。最终 JPEG 已读取确认尺寸 720×1280，SHA256 为 `0341bcba8cf9dcf7560b056ddd604c9532636b1e98d0576bddbe574200e18135`。业务源码、正式 HAP 构建清单均未修改。真实开发板系统栏、硬件、相机仍待板端验收；原生预览的系统服务是 SDK mock，页面上的模拟环境数值不是实物采集。

复现（PowerShell，需允许临时构建目录读写）：

```powershell
./tools/preview-native7.ps1 -CompilePreview
```

默认从 `output/hap/openharmony7/build-manifest.json` 读取当前临时构建副本，也可传 `-BuildDirectory`。成功会生成 `tmp/verification/preview/native-720x1280.jpg`。SDK 路径按仓库现有 `tmp/sdk/7.0-release/api26`；一次只运行一个实例，localhost 53127 需空闲。脚本不签名、不安装、不接触开发板、不修改业务页面。

关键实现：Hvigor 任务名为大小写敏感的 `PreviewBuild`；需要 `-p previewMode=true -p buildRoot=.preview -p previewer.replace.page=pages/Index`。Windows 命名管道 `pengan_preview_commandPipe` 与 `pengan_trace` 必须持续异步消费，防止缓冲写满导致启动阻塞。必须提供预览 `loader.json`；使用预览器 bin 为工作目录。官方 WebSocket 图像协议子协议为 `ws`，服务仅绑定 `127.0.0.1`。脚本有编译 90 秒、截图 12 秒上限，并在结束时清理自己启动的进程。

证据：`compile-repro.log` 编译成功；`capture-render.log` 的 `Get first render buffer`；`native-frame.bin` 是原始传输数据；`capture-command.bin` 含真实 ArkUI inspector 树；`capture-trace.bin` 含渲染阶段 trace。初次失败尝试保留在 `compile.log`、`compile-previewmode.log`、`render*.log`。未持续消费管道的早期尝试曾有访问违规 `0xc0000005` 或启动阻塞，后来完整管道处理后实际成功，故不能把早期失败直接归因于应用。

官方源码参考：

- https://github.com/openharmony/ide_previewer/blob/master/README.md
- https://github.com/openharmony/ide_previewer/blob/master/util/CommandParser.cpp
- https://github.com/openharmony/ide_previewer/blob/master/util/WebSocketServer.h
- https://github.com/openharmony/ide_previewer/blob/master/mock/rich/VirtualScreenImpl.cpp
- https://github.com/openharmony/ide_previewer/blob/master/util/windows/LocalSocket.cpp
