# 原生上传器交接（待协调者汇总）

任务NATIVE-CLOUD-UPLOAD-20261102；执行者native_uploader。修改Index.ets、DirectHardwareView.ets；新增CloudUpload.ets、gateway/test/native-cloud-upload.test.mjs。DirectTelemetry未改，未触碰共享清单、构建产物、网关和Web源码。

CloudUpload强制HTTPS，内存令牌，不写首选项/台账/日志；重启重输。诊断页明确输入登记ID与设备令牌、使用已保存服务地址，启用后每个新鲜帧只尝试上传一次，失败不重试旧帧。/api/v1/telemetry/current POST Bearer+X-Pengan-Sent-At+X-Pengan-Gateway-Id；3秒、maxRedirects0、请求4096字节/响应65536上限。原生API会话变更丢弃迟到结果，物理请求锁直至transport结束。DirectHardwareView只导出confirmed且尚新鲜rawframe，保留采样年龄。

直采环境分析只在设备会话显式启用后改走/api/v1/device/analyze，返回必须gatewayId匹配、只读HardwareAnalysis，在线时sessionBootId还须匹配本地采集会话；不会调用旧网关环境分析。旧历史/报告守卫仍保留，尚未实现原生device/history或observations GET显示。服务端地址改变会清除内存设备会话，前后台/来源变动作废迟到响应。

4项新增主机测试执行真实ArkTS源码：HTTPS与请求头、时效/回执、物理串行、迟到上下文、设备/会话分析隔离；加原7项直采UI测试合计11项通过。未自行构建HAP，由协调者统一编译；未装机、未真实设备/云端/模型验收。未实现HUKS长期设备令牌保存（采用明确的会话内录入），登记ID亦暂未独立持久化。现有照片和合成测试仍用GatewayLink，若云端禁止匿名，应由后续device端点接线；不要声称这些已完成云端迁移。

父代理需统一构建并校验接口、UI及历史接线。任务文件落稳，自己的锁释放；待办/进度由协调者更新。

## 后续照片/合成测试接线完成

CloudUpload补testModel()和inspectImage()，Index在cloudSessionReady时改走device/test和device/inspect-image（Bearer+登记ID），35秒超时，不再把已启用的设备会话误送到匿名旧网关。两种响应均要求gatewayId匹配；合成测试证明未发现场/图像/未执行，图片沿用完整只读协议及2MiB编码、条目/文本、SHA256和时间边界。云会话替换/关闭同时清除图片/模型测试epoch，旧响应不能串会话。未启用设备会话时仍保留电脑临时GatewayLink路径。

环境分析加强findings最多10、unknowns最多12、每条1000字；deviceOnline=true但expectedSession为空同样拒绝。新增3项真实模块测试，native-cloud-upload共7项，通过；与既有直采UI合计14项通过。仍未自行构建/安装，由父代理统一编译。device/history/observations GET及长期凭据存储不在此次补充交付中。
