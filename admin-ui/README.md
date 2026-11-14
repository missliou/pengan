# 棚安 · Ubuntu 云端 Web 管理平台（admin-ui）

当前云端登录、权限、审计和历史游标用法以[CLOUD-README.md](CLOUD-README.md)为准。以下保留原前端交付说明，其中“本机门槛/管理API未实现/固定501”等旧状态已被云端接线替代。

独立的管理控制台前端。任务 ID：QWEN-CLOUD-ADMIN-UI-20261102（执行者 Qwen-3.8）。

**产品边界**：本平台运行在 Ubuntu 云端、由浏览器访问，用于配置模型、查看设备与历史。它与 DAYU200 原生 HAP 相互独立，**不嵌入原生应用**；原生应用的 ArkTS/ArkUI 红线与本目录无关。

## 快速开始（Windows 本地开发，不需要云服务器）

```powershell
# 1. 启动真实模式网关（电脑临时测试，见根 README）
py -3 -X utf8 start_server.py --host 127.0.0.1

# 2. 另开终端，启动管理平台
cd admin-ui
node serve.mjs                # 默认 http://127.0.0.1:5199
# 端口被占：node serve.mjs --port 5200
# 网关不在默认地址：node serve.mjs --upstream http://127.0.0.1:5187

# 3. 浏览器打开 http://127.0.0.1:5199
```

要求：Node.js ≥ 22（与网关一致；使用内置 fetch、AbortSignal.any/timeout 和测试工具，**零 npm 依赖**，`npm install` 不需要）。

- `serve.mjs` 把 `/api/*` 反代到网关（解决同源/CORS，转发时重写 Origin 通过网关校验）。
- 网关没启动时页面**如实显示"后端未连接"**，不会出现假数据或假成功。
- `/admin-api/*`代理真实云端会话、设备和审计接口；旧gateway不实现这些接口，请启动gateway/cloud-main.mjs。没有后端时登录失败，不降级前端门槛。

## 构建与 Ubuntu 部署（同一套源码）

```powershell
node build.mjs                          # 产出 admin-ui/dist/，API_BASE=/api（nginx 反代路径）
node build.mjs --api-base https://云平台域名   # 公网必须 https，脚本会拒绝 http
```

Ubuntu 侧（部署属后端负责人任务，以下为前端交付的参考配置，未实测）：

```nginx
server {
  listen 443 ssl;                       # 证书路径略
  root /srv/pengan-admin;               # 即 dist/ 内容
  location / { try_files $uri /index.html; }
  location /api/ { proxy_pass http://127.0.0.1:5187; }   # 云上网关
  location /admin-api/ { proxy_pass http://127.0.0.1:5201; }
}
```

## 测试

```powershell
npm test                         # 全部主机回归（包含原16项）
# 或 node --test test/*.test.mjs
```

重点回归：演示模式不调用真实API、10秒读数失效、同帧不能续期、通道年龄、页面取消/迟到响应、跨页面写请求互斥、清密钥不提交脏表单、保存/重读失败及历史标签切换。页面测试在最小DOM主机中运行真实页面模块，不含浏览器布局验收。

`test/helpers/preview-backend.mjs` 可启动隔离的真实网关路由进行手动浏览器验证。它仅监听回环动态端口，配置只在内存中，无真实密钥/硬件/历史，模型外网调用被显式阻断，30分钟自动停止。不要将其作为正式服务器使用；构建产物不包含测试目录。

## 目录

```
admin-ui/
  index.html  env.js  styles.css        # 入口与运行时配置（非敏感）
  serve.mjs   build.mjs                 # 开发服务器 / 生产构建
  src/app.js                            # 外壳：导航、连接探测、演示模式、登录门（纯前端门槛）
  src/lib/api.js                        # 网络统一适配层：每个接口标注 [已有]/[待实现]
  src/lib/{dom,format,pagination,store,trend,env}.js
  src/demo.js                           # 演示数据（显式隔离，界面常驻警示条）
  src/pages/{overview,model,records,devices,tasks,system}.js
  test/unit.test.mjs
  docs 接口契约缺口清单见 ../docs/协作记录/
```

## 安全与数据边界（代码层强制）

- 密钥只出现在"保存配置"那一次 POST 请求体内：不写日志（服务器只记方法+路径）、不进 localStorage（store.js 白名单拒绝任何非界面偏好键）、不回显（配置页只显示"服务器上已保存"状态）。
- CSRF：沿用网关 `x-pengan-config-token`，缺失时保存/清除按钮如实报错。
- 所有文本一律 `textContent` 渲染，后端数据不进 `innerHTML`。
- 趋势图只画有效点，缺口断开；未知值显示"未知"；CO/CO₂ 恒显示"未接入"。
- 演示模式与真实模式互斥，演示时顶部常驻黄色警示条；保存/清除/测试按钮禁用，数据源也拒绝所有真实写请求及管理读取。
- 总览每2秒读取状态/观测，每10秒读取模型与历史，本地每500毫秒重算时效。同帧不能延长失效时间，通道失效只显示未知。后台、断网或切换模式后作废旧请求，不自动重发写操作。
- 登录门只是界面门槛：页面持续明示"后端管理鉴权 [待实现]，正式鉴权完成前只应在受控网络使用"。

## 已实现 / 未实现一览

| 功能 | 状态 |
|---|---|
| 运行总览（连接/采样/时效/来源/模型三态/趋势/存储健康） | 前端完成，真实模式已联调（离线形状核对通过） |
| 模型配置（保存/保留/替换/清除 + CSRF + 手动测试 + 错误解释） | 前端完成，接口全部对接 [已有] 网关端点 |
| 采集历史 / AI 历史（搜索/有效性/时间筛选、分页、详情、CSV 导出） | 前端完成；服务端条件查询/导出属 [待实现]，界面如实标注当前是对已取回窗口的客户端筛选 |
| 设备管理 | 仅呈现观测快照中可确证信息；列表/配对/诊断 [待实现] |
| AI 任务过程 | 展开历史记录内真实携带的 toolTrace/persistence；独立审计流 [待实现] |
| 系统与审计 | 呈现 health/observations/storage 实测字段；审计事件流 [待实现] |
| 登录/会话/退出 | 后端Cookie会话、CSRF、admin/viewer及退出已接入；本机调试门槛默认关闭 |

Ubuntu 部署：**未实测**（无云环境）；Qwen原交付见 `../docs/协作记录/QWEN-CLOUD-ADMIN-UI-20261102-Qwen.md`，后续修复和Windows浏览器验证见 `../docs/协作记录/CODEX-ADMIN-UI-FIX-20261102.md`。本机入口没有真实鉴权，不是公网可部署成品。
