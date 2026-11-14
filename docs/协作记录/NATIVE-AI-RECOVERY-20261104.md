# NATIVE-AI-RECOVERY-20261104

执行者pipeline_rag_hook；待根协调者汇总。独占Index.ets、CloudUpload.ets及native-direct-ui/native-cloud-upload测试；未改共享清单、后端或DirectHardwareView机制。

修复P1：原生直采文字分析在助手页先实际poll采集新有效帧，再await上传回执，之后才向认证设备analyze发送相同sessionBootId。沿用原有采集去重/TTL，不保留切页前的confirmed，不使冻结旧帧续期。无法取得新有效帧、上传未确认、切页/上下文变化均不发送分析，不回退旧网关。analysis结果也核对hardwareEpoch与connectionEpoch。

修复P2：CloudUpload的http.createHttp移动到try内，可选句柄finally销毁，嵌套finally确保destroy抛错也清busy。实际物理请求并发互斥不变。

明确阻断未接通能力：真实直采requestAgentPipeline不再调用旧GatewayLink.pipeline，提示使用独立Web管理平台；原生认证202+poll尚未实现，不宣称已完成。

相关22项测试全通过（新增2项综合失败回归）：包括真实服务采样后切页→重新取得新帧→等待上传确认→分析顺序，重复冻结帧拒绝、上传失败拒绝、上传期间切页拒绝、直采pipeline禁回退、create/destroy失败后可再次上传。未构建HAP/装机/烧录，根负责全量集成和编译。

锁已完成并释放。

## 追加：正式设备认证三阶段管线已接通

根协调追加要求后实现CloudUpload.pipeline(prompt)：POST /api/v1/device/pipeline只接受202并验证taskId/gatewayId；GET /api/v1/device/pipeline/tasks/<id>认证轮询500ms，45秒整体预算（含请求与sleep）、单请求最多3秒，物理请求锁不放宽。只允许running/completed/failed，校验设备/任务身份、hardware/只读结果；复用现有GatewayLink公开validatePipeline（只改访问级别）。任务响应限256KiB；普通接口原64KiB不变，普通请求仍只接受200。上下文revision变化拒绝迟到回执；任务失败不回退旧网关。

Index直采模式启用云会话后直接调用CloudUpload，不依赖临时gateway的remoteMode；临时模式保留旧GatewayLink。仅calls=0允许null provider/model转换空串，UI明确“模型尚未配置，未调用模型”。新增3项认证启动/轮询/跨设备/错误结果/迟到上下文回归及1项45秒虚拟时钟预算回归。相关测试最终26项全部通过。此前“明确阻断未接通能力”的段落由本追加替代；认证设备后端由rag_store负责，待根全量集成与SDK编译，未宣称实物或真实TLS验收。
