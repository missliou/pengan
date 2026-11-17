from pathlib import Path
import hashlib,json,re,subprocess,sys,tempfile
root=Path(__file__).resolve().parent;src=(root/'src/dashboard.c').read_text(encoding='utf-8')
def function(name):
 start=src.index('static ',src.rfind('\n',0,src.index(name+'('))+1);brace=src.index('{',start);depth=1;i=brace+1
 while depth:
  depth+=(src[i]=='{')-(src[i]=='}');i+=1
 return src[start:i]
head=r'''#include <assert.h>
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
'''
text=function('text');text=text.replace(' while(*s)', ' record(x,y,strlen(s)*font.FontWidth,font.FontHeight,s);\n while(*s)',1)
chinese=function('chinese');chinese=chinese.replace('{while','{record(x,y,strlen(s)/3*16,16,s);while',1)
render=function('render');assert 'hi_sleep' not in render and 'while' not in render
code=head+function('pixel')+'\n'+text+'\n'+chinese+'\n'+render+r'''
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
'''
out=root/'tests/oled_render_test.c';out.write_text(code)
subprocess.run(['gcc','-std=c99','-Wall','-Wextra','-Werror','-Wno-misleading-indentation','-I'+str(root/'src'),str(out),str(root/'src/ssd1306_fonts.c'),'-o','/tmp/pengan-oled-test'],check=True)
subprocess.run(['/tmp/pengan-oled-test'],check=True)
# Inspect and execute the actual schedule's deadline rules, including uint32 wrap.
assert 'gas_tick(now);climate_tick(now);if(dash_due(now,telemetry_due)){telemetry_due=now+2000;pengan_telemetry(now);}' in src
assert 'display_due=now+250;render(now)' in src
assert 'coValid\\\":false' in src and 'co2Valid\\\":false' in src and 'coPpm\\\":null' in src and 'co2Ppm\\\":null' in src
print('SOURCE CONTRACT PASS: telemetry2s/display250ms independent, no ppm fiction')

core=(root/'src/dash_core.c').read_text(encoding='utf-8');a=core.index('bool dash_due(');b=core.index('\n}',a)+2 if '\n}' in core[a:core.index('bool dash_aht_decode')] else core.index('\n',a)
due=core[a:core.index('\n',a)]
scheduler='#include <stdint.h>\n#include <stdbool.h>\n#include <assert.h>\n#include <stdio.h>\n'+due+r'''
int main(void){uint32_t telemetry_due=0,display_due=0;unsigned emits=0,frames=0;for(uint32_t now=0;now<=10000;now+=10){if(dash_due(now,telemetry_due)){telemetry_due=now+2000;emits++;}if(dash_due(now,display_due)){display_due=now+250;frames++;}}assert(emits==6&&frames==41);assert(dash_due(5,UINT32_MAX-5));assert(!dash_due(UINT32_MAX-5,5));puts("SCHEDULE PASS: 41 heartbeats and 6 complete 2s telemetry opportunities / 10s, including wrap-safe deadlines");}
'''
p=root/'tests/schedule_test.c';p.write_text(scheduler);subprocess.run(['gcc','-std=c99','-Wall','-Wextra','-Werror',str(p),'-o','/tmp/pengan-schedule-test'],check=True);subprocess.run(['/tmp/pengan-schedule-test'],check=True)

cache = src[src.index('static char telemetry_json[512]'):src.index('static void pengan_telemetry(')]
cache_test = r'''
#include <assert.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
typedef unsigned hi_u32;
static uint32_t now, started, th_sampled, gas_sampled;
static bool locked, th_ok = true, gas_ok = true;
static int temperature10 = 250;
static unsigned humidity10 = 600, gas_raw = 100, gas_mv = 200;
static hi_u32 hi_int_lock(void){assert(!locked);locked=true;return 0;}
static void hi_int_restore(hi_u32 irq){assert(irq==0&&locked);locked=false;}
static uint32_t hi_get_milli_seconds(void){assert(!locked);return now;}
''' + cache + r'''
int main(int argc,char **argv){
 (void)argv;
 char body[512], short_body[4];
 if(argc>1){
  now=4000;th_sampled=3400;gas_sampled=3500;
  temperature10=256;humidity10=638;gas_raw=1234;gas_mv=3210;
  publish_http_telemetry(now);assert(dash_pengan_json(body,sizeof(body))>0);puts(body);return 0;
 }
 assert(dash_pengan_json(body,sizeof(body))==0);
 now=250;publish_http_telemetry(now);
 for(unsigned i=0;i<100;i++){
  size_t n=dash_pengan_json(body,sizeof(body));
  assert(n==strlen(body)&&strstr(body,"\"uptime_ms\":250")&&strstr(body,"\"controlSupported\":false"));
 }
 assert(dash_pengan_json(short_body,sizeof(short_body))==0);
 now=1250;assert(dash_pengan_json(body,sizeof(body))==0);
 now=UINT32_MAX-100;publish_http_telemetry(now);now=50;
 assert(dash_pengan_json(body,sizeof(body))>0);
 puts("HTTP snapshot PASS: bounded copy, repeated reads, stale rejection, timer wrap");
 return 0;
}
'''
with tempfile.TemporaryDirectory(prefix='pengan-http-snapshot-') as temp:
    cache_path = Path(temp) / 'snapshot.c'
    executable = Path(temp) / 'snapshot'
    cache_path.write_text(cache_test)
    subprocess.run(['gcc','-std=c99','-Wall','-Wextra','-Werror',str(cache_path),'-o',str(executable)],check=True)
    subprocess.run([str(executable)],check=True)
    if '--write-http-fixture' in sys.argv:
        fixture = {'synthetic': True, 'producerSha256': hashlib.sha256(cache.strip().encode()).hexdigest(),
                   'frame': json.loads(subprocess.check_output([str(executable), 'fixture']))}
        output = root.parent.parent / 'gateway/test/fixtures/firmware-http-frame.json'
        output.write_text(json.dumps(fixture, indent=2) + '\n', encoding='utf-8')
