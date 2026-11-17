#include <stdio.h>
#include <string.h>
#include <hi_io.h>
#include <hi_i2c.h>
#include <hi_task.h>
#include <hi_time.h>
#include <hi_gpio.h>
#include <hi_pwm.h>
#include <hi_adc.h>
#include <hi_isr.h>
#include "ssd1306_fonts.h"
#include "dash_core.h"
#include "dash_glyphs.h"
#include "board_config.h"
#include "dash_web.h"
#include "dash_weather.h"
static dash_weather_t weather;
static unsigned char pixels[1024];
static bool oled_ok,pwm_ok,playing=false,gas_ok,th_ok,aht_wait;
static unsigned page,note,gas_raw,gas_mv,humidity10;
static int temperature10;
static uint32_t note_end,note_off,gas_due,th_due,th_ready,th_deadline,display_due,oled_retry,started;
static uint32_t gas_sampled,th_sampled,telemetry_due;
static uint16_t trend[96];static unsigned trend_head,trend_count;
static dash_key_t key;
#include "song_internationale.h"
#define SONG_COUNT (sizeof(melody)/sizeof(melody[0]))
static hi_u32 write_bus(unsigned address,const uint8_t *bytes,unsigned n){hi_i2c_data d={0};d.send_buf=(hi_u8*)bytes;d.send_len=n;return hi_i2c_write(DASH_I2C,address,&d);}
static hi_u32 read_bus(unsigned address,uint8_t *bytes,unsigned n){hi_i2c_data d={0};d.receive_buf=bytes;d.receive_len=n;return hi_i2c_read(DASH_I2C,address|1,&d);}
static hi_u32 command(uint8_t c){uint8_t b[]={0,c};return write_bus(DASH_OLED_ADDR,b,2);}
static void pixel(unsigned x,unsigned y){if(x<128&&y<64)pixels[(y/8)*128+x]|=1u<<(y%8);}
static void line(unsigned x,unsigned y,unsigned w){for(unsigned i=0;i<w;i++)pixel(x+i,y);}
static void text(unsigned x,unsigned y,const char *s,FontDef font){
 while(*s){unsigned ch=(uint8_t)*s++;if(ch<32||ch>126||x+font.FontWidth>128||y+font.FontHeight>64)return;
  for(unsigned row=0;row<font.FontHeight;row++){unsigned bits=font.data[(ch-32)*font.FontHeight+row];for(unsigned col=0;col<font.FontWidth;col++)if(bits&(0x8000u>>col))pixel(x+col,y+row);}x+=font.FontWidth;
 }
}
static void chinese(unsigned x,unsigned y,const char *s){while(*s&&x+16<=128){bool found=false;
 for(unsigned i=0;i<sizeof(glyphs)/sizeof(glyphs[0]);i++)if(!strncmp(s,glyphs[i].utf8,3)){for(unsigned r=0;r<16;r++)for(unsigned c=0;c<16;c++)if(glyphs[i].row[r]&(0x8000u>>c))pixel(x+c,y+r);found=true;break;}
 if(!found)return;
 s+=3;x+=16;}}
