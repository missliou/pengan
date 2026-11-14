#include "dash_core.h"
#include <stdio.h>
#include <string.h>

bool dash_due(uint32_t now,uint32_t deadline){return (int32_t)(now-deadline)>=0;}

bool dash_aht_decode(const uint8_t b[7],int *temp10,unsigned *humidity10){
 if(!b||!temp10||!humidity10||(b[0]&0x80)||!(b[0]&8))return false;
 uint8_t crc=0xff;for(unsigned i=0;i<6;i++){crc^=b[i];for(unsigned j=0;j<8;j++)crc=(uint8_t)((crc<<1)^((crc&0x80)?0x31:0));}
 if(crc!=b[6])return false;
 uint32_t rh=((uint32_t)b[1]<<12)|((uint32_t)b[2]<<4)|(b[3]>>4);
 uint32_t t=((uint32_t)(b[3]&15)<<16)|((uint32_t)b[4]<<8)|b[5];
 *humidity10=(rh*1000u+524288u)/1048576u;*temp10=(int)((t*2000u+524288u)/1048576u)-500;return true;
}

size_t dash_ndef_text(uint8_t *out,size_t cap,const char *text){
 if(!out||!text)return 0;
 size_t n=strlen(text);
 if(n>246||cap<n+10)return 0;
 // NFC Forum Text RTD, UTF-8, language code zh; wrapped in Type 2 NDEF TLV.
 out[0]=3;out[1]=(uint8_t)(n+7);out[2]=0xd1;out[3]=1;out[4]=(uint8_t)(n+3);out[5]='T';out[6]=2;out[7]='z';out[8]='h';memcpy(out+9,text,n);out[n+9]=0xfe;return n+10;
}

unsigned dash_key(dash_key_t *k,bool down,uint32_t now){
 if(down!=k->raw){k->raw=down;k->changed=now;}
 if(k->stable!=k->raw&&(uint32_t)(now-k->changed)>=40){
  k->stable=k->raw;
  if(k->stable){k->pressed=now;k->long_sent=false;}
  else if(!k->long_sent)return 1;
 }
 if(k->stable&&!k->long_sent&&(uint32_t)(now-k->pressed)>=800){k->long_sent=true;return 2;}
 return 0;
}

static bool has_prefix(const char *s, size_t len, const char *p) {
 size_t plen = strlen(p);
 return len >= plen && memcmp(s, p, plen) == 0;
}

int dash_http_route(const char *req, size_t len) {
 if (!req || len < 5) return DASH_ROUTE_NOT_FOUND;
 if (has_prefix(req, len, "OPTIONS ")) return DASH_ROUTE_OPTIONS;
 const char *path = NULL;
 if (has_prefix(req, len, "GET ")) path = req + 4;
 else if (has_prefix(req, len, "POST ")) path = req + 5;
 else return DASH_ROUTE_NOT_FOUND;

 size_t rem = len - (size_t)(path - req);
 if (has_prefix(path, rem, "/ ") || has_prefix(path, rem, "/?") || has_prefix(path, rem, "/index.html")) {
  return DASH_ROUTE_INDEX;
 }
 if (has_prefix(path, rem, "/api/status")) {
  return DASH_ROUTE_STATUS;
 }

 return DASH_ROUTE_NOT_FOUND;
}

size_t dash_status_json(char *out, size_t cap, const dash_status_t *st) {
 if (!out || !st || cap < 256) return 0;
 int n = snprintf(
  out, cap,
  "{\"schemaVersion\":1,\"deviceId\":\"hh-hsp101-001\",\"simulated\":false,\"coValid\":false,\"co2Valid\":false,\"coPpm\":null,\"co2Ppm\":null,\"controlSupported\":false,\"uptime_ms\":%u,\"page\":%u,\"oled_ok\":%s,\"pwm_ok\":%s,\"playing\":%s,"
  "\"note\":%u,\"song_count\":%u,\"gas_ok\":%s,\"gas_raw\":%u,\"gas_mv\":%u,"
  "\"th_ok\":%s,\"temperature10\":%d,\"humidity10\":%u,"
  "\"nfc_status\":\"%s\",\"nfc_text\":\"%s\","
  "\"wifi_mode\":\"%s\",\"wifi_ssid\":\"%s\",\"wifi_ip\":\"%s\",\"trend\":[",
  (unsigned)st->uptime_ms,
  st->page & 3u,
  st->oled_ok ? "true" : "false",
  st->pwm_ok ? "true" : "false",
  st->playing ? "true" : "false",
  st->note,
  st->song_count ? st->song_count : 128u,
  st->gas_ok ? "true" : "false",
  st->gas_raw,
  st->gas_mv,
  st->th_ok ? "true" : "false",
  st->temperature10,
  st->humidity10,
  st->nfc_status ? st->nfc_status : "?",
  st->nfc_text ? st->nfc_text : "HH-HSP101 环境监测站",
  st->wifi_mode ? st->wifi_mode : "AP",
  st->wifi_ssid ? st->wifi_ssid : "HH-HSP101-Monitor",
  st->wifi_ip ? st->wifi_ip : "192.168.43.1"
 );
 if (n < 0 || (size_t)n >= cap) return 0;
 size_t pos = (size_t)n;
 unsigned cnt = st->trend_count > 96u ? 96u : st->trend_count;
 for (unsigned i = 0; i < cnt; i++) {
  int w = snprintf(out + pos, cap - pos, "%s%u", i ? "," : "", (unsigned)st->trend[i]);
  if (w < 0 || pos + (size_t)w >= cap) return 0;
  pos += (size_t)w;
 }
 int tail = snprintf(out + pos, cap - pos, "],\"oled_hex\":\"");
 if (tail < 0 || pos + (size_t)tail + 2048u + 3u >= cap) return 0;
 pos += (size_t)tail;
 static const char hex[] = "0123456789abcdef";
 for (unsigned i = 0; i < 1024u; i++) {
  uint8_t v = st->pixels[i];
  out[pos++] = hex[v >> 4];
  out[pos++] = hex[v & 0x0f];
 }
 out[pos++] = '"';
 out[pos++] = '}';
 out[pos] = '\0';
 return pos;
}
