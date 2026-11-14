# PIPELINE-RAG-HOOK-20261103 交接

执行者pipeline_rag_hook；范围仅gateway/agent-pipeline.mjs、gateway/test/pipeline-rag.test.mjs；共享清单待协调者汇总。

构造新增readKnowledge(prompt)、onEvent({type,data})。检索接受数组或{items}，2秒有界等待，最多5块，每块content最多1200字符，白名单chunkId/documentId/title/source/content/score/contentSha256。结果附retrieval={method:'lexical',items,untrusted:true,error?}。失败稳定knowledge_unavailable或knowledge_timeout，不泄露供应商错误，晚到Promise不会再发事件。

检索发生在安全短路前，knowledge仅作为未可信参考进入三个模型阶段，不进入env证据，不放宽任何规则。新增事件retrieval_started/completed、safety_checked、stage_started/completed，runStage事件实时；短路/级联blocked记录也发完成事件。onEvent均await，在模型catch之外，持久审计失败直接中止而不是当作模型错误继续。

实际6项专项全通过，覆盖三阶段注入白名单、硬规则短路仍检索、检索错误和超时、迟到无事件、事件存储失败中止、恶意文本不覆盖CO缺值。原27项管线回归24纯逻辑通过，3 HTTP因沙箱EACCES失败，需协调者提权完整复跑。不改旧断言，不调用外部模型。

未改原生、前端、cloud-server、agent-audit及共享待办/进度。未签名装机或实物验收；锁所有者完成标记RELEASED。