static uint8_t oled_sent[sizeof(pixels)];
static uint8_t oled_valid_pages;
static bool oled_init(void){
 oled_valid_pages=0;
 const uint8_t seq[]={0xae,0xd5,0x80,0xa8,0x3f,0xd3,0,0x40,0x8d,0x14,0x20,2,0xa1,0xc8,0xda,0x12,0x81,0xcf,0xd9,0xf1,0xdb,0x40,0xa4,0xa6,0xaf};
 for(unsigned i=0;i<sizeof(seq);i++)if(command(seq[i]))return false;
 return true;
}
static bool oled_flush(void){
 uint8_t block[17]={0x40};
 for(unsigned page=0;page<8;page++){
  const uint8_t *current=pixels+page*128;
  uint8_t *sent=oled_sent+page*128;
  const uint8_t page_bit=(uint8_t)(1u<<page);
  if((oled_valid_pages&page_bit)&&memcmp(current,sent,128)==0)continue;
  const uint8_t address[]={0,0xb0+page,0,0x10};
  if(write_bus(DASH_OLED_ADDR,address,sizeof(address)))return false;
  for(unsigned column=0;column<128;column+=16){
   memcpy(block+1,current+column,16);
   if(write_bus(DASH_OLED_ADDR,block,sizeof(block)))return false;
  }
  memcpy(sent,current,128);
  oled_valid_pages|=page_bit;
 }
 return true;
}
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
bool dash_receive_weather(const char *body){
 dash_weather_t next={0};uint32_t uptime=hi_get_milli_seconds()-started;
 if(!dash_weather_parse(body,uptime,&next))return false;
 hi_u32 irq=hi_int_lock();weather=next;hi_int_restore(irq);return true;
}
static void music_tick(uint32_t now){
 if(!playing||!pwm_ok)return;
 if(dash_due(now,note_end)){
  unsigned period=melody[note];hi_u32 r=period?hi_pwm_start(HI_PWM_PORT_PWM0,period/2,period):hi_pwm_stop(HI_PWM_PORT_PWM0);
  if(r){pwm_ok=false;hi_pwm_stop(HI_PWM_PORT_PWM0);printf("[music] PWM error 0x%x\r\n",r);return;}
  uint32_t duration=durations_ms[note];note_end=now+duration;note_off=note_end-(duration>280?35:duration/8);note=(note+1)%SONG_COUNT;
 }else if(dash_due(now,note_off))hi_pwm_stop(HI_PWM_PORT_PWM0);
}
static void gas_tick(uint32_t now){if(!dash_due(now,gas_due))return;gas_due=now+1000;hi_u16 raw=0;bool valid=hi_adc_read(DASH_GAS_ADC,&raw,HI_ADC_EQU_MODEL_4,HI_ADC_CUR_BAIS_DEFAULT,0)==0;hi_u32 irq=hi_int_lock();gas_ok=valid;
 if(gas_ok){gas_sampled=now;gas_raw=raw;gas_mv=((uint32_t)raw*7200u+2048u)/4096u;trend[trend_head]=raw;trend_head=(trend_head+1)%96;if(trend_count<96)trend_count++;}
 hi_int_restore(irq);
}
static void climate_tick(uint32_t now){
 if(aht_wait){if(!dash_due(now,th_ready))return;uint8_t b[7];hi_u32 r=read_bus(DASH_AHT_ADDR,b,7);
  if(!r&&(b[0]&0x80)&&!dash_due(now,th_deadline)){th_ready=now+20;return;}
  int next_temperature=0;unsigned next_humidity=0;bool valid=!r&&dash_aht_decode(b,&next_temperature,&next_humidity);
  hi_u32 irq=hi_int_lock();th_ok=valid;if(valid){temperature10=next_temperature;humidity10=next_humidity;th_sampled=now;}hi_int_restore(irq);aht_wait=false;
  if(!th_ok){const uint8_t init[]={0xbe,8,0};write_bus(DASH_AHT_ADDR,init,3);printf("[aht20] read/status/CRC failed\r\n");}return;
 }
 if(dash_due(now,th_due)){th_due=now+2000;const uint8_t trigger[]={0xac,0x33,0};
  if(write_bus(DASH_AHT_ADDR,trigger,3)){hi_u32 irq=hi_int_lock();th_ok=false;hi_int_restore(irq);return;}
  aht_wait=true;th_ready=now+90;th_deadline=now+500;
 }
}
static volatile int web_commands[8];
static volatile unsigned web_head,web_tail;
void dash_get_status(dash_status_t *out){
 if(!out)return;
 hi_u32 irq=hi_int_lock();
 memset(out,0,sizeof(*out));
 uint32_t now=hi_get_milli_seconds();
 out->uptime_ms=now-started;
 out->page=page;
 out->oled_ok=oled_ok;
 out->pwm_ok=pwm_ok;
 out->playing=playing;
 out->note=note;
 out->song_count=(unsigned)SONG_COUNT;
 out->gas_ok=gas_ok;
 out->gas_raw=gas_raw;
 out->gas_mv=gas_mv;
 out->trend_count=trend_count;
 for(unsigned i=0;i<trend_count;i++){
  unsigned k=(trend_head+96-trend_count+i)%96;
  out->trend[i]=trend[k];
 }
 out->th_ok=th_ok;
 out->temperature10=temperature10;
 out->humidity10=humidity10;
 out->nfc_status="disabled";
 out->nfc_text=DASH_TAG_TEXT;
 memcpy(out->pixels,pixels,sizeof(pixels));
 hi_int_restore(irq);
}
void dash_apply_command(int route_cmd,uint32_t now){
 (void)now;hi_u32 irq=hi_int_lock();unsigned next=(web_head+1)%8;if(next!=web_tail){web_commands[web_head]=route_cmd;web_head=next;}hi_int_restore(irq);
}
static void apply_queued_command(int route_cmd,uint32_t now){
 if(route_cmd==DASH_ROUTE_CMD_NEXT_PAGE){page=(page+1)%4;display_due=now;}
 else if(route_cmd>=DASH_ROUTE_CMD_PAGE_0&&route_cmd<=DASH_ROUTE_CMD_PAGE_3){page=(unsigned)(route_cmd-DASH_ROUTE_CMD_PAGE_0);display_due=now;}
 else if(route_cmd==DASH_ROUTE_CMD_TOGGLE_PLAY){playing=!playing;if(!playing)hi_pwm_stop(HI_PWM_PORT_PWM0);else note_end=now;display_due=now;}
 else if(route_cmd==DASH_ROUTE_CMD_NFC_RECHECK){dash_nfc_force_check();}
}

