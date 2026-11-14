#include <stdio.h>
#include <stdarg.h>
#include <stdint.h>
#include <stdbool.h>
#include <string.h>
static char output[4096];static size_t used,max_call;
static int capped_printf(const char *fmt,...){char b[1024];va_list a;va_start(a,fmt);int n=vsnprintf(b,sizeof(b),fmt,a);va_end(a);size_t size=n>256?256:n;if(size>max_call)max_call=size;memcpy(output+used,b,size);used+=size;return n;}
#define printf capped_printf
static unsigned started=0,gas_raw=4095,gas_mv=7200,humidity10=1000,th_sampled=0,gas_sampled=0;
static int temperature10=-500;static bool th_ok=true,gas_ok=true;
static void pengan_telemetry(uint32_t now){
 char frame[512];
 int n=snprintf(frame,sizeof(frame),"PENGAN_TELEMETRY {\"schemaVersion\":1,\"deviceId\":\"hh-hsp101-001\",\"simulated\":false,\"uptime_ms\":%u,\"th_ok\":%s,\"temperature10\":%d,\"humidity10\":%u,\"gas_ok\":%s,\"gas_raw\":%u,\"gas_mv\":%u,\"th_sample_age_ms\":%u,\"gas_sample_age_ms\":%u,\"coValid\":false,\"co2Valid\":false,\"coPpm\":null,\"co2Ppm\":null,\"controlSupported\":false}\r\n",(unsigned)(now-started),th_ok?"true":"false",temperature10,humidity10,gas_ok?"true":"false",gas_raw,gas_mv,(unsigned)(now-th_sampled),(unsigned)(now-gas_sampled));
 if(n<=0||(size_t)n>=sizeof(frame))return;
 /* Hi3861 printf truncates individual writes at approximately 256 bytes.
  * Each call below emits at most 128 bytes, preserving one JSON line.
  * No sleep/yield is introduced between chunks; UART collector still rejects
  * any damaged line rather than inventing sensor readings.
  */
 for(int off=0;off<n;off+=128){int count=n-off;if(count>128)count=128;printf("%.*s",count,frame+off);}
}
int main(void){pengan_telemetry(UINT32_MAX);if(max_call>128||used<=256)return 1;fwrite(output,1,used,stdout);return 0;}
