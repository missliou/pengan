# 棚安原生工程草稿

目标：OpenHarmony 标准系统 API 11（适配候选） / ArkTS / Stage 模型，DAYU200。

已提供 AppScope、entry、UIAbility、页面、模型、模拟设备服务和独立安全规则。五个业务入口与设备诊断入口以组件条件显示完成原型，尚未按最终方案拆成 Navigation / NavDestination 页面。

**已通过官方 OpenHarmony SDK 4.1.7.5 / API 11 和 Hvigor 4.1.2 的实际编译与 HAP 打包。** 已从干净的英文路径副本重复构建成功。HAP 在 ../output/hap，日志与校验清单同目录。实际 DAYU200 的 API 等级仍待连接后确认。

## 后续构建

1. 本目录 `npm ci --ignore-scripts` 安装锁定依赖。
2. 从项目根目录运行 `./tools/build-native.ps1 -JavaHome '你的JDK目录'`。默认 SDK 为 tmp/sdk/api11，也可指定 -SdkPath。
3. 构建脚本在英文 TEMP 目录复制源文件并运行 Hvigor，避免中文项目路径限制；不移动源码。
4. 签名脚本 `tools/sign-native-debug.ps1` 仅用于 SDK 公开测试身份的设备绑定开发签名，要求实际 UDID；`-OfflineSelfTest` 只生成虚构设备自测包，不可安装。
5. 已通过离线 sign-profile / sign-app / verify-app 流程。设备是否信任 SDK 测试证书、实际安装和运行尚未验证，不修改设备信任配置来绕过验证。
6. USB 当前枚举错误43，hdc列表为空；新数据线到后读取 API 和 UDID，再签名安装。

## 当前边界

- 环境和执行器默认模拟；可通过本机 HTTP 网关接 MQTT 软件终端联调。
- 原生台账采用 Preferences 逐条持久保存和 cryptoFramework SHA-256 链，原型最多1000条；没有独立云端锚定，不能防止整链重写。
- 已有服务端模型计划接口与人工逐步确认界面；未配置密钥，真实大模型未调用。
- 已有 Camera Kit 预览、用户主动权限申请与本地抓拍，编译通过；未进行真实摄像头验收，不自动上传图片。
- 已有 AudioRenderer 本地中文语音，使用API11推荐的writeData回调；5段PCM随包，附文字、格式与SHA256清单。原生音频尚未实机验证。
- 已有DocumentViewPicker台账JSON导出和设备诊断页，均通过编译，待实际镜像验证。
- 权限只含 INTERNET 与 CAMERA；不申请麦克风。
- 切换页面与退出时释放相机；真实设备自治必须在HH-HSP101完成，不能依赖UI生命周期。
- 真实门锁、传感器和 HH-HSP101 固件尚未接入。
- 所有数字阈值均是演示参数。

## 网关联调

网关运行在电脑回环地址5187。连接并授权 hdc 后，可用 `hdc rport tcp:5187 tcp:5187` 将板子本地5187转到电脑网关，然后在原生演示控制台启用 MQTT 模拟网关。该步骤尚未在实际板子上运行；不把调试转发当作最终部署方式。

实际部署应明确网关服务的位置和设备认证；当前 HAP 不包含 Node.js 网关进程，也不包含网页 WebView。
