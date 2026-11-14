#include <stdio.h>
#include <string.h>
#include <hi_task.h>
#include <hi_time.h>
#include <hi_wifi_api.h>
#include <hi_fs.h>
#include <lwip/ip_addr.h>
#include <lwip/netifapi.h>
#include <lwip/sockets.h>
#include "board_config.h"
#include "dash_core.h"
#include "dash_web.h"
#include "dash_web_ui.h"

static char g_wifi_mode[8] = "AP";
static char g_wifi_ssid[33] = DASH_WIFI_AP_SSID;
static char g_wifi_ip[20] = "192.168.43.1";
static char g_net_ifname[WIFI_IFNAME_MAX_SIZE + 1] = {0};

static void update_ip_str(void) {
    if (!g_net_ifname[0]) return;
    struct netif *netif_p = netif_find(g_net_ifname);
    if (!netif_p) return;
    ip4_addr_t ip = {0}, mask = {0}, gw = {0};
    if (netifapi_netif_get_addr(netif_p, &ip, &mask, &gw) == 0 && ip.addr != 0) {
        unsigned a = (unsigned)(ip.addr & 0xffu);
        unsigned b = (unsigned)((ip.addr >> 8) & 0xffu);
        unsigned c = (unsigned)((ip.addr >> 16) & 0xffu);
        unsigned d = (unsigned)((ip.addr >> 24) & 0xffu);
        snprintf(g_wifi_ip, sizeof(g_wifi_ip), "%u.%u.%u.%u", a, b, c, d);
    }
}

static bool wifi_setup_softap(void) {
    hi_wifi_softap_config conf;
    memset(&conf, 0, sizeof(conf));
    strncpy(conf.ssid, DASH_WIFI_AP_SSID, sizeof(conf.ssid) - 1);
    conf.channel_num = DASH_WIFI_AP_CHANNEL;
    conf.ssid_hidden = 0;
    if (strlen(DASH_WIFI_AP_KEY) >= 8) {
        strncpy(conf.key, DASH_WIFI_AP_KEY, sizeof(conf.key) - 1);
        conf.authmode = HI_WIFI_SECURITY_WPA2PSK;
        conf.pairwise = HI_WIFI_PAIRWISE_AES;
    } else {
        conf.authmode = HI_WIFI_SECURITY_OPEN;
    }

    int len = (int)sizeof(g_net_ifname);
    if (hi_wifi_softap_start(&conf, g_net_ifname, &len) != HISI_OK) {
        printf("[web] hi_wifi_softap_start failed\r\n");
        return false;
    }
    struct netif *netif_p = netif_find(g_net_ifname);
    if (!netif_p) {
        printf("[web] netif_find(%s) failed\r\n", g_net_ifname);
        return false;
    }
    ip4_addr_t ipaddr, netmask, gw;
    IP4_ADDR(&ipaddr, 192, 168, 43, 1);
    IP4_ADDR(&netmask, 255, 255, 255, 0);
    IP4_ADDR(&gw, 192, 168, 43, 1);
    if (netifapi_netif_set_addr(netif_p, &ipaddr, &netmask, &gw) != 0 ||
        netifapi_dhcps_start(netif_p, NULL, 0) != 0) {
        printf("[web] AP address or DHCP failed\r\n");return false;
    }

    snprintf(g_wifi_mode, sizeof(g_wifi_mode), "AP");
    snprintf(g_wifi_ssid, sizeof(g_wifi_ssid), "%s", DASH_WIFI_AP_SSID);
    snprintf(g_wifi_ip, sizeof(g_wifi_ip), "192.168.43.1");
    printf("[web] provisioning AP ready: http://192.168.43.1/\r\n");
    return true;
}

