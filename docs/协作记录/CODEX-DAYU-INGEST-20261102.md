# 云端采集接入基础

DAYU-INGEST-20261102，Codex；新文件gateway/dayu-ingest.mjs与gateway/test/dayu-ingest.test.mjs。未改原生、固件和既有网关路由；新文件基线为空，接口不自动启用，自己的锁收尾释放。

DayuIngress每实例绑定登记gatewayId/令牌SHA256与独立持久文件，认证做常量时间摘要比较；令牌不落遥测。严格校验HSP、字段白名单、真实模式和10秒时效。相同会话uptime不递增不续期，退役会话ID持久保存，重启后仍拒收；128个退役会话满后要求重新登记。原子rename成功才确认，存储失败不更新内存；损坏文件失败关闭，不覆盖为假空记录。这里只存最新状态和去重元数据，不是历史数据库。

startDayuIngressServer只监听127.0.0.1，未来由Ubuntu TLS反代暴露；POST /api/v1/telemetry/current，Bearer、application/json，最多4096字节、5秒请求超时，拒绝浏览器Origin，无匿名读取端点。请求体schemaVersion=1/gatewayId/sessionBootId/sampleAgeMs/frame；X-Pengan-Sent-At必填毫秒，允许过去3秒/未来1秒，年龄叠加传输时间及1秒保守时钟余量。端侧需校时，尚未实现上传器。与Qwen草案的batch历史补传不同，不接受离线历史冒充当前数据。current()输出dayu-direct且独立老化，仅供后续认证应用内部使用，未接现有Agent/Web，不能解除原生直采环境AI守卫。

新增5项实际模块/临时文件/回环HTTP测试：认证、去重/重启、退役、隔离、质量/越界、存储失败/损坏、HTTP大小/Origin/发送时钟。完整离线200项199通过/1跳过/0失败，工程/HAP/串口解析通过，日志tmp/verification/offline-suite/20261102-105954-476/。没有真实设备令牌、模型调用、常驻服务或Ubuntu部署；HAP未变，无须重复编译。旧ZIP不包含新增文件，工作区源码为准。

下一步：部署登记/凭据管理、TLS和持久目录、原生安全凭据保存/上传器/离线策略；按设备/会话把观测接到Agent、Web和历史。管理员登录/权限/审计、原生语音、签名装机及实板/真实DeepSeek验收仍未完成。
