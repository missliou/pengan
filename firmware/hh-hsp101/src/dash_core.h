#pragma once
#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>

bool dash_aht_decode(const uint8_t data[7],int *temp10,unsigned *humidity10);
size_t dash_ndef_text(uint8_t *out,size_t cap,const char *text);
typedef struct {bool raw,stable,long_sent;uint32_t changed,pressed;} dash_key_t;
// 1 short release -> next page; 2 long hold -> play/pause.
unsigned dash_key(dash_key_t *key,bool down,uint32_t now);
bool dash_due(uint32_t now,uint32_t deadline);

// Hardware telemetry snapshot & HTTP routing for Web Server
typedef struct {
    uint32_t uptime_ms;
    unsigned page;
    bool oled_ok;
    bool pwm_ok;
    bool playing;
    unsigned note;
    unsigned song_count;
    bool gas_ok;
    unsigned gas_raw;
    unsigned gas_mv;
    uint16_t trend[96];
    unsigned trend_count;
    bool th_ok;
    int temperature10;
    unsigned humidity10;
    const char *nfc_status;
    const char *nfc_text;
    const char *wifi_mode;
    const char *wifi_ssid;
    const char *wifi_ip;
    uint8_t pixels[1024];
} dash_status_t;

enum {
    DASH_ROUTE_NOT_FOUND = 0,
    DASH_ROUTE_INDEX,
    DASH_ROUTE_STATUS,
    DASH_ROUTE_OPTIONS,
    DASH_ROUTE_CMD_NEXT_PAGE,
    DASH_ROUTE_CMD_PAGE_0,
    DASH_ROUTE_CMD_PAGE_1,
    DASH_ROUTE_CMD_PAGE_2,
    DASH_ROUTE_CMD_PAGE_3,
    DASH_ROUTE_CMD_TOGGLE_PLAY,
    DASH_ROUTE_CMD_NFC_RECHECK
};

int dash_http_route(const char *req, size_t len);
size_t dash_status_json(char *out, size_t cap, const dash_status_t *st);
