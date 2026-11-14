# DAYU200原生直采接线交接

任务NATIVE-DIRECT-UI-20261102，执行者Codex。只读子智能体审查已完成，没有写共享文件。基线原生43文件/指纹bd241fc04584d80bd44b4346726d61a7694a80b4d126fe496b3c0eaba65dfded。本轮新指纹45文件/2f6835c855262b959dfd7c9b8d93bd7a74a305cca623fbaa2491df8ef6ba05dc。

## 代码与接口

- 新增DirectConnectionSettings.ets：独立原生Preferences，单JSON保存采集模式与裸私网IPv4。默认direct/IP空，不猜地址、不回退旧网关；不保存密钥或Wi-Fi密码。损坏配置不自动覆盖；flush失败报告结果未确认，不切换当前来源并关闭后续写入口，需重启核对。
- 新增DirectHardwareView.ets：调用真实DirectTelemetry，按quality显示温湿度和MQ-2原始ADC；currentSnapshot本地老化，不映射到模拟EnvSnapshot。重复帧只沿用原截止时间；读取异常后不由缓存重新刷成正常，必须下一份新有效帧才能恢复。固定私网HTTP80和/api/pengan/telemetry。
- Index.ets原生诊断页新增来源选择、采集板IP、保存与状态，默认本地直采；电脑临时网关作为显式选项保留。两套配置独立载入，服务端地址载入失败不会阻断已配置的本地直采。每2秒轮询，前台显示时每秒独立裁剪时效；页面/前后台/来源变化作废旧结果。
- 本地直采尚未认证上传Ubuntu：环境分析、两类旧网关历史和报告在真实方法入口拦截，防止旧服务端数据冒充本地现场。照片分析与合成模型测试保留，明确独立使用服务端地址，不自动携带本地环境。没有加入未认证上报端点或将HH-HSP私网IP交给云端读取。
- tools/verify-offline.ps1纳入admin-ui/test下*.test.mjs。tools/package-release.mjs纳入admin-ui及根目录规则/待办/AGENTS/QWEN/目录导航；继续排除SDK、node_modules、tmp、私钥/设备绑定签名等。打包不删除源码，旧HAP另存在output/hap/history/。

## 实际验证

- gateway/test/native-direct-ui.test.mjs新增7项：配置/IP/重载/flush失败、损坏不覆盖、空IP零请求、真实格式采集与10秒截止、重复与错误后不复活、通道失效、来源切换迟到、直接执行Index真实方法守卫确认旧网关零请求。执行真实非UI ArkTS服务并注入明确OS/HTTP桩，不是ArkUI/实板验收。
- 定向77项（7新+28直采+42Web）全部通过。初次将旧回环集成测试放在沙箱内出现fetch failed；获准回环运行后完整回归通过，未削弱断言或改为假通过。
- 完整离线套件：195项，194通过、0失败、1跳过；工程/HAP/串口解析通过。日志tmp/verification/offline-suite/20261102-104939-616/。跳过项为既有串口桥环境探测，不是新功能验收。
- 官方SDK26.0.0.38、Hvigor6.26.8、JDK25.0.5.0.2实际BUILD SUCCESSFUL，独立HAP检查通过。构建先在sandbox中因目录联接权限失败，获准的隔离构建完成；日志tmp/verification/native-direct-ui-20261102/build.log与output/hap/openharmony7/build-native.log。
- 候选output/hap/openharmony7/pengan-0.1.0-api26.0.0-unsigned.hap，1647473字节，SHA256 2bf5a413e2062780cdcc56fa10745d12e7074a8fbb40e32e084ab0d230247916；Ark字节码存在、无Web页面、未签名/未安装。保留既有音频/crypto SysCap及异常处理警告。前一候选备份pengan-before-direct-ui-0338ec86753c.hap。

## 接板验证步骤与尚未完成

1. 先核对DAYU200当前系统/API及设备连接，再签名安装此候选；没有本轮装机结果。不要用旧版本屏幕录像验收新诊断页。
2. HH-HSP101需有局域网遥测固件（本项目0.1.3候选尚未实物Wi-Fi验收），两块板加入同一局域网；从采集板OLED/路由器确认真实IP。
3. 原生设备诊断选择“采集板直连”，填写裸IP并保存；回首页核对实际温湿度/ADC与来源dayu-direct。HH-HSP101只需局域网回传，不要求自己访问模型互联网。
4. 拔采集板网络/停止帧、模拟通道异常、切后台/来源并恢复，验证未知、重复不续命和迟到不串来源；实测配置重启恢复及720×1280布局/系统栏。
5. 环境AI正式能力下一阶段需要设备身份、认证HTTPS上报、云端按设备/会话隔离的实时观测和历史；完成后再解除直采守卫，不能通过直接调用旧gateway.analyze冒充接入。还需管理鉴权、持久目录和Ubuntu部署验收。

本轮未改固件和gateway业务协议，未连接真实模型、未安装/烧录、未实板无线验收、未部署Ubuntu；只证明上述主机逻辑及HAP构建。发布包与文件位置通过现有工具重新生成/校验后，以output清单为准。任务收尾时由Codex释放自身锁，保留其他执行者的历史锁文件。

## 发布校验收尾

本轮源码ZIP已重建（286项、3157214字节），独立CRC、逐文件SHA256、45个原生源文件指纹核对通过；归档SHA256为60514343d99ceff49b802264895bcfc786e06551e7c1582c8c558c3e2b372a09。output/release/verification-api26.json与output/交付文件位置.md均已由现有工具生成。旧ZIP备份output/release/history/，原件源码保留。归档是打包时快照，本收尾记录随后写入；最终源码/候选及后续状态以工作区清单为准。自己的NATIVE-DIRECT-UI锁释放，临时浏览器前后端测试会话已结束；其他执行者历史锁保留。