static char telemetry_json[512];
static size_t telemetry_json_len;
static uint32_t telemetry_published;

static void publish_http_telemetry(uint32_t now){
 char frame[sizeof(telemetry_json)];
 int n=snprintf(frame,sizeof(frame),"{\"schemaVersion\":1,\"deviceId\":\"hh-hsp101-001\",\"simulated\":false,\"uptime_ms\":%u,\"th_ok\":%s,\"temperature10\":%d,\"humidity10\":%u,\"gas_ok\":%s,\"gas_raw\":%u,\"gas_mv\":%u,\"th_sample_age_ms\":%u,\"gas_sample_age_ms\":%u,\"coValid\":false,\"co2Valid\":false,\"coPpm\":null,\"co2Ppm\":null,\"controlSupported\":false}",(unsigned)(now-started),th_ok?"true":"false",temperature10,humidity10,gas_ok?"true":"false",gas_raw,gas_mv,(unsigned)(now-th_sampled),(unsigned)(now-gas_sampled));
 hi_u32 irq=hi_int_lock();
 telemetry_json_len=n>0&&(size_t)n<sizeof(frame)?(size_t)n:0;
 if(telemetry_json_len){memcpy(telemetry_json,frame,telemetry_json_len+1);telemetry_published=now;}
 hi_int_restore(irq);
}

size_t dash_pengan_json(char *frame,size_t capacity){
 hi_u32 irq=hi_int_lock();
 size_t count=telemetry_json_len<capacity?telemetry_json_len:0;
 uint32_t published=telemetry_published;
 if(count)memcpy(frame,telemetry_json,count+1);
 hi_int_restore(irq);
 return count&&(uint32_t)(hi_get_milli_seconds()-published)<1000?count:0;
}
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
static hi_void *dashboard_task(hi_void *arg){
 (void)arg;started=hi_get_milli_seconds();hi_gpio_init();hi_io_set_func(HI_IO_NAME_GPIO_5,HI_IO_FUNC_GPIO_5_GPIO);hi_io_set_pull(HI_IO_NAME_GPIO_5,HI_IO_PULL_UP);hi_gpio_set_dir(HI_GPIO_IDX_5,HI_GPIO_DIR_IN);
 /* No PWM initialization in read-only firmware. */
 hi_io_set_func(HI_IO_NAME_GPIO_11,HI_IO_FUNC_GPIO_11_GPIO);hi_io_set_pull(HI_IO_NAME_GPIO_11,HI_IO_PULL_NONE);hi_gpio_set_dir(HI_GPIO_IDX_11,HI_GPIO_DIR_IN);
 hi_io_set_func(HI_IO_NAME_GPIO_13,HI_IO_FUNC_GPIO_13_I2C0_SDA);hi_io_set_func(HI_IO_NAME_GPIO_14,HI_IO_FUNC_GPIO_14_I2C0_SCL);
 hi_i2c_deinit(DASH_I2C);hi_i2c_init(DASH_I2C,400000);hi_sleep(100);oled_ok=oled_init();oled_retry=started+3000;
 const uint8_t init[]={0xbe,8,0};write_bus(DASH_AHT_ADDR,init,3);th_due=hi_get_milli_seconds()+100;
 uint32_t http_telemetry_due=started;
 for(;;){uint32_t now=hi_get_milli_seconds();hi_gpio_value v=HI_GPIO_VALUE1;
  if(hi_gpio_get_input_val(HI_GPIO_IDX_5,&v)==0){unsigned event=dash_key(&key,v==HI_GPIO_VALUE0,now);if(event==1){page=(page+1)%4;display_due=now;}}
  hi_u32 irq=hi_int_lock();int cmd=0;if(web_tail!=web_head){cmd=web_commands[web_tail];web_tail=(web_tail+1)%8;}hi_int_restore(irq);if(cmd)apply_queued_command(cmd,now);
  gas_tick(now);climate_tick(now);if(dash_due(now,telemetry_due)){telemetry_due=now+2000;pengan_telemetry(now);}
  if(dash_due(now,http_telemetry_due)){http_telemetry_due=now+250;publish_http_telemetry(now);}
  if(!oled_ok&&dash_due(now,oled_retry)){oled_ok=oled_init();oled_retry=now+3000;}
  if(oled_ok&&dash_due(now,display_due)){display_due=now+250;render(now);}
  hi_sleep(10);
 }
 return HI_NULL;
}
hi_void oled_start(hi_void){
 hi_u32 id;hi_task_attr a={0};a.task_name="Dashboard";a.stack_size=8192;a.task_prio=25;
 hi_u32 r=hi_task_create(&id,&a,dashboard_task,HI_NULL);
 printf("[dashboard] task 0x%x; GPIO5 short=page long=play/pause\r\n",r);
 dash_web_start();
}
