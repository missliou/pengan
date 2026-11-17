#include <assert.h>
#include <stdio.h>
#include <string.h>
#include <stdint.h>
#include <stdbool.h>
#include "ssd1306_fonts.h"
#include "dash_glyphs.h"
#include "dash_weather.h"
typedef unsigned hi_u32;
static hi_u32 hi_int_lock(void){return 0;}
static void hi_int_restore(hi_u32 irq){(void)irq;}
static dash_weather_t weather;
struct {unsigned char before[16],data[1024],after[16];} guarded;
#define pixels guarded.data
static bool th_ok,gas_ok,oled_ok=true;static unsigned gas_raw,humidity10;static int temperature10;static uint32_t started,oled_retry;
static unsigned rects,flushes;static char texts[16][64];static unsigned boxes[16][4];
static void record(unsigned x,unsigned y,unsigned w,unsigned h,const char *s){assert(x+w<=128&&y+h<=64);for(unsigned i=0;i<rects;i++)assert(x+w<=boxes[i][0]||boxes[i][0]+boxes[i][2]<=x||y+h<=boxes[i][1]||boxes[i][1]+boxes[i][3]<=y);boxes[rects][0]=x;boxes[rects][1]=y;boxes[rects][2]=w;boxes[rects][3]=h;snprintf(texts[rects],64,"%s",s);rects++;}
static const char *network_state="WiFi failed: use AP";
static void dash_wifi_display(char *out,size_t n){snprintf(out,n,"%s",network_state);}
static bool oled_flush(void){flushes++;return true;}
static void pixel(unsigned x,unsigned y){if(x<128&&y<64)pixels[(y/8)*128+x]|=1u<<(y%8);}
static void text(unsigned x,unsigned y,const char *s,FontDef font){
 record(x,y,strlen(s)*font.FontWidth,font.FontHeight,s);
 while(*s){unsigned ch=(uint8_t)*s++;if(ch<32||ch>126||x+font.FontWidth>128||y+font.FontHeight>64)return;
  for(unsigned row=0;row<font.FontHeight;row++){unsigned bits=font.data[(ch-32)*font.FontHeight+row];for(unsigned col=0;col<font.FontWidth;col++)if(bits&(0x8000u>>col))pixel(x+col,y+row);}x+=font.FontWidth;
 }
}
static void chinese(unsigned x,unsigned y,const char *s){record(x,y,strlen(s)/3*16,16,s);while(*s&&x+16<=128){bool found=false;
 for(unsigned i=0;i<sizeof(glyphs)/sizeof(glyphs[0]);i++)if(!strncmp(s,glyphs[i].utf8,3)){for(unsigned r=0;r<16;r++)for(unsigned c=0;c<16;c++)if(glyphs[i].row[r]&(0x8000u>>c))pixel(x+c,y+r);found=true;break;}
 if(!found)return;
 s+=3;x+=16;}}
static void render(uint32_t now){
 char b[48];memset(pixels,0,sizeof(pixels));chinese(0,0,"系统运行中");
 const char spin[]={'|','/','-','\\'};char anim[2]={spin[(now/250)%4],0};text(115,2,anim,Font_6x8);
 snprintf(b,sizeof(b),"UP:%lus",(unsigned long)((now-started)/1000));text(0,18,b,Font_6x8);
 if(th_ok){unsigned t=temperature10<0?-(int64_t)temperature10:temperature10;snprintf(b,sizeof(b),"T:%s%u.%uC RH:%u.%u%%",temperature10<0?"-":"",t/10,t%10,humidity10/10,humidity10%10);}
 else snprintf(b,sizeof(b),"AHT20: UNKNOWN");text(0,29,b,Font_6x8);
 if(gas_ok)snprintf(b,sizeof(b),"MQ2 RAW:%u",gas_raw);else snprintf(b,sizeof(b),"MQ2: UNKNOWN");text(0,38,b,Font_6x8);
 hi_u32 weather_irq=hi_int_lock();dash_weather_t wx=weather;hi_int_restore(weather_irq);
 const char *detail=(now/3000)%2?(dash_weather_fresh(&wx,now-started)?dash_weather_label(wx.mask):"WX: UNKNOWN/EXPIRED"):"CO/CO2: UNKNOWN";
 text(0,47,detail,Font_6x8);
 dash_wifi_display(b,sizeof(b));text(0,56,b,Font_6x8);
 if(!oled_flush()){oled_ok=false;oled_retry=now+3000;printf("[oled] I2C failed\r\n");}
}
static void checked_render(uint32_t now){rects=0;render(now);for(unsigned i=0;i<16;i++){assert(guarded.before[i]==0xa5);assert(guarded.after[i]==0x5a);}}
int main(void){memset(guarded.before,0xa5,16);memset(guarded.after,0x5a,16);
 const char *required[]={"系","统","运","行","中"};for(unsigned c=0;c<5;c++){bool found=false;for(unsigned g=0;g<sizeof(glyphs)/sizeof(glyphs[0]);g++)if(!strcmp(required[c],glyphs[g].utf8)){unsigned sum=0;for(unsigned row=0;row<16;row++)sum|=glyphs[g].row[row];assert(sum);found=true;}assert(found);}
 th_ok=gas_ok=true;temperature10=-5;humidity10=1000;gas_raw=4095;checked_render(0);assert(strstr(texts[3],"-0.5C"));
 unsigned char first[1024];memcpy(first,pixels,1024);checked_render(250);assert(memcmp(first,pixels,1024)!=0);assert(memcmp(first+3*128,pixels+3*128,5*128)==0);
 for(unsigned i=0;i<4;i++)checked_render(i*250);th_ok=gas_ok=false;checked_render(1000);assert(!strcmp(texts[3],"AHT20: UNKNOWN"));assert(!strcmp(texts[4],"MQ2: UNKNOWN"));assert(!strcmp(texts[5],"CO/CO2: UNKNOWN"));
 for(unsigned i=0;i<4;i++)checked_render(i*3000);network_state="LAN 192.168.123.234";checked_render(9000);
 assert(!strcmp(texts[6],network_state));checked_render(12000);assert(!strcmp(texts[6],network_state));
 assert(dash_weather_parse("PGWX1 4 -10 100 180 0 600 9000",9000,&weather));checked_render(9000);assert(!strcmp(texts[5],"WX: STRONG WIND"));checked_render(609000);assert(!strcmp(texts[5],"WX: UNKNOWN/EXPIRED"));
 puts("OLED PASS: nonempty Chinese glyphs, no rectangle overlap, guarded 128x64 pixels, negative subzero, UNKNOWN, independent heartbeat");return 0;}
