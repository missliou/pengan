# DAYU200 连接与安装

## 已有的软件

应用为 ArkTS/ArkUI 原生 HAP，已实际编译。不是网页，也不依赖浏览器。电脑上的 Web 原型仅用于先行确认业务流程。

设备：DAYU200；用户报告“关于设备”版本4.1.7.7。以API11为当前候选，最终读取板子实际API后确认。

## USB接线

- 板子用原配电源供电，保持正常桌面。
- 电脑USB口接DAYU200标有USB3.0 OTG的口，常见原版套件使用配套USB-A双公数据线。
- HOST口用于外设，不作为这里的设备调试连接。
- 安装HAP不需要按Recovery，也不刷写系统。
- 开启板子支持的USB调试功能，出现信任弹窗时由使用者确认。

厂家接口资料：https://gitee.com/hihope_iot/docs/blob/master/HiHope_DAYU200/README.md

## 当前故障记录

2026-10-30：接OTG后，Windows先显示“设备描述符请求失败”，重插后“配置描述符请求失败”，错误43；硬件ID仅USB\CONFIG_DESCRIPTOR_FAILURE，当前usb.inf，hdc列表Empty。拔线后异常设备消失。

这只证明该连接没有完成USB枚举，不能直接判定是缺少HDC驱动。尚未获得真实VID/PID，不强行给未知设备绑定驱动。用户计划换新线后再测。

先使用可靠数据线、正确OTG口、正常板载供电重试；Windows识别出HDC设备或真实VID/PID后，再按匹配信息检查驱动。没有安装刷机驱动、没有修改Plug and Play服务、没有关闭签名验证。

微软枚举说明：https://learn.microsoft.com/windows-hardware/drivers/usbcon/case-study--troubleshooting-an-unknown-usb-device-by-using-etw-and-netmon

OpenHarmony调试说明：https://github.com/openharmony/docs/blob/master/zh-cn/application-dev/dfx/hdc.md

## 检查与安装顺序

1. `tmp/sdk/api11/toolchains/hdc.exe list targets` 应出现一个已授权目标；空列表不能继续安装。
2. 用 tools/check-native-environment.ps1 读取API和完整系统名。若多台设备，明确目标后再操作。
3. 读取该设备UDID用于调试Profile绑定；保存在本地，不放到公开交付说明。
4. 使用 tools/sign-native-debug.ps1 指定真实UDID；SDK公开测试证书仅用于开发。实际信任情况以设备验签为准。
5. 验签后安装 com.pengan.greenhouse，启动 EntryAbility。安装不通过时记录实际错误，不通过关闭设备验签解决。
6. 逐项验收：原生首页、页面切换、模拟超标拒止、通风回采、急停、失联、台账重启恢复、哈希链校验。
7. 用户点击启用摄像头后授权，测试本地预览、抓拍、切页释放。照片不自动上传。

无线调试可作为后续替代路径，但需要板子界面中可用的无线调试设置和明确IP/端口，当前未启用或扫描。

## 脚本支持

- tools/install-native.ps1：先验签、校验normal APL/包名、核对目标UDID与API，再安装并发出启动命令。设备列表为空时已验证会停止；正向安装尚未实机测试。
- tools/sign-native-debug.ps1：使用官方SDK公开测试身份，30天、单设备绑定；OfflineSelfTest输出只在tmp，不能安装到真机。
- tools/prepare-sdk.ps1：官方API11 SDK下载/校验/选择性解压。当前SDK已准备好，无需重复下载。
- 原生诊断页可在应用启动后查看运行时API与系统全名；图像与音频仍需接入真实硬件验证。
