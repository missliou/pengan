# HH-HSP101本地资料核对

2026-10-30，用户提供另一聊天及目录C:/Users/ASUS/Documents/ChatGPT/无人机探测固件。只读查看，没有修改该项目或刷写设备。

已核对hi3861-dashboard-v1.2.0-review/src/board_config.h、dashboard.c、dash_core.h/c、dash_web.c、prepare_sdk.py和REVIEW.md。

- 既有Hi3861V100代码、SDK构建脚本、已生成730884字节allinone.bin；原项目记录为编译和软件测试通过、实板待验证。此次没有重新编译该固件。
- WSL Ubuntu实际检查：/home/asus/hi3861-build/device_soc_hisilicon-master/hi3861v100/sdk_liteos/include/hi_wifi_api.h存在，/home/asus/hi3861-build/gcc_riscv32/bin/riscv32-unknown-elf-gcc可执行。无需要求用户另外购买SDK。
- 代码配置：按键GPIO5、蜂鸣器GPIO9、气体ADC通道5、I2C0、OLED地址0x3C、AHT地址0x38。属于代码默认值，尚未实物核对。
- dashboard.c显示MQ2 ADC原始值/电压，AHT20温湿度解码；有OLED、NFC、Wi-Fi SoftAP/STA实现。不能据此断言用户板上这些模块全都安装。
- 默认SoftAP HH-HSP101-Monitor，地址192.168.43.1；GET /api/status返回th_ok/temperature10/humidity10/gas_ok/gas_raw/gas_mv等。温湿度按十分之一单位换算。服务尚未实板连通验证。
- 控制接口当前是翻页、音乐开关和NFC重查，没有棚安风机/门锁继电器指令或对应执行回执。
- MQ2原始值/电压不能当成CO或CO2 ppm。未找到独立CO/CO2测量或可用继电器的实物证据；棚安必须将缺失通道标未知并拒止，不可沿用模拟正常值。

后续在本项目创建隔离适配代码，复用已核实SDK，先只读温湿度与ADC，再核实外设/引脚和终端安全闭环。原监测固件不直接视为棚安控制固件。

公开资料：HiSpark/hi3861_hdu_iot_application README明确支持润和HiHope Pegasus，提供Windows/Linux构建及MQTT例程；HH-HSP101具体板号匹配尚需进一步确认。用户发来的lytsfeng/china_remote_id是ESP32系列无人机RID项目，不能作Hi3861固件使用。
