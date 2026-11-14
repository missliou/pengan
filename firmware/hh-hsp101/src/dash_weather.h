#pragma once
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
/* Informational LAN relay, NOT authenticated, no actuator or admission effect. */
typedef struct { unsigned mask; int min10,max10; unsigned gust10,rain10,ttl; uint32_t sent,received; bool valid; } dash_weather_t;
static bool dash_weather_parse(const char *body,uint32_t uptime,dash_weather_t *out){
 unsigned mask,gust,rain,ttl,sent;int low,high,n=0;
 if(!body||strlen(body)>100||sscanf(body,"PGWX1 %u %d %d %u %u %u %u%n",&mask,&low,&high,&gust,&rain,&ttl,&sent,&n)!=7||body[n]!=0)return false;
 if(mask>63||low< -1000||high>700||low>high||gust>1500||rain>120000||ttl<1||ttl>600||(uint32_t)(uptime-sent)>5000u)return false;
 *out=(dash_weather_t){.mask=mask,.min10=low,.max10=high,.gust10=gust,.rain10=rain,.ttl=ttl,.sent=sent,.received=uptime,.valid=true};return true;
}
static bool dash_weather_fresh(const dash_weather_t *w,uint32_t uptime){return w->valid&&(uint32_t)(uptime-w->received)<w->ttl*1000u;}
static const char *dash_weather_label(unsigned mask){
 if(mask&4)return "WX: STRONG WIND";
 if(mask&16)return "WX: SNOW RISK";
 if(mask&32)return "WX: THUNDER";
 if(mask&1)return "WX: FROST RISK";
 if(mask&2)return "WX: HEAT RISK";
 if(mask&8)return "WX: HEAVY RAIN";
 return "WX: NO RULE HIT";
}
