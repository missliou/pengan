#include <stdint.h>
#include <stdbool.h>
#include <assert.h>
#include <stdio.h>
bool dash_due(uint32_t now,uint32_t deadline){return (int32_t)(now-deadline)>=0;}
int main(void){uint32_t telemetry_due=0,display_due=0;unsigned emits=0,frames=0;for(uint32_t now=0;now<=10000;now+=10){if(dash_due(now,telemetry_due)){telemetry_due=now+2000;emits++;}if(dash_due(now,display_due)){display_due=now+250;frames++;}}assert(emits==6&&frames==41);assert(dash_due(5,UINT32_MAX-5));assert(!dash_due(UINT32_MAX-5,5));puts("SCHEDULE PASS: 41 heartbeats and 6 complete 2s telemetry opportunities / 10s, including wrap-safe deadlines");}
