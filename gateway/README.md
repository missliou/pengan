# 棚安电脑数据服务

当前默认真实数据模式。程序文件仍名为demo.mjs，但正式入口会传hardware模式；不启动虚拟终端来填补现场读数。

~~~powershell
node tools/system.mjs --host 192.168.1.89
# 接回采集板、确认实际端口后：
node tools/system.mjs --host 192.168.1.89 --serial COM7
~~~

从项目根目录执行；先在gateway执行npm ci --ignore-scripts安装锁定依赖。--host需要电脑实际局域网IPv4，省略只监听127.0.0.1。指定串口后由PowerShell7只读接收，断线重试同一端口，不扫描设备、不刷写固件；HiBurn烧录前先停止接收。

| 接口 | 内容 |
|---|---|
| GET /api/health | hardware/simulation模式、采集是否在线 |
| GET /api/observations | 真实快照、能力与未知准入 |
| GET /api/hardware | 独立HH-HSP101只读遥测 |
| GET /api/hardware/history?limit=50 | 真实历史，明确非当前读数 |
| GET /api/agent/status | 模型配置状态，无密钥 |
| GET/POST /api/agent/config | 网页读取/保存配置，保存需同源token |
| POST /api/agent/analyze | 真实观测与历史的只读Agent分析 |
| GET /api/agent/history?limit=20 | 真实文字AI历史，问题、依据与工具溯源 |
| POST /api/agent/inspect-image | 用户主动发送单张作物照片分析 |

真实模式拒绝旧模拟设备、控制、场景和计划接口。需要软件演示时必须显式--mode simulation；不能通过网页切换服务运行模式。

网页模型设置支持DeepSeek或千问，使用账户中可用且支持工具调用的模型。千问北京新工作空间可填写workspaceId，仅允许合法官方主机标签；旧兼容账户可留空。密钥仅服务端保存、不回显、不进入交付包。配置未完成时返回错误，不使用预设文本冒充真实AI。

真实Agent最多3轮、共同25秒，只允许读取当前环境和最近历史，无控制权限。源快照过期后显示当前未知；模型推断不能代替测量。照片只在用户点击后发送给所配置服务商，<=2MiB JPEG/PNG，单次请求不落盘/写日志；所选模型还需支持图像输入，失败不生成诊断。网页和DAYU200均有明确来源、时间与图像哈希显示。

真实串口文件tmp/runtime/hsp-latest.json由接收器更新，10秒失效。真实采集历史hardware-history.jsonl去重并校验SHA256链，64MB满时停止写入，不覆盖旧数据，界面显示存储异常。最近500条保留查询窗口，历史记录不代表当前状态。模拟事件日志与真实历史独立。

文字AI历史ai-analysis-history.jsonl独立保存成功真实分析，16MB上限、最近200条查询窗口，返回persistence明确保存是否成功。存储损坏时保留文件并拒写，分析仍可返回但会提示未保存。图片、模拟计划、失败分析不入库；附加凭据、图片内容与内部思考字段不保存。启动或配置更新时，仅从健康历史恢复同服务商同模型最近8条建议，不恢复步骤或执行权限。

~~~powershell
node --test tests/*.test.mjs gateway/test/*.test.mjs
pwsh -NoProfile -File tools/test-hsp-reader.ps1
pwsh -NoProfile -File tools/test-hsp-reconnect.ps1
~~~

测试中的模型为明确注入桩，OS接口部分为主机模拟；它们不构成外部模型调用或板端验收。完整配置与实际边界见[真实数据与AI联调](../docs/真实数据与AI联调.md)。

