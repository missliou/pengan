/* Included once by dash_web.c; credentials exist only in board filesystem/RAM. */
static const char setup_html[]=
"<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><title>HH-HSP101 配网</title><style>body{font:16px sans-serif;max-width:580px;margin:24px auto;padding:16px}button,input,select{display:block;margin:12px 0;padding:12px;max-width:100%;box-sizing:border-box}pre{white-space:pre-wrap}</style>"
"<h1>HH-HSP101 配网</h1><p>手机连接 HH-HSP101-Monitor 热点。此热点没有互联网，请保持连接。选择家里的2.4GHz Wi-Fi；目前支持开放网络或WPA2个人网络，SSID最多32字节，密码8至63个ASCII字符。</p><button id=scan>扫描附近Wi-Fi</button><select id=aps></select><form id=form><label>Wi-Fi名称<input id=ssid maxlength=32 required></label><label>Wi-Fi密码<input id=key type=password maxlength=63 autocomplete=new-password></label><button>连接并保存</button></form><pre id=status>尚未查询</pre><p>凭据只保存在板子，不会回显。连接成功只表示局域网可达，不表示互联网可达。电脑服务用板子的局域网IP采集；本页连接过程中可能需等待30秒。</p>"
"<script>const $=id=>document.getElementById(id);async function state(){try{let r=await fetch('/api/wifi/status',{cache:'no-store'});let d=await r.json();$('status').textContent='状态：'+d.state+'\n局域网IP：'+d.ip+'\n配网地址：http://192.168.43.1/\n凭据保存：'+d.credentialsSaved}catch(e){$('status').textContent='查询失败，连接期间请等待30秒后重试'}}$('scan').onclick=async()=>{try{$('scan').disabled=true;let r=await fetch('/api/wifi/scan',{cache:'no-store'}),d=await r.json();if(!r.ok)throw Error(d.error);$('aps').replaceChildren();for(let a of d.aps){let o=document.createElement('option');o.value=a.ssid;o.textContent=a.ssid+' ('+a.rssi+' dBm)';$('aps').append(o)}if(d.aps.length)$('ssid').value=d.aps[0].ssid;else $('status').textContent='没有扫描结果，请重试或手动输入SSID'}catch(e){$('status').textContent='扫描失败，请稍后重试'}finally{$('scan').disabled=false}};$('aps').onchange=()=>$('ssid').value=$('aps').value;$('form').onsubmit=async e=>{e.preventDefault();try{let r=await fetch('/api/wifi/connect',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({ssid:$('ssid').value,key:$('key').value})});$('key').value='';if(!r.ok)throw Error();$('status').textContent='已提交连接，等待DHCP，30秒后刷新状态';setTimeout(state,32000)}catch(e){$('status').textContent='未确认连接，请检查输入后重试'}};state();</script>";
static bool credentials_saved;
static unsigned saved_sequence;
static int saved_slot=-1;
static unsigned credential_hash(const unsigned char *data){unsigned h=2166136261u;for(unsigned i=0;i<106;i++){h^=data[i];h*=16777619u;}return h;}
static unsigned read_u32(const unsigned char *p){return (unsigned)p[0]|(unsigned)p[1]<<8|(unsigned)p[2]<<16|(unsigned)p[3]<<24;}
static void write_u32(unsigned char *p,unsigned n){for(unsigned i=0;i<4;i++)p[i]=(unsigned char)(n>>(i*8));}
static bool read_slot(int slot,unsigned char *data){
 int fd=hi_open(slot?"pgwifi1":"pgwifi0",HI_FS_O_RDONLY);if(fd<0)return false;
 int n=hi_read(fd,(char*)data,110);hi_close(fd);
 return n==110&&memcmp(data,"PG13",4)==0&&data[36]==0&&data[101]==0&&read_u32(data+102)>0&&read_u32(data+106)==credential_hash(data);
}
static void provision_load(void){
 unsigned char data[110]={0};saved_sequence=0;saved_slot=-1;
 for(int slot=0;slot<2;slot++){if(read_slot(slot,data)&&read_u32(data+102)>saved_sequence){saved_sequence=read_u32(data+102);saved_slot=slot;memcpy(g_target_ssid,data+4,33);memcpy(g_target_key,data+37,65);}}
 credentials_saved=saved_slot>=0;memset(data,0,sizeof(data));
}
static void provision_save(void){
 unsigned char data[110]={0},check[110]={0};credentials_saved=false;
 if(saved_sequence==0xffffffffu)return;
 memcpy(data,"PG13",4);memcpy(data+4,g_target_ssid,33);memcpy(data+37,g_target_key,65);write_u32(data+102,saved_sequence+1);write_u32(data+106,credential_hash(data));
 int next=saved_slot==0?1:0;
 int fd=hi_open(next?"pgwifi1":"pgwifi0",HI_FS_O_WRONLY|HI_FS_O_CREAT|HI_FS_O_TRUNC);
 bool written=false;if(fd>=0){written=hi_write(fd,(const char*)data,sizeof(data))==sizeof(data);hi_close(fd);}
 if(written&&read_slot(next,check)&&memcmp(data,check,sizeof(data))==0){saved_sequence++;saved_slot=next;credentials_saved=true;}
 memset(data,0,sizeof(data));memset(check,0,sizeof(check));
}
static void reply(int fd,int code,const char *type,const char *body){
 char h[220];int n=snprintf(h,sizeof(h),"HTTP/1.1 %d %s\r\nContent-Type: %s\r\ncontent-length: %u\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",code,code==200?"OK":code==202?"Accepted":"Error",type,(unsigned)strlen(body));
 if(n>0&&(size_t)n<sizeof(h)){send_all(fd,h,n);send_all(fd,body,strlen(body));}
}
static bool form_value(const char *body,const char *key,char *out,size_t capacity){
 size_t k=strlen(key);const char *p=body;
 while(*p){const char *end=strchr(p,'&');if(!end)end=p+strlen(p);
  if((size_t)(end-p)>k&&memcmp(p,key,k)==0&&p[k]=='='){
   size_t n=0;for(const char *v=p+k+1;v<end;v++){unsigned char c=*v;
    if(c=='+')c=' ';else if(c=='%'){if(end-v<3)return false;unsigned h=0;for(int j=1;j<3;j++){char x=v[j];if(x>='0'&&x<='9')h=h*16+x-'0';else if(x>='a'&&x<='f')h=h*16+x-'a'+10;else if(x>='A'&&x<='F')h=h*16+x-'A'+10;else return false;}c=h;v+=2;}
    if(c<32||c==127||n+1>=capacity)return false;
    out[n++]=c;
   }out[n]=0;return true;
  }p=*end?end+1:end;
 }return false;
}
static bool utf8_valid(const char *text){
 const unsigned char *p=(const unsigned char*)text;
 while(*p){unsigned c=*p++;if(c<0x80)continue;unsigned n,min,cp;
 if(c>=0xc2&&c<=0xdf){n=1;min=0x80;cp=c&31;}else if(c>=0xe0&&c<=0xef){n=2;min=0x800;cp=c&15;}else if(c>=0xf0&&c<=0xf4){n=3;min=0x10000;cp=c&7;}else return false;
 for(unsigned i=0;i<n;i++){if(!*p||(*p&0xc0)!=0x80)return false;cp=(cp<<6)|(*p++&63);}if(cp<min||cp>0x10ffff||(cp>=0xd800&&cp<=0xdfff))return false;
 }return true;
}
static size_t quote_json(char *out,size_t cap,const char *in){size_t n=0;if(cap<3)return 0;out[n++]='"';if(!utf8_valid(in))in="";for(size_t i=0;in[i]&&i<32;i++){unsigned char c=in[i];if(c<32)c='?';if(c=='"'||c=='\\'){if(n+2>=cap)return 0;out[n++]='\\';}if(n+1>=cap)return 0;out[n++]=c;}out[n++]='"';out[n]=0;return n;}
static bool provision_route(int fd,char *req,size_t used){
 if(strncmp(req,"POST /api/pengan/weather HTTP/1.1\r\n",strlen("POST /api/pengan/weather HTTP/1.1\r\n"))==0){
  /* Native-only custom MIME: deny browsers and chunking; never accepts credentials. */
  char *header_end=strstr(req,"\r\n\r\n");
  if(!header_end){reply(fd,400,"application/json","{\"error\":\"weather_headers\"}");return true;}
  for(char *line=strstr(req,"\r\n");line&&line<header_end;){line+=2;char *end=strstr(line,"\r\n");if(!end)break;for(char *p=line;p<end&&*p!=':';p++)if(*p>='A'&&*p<='Z')*p+=32;line=end;}
  char *length=strstr(req,"\r\ncontent-length: ");unsigned count=0;int consumed=0;
  if(strstr(req,"\r\norigin:")||strstr(req,"\r\ntransfer-encoding:")||!strstr(req,"\r\ncontent-type: application/x-pengan-weather\r\n")||!length||sscanf(length,"\r\ncontent-length: %u%n",&count,&consumed)!=1||strncmp(length+consumed,"\r\n",2)||count>100||!count){reply(fd,403,"application/json","{\"error\":\"weather_native_only\"}");return true;}
  size_t offset=(size_t)(header_end+4-req);
  if(offset+count>=3072){reply(fd,413,"application/json","{\"error\":\"weather_too_large\"}");return true;}
  while(used<offset+count){int more=lwip_recv(fd,req+used,offset+count-used,0);if(more<=0)return true;used+=more;req[used]=0;}
  if(used!=offset+count||memchr(req+offset,0,count)||!dash_receive_weather(req+offset)){reply(fd,400,"application/json","{\"error\":\"weather_invalid_or_stale\"}");return true;}
  reply(fd,202,"application/json","{\"saved\":true,\"informationalOnly\":true,\"authenticated\":false}");return true;
 }
 if(strncmp(req,"GET /api/pengan/telemetry ",strlen("GET /api/pengan/telemetry "))==0){char json[512];size_t n=dash_pengan_json(json,sizeof(json));reply(fd,n?200:503,"application/json",n?json:"{\"error\":\"telemetry_unavailable\"}");return true;}
 if(strncmp(req,"GET / ",strlen("GET / "))==0){reply(fd,200,"text/html; charset=utf-8",setup_html);return true;}
 if(strncmp(req,"GET /api/wifi/status ",strlen("GET /api/wifi/status "))==0){
  if(strcmp(g_connection,"lan_ready")==0&&!lan_address_ready()){g_connection="disconnected";snprintf(g_wifi_ip,sizeof(g_wifi_ip),"0.0.0.0");}
  char body[220];snprintf(body,sizeof(body),"{\"state\":\"%s\",\"ip\":\"%s\",\"credentialsSaved\":%s,\"internetVerified\":false}",g_connection,g_wifi_ip,credentials_saved?"true":"false");reply(fd,200,"application/json",body);return true;
 }
 if(strncmp(req,"GET /api/wifi/scan ",strlen("GET /api/wifi/scan "))==0){
  if(pending_connect){reply(fd,409,"application/json","{\"error\":\"connection_busy\"}");return true;}
  static hi_wifi_ap_info aps[16];unsigned count=16;
  if(!sta_start()||hi_wifi_sta_scan()!=HISI_OK){reply(fd,503,"application/json","{\"error\":\"scan_failed\"}");return true;}
  hi_sleep(3500);
  if(hi_wifi_sta_scan_results(aps,&count)!=HISI_OK){reply(fd,503,"application/json","{\"error\":\"scan_results_failed\"}");return true;}
  char body[2000];size_t n=snprintf(body,sizeof(body),"{\"aps\":[");
  if(count>16)count=16;
  for(unsigned i=0;i<count;i++){char ssid[70];aps[i].ssid[32]=0;quote_json(ssid,sizeof(ssid),aps[i].ssid);n+=snprintf(body+n,sizeof(body)-n,"%s{\"ssid\":%s,\"rssi\":%d}",i?",":"",ssid,aps[i].rssi/100);}
  snprintf(body+n,sizeof(body)-n,"]}");reply(fd,200,"application/json",body);return true;
 }
 if(strncmp(req,"POST /api/wifi/connect ",strlen("POST /api/wifi/connect "))!=0)return false;
 if(pending_connect){reply(fd,409,"application/json","{\"error\":\"connection_busy\"}");return true;}
 /* HTTP field names are case-insensitive; preserve all field values and body bytes. */
 for(char *line=strstr(req,"\r\n");line&&line[2]&&line[2]!='\r';){
  line+=2;char *end=strstr(line,"\r\n");if(!end)break;
  for(char *p=line;p<end&&*p!=':';p++)if(*p>='A'&&*p<='Z')*p=(char)(*p-'A'+'a');
  line=end;
 }
 /* Browser same-origin check; reject arbitrary cross-origin credential submissions. */
 if(!strstr(req,"\r\norigin: http://192.168.43.1\r\n")){reply(fd,403,"application/json","{\"error\":\"origin_rejected\"}");return true;}
 char *headers=strstr(req,"\r\n\r\n"),*length=strstr(req,"\r\ncontent-length:");
 if(!headers||!length||length>headers||!strstr(req,"\r\ncontent-type: application/x-www-form-urlencoded\r\n")){reply(fd,400,"application/json","{\"error\":\"invalid_headers\"}");return true;}
 unsigned size=0;if(sscanf(length,"\r\ncontent-length: %u",&size)!=1||size>512){reply(fd,413,"application/json","{\"error\":\"body_too_large\"}");return true;}
 size_t offset=headers+4-req;if(offset+size>=3072){reply(fd,413,"application/json","{}");return true;}
 while(used<offset+size){int n=lwip_recv(fd,req+used,offset+size-used,0);if(n<=0){reply(fd,400,"application/json","{\"error\":\"incomplete_body\"}");return true;}used+=n;}
 req[offset+size]=0;char ssid[33]={0},key[65]={0};
 bool valid=form_value(req+offset,"ssid",ssid,sizeof(ssid))&&ssid[0]&&utf8_valid(ssid)&&form_value(req+offset,"key",key,sizeof(key))&&(!key[0]||(strlen(key)>=8&&strlen(key)<=63));
 for(size_t i=0;key[i];i++)if((unsigned char)key[i]>126)valid=false;
 if(!valid){memset(ssid,0,sizeof(ssid));memset(key,0,sizeof(key));memset(req,0,3072);reply(fd,400,"application/json","{\"error\":\"invalid_credentials\"}");return true;}
 memcpy(g_target_ssid,ssid,sizeof(ssid));memcpy(g_target_key,key,sizeof(key));memset(key,0,sizeof(key));memset(req,0,3072);pending_connect=true;g_connection="connecting";
 reply(fd,202,"application/json","{\"accepted\":true,\"connected\":false}");return true;
}
