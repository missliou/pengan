# OpenHarmony 7.0 迁移记录

日期：2026-10-30。用户明确指定后续以OpenHarmony7.0系统和对应API开发。

## 已完成

- 用户镜像文件名：version-Daily_Version-OpenHarmony_7.0.0.46-20261030_003215-dayu200_img.tar.gz。本机下载目录文件728797595字节，tar可完整列出boot_linux.img、system.img、vendor.img、MiniLoaderAll.bin、config.cfg等。此为每日构建镜像；尚未获得该镜像的官方校验值，不把归档可读等同真实性/完整性验签。
- 下载官方7.0 Release公共SDK：ohos-sdk-windows_linux-public_20260829.tar.gz，3671263766字节。
- 官方SHA256：6bf6ae1efe8de0e8bd15ddbd7fac58bcb54d9620262a541b9b219439317a4c42；下载文件校验一致。
- Windows组件解压到tmp/sdk/7.0-release/api26；组件元数据apiVersion=26、platformVersion=26.0.0、version=26.0.0.38。
- 官方npm源repo.harmonyos.com/npm提供的Hvigor与ohos插件均为6.26.8，已隔离安装到tmp/build-tools/7.0，未覆盖原有4.1.2依赖。
- tools/build-native7.ps1从实际SDK元数据构造编译、兼容与目标版本；复制到英文TEMP构建，动态生成AppBuildInfo。API26+使用字符串26.0.0，SDK目录必须为sdk/26.0.0。初期目录误设为26时，工具误以为组件缺失而请求下载并报license未接受；修正目录后正常识别已有组件，无需绕过或修改许可检查。
- 实际CompileArkTS、资源、字节码及打包成功。产物output/hap/openharmony7/pengan-0.1.0-api26.0.0-unsigned.hap；最新大小与哈希以同目录build-manifest.json为准。
- tools/check-hap.mjs支持指定清单，并核对API主/次/补丁、SDK版本、SHA256、CRC、权限、PANDA字节码及5段语音资源。新包检查通过，旧API11包检查仍通过。
- 32项主机测试通过（OS API为明确模拟，不是7.0实机验收）。诊断页编译目标不再固定显示11，7.0构建显示26.0.0及SDK26.0.0.38。

## 复现

1. 获取上述官方SDK并核对SHA256，提取Windows组件，保持组件元数据不变。
2. 在tmp/build-tools/7.0创建package.json，将@ohos/hvigor和@ohos/hvigor-ohos-plugin均锁为6.26.8，执行npm install --ignore-scripts --registry=https://repo.harmonyos.com/npm/。本机已保存package-lock.json。
3. 构建：

```powershell
./tools/build-native7.ps1 -SdkPath ./tmp/sdk/7.0-release/api26 -JavaHome 'C:/Program Files/Java/jdk-25.0.5.0.2'
node tools/check-hap.mjs output/hap/openharmony7/build-manifest.json
```

源工程的静态build-profile和原有build-native.ps1保留API11调试模板；7.0构建必须使用build-native7.ps1，其临时完整工程路径见清单buildDirectory，可用于检查生成配置。不能用旧脚本构建后宣称API26，也不能只改旧包文件名。

## 未完成与边界

- 2026-10-30旧一轮API26应用已设备绑定签名、安装启动，实读系统OpenHarmony7.1.0.22/API26；系统栏与真实只读采集有截图。2026-10-31最新自动刷新/异常处理候选仍未签名、未安装，不可把旧截图当作新版验收。
- 当前两板未连接。用户回家后再接板，校验实际API/UDID并安装；不重复刷写系统。
- 每日镜像7.0.0.46与公共SDK26.0.0.38命名不同；兼容性取决于镜像实际API与SysCap，不能靠文件名推断已兼容。
- 2026-10-31已清理getContext弃用、原生API异常、资源重名及模块SemVer警告；保留加密/音频SysCap提示（源码有运行时检查）和未配置签名提示。不以编译成功代替缺能力设备验收；未完成DevEco Studio IDE内构建验收。
- HH-HSP101、真实模型服务、相机/音频与数据持久化的7.0实机验收仍待完成。

官方来源：[7.0发布目录](https://mirrors.huaweicloud.com/openharmony/os/7.0-Release/)、[SDK SHA256](https://mirrors.huaweicloud.com/openharmony/os/7.0-Release/ohos-sdk-windows_linux-public_20260829.tar.gz.sha256)。SDK不是DAYU200烧写镜像；没有刷写任何系统。


## API26专用安装入口

2026-10-31新增tools/install-native7.ps1，读取最新构建清单，确认实际设备API与UDID，绑定签名后安装并发启动命令，安装限时45秒；成功后写install-receipt.json，视觉验收仍标false。若未连接设备明确停止，不卸载旧包。当前只通过语法/离线拒止测试，成功安装路径待接板后实测。最新自动刷新源版本已编译，不能将同目录旧device-debug包当作本轮新签名产物。

## 构建来源一致性

build-native7.ps1现会在复制源码前和构建后核对原生源码/资源指纹，并写入build-manifest.json的nativeSourceSha256与nativeSourceFiles。编译期间源码变化时拒绝发布候选。check-hap、install-native7及package-release --api26会校验当前源码与候选来源一致，避免新源码配上旧HAP；新增字段缺失的旧清单需重新构建才能用新版专用安装/打包入口。指纹排除依赖、构建输出、本地SDK路径和签名文件，不代替SDK/签名/实机验收。
