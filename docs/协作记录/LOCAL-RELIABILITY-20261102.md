# 本机开发与原生会话可靠性

用户明确尚未准备服务器，继续本机开发，不再等待服务器路径。任务LOCAL-RELIABILITY-20261102，Codex；基线原生077b3697…/46文件、上轮ZIP80289b00…；修改DirectTelemetry.ets、native-direct-vectors.test.mjs、setup_cloud.py与运行文档，构建/打包候选并保存共享进度。

发现invalidate在页面/后台切换时清除lastUptime/sessionBootId，导致正常页面切换冒充板子重启；云端退役会话有128个上限，频繁切页面可能耗尽，而且冻结帧可能重新被接受。修正为仅清可见缓存/作废迟到响应，保留会话、最后uptime及原接收时间；同一IP重新配置同样失效但不换身份，真正换IP清旧身份，uptime回退仍合成新启动会话。回前台必须收到新的uptime才能恢复有效数据，不从清空的缓存恢复旧正常值。

新增2项真实模块回归，包含140次页面失效循环、同IP/不同IP、冻结旧帧不续期；定向37项通过。统一230项229通过/1跳过/0失败，工程/HAP/串口解析通过，日志tmp/verification/offline-suite/20261102-114450-738/。本轮不是离线补发队列实现，未更改“一帧仅尝试一次、失败明确未确认”策略。

新增setup_cloud.py --local，固定http://127.0.0.1:5201；用户可在源码之外创建本机持久账号/数据目录，便于无服务器时使用正式Web登录和记录功能。原生CloudUpload仍拒绝HTTP设备令牌，不将本机测试模式扩成公网明文接口。独立临时目录验证local配置及Python scrypt→Node登录兼容通过，未生成真实账号或常驻服务。

实际API26编译成功，HAP1686309字节，SHA256 70cf7935400f3607d9abd94c591f8d8197ad557130ccfd761a975bc80ef434fa；源46文件/指纹d41c07566347fdb1e62446a8c87279f2fc01a07397521bbbf07ceb233d9087c3。前一HAP已备份output/hap/history/pengan-before-reliability-3515d05d11eb.hap。未签名/装机/烧录/外部模型/真实TLS或Ubuntu部署。后续仍需离线补发、长期安全凭据、原生历史报告迁移等；先按本机运行说明继续，不反复索要服务器。

候选重新打包和独立校验后以output/交付文件位置.md为准；自己任务锁收尾释放，其他执行者历史锁不改。原始源码及旧候选保留。
