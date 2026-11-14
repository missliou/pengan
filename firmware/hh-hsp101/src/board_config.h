#pragma once
#include <stdbool.h>
#include <stdint.h>
// Defaults verified against Pegasus environment board examples.
#define DASH_BUTTON_GPIO 5
#define DASH_BUZZER_GPIO 9
#define DASH_GAS_ADC HI_ADC_CHANNEL_5
#define DASH_I2C HI_I2C_IDX_0
#define DASH_OLED_ADDR (0x3cu<<1)
#define DASH_AHT_ADDR (0x38u<<1)
#define DASH_TAG_TEXT "HH-HSP101 环境监测站"

// WiFi & HTTP Web Server configuration (Hi3861V100 LwIP + SoftAP/STA)
// Leave DASH_WIFI_STA_SSID empty ("") to start a plug-and-play SoftAP hotspot:
//   SSID: HH-HSP101-Monitor  |  Key: 12345678  |  URL: http://192.168.43.1/
// Or fill DASH_WIFI_STA_SSID & DASH_WIFI_STA_KEY to join an existing router WiFi.
#define DASH_WIFI_AP_SSID     "HH-HSP101-Monitor"
#define DASH_WIFI_AP_KEY      "12345678"
#define DASH_WIFI_AP_CHANNEL  6
#define DASH_WIFI_STA_SSID    ""
#define DASH_WIFI_STA_KEY     ""
#define DASH_WEB_PORT         80

void dash_nfc_tick(uint32_t now);
const char *dash_nfc_status(void);
void dash_nfc_force_check(void);
void dash_web_start(void);
