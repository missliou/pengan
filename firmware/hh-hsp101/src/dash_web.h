#pragma once
#include <stdint.h>
#include "dash_core.h"

// Exported by dashboard.c for dash_web.c to query live telemetry and apply remote commands
void dash_get_status(dash_status_t *out);
void dash_apply_command(int route_cmd, uint32_t now);

// Starts WiFi (SoftAP or STA per board_config.h) and spawns the LwIP HTTP Web Server task
void dash_web_start(void);

size_t dash_pengan_json(char *frame,size_t capacity);

const char *dash_wifi_state(void);
void dash_wifi_address(char *out,size_t capacity);
bool dash_receive_weather(const char *body);
