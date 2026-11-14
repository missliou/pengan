# Web三阶段Agent、RAG与可观测任务集成

任务CLOUD-RAG-PIPELINE-20261103，协调者Codex。依据用户要求，将DeepSeek已有管线接入正式云端管理API，补知识库及全过程观测；用户确认尚未初始化管理员，先完成代码与演示。三子任务交接：PIPELINE-WEB-20261103.md、PIPELINE-RAG-HOOK-20261103.md，知识库交接由根汇总。

## 交付与接口

- `gateway/knowledge-store.mjs`：源码外dataDir/knowledge.json，文本粘贴、元数据、中文二元组/英文词法检索，400字符块/320步长，按gatewayId隔离。最多100文档、2MiB、单篇4万字符，fsync+原子替换，失败不替换旧内存。无PDF/URL抓取或向量模型，不伪报向量RAG。
- `agent-pipeline.mjs`新增可注入readKnowledge/onEvent，2秒检索上限、5块、未可信资料只加入模型上下文；不能变成env传感证据或改安全规则。回调失败直接中止。检索/安全检查/阶段开始完成事件均可观测；结果新增retrieval兼容扩展，严格字段测试与契约同步。
- `pipeline-tasks.mjs`：异步任务及事件按audit/pipeline_state保存到既有哈希链保留文件。先持久化再发布完成态；任务失败明确标记，落盘未确认也如实显示。重启恢复最近100任务，运行中任务标server_restarted，不自动重发模型；列表最近50非全量。
- Web/admin接口全部复用Cookie、admin/viewer、CSRF/Origin与设备选择；POST admin，viewer仅GET。知识库列表/保存`/admin-api/knowledge?gatewayId=`，检索POST `/admin-api/knowledge/search` body{query}。
- 启动POST `/api/agent/pipeline?gatewayId=` body{prompt}返回202{taskId,gatewayId}；GET `/admin-api/pipeline/tasks`列记录，GET `/admin-api/pipeline/tasks/<id>`取事件/检索/结果。任务运行占用全局modelBusy，不与配置或其他模型操作并行；关闭页面不会取消已接收任务。
- 新Web任务页保留输入区，1秒读任务状态；知识页可保存/检索；显式静态演示仅显示安全的真实API合成测试回执，不执行真实写入。未嵌入原生HAP。

## 实际验证

- 全量306测试：305通过、1跳过、0失败，日志tmp/verification/cloud-rag-pipeline-20261103/all-tests-final.log。包括知识8项、RAG钩子6项、真实HTTP鉴权/设备隔离/存储重启与前端测试。工程配置19项通过，dist重建。
- 首轮2失败如实记录：严格字段断言未包含新retrieval（已随契约修正）；另一旧ai-http用例fetch failed，后续全量未复现，未据猜测修改旧网络测试。
- 本轮联调发现“status先完成但最终事件未落盘”竞态，改成持久化后才发布终态，定向与全量通过。
- 用户提供临时DeepSeek测试密钥，仅交给无回显进程内存，进程已退出，没有写源码/配置/交接/ZIP。真实API合成环境测试：deepseek-chat，3次调用，decision/generate/verify均passed（2998/2629/1978ms），检索1块、verdict allow、executed=false。允许结论仅适用于当时合成软件条件，不是实物/人员安全准入。证据deepseek-real-test.json，只有安全回执字段。
- 正式硬件API模式缺CO/CO₂仍block/calls0，HTTP测试验证不绕过硬规则。真实硬件和真实知识资料尚未验收。
- Edge已有5199预览页实际展示“AI任务过程”、静态测试回执和RAG样例，截图tmp/verification/cloud-rag-pipeline-20261103/tasks-preview.png。IAB绑定异常，使用已存在Edge预览标签；未查看其他标签中的凭据。输入框布局已修。

## 运行边界与后续

5199预览服务沿用用户原任务保持运行；真实管理后端需用户初始化源码外cloud-config.json，当前尚未配置，因此演示不开放真实提交。运行指令仍见docs/云端部署运行.md。模型密钥只由用户在正式Web模型设置保存，此次临时测试不自动当成生产配置。

本轮未修改原生/固件，未编译/安装HAP；DeepSeek之前原生修改的HAP构建缺口仍在。旧统一发布ZIP未更新，不包含本轮功能；为避免把旧HAP冒充最新，不强行生成新统一包。PDF/向量索引、人工复核回填、全量任务归档/导出及Ubuntu部署仍待做。任务事件是可解释状态/摘要，不输出模型内部思维链。

最后额度快照主剩35%、周剩6%，未触及3%；非连续监控。共同待办/进度写入读回后释放自己的锁，其他子任务锁已由本人释放。
