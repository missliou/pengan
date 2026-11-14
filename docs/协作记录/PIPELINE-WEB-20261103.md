# PIPELINE-WEB-20261103

执行者pipeline_web，待父协调者汇总。独占admin-ui锁；基线既有67项前端测试通过。改动：src/pages/tasks.js替换旧占位、knowledge.js新增、app导航、lib/api.js/data-source.js接任务/RAG认证接口，test/pipeline-pages.test.mjs新增3项，dist重建。未改gateway/原生/共享清单。

契约依父任务：POST /api/agent/pipeline?gatewayId，GET /admin-api/pipeline/tasks与/tasks/<taskId>；GET/POST /admin-api/knowledge与POST /knowledge/search。任务必须含taskId/gatewayId/status/startedAt/events；检索retrieval与result按JSON文字展示，避免后端字段遗漏，来源、阶段事件、耗时/失败均可见。任务详情响应限256KiB；新POST 10秒超时，CSRF/同源凭据及设备作用域沿用统一层。知识文本上限40000字符，source仅标签；演示不访问真实读写，viewer禁止POST。PageScope销毁清timer且迟到结果不落页，任务输入区不被轮询重建。

测试：node --test admin-ui/test/*.test.mjs =>70通过/0失败（新增演示不访问、任务实际点击与输入保留、mutation作用域与viewer拒绝）。node admin-ui/build.mjs成功。日志tmp/pipeline-web-tests.log。未浏览器布局/真实模型验收，父协调者集成后需复验真实后端事件字段和截图。没有启动常驻服务或保存密钥。锁已由自身标completed/RELEASED。

## 2026-11-03 补充：演示预览真实模型合成测试回执

父协调者要求展示已验证的合成测试回执。重新原子认领PIPELINE-WEB-DEMO-20261103，新增src/demo-pipeline.js仅从tmp/verification/cloud-rag-pipeline-20261103/deepseek-real-test.json复制显式安全字段（provider/model、calls3、stages、verdict、retrievalHits1、executedfalse、events及测试标记），不含密钥或实物标识。tasks演示分支明确“真实DeepSeek调用的合成数据测试回执（静态历史，不是当前设备）”，显示阶段时间/耗时/状态/事件和只读回执按钮；仍禁提交真实任务。knowledge演示分支填充静态样例文本与列表，不保存、不检索、不伪造当前命中。

前端70/70通过，新增演示显示/回执点击断言专项3/3通过；dist重建。未由本子任务浏览器验收。自身锁completed/RELEASED，待父协调者刷新预览并验证。未改共享清单和后端。
