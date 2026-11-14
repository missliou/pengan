# 2026-10-31 离线验证证据

- native-home-720x1280.jpg：官方API26 ArkUI Previewer实际输出，未修改图片内容，对应HAP候选SHA256 0e55f110f22c358d9af7bf8b381ba00591b0ae5321940ec96fdbfc38de26d1b5。不是HTML；SDK系统服务为mock，开发板系统栏与实物功能仍待验收。复现见native-preview.md。
- oled-normal-host.png、oled-sensor-failed-host.png、oled-heartbeat-host.gif：实际C绘图函数与字库生成的主机帧缓存，明确有HOST FRAMEBUFFER标记。输入25.3℃/63.8%/ADC1450为合成测试值，不是实物照片或传感器数据。真实OLED显示/I²C时序仍待上板。
- oled-manifest.json：固件绘图源码哈希、尺寸、动画帧间隔与非实物标记。

56项Node回归通过；原生OS接口部分使用明确的主机模拟，MQTT/HTTP使用真实本机回环通信，跨进程串口测试只在系统TEMP回放日志。不打开串口、不调用外部模型。详细日志位于开发机tmp/verification/offline-final-tests.log，临时日志不纳入交付包。

当前设备未连接；最新HAP未签名、未安装，HH-HSP101 0.1.2固件未烧录。历史0.1.1实物联调证据另存，不能用来宣称本轮候选已验收。
