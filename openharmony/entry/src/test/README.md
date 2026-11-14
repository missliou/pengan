# 原生侧可执行断言（主机侧，不需要 SDK / 设备）

本目录是 OpenHarmony 原生代码的**主机侧**测试入口。它不参与 HAP 构建，也不会出现在
hvigor 的源码集合里，仅用于在没有 SDK / 没有设备开发板的机器上验证 ArkTS 业务逻辑。

## 为什么放在这里

`../main/ets/services/DirectTelemetry.ets` 里的帧校验（身份段、质量段、温湿度段、ADC 段、
时效、白名单、回绕）与 `docs/DAYU200遥测帧校验向量.md` 中 F / S / T 组向量一一对应。
这些逻辑只要有一处与网关侧 `gateway/hsp-telemetry.mjs` 走样，真机上就会出现"网关收得到、
设备却判无效"的诡异现象。把断言跑在主机侧，可以在没有编译链的情况下先钉住语义。

## 怎么跑

在仓库根目录执行：

```
node --test gateway/test/native-direct-vectors.test.mjs
```

## 它是怎么把 .ets 跑起来的

Node 22 的 ESM 加载器只对 `.ts/.mts/.cts/.js` 做类型剥离，遇到 `.ets` 会抛
`ERR_UNKNOWN_FILE_EXTENSION`，对 `data:` URL 也不会剥离类型。所以测试读取
`DirectTelemetry.ets` 的源码文本，把 `@ohos.net.http` / `@ohos.util` 两条 import
改写成从注入的全局桩取值，把文件写进系统临时目录的 `.mts`，再用 `pathToFileURL` 动态
import。这样执行的就是被测实现的真实代码，而不是一份复制品。

因此：**修改 `DirectTelemetry.ets` 后无需任何构建步骤，重跑上面的命令即可看到结果。**

## 断言覆盖

| 组 | 内容 |
| --- | --- |
| 身份 | schemaVersion / deviceId / simulated / controlSupported / coValid / co2Valid / coPpm / co2Ppm 任一不满足 |
| 质量 | uptime_ms、各 sample_age 非 uint，th_ok / gas_ok 非 boolean |
| 温湿度 | th_ok=true 越界拒绝；th_ok=false 越界放行 |
| ADC | gas_ok=true 越界拒绝；gas_ok=false 越界放行、可缺失 |
| 时效 | 通道年龄严格小于 10000 才算有效；请求耗时 3000ms 判超时 |
| 白名单 | Snapshot.frame 只保留 17 个契约键 |
| 会话 | 重复帧不刷新 receivedAt；uptime_ms 回绕换 sessionBootId |
| 传输 | 503 / 非 200 / 超大响应体 / 非法 JSON / 未配置 |
| 准入 | assertPrivateIpv4 只放行 RFC1918 |
| 来源 | 所有失败路径 source 恒为 dayu-direct |

## 2026-11-02 协调者复核补充

原交付22项已复跑通过，新增6项回归（合计28）：跨轮次本地缓存老化、独立通道过期与原始帧可重验、长时间运行后新帧重置重复计时、墙钟回退/作废清缓存、物理请求串行及配置切换迟到响应、API26禁止重定向与4096字节接收限制。

3秒守卫用于拒绝耗时过长的新响应，不应为了触发10秒分支而放宽。10秒时效通过 `currentSnapshot()` 在缓存读取时重算，不发网络请求，也不刷新receivedAt；重复帧由pollOnce返回独立拒绝结果。UI接线时必须定期读取当前快照，不可长期显示此前返回对象上的固定年龄。缓存过期后telemetry_stale现在可由真实时间推进触发。

返回快照中的frame保留有效原始数值与原始样本年龄；过期通道只在当前values/quality中置未知，不把仍标th_ok/gas_ok的原始帧剪成null而破坏对端校验。frame是副本，不可反向修改内部缓存。

这些依然是OS接口桩的主机测试，模块尚未接入Index.ets或云端上报，不能替代原生网络真机验收。