static char g_sta_if[WIFI_IFNAME_MAX_SIZE+1];
static char g_target_ssid[33],g_target_key[65];
static const char *g_connection="not_configured";
static bool g_sta_started;
static volatile bool pending_connect;
static bool sta_start(void){
 if(g_sta_started)return true;
 int len=sizeof(g_sta_if);
 g_sta_started=hi_wifi_sta_start(g_sta_if,&len)==HISI_OK;
 return g_sta_started;
}
static bool wifi_setup_sta(void){
 g_connection="connecting";
 if(!sta_start()){g_connection="sta_start_failed";return false;}
 hi_wifi_sta_disconnect();
 struct netif *n=netif_find(g_sta_if);
 if(n){netifapi_dhcp_stop(n);ip4_addr_t zero={0};netifapi_netif_set_addr(n,&zero,&zero,&zero);}
 hi_wifi_assoc_request req={0};
 strncpy(req.ssid,g_target_ssid,sizeof(req.ssid)-1);
 strncpy(req.key,g_target_key,sizeof(req.key)-1);
 req.auth=g_target_key[0]?HI_WIFI_SECURITY_WPA2PSK:HI_WIFI_SECURITY_OPEN;
 int rc=hi_wifi_sta_connect(&req);memset(&req,0,sizeof(req));
 if(rc!=HISI_OK){g_connection="association_request_failed";return false;}
 bool dhcp=false;
 for(unsigned i=0;i<150;i++){
  hi_wifi_status status={0};
  if(hi_wifi_sta_get_connect_info(&status)==HISI_OK&&status.status==HI_WIFI_CONNECTED){
   n=netif_find(g_sta_if);
   if(n&&!dhcp){if(netifapi_dhcp_start(n)!=0)break;dhcp=true;}
   ip4_addr_t ip={0},mask={0},gw={0};
   if(dhcp&&netifapi_netif_get_addr(n,&ip,&mask,&gw)==0&&ip.addr){
    snprintf(g_wifi_ip,sizeof(g_wifi_ip),"%u.%u.%u.%u",(unsigned)(ip.addr&255),(unsigned)((ip.addr>>8)&255),(unsigned)((ip.addr>>16)&255),(unsigned)((ip.addr>>24)&255));
    snprintf(g_wifi_mode,sizeof(g_wifi_mode),"STA");snprintf(g_wifi_ssid,sizeof(g_wifi_ssid),"%s",g_target_ssid);g_connection="lan_ready";return true;
   }
  }
  hi_sleep(200);
 }
 hi_wifi_sta_disconnect();if(n)netifapi_dhcp_stop(n);
 g_connection="connection_or_dhcp_failed";snprintf(g_wifi_mode,sizeof(g_wifi_mode),"AP");snprintf(g_wifi_ip,sizeof(g_wifi_ip),"192.168.43.1");
 return false;
}

static void send_all(int fd, const char *buf, size_t len) {
    size_t sent = 0;
    while (sent < len) {
        size_t chunk = len - sent;
        if (chunk > 1024u) chunk = 1024u;
        int w = lwip_send(fd, buf + sent, chunk, 0);
        if (w <= 0) break;
        sent += (size_t)w;
    }
}

static bool lan_address_ready(void){
 hi_wifi_status state={0};if(hi_wifi_sta_get_connect_info(&state)!=HISI_OK||state.status!=HI_WIFI_CONNECTED)return false;
 struct netif *n=netif_find(g_sta_if);ip4_addr_t ip={0},mask={0},gw={0};
 return n&&netifapi_netif_get_addr(n,&ip,&mask,&gw)==0&&ip.addr!=0;
}
#include "dash_provision.h"
static volatile bool connection_worker;
static hi_void *connect_task(hi_void *arg){(void)arg;if(wifi_setup_sta())provision_save();memset(g_target_key,0,sizeof(g_target_key));pending_connect=false;connection_worker=false;return HI_NULL;}
static void begin_connect(void){
 if(connection_worker||!pending_connect)return;
 connection_worker=true;hi_u32 id=0;hi_task_attr attr={0};attr.task_name="WifiConnect";attr.stack_size=4096;attr.task_prio=27;
 if(hi_task_create(&id,&attr,connect_task,HI_NULL)!=0){g_connection="worker_failed";pending_connect=false;connection_worker=false;memset(g_target_key,0,sizeof(g_target_key));}
}


