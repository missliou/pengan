#include <stdio.h>
#include <string.h>
#include <hi_i2c.h>
#include "board_config.h"
#include "dash_core.h"
// FM11NT082C: 7-bit I2C 0x57, 16-bit big-endian EEPROM address.
// Only user memory 0x0010 onward is written. UID, lock bits and configuration are preserved.
#define TAG_ADDRESS (0x57u<<1)
static uint8_t desired[128];
static unsigned length,padded,position,state;
static uint32_t next;
static const char *status="?";
const char *dash_nfc_status(void){return status;}
static hi_u32 tag_read(uint16_t address,uint8_t *data,unsigned n){uint8_t pointer[]={(uint8_t)(address>>8),(uint8_t)address};hi_i2c_data d={0};d.send_buf=pointer;d.send_len=2;d.receive_buf=data;d.receive_len=n;return hi_i2c_writeread(DASH_I2C,TAG_ADDRESS,&d);}
static hi_u32 tag_write(uint16_t address,const uint8_t *data,unsigned n){uint8_t bytes[18];if(n>16||(address&15)+n>16||address<0x10||address+n>0x378)return 1;
 bytes[0]=address>>8;bytes[1]=address;memcpy(bytes+2,data,n);hi_i2c_data d={0};d.send_buf=bytes;d.send_len=n+2;return hi_i2c_write(DASH_I2C,TAG_ADDRESS,&d);}
static void retry(uint32_t now,const char *why){status="?";state=0;next=now+5000;printf("[nfc] %s; retry in 5s\r\n",why);}
void dash_nfc_tick(uint32_t now){
 if(!dash_due(now,next))return;
 if(!length){length=dash_ndef_text(desired,sizeof(desired),DASH_TAG_TEXT);if(!length){status="!";next=now+60000;return;}padded=(length+15)&~15u;}
 if(state==0){uint8_t header[16],actual[128];
  if(tag_read(0,header,16)){retry(now,"FM11NT082C not responding at 0x57; check NFC switches/I2C");return;}
  // A valid Type 2 CC must grant RF read access and enough memory for this message.
  if(header[12]!=0xe1||(header[13]>>4)!=1||header[14]*8u<length||(header[15]&0xf0)){
   status="!";next=now+60000;printf("[nfc] unsupported tag format/permissions; configuration left unchanged\r\n");return;
  }
  if(tag_read(0x10,actual,padded)){retry(now,"user memory read failed");return;}
  if(!memcmp(actual,desired,padded)){status="N";next=now+60000;return;}
  // Invalidate NDEF length until all payload pages have been committed.
  uint8_t first[16];memcpy(first,desired,16);first[1]=0;
  if(tag_write(0x10,first,16)){retry(now,"first page write failed");return;}
  position=16;state=1;status="~";next=now+20;return;
 }
 if(state==1){if(position<padded){if(tag_write(0x10+position,desired+position,16)){retry(now,"payload write failed");return;}position+=16;next=now+20;return;}
  if(tag_write(0x11,desired+1,1)){retry(now,"NDEF length commit failed");return;}state=2;next=now+20;return;
 }
 uint8_t actual[128];if(tag_read(0x10,actual,padded)||memcmp(actual,desired,padded)){retry(now,"read-back verification failed");return;}
 status="N";state=0;next=now+60000;printf("[nfc] ready: %s; EEPROM write verified\r\n",DASH_TAG_TEXT);
}

void dash_nfc_force_check(void){next=0;}
