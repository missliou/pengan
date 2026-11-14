# 原生设备云端历史与最近记录导出

任务NATIVE-CLOUD-HISTORY-20261102，执行者Codex，2026-11-02。基线原生指纹d41c07566347（46文件）、HAP70cf7935400f；既有协作锁均已释放。当前任务锁覆盖原生CloudUpload/CloudHistory/Index、云端历史契约及测试、共享交接与产物。

## 行为与契约

- CloudUpload新增GET设备认证历史读取，固定路径`/api/v1/device/history?kind=telemetry|analysis&limit=10`，沿用HTTPS/Bearer、X-Pengan-Gateway-Id、禁止重定向、3秒超时、64KiB响应限额及上下文作废；不读管理员Cookie、不发模型请求。
- 后端queryHistory新增顶层gatewayId，属于兼容字段扩展；原生据此拒绝串设备响应。历史仍由现有按设备过滤的存储提供，保留不同历史会话；不强行与当前会话相同，不把历史记为当前。
- CloudHistory严格校验身份、非当前标记、递减唯一seq、游标、保留文件状态、采集来源、质量/量程/通道年龄、CO/CO₂空值及只读分析。无效通道只显示未知。存储records明确是全库计数，含其他设备/审计，不标设备记录总数。
- 原生历史页在直采且设备云会话已启用时读认证云API，无会话或云失败不回退旧电脑网关；临时网关模式仍走自己的明确路径。
- 进历史页串行读取两类，按钮及方法互斥，避免共享上传服务物理请求互相争用；切页/来源变化epoch丢弃迟到历史和后续读取。
- 最近记录JSON经系统文件保存器导出：每类最多10条格式化历史，不含原始响应/凭据/照片；标historical=true/isCurrent=false/completeHistory=false、只读及人员准入未知/拒止。两次读取不是原子快照；有更早记录会提示，但本轮原生未增加向前翻页按钮，不宣称全量导出。

## 实际验证

新增5项实际ArkTS服务回归、1项实际Index方法接线/失败不回退/迟到保护回归、1项真实回环HTTP+持久存储+原生读取/报告/重启/多设备隔离集成。历史AI由显式模型桩生成，不是外部模型验收。

完整254项：253通过、1跳过、0失败；工程/HAP/串口解析通过，日志tmp/verification/offline-suite/20261102-175529-345/。API26 SDK26.0.0.38、Hvigor6.26.8实际BUILD SUCCESSFUL，日志tmp/verification/native-cloud-history-20261102/build.log；保留系统能力/异常/未签名警告。

新HAP1715620字节，SHA256 e85230051b389d4cd9fc0b06f5c1eba3595e43ae0c13cb6f3f0db09e0b0465e7；47文件指纹6688cffc60171c2cc13f8984999ab664fb1800077f594f0601b2d6cb6dfd1a7f。旧HAP从已校验ZIP提取并核验原哈希后保留于history，源码未删除。

## 限制与下一步

尚未签名/安装、实物与系统文件保存器验收、真实TLS/DeepSeek/Ubuntu部署。浏览器此前被Work设置禁用，本轮未以主机测试替代布局验收。64KiB响应限制下复杂分析批次可能明确失败；后续应补服务端按字节分页/原生向前翻页。长期凭据HUKS、离线补发、账号在线管理、全范围导出和归档仍待开发。固件未修改。

起始额度主剩89%、周剩36%为本轮快照，未到3%；非持续监控。发布时备份旧ZIP、重建并独立校验，索引以output为准；最终回执在归档快照之后保存。结束前释放自有锁，未启动常驻服务。

NATIVE-CLOUD-HISTORY发布完成：ZIP317项/3274909字节，SHA256 2d330b8f13f46c7f2a098c2e7299c7e15fa4c30cb9f5a002aeb0150eed7ff5fc；独立CRC/逐文件哈希/47原生文件指纹通过，位置索引更新。旧ZIP/HAP保留，候选未签名未装机，完整历史翻页/离线补发等仍未完成。归档为打包时快照，收尾回执随后写入；本轮自有锁标记completed/RELEASED，无常驻服务。
