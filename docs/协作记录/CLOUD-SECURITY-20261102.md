# 云端认证、审计与历史模块交接（待父代理汇总）

任务CLOUD-SECURITY-20261102，执行者/root/cloud_security。基线为4个不存在的新源码/测试文件；只修改gateway/cloud-security.mjs、cloud-history.mjs、test/cloud-security.test.mjs、test/cloud-history.test.mjs及本交接。未改共享待办/进度、runtime、原生或Web文件。自有锁完成后释放，未碰其他锁。

## 确定接口

CloudSecurity({users:[{username,role,passwordHash}],now?,ttlMs?,maxSessions?})；CloudSecurity.hashPassword(password)异步返回随机盐scrypt-v1摘要（密码长度12至256）；不自动生成真实账号或凭据。login(username,password,{ip})异步返回{token,user:{username,role},csrfToken}；authenticate(token)返回会话公开数据；logout(token)、requireRole(session,'admin'|'viewer')、requireCsrf(session,token)同步。角色viewer仅只读，admin可两种权限。路由必须先authenticate再requireRole，任何session对象都不是远程信任证明。服务端会话只以token的SHA256索引，默认30分钟；注销、到期、墙钟回退、进程重启失效。登录按IP/账号限5次每分钟，入队前计数抑制并发喷射；容量有上限。父代理负责Cookie的HttpOnly/SameSite/Secure、Origin核对、路由鉴权及审计写入顺序。

CloudHistory({file:绝对路径,maxBytes?:默认64MiB,now?})；await open()；await append({kind:'telemetry'|'analysis'|'audit',gatewayId,data,key?})返回row；query({kind?,gatewayId?,limit?:50,beforeSeq?})返回{items,storage,nextBeforeSeq}。row为{seq,kind,gatewayId,key,recordedAt,previousHash,data,hash}，key可64hex摘要；相同kind+gatewayId+key且同JSON内容幂等返回原row，不同内容冲突拒绝。await flush()等待队列；status()返回健康/字节/条数/上限。单页最多200，nextBeforeSeq非null时继续请求；所有文件内记录均保留，非只保留200条。多设备访问权限由父路由强制，不能直接暴露不带授权过滤的query。

审计由父代理调用history.append({kind:'audit',gatewayId:'system',data:{event,actor,outcome,...}})，本模块不自动记录登录动作，以便HTTP层先持久审计再确认敏感操作。data递归拒绝password/passwd/secret/token/authorization/apiKey/wifiSSID等字段名；仍须上游只给受控事件元数据，不得把请求/凭据原文放进自由文本。

## 持久与边界

JSONL串行追加、每行前向SHA256链，fsync成功及close后才确认。写失败关闭后续读写；恢复半行/损坏链/重复key/越界文件失败，不截断、不重建假空库。达到字节上限明确报history_capacity_exceeded，不静默丢最旧数据。没有自动日志轮转或归档；达到部署配额需运维处理。历史内存保留整个有界文件，适合当前单站点原型，后续规模增长需数据库和迁移。

SHA256链不是加密/签名或外部完整性见证：有效整行尾部被删除、全文件丢失后重建，无法仅凭本文件检测，因此storage标记scope='retained-file'、externalCompletenessVerified=false，不虚称已恢复全部历史。真实部署需外部备份/检查点。未做Linux断电/磁盘实物验收，Node的文件fsync不等于跨系统断电保证。

## 实际验证

node --test gateway/test/cloud-security.test.mjs gateway/test/cloud-history.test.mjs：9项全部通过、0失败（2026-11-02）。包含随机盐/会话摘要、权限/CSRF、注销/到期/回退/重启/容量、未知账号/密码失败与并发限流；230条跨200分页、设备分区、重启和幂等冲突、损坏/半行保留、容量/写失败、敏感字段拒绝。真实源模块运行、临时测试文件，无网络/真实凭据/模型调用。没有运行父代理全量集成，没有云端部署或原生装机。额度由父代理监测，本子任务未读取，记未知。

## 后续复核修正

父代理要求的磁盘外变动保护已落地：每次写入（包括幂等返回）前stat核对预期文件大小/类型；删除、删尾、外部追加或类型变化会立即healthy=false并报history_file_changed，后续query/append失败关闭。打开句柄后再次比对长度，fsync后核对实际追加长度，降低中途外部变动未被察觉风险。open损坏时清除已部分解析的rows/keys，保持ready=false/healthy=false。

新增外部追加/删除/删尾（含幂等重试）回归及恢复状态断言，最终认证+历史10项通过/0失败。未实现跨进程排他文件锁：部署必须保证同一历史路径只有一个写进程（单实例systemd服务，不同实例不同数据目录），不能以这次大小检查代替跨进程原子锁；同尺寸恶意改写亦非此检查保证，仍依赖外部备份/签名检查点。父代理可后续实现生命周期排他锁与close，不擅自抢遗留锁。
