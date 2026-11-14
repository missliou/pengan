
## 2026-11-02 Qwen最新设备页接收复核

已读取QWEN-ADMIN-UI-SESSION-20261102-Qwen.md及实际源码，Qwen锁为completed/RELEASED。本次专项10/10、完整前端60/60通过；devices.js SHA256为465fa49400db90e6ed618ca0840fe126089b180442a48f2c9f2e69d074eb8dcc，与dist一致；CSS与dist亦一致。未改产品代码，未重建HAP/ZIP，旧ZIP不含新设备页，未做本次浏览器、真实模型、实物或Ubuntu验收。

源码复核待修：列表仅按浏览器时钟减服务器receivedAt判过期，忽略sampleAgeMs及climateAgeMs/gasAgeMs，存在跨时钟与通道先过期时显示旧值风险，气体展示也应遵守gasValid；初次详情失败后提前返回，不会自动重试详情或刷新列表；非数组设备响应被显示为空登记；详情deviceId仅初始化一次。以上为源码审查结论，尚未补专项复现用例。

语义纠正：admission=unknown_denied为人员入棚安全准入未知/拒止，不是遥测上传失败；缺少CO/CO₂和执行器时不能放宽为允许。Qwen交接中建议删除或更改该字段不能直接采用。

下一步优先修列表逐通道时效、跨时钟与错误恢复，再补回归、dist、浏览器及发布校验。本轮仅接收复核并保存状态，额度当前未重新读取，记未知；没有常驻服务。文档锁QWEN-LATEST-REVIEW-20261102由Codex收尾标记释放。
