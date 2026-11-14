# 告警可靠性与设备管线API修复交接

任务：ALERT-RELIABILITY-20261104；执行者rag_store；待root汇总，未修改共享待办/进度。基线alerts SHA256 d378f5744867、cloud-server d7859bbdb70c。已核对Qwen TASK-TIMELINE锁仅在tasks/styles/dist，新任务不重叠。

## 改动范围

- gateway/alerts.mjs：reconcile和submit共用串行队列，入队复制输入，错误不会阻塞后续操作；revision在队列内检查，避免并发备注、确认、合并/恢复丢失。
- gateway/cloud-server.mjs：alertInputs投影从state.receivedAt保留真实采样时间、sampleAgeMs与result.stages；其余告警路由未改。
- TTL：连接静默以acceptedAt算60秒offline，采样TTL取可确认采样时间/年龄与连接年龄保守上界；快照必须在线且时钟有效才能作为恢复证据。采样已过期不因刚接收而变新鲜。
- 模型告警：任一stage.state=failed均为模型阶段失败，即便job completed或安全verdict=needs_human/block；安全blocked阶段自身不产模型故障。模型故障恢复要求后续任务allow且decision/generate/verify三阶段passed且无error，不能被单纯completed或block任务误清。
- 应root追加授权，提取launchPipeline供管理员和设备接口共同调用：POST /api/v1/device/pipeline body{prompt} ->202{taskId,gatewayId}；GET /api/v1/device/pipeline/tasks/<id>按Bearer绑定设备读取。无Cookie迁移、无Origin；保留全局modelBusy、会话校验、RAG/记忆和告警onFinish。
- 新增gateway/test/alerts-reliability.test.mjs（6项）、gateway/test/device-pipeline-http.test.mjs（1项）；既有alerts.test.mjs修正恢复夹具，新的采样恢复必须更新receivedAt，模型恢复必须明确三阶段成功/allow。

## 实际证据

原只读审查复现：两个不同note/revision1并发都fulfilled，内存与重放仅剩second。修复后新回归要求一个成功、一个revision冲突，真实CloudHistory重放保留first；并发reconcile只新建一条，ack与reconcile并行不丢确认。

过期回归：acceptedAt仅1秒前、receivedAt已10秒前，立即产telemetry_stale；60秒采样旧但连接仍新不误称offline。刚接收旧帧或时钟回退均不能恢复stale。

模型回归：completed+failed stages对三种安全verdict均产model_task_failed；blocked阶段不产故障，后续block不恢复，真正allow+3passed才恢复。

实际运行：node --test gateway/test/alerts.test.mjs gateway/test/alerts-reliability.test.mjs gateway/test/alerts-http.test.mjs gateway/test/device-pipeline-http.test.mjs gateway/test/cloud-pipeline-rag.test.mjs，52项全通过，0失败0跳过。HTTP集成使用本机回环/临时凭据/合成数据，无外部模型；测试结束服务与临时目录清理。需沙箱外回环权限，已获准。

## 限制

未跑root最终全量套件、未构建原生、未接设备/真实DeepSeek/TLS/Ubuntu；该部分由root集成验收。未改UI、pipeline-tasks、AgentPipeline和硬件规则；安全block仍保持拒止。只读list/detail可能在一个未完成的异步mutation期间看到前一已提交快照，提交成功后数据正确；无停止轮询来掩盖并发。

自己锁完成释放，其他锁保留。新API契约需root同步正式接口文档并通知native执行者（已消息通知root）。