static void handle_http_client(int client_fd) {
    char req[3072];
    static char json_buf[4096];
    char hdr[256];

    struct timeval tv = { .tv_sec = 2, .tv_usec = 0 };
    lwip_setsockopt(client_fd, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));

    int r = lwip_recv(client_fd, req, sizeof(req) - 1, 0);
    if (r <= 0) return;
    req[r] = '\0';
    while(!strstr(req,"\r\n\r\n") && (size_t)r<sizeof(req)-1){int more=lwip_recv(client_fd,req+r,sizeof(req)-1-r,0);if(more<=0)return;r+=more;req[r]=0;}
    if(provision_route(client_fd,req,(size_t)r))return;

    int route = dash_http_route(req, (size_t)r);
    if (route == DASH_ROUTE_OPTIONS) {
        static const char preflight[] =
            "HTTP/1.1 204 No Content\r\n"
            "Access-Control-Allow-Origin: *\r\n"
            "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n"
            "Connection: close\r\n\r\n";
        send_all(client_fd, preflight, sizeof(preflight) - 1);
        return;
    }

    if (route == DASH_ROUTE_INDEX) {
        int hlen = snprintf(
            hdr, sizeof(hdr),
            "HTTP/1.1 200 OK\r\n"
            "Content-Type: text/html; charset=utf-8\r\n"
            "Content-Length: %u\r\n"
            "Cache-Control: no-cache\r\n"
            "Connection: close\r\n\r\n",
            (unsigned)DASH_WEB_HTML_LEN
        );
        if (hlen > 0) send_all(client_fd, hdr, (size_t)hlen);
        send_all(client_fd, DASH_WEB_HTML, DASH_WEB_HTML_LEN);
        return;
    }

    if (route >= DASH_ROUTE_CMD_NEXT_PAGE && route <= DASH_ROUTE_CMD_NFC_RECHECK) {
        dash_apply_command(route, hi_get_milli_seconds());
        route = DASH_ROUTE_STATUS;
    }

    if (route == DASH_ROUTE_STATUS) {
        /* STA address is confirmed by DHCP in wifi_setup_sta. */
        dash_status_t st;
        dash_get_status(&st);
        st.wifi_mode = g_wifi_mode;
        st.wifi_ssid = g_wifi_ssid;
        st.wifi_ip = g_wifi_ip;
        size_t jlen = dash_status_json(json_buf, sizeof(json_buf), &st);
        int hlen = snprintf(
            hdr, sizeof(hdr),
            "HTTP/1.1 200 OK\r\n"
            "Content-Type: application/json; charset=utf-8\r\n"
            "Access-Control-Allow-Origin: *\r\n"
            "Cache-Control: no-store\r\n"
            "Content-Length: %u\r\n"
            "Connection: close\r\n\r\n",
            (unsigned)jlen
        );
        if (hlen > 0) send_all(client_fd, hdr, (size_t)hlen);
        if (jlen > 0) send_all(client_fd, json_buf, jlen);
        return;
    }

    static const char not_found[] =
        "HTTP/1.1 404 Not Found\r\n"
        "Content-Type: text/plain; charset=utf-8\r\n"
        "Content-Length: 14\r\n"
        "Connection: close\r\n\r\n404 Not Found\n";
    send_all(client_fd, not_found, sizeof(not_found) - 1);
}

static hi_void *web_server_task(hi_void *arg) {
    (void)arg;
    hi_sleep(300);
    if(!wifi_setup_softap()){printf("[web] provisioning AP failed\r\n");return HI_NULL;}
    sta_start();
    provision_load();
    if(g_target_ssid[0]){pending_connect=true;begin_connect();}

    int srv_fd = lwip_socket(AF_INET, SOCK_STREAM, 0);
    if (srv_fd < 0) {
        printf("[web] lwip_socket failed\r\n");
        return HI_NULL;
    }
    int reuse = 1;
    lwip_setsockopt(srv_fd, SOL_SOCKET, SO_REUSEADDR, &reuse, sizeof(reuse));

    struct sockaddr_in addr;
    memset(&addr, 0, sizeof(addr));
    addr.sin_family = AF_INET;
    addr.sin_port = htons(DASH_WEB_PORT);
    addr.sin_addr.s_addr = htonl(INADDR_ANY);

    if (lwip_bind(srv_fd, (struct sockaddr *)&addr, sizeof(addr)) < 0) {
        printf("[web] lwip_bind port %d failed\r\n", DASH_WEB_PORT);
        lwip_close(srv_fd);
        return HI_NULL;
    }
    if (lwip_listen(srv_fd, 4) < 0) {
        printf("[web] lwip_listen failed\r\n");
        lwip_close(srv_fd);
        return HI_NULL;
    }
    printf("[web] HTTP server listening on port %d\r\n", DASH_WEB_PORT);

    for (;;) {
        struct sockaddr_in cli_addr;
        socklen_t cli_len = sizeof(cli_addr);
        int cli_fd = lwip_accept(srv_fd, (struct sockaddr *)&cli_addr, &cli_len);
        if (cli_fd < 0) {
            hi_sleep(20);
            continue;
        }
        handle_http_client(cli_fd);
        lwip_close(cli_fd);
        begin_connect();
    }
    return HI_NULL;
}

void dash_web_start(void) {
    hi_u32 id = 0;
    hi_task_attr attr = {0};
    attr.task_name = "WebServer";
    attr.stack_size = 8192;
    attr.task_prio = 26;
    hi_u32 r = hi_task_create(&id, &attr, web_server_task, HI_NULL);
    printf("[web] task 0x%x started\r\n", r);
}

const char *dash_wifi_state(void){
 if(!strcmp(g_connection,"lan_ready"))return "LAN READY (not WAN)";
 if(!strcmp(g_connection,"connecting"))return "WiFi connecting";
 if(!strcmp(g_connection,"not_configured"))return "AP setup ready";
 if(!strcmp(g_connection,"disconnected"))return "WiFi disconnected";
 return "WiFi failed: use AP";
}
void dash_wifi_address(char *out,size_t capacity){snprintf(out,capacity,"%s",g_wifi_ip);}
