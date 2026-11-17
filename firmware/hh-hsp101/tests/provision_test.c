#include <stdio.h>
#include <string.h>
#include <stdbool.h>
#include <stdlib.h>
#include <assert.h>
#define HI_FS_O_RDONLY 0
#define HI_FS_O_WRONLY 1
#define HI_FS_O_CREAT 2
#define HI_FS_O_TRUNC 4
#define HISI_OK 0
#define HI_WIFI_CONNECTED 1
static char g_target_ssid[33],g_target_key[65],g_wifi_ip[20]="192.168.43.1";
static const char *g_connection="not_configured";
static bool pending_connect;
typedef struct{int status;} hi_wifi_status;
typedef struct{char ssid[33];int rssi;} hi_wifi_ap_info;
static unsigned char files[2][110];static int lengths[2],fail_write;static bool fs_enabled;
static int hi_open(const char*p,int flags){if(!fs_enabled)return -1;int slot=!strcmp(p,"pgwifi1");if(flags&HI_FS_O_TRUNC)lengths[slot]=0;return slot;}
static int hi_read(int fd,char*b,unsigned n){if(n>(unsigned)lengths[fd])n=lengths[fd];memcpy(b,files[fd],n);return n;}
static int hi_write(int fd,const char*b,unsigned n){if(fail_write)n/=2;memcpy(files[fd],b,n);lengths[fd]=n;return n;}
static int hi_close(int fd){(void)fd;return 0;}
static bool sta_start(void){return true;}
static int hi_wifi_sta_scan(void){return 0;}
static int hi_wifi_sta_scan_results(hi_wifi_ap_info*a,unsigned*n){*n=1;strcpy(a[0].ssid,"quote\"slash\\<tag>");a[0].rssi=-5000;return 0;}
static void hi_sleep(int ms){(void)ms;}
static int client_recv(int fd,char*b,size_t n){(void)fd;(void)b;(void)n;return -1;}
static char sent[20000];static size_t sent_len;
static void send_all(int fd,const char*b,size_t n){(void)fd;assert(sent_len+n<sizeof(sent));memcpy(sent+sent_len,b,n);sent_len+=n;sent[sent_len]=0;}
static size_t dash_pengan_json(char*b,size_t n){return snprintf(b,n,"{\"schemaVersion\":1}");}
#include "../src/dash_weather.h"
static bool dash_receive_weather(const char *body){dash_weather_t w={0};return dash_weather_parse(body,10000,&w);}
#include "../src/dash_provision.h"
static void call(const char*text){char req[3072],body[4096];snprintf(req,sizeof(req),"%s",text);sent_len=0;assert(provision_route(0,req,strlen(req),body,sizeof(body)));}
int main(void){
 const char *weather_body="PGWX1 5 -20 100 180 0 600 9000";char weather_req[512];
 snprintf(weather_req,sizeof(weather_req),"POST /api/pengan/weather HTTP/1.1\r\nContent-Type: application/x-pengan-weather\r\nContent-Length: %u\r\n\r\n%s",(unsigned)strlen(weather_body),weather_body);call(weather_req);assert(strstr(sent,"202")&&strstr(sent,"authenticated\":false"));
 snprintf(weather_req,sizeof(weather_req),"POST /api/pengan/weather HTTP/1.1\r\nOrigin: http://evil.test\r\nContent-Type: application/x-pengan-weather\r\nContent-Length: %u\r\n\r\n%s",(unsigned)strlen(weather_body),weather_body);call(weather_req);assert(strstr(sent,"403"));
 char out[33];assert(form_value("ssid=abc%26def&key=x","ssid",out,sizeof(out))&&!strcmp(out,"abc&def"));assert(!form_value("ssid=%00bad","ssid",out,sizeof(out)));assert(!form_value("ssid=%zz","ssid",out,sizeof(out)));assert(form_value("ssid=%E4","ssid",out,sizeof(out))&&!utf8_valid(out));assert(form_value("ssid=%E5%AE%B6%E9%87%8C","ssid",out,sizeof(out))&&utf8_valid(out));
 call("GET /api/pengan/telemetry HTTP/1.1\r\n\r\n");assert(strstr(sent,"200 OK")&&strstr(sent,"Cache-Control: no-store")&&strstr(sent,"schemaVersion"));
 for(unsigned i=0;i<100;i++){
  call("POST /api/wifi/connect HTTP/1.1\r\nOrigin: http://192.168.43.1\r\nContent-Type: application/x-www-form-urlencoded\r\nContent-Length: 24\r\n\r\nssid=");assert(strstr(sent,"incomplete_body"));
  call("GET /api/pengan/telemetry HTTP/1.1\r\n\r\n");assert(strstr(sent,"200 OK")&&strstr(sent,"schemaVersion"));
 }
 call("GET /api/wifi/scan HTTP/1.1\r\n\r\n");assert(strstr(sent,"quote\\\"slash\\\\<tag>")&&strstr(sent,"-50"));
 call("POST /api/wifi/connect HTTP/1.1\r\nContent-Length: 24\r\n\r\nssid=test&key=password12");assert(strstr(sent,"403"));
 call("POST /api/wifi/connect HTTP/1.1\r\nOrigin: http://evil.test\r\nContent-Length: 24\r\n\r\nssid=test&key=password12");assert(strstr(sent,"403"));
 call("POST /api/wifi/connect HTTP/1.1\r\nOrigin: http://192.168.43.1\r\nContent-Type: application/x-www-form-urlencoded\r\nContent-Length: 513\r\n\r\n");assert(strstr(sent,"413"));
 call("POST /api/wifi/connect HTTP/1.1\r\nOrigin: http://192.168.43.1\r\nContent-Type: application/x-www-form-urlencoded\r\nContent-Length: 24\r\n\r\nssid=test&key=password12");assert(strstr(sent,"202 Accepted")&&pending_connect&&!strcmp(g_target_ssid,"test")&&!strcmp(g_target_key,"password12"));assert(!strstr(sent,"password12"));
 call("GET /api/wifi/status HTTP/1.1\r\n\r\n");assert(!strstr(sent,"password12")&&strstr(sent,"internetVerified\":false"));
 provision_load();provision_save();assert(!credentials_saved);
 fs_enabled=true;strcpy(g_target_ssid,"oldwifi");strcpy(g_target_key,"oldpassword");provision_save();assert(credentials_saved&&saved_sequence==1);
 strcpy(g_target_ssid,"newwifi");strcpy(g_target_key,"newpassword");fail_write=1;provision_save();assert(!credentials_saved);memset(g_target_ssid,0,33);provision_load();assert(!strcmp(g_target_ssid,"oldwifi")&&saved_sequence==1);
 fail_write=0;strcpy(g_target_ssid,"newwifi");strcpy(g_target_key,"newpassword");provision_save();assert(credentials_saved&&saved_sequence==2);memset(g_target_ssid,0,33);provision_load();assert(!strcmp(g_target_ssid,"newwifi"));files[saved_slot][40]^=1;provision_load();assert(!strcmp(g_target_ssid,"oldwifi")&&saved_sequence==1);
 puts("provision routing/parser/credential-redaction/torn-write-recovery PASS");return 0;
}
