# 云端与原生/Web集成交接

任务CLOUD-INTEGRATION-20261102，协调者Codex；三个子任务各自独占原生上传、Web、认证/历史并已释放锁，详见同目录NATIVE-CLOUD-UPLOAD、WEB-CLOUD、CLOUD-SECURITY交接。父代理新增gateway/cloud-server.mjs、cloud-main.mjs、cloud-integration.test.mjs、setup_cloud.py，复核并接管落稳后的子模块；修改Web只读权限说明、打包排除部署凭据/纳入初始化脚本及.gitignore。原生基线45文件2f6835c…，最新46文件077b369760f361aa4520ba02525da6c715fc1cf79b0eab5685dedd6b1775f62b；其余基线可对照上一验证ZIP60514343…和各独立交接。

接口见docs/云端接入接口.md，运行见docs/云端部署运行.md。设备Bearer与管理Cookie严格分离，设备按登记gatewayId隔离；多设备管理请求缺ID拒绝，不静默选第一台。会话CSRF/Origin/角色由后端核验，viewer仅浏览；管理会话重启失效。完整保留文件历史带游标、哈希链、fsync、幂等、损坏/容量保护；不能证明整行尾删，外部完整性不伪报通过。cloud-server加排他单写者锁，异常退出不自动抢锁。上传最新状态成功而历史写失败会返回失败，可按幂等键补写相同帧；旧帧不续期。

Agent使用已认证同设备当前帧/历史，记忆按会话/模型隔离，分析期间会话改变拒绝结果，文字结果持久化后才报告saved。新原生CloudUpload经设备认证端点上传、分析、照片、合成测试；严格HTTPS/时间/回执/大小/重定向约束，token仅内存。尚无离线补发、HUKS长期凭据或原生完整历史页面迁移；不要删掉旧历史守卫冒充新功能。

本轮验证：统一228项227通过/1跳过/0失败，工程/HAP/串口解析通过，日志tmp/verification/offline-suite/20261102-112256-212/。三项集成回归执行真实HTTP、持久存储、真实ArkTS上传服务的主机适配、模型明确测试桩、Web历史接口；TLS主机适配不代表真实TLS验收。另有Python初始化scrypt与Node登录兼容检查；sandbox临时目录权限失败后，获准在独立临时目录完成并清理，未创建真实部署凭据。

实际API26编译成功，SDK26.0.0.38/Hvigor6.26.8，HAP1686311字节，SHA256 3515d05d11eb3693940fa9f87b164d95b77ef701e878418e75eb10376caa0b8f；未签名未装机。旧HAP备份output/hap/history/pengan-before-cloud-2bf5a413e206.hap。构建日志tmp/verification/cloud-integration-20261102/build.log，保留原有SysCap/异常警告。

Windows Edge直连隔离cloud-server固定5201验证：reader登录、刷新恢复Cookie会话、模型写按钮禁用及只读说明；退出后admin登录、持久审计显示login/logout、切换登记设备；截图tmp/verification/cloud-integration-20261102/audit-ui.png，无真实遥测、真实密码或外部模型。测试服务与标签已停止，未常驻部署。Web源码修正后dist已重建，实际浏览器打开的是生产静态目录。

未完成的环境验收：真实Ubuntu/TLS、账号/设备正式登记、DeepSeek密钥与实调用、DAYU200签名安装及HH-HSP实板无线联调。管理账号CRUD、归档轮转/外部历史检查点、服务端全范围导出、设备令牌长期安全保存、离线补传为后续明确缺口。所有工作落稳后统一更新ZIP/位置索引并释放父锁；不删除原始源码/旧候选，不清其他执行者历史锁。
最终续验：tmp/verification/offline-suite/20261102-112535-467/同为228项227通过/1跳过。额外验证源码外数据目录强制与同目录第二进程拒绝，不抢旧锁。
发布收尾：ZIP310项/3226979字节，SHA256 80289b00c7ededba6d27495fa33c93fe7a7bf6ebc1fd1b2fd0a48c2b015db13f，独立校验和位置索引生成通过。旧候选保留，任务锁释放；发布回执在打包后追加，归档是当时快照。
