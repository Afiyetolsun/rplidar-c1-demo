#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <sys/socket.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_wifi.h"
#include "esp_event.h"
#include "esp_netif.h"
#include "esp_timer.h"
#include "nvs_flash.h"
#include "nvs.h"
#include "cJSON.h"
#include "driver/gpio.h"
#include "driver/usb_serial_jtag.h"
#include "driver/usb_serial_jtag_vfs.h"
#include "driver/rmt_tx.h"
#ifdef BOARD_WAVESHARE
#include "waveshare_panel.h"
#define LED_COUNT 1
#define LED_GPIO 38
static const int buttons[] = {0};
#else
#include "firefly-display.h"
#define LED_COUNT 4
#define LED_GPIO 9
static const int buttons[] = {10, 8, 3, 2};
#endif
#define BUTTON_COUNT ((int)(sizeof(buttons) / sizeof(buttons[0])))
#include "radar-ui.h"

#define PACKET_SIZE 212

static uint8_t latest[PACKET_SIZE], key[16];
static int64_t last_rx;
static float display_range=6;
static uint32_t display_frames, display_sequence;
static int64_t display_completed;
static uint16_t display_distance;
static int display_stage;
static portMUX_TYPE mux = portMUX_INITIALIZER_UNLOCKED;
static volatile bool online;
static char ip_text[20] = "NO WIFI";
static uint16_t u16(const uint8_t *p) { return p[0] | (p[1] << 8); }
static uint32_t u32(const uint8_t *p) { return u16(p) | ((uint32_t)u16(p + 2) << 16); }
#ifndef BOARD_WAVESHARE
static void render(uint8_t *buffer,uint32_t y,void *ctx) { (void)ctx; memcpy(buffer,radar_pixels+y*RADAR_WIDTH,RADAR_WIDTH*FfxDisplayFragmentHeight*2); }
#endif
static void wifi_event(void *arg, esp_event_base_t base,int32_t id,void *data) {
 (void)arg;
 if(base==WIFI_EVENT && (id==WIFI_EVENT_STA_START || id==WIFI_EVENT_STA_DISCONNECTED)) {
  online=false; esp_wifi_connect();
 } else if(base==IP_EVENT && id==IP_EVENT_STA_GOT_IP) {
  ip_event_got_ip_t *event=data;
  portENTER_CRITICAL(&mux); snprintf(ip_text,sizeof(ip_text),IPSTR,IP2STR(&event->ip_info.ip)); portEXIT_CRITICAL(&mux);
  online=true; printf("FIREFLY_IP=%s\n",ip_text); fflush(stdout);
 }
}
static void serial_task(void *arg) {
 (void)arg; char input[512]; size_t used=0;
 for(;;) {
  char c; if(usb_serial_jtag_read_bytes(&c,1,pdMS_TO_TICKS(100))!=1) continue;
  if(c=='\n') {
   input[used]=0; used=0;
   if(!strcmp(input,"STATUS")) { printf("FIREFLY_IP=%s\n",online?ip_text:"OFFLINE");
    portENTER_CRITICAL(&mux); int64_t age=last_rx?(esp_timer_get_time()-last_rx)/1000:-1; int state=online&&age>=0&&age<1800?latest[28]:0, contacts=state==2?latest[29]:0; float radius=display_range; uint32_t frames=display_frames, seq=display_sequence; int stage=display_stage; int64_t render_age=display_completed?(esp_timer_get_time()-display_completed)/1000:-1; int mm=display_distance; portEXIT_CRITICAL(&mux);
    printf("FIREFLY_STATUS age_ms=%lld state=%d contacts=%d radius_m=%.2f heap=%lu\n",(long long)age,state,contacts,radius,(unsigned long)esp_get_free_heap_size()); printf("FIREFLY_DISPLAY frames=%lu sequence=%lu stage=%d age_ms=%lld distance_mm=%d\n",(unsigned long)frames,(unsigned long)seq,stage,(long long)render_age,mm); fflush(stdout); continue; }
   cJSON *j=cJSON_Parse(input);
   const cJSON *s=cJSON_GetObjectItem(j,"ssid"), *p=cJSON_GetObjectItem(j,"password"), *k=cJSON_GetObjectItem(j,"key");
   if(cJSON_IsString(s)&&cJSON_IsString(p)&&cJSON_IsString(k)&&strlen(s->valuestring)>0&&strlen(s->valuestring)<=32&&strlen(p->valuestring)<=63&&strlen(k->valuestring)==32) {
    bool valid=true; for(int i=0;i<32;i++) if(!strchr("0123456789abcdefABCDEF",k->valuestring[i])) valid=false;
    if(valid) {
     nvs_handle_t h; ESP_ERROR_CHECK(nvs_open("heartbeat",NVS_READWRITE,&h));
     ESP_ERROR_CHECK(nvs_set_str(h,"ssid",s->valuestring)); ESP_ERROR_CHECK(nvs_set_str(h,"password",p->valuestring)); ESP_ERROR_CHECK(nvs_set_str(h,"key",k->valuestring)); ESP_ERROR_CHECK(nvs_commit(h)); nvs_close(h);
     cJSON_Delete(j); memset(input,0,sizeof(input)); printf("FIREFLY_CONFIGURED\n"); fflush(stdout); vTaskDelay(pdMS_TO_TICKS(300)); esp_restart();
    }
   }
   cJSON_Delete(j); memset(input,0,sizeof(input));
  } else if(used<sizeof(input)-1) input[used++]=c;
  else used=0;
 }
}
static void udp_task(void *arg) {
 (void)arg; int fd=socket(AF_INET,SOCK_DGRAM,IPPROTO_UDP); assert(fd>=0);
 struct sockaddr_in addr={.sin_family=AF_INET,.sin_port=htons(8789),.sin_addr.s_addr=htonl(INADDR_ANY)};
 assert(bind(fd,(struct sockaddr*)&addr,sizeof(addr))==0);
 uint8_t packet[PACKET_SIZE+1]; uint32_t session=0, sequence=0; bool have=false;
 for(;;) {
  int n=recv(fd,packet,sizeof(packet),0); if(n!=PACKET_SIZE||memcmp(packet,"FFH1",4)||memcmp(packet+4,key,16)||packet[28]>2||packet[29]>8) continue;
  uint32_t s=u32(packet+20), q=u32(packet+24);
  if(have && s==session && (int32_t)(q-sequence)<=0) continue;
  session=s; sequence=q; have=true;
  portENTER_CRITICAL(&mux); memcpy(latest,packet,PACKET_SIZE); last_rx=esp_timer_get_time(); portEXIT_CRITICAL(&mux);
 }
}
static rmt_channel_handle_t led_channel;
static rmt_encoder_handle_t led_encoder;
static void led_init(void) {
 rmt_tx_channel_config_t config={.gpio_num=LED_GPIO,.clk_src=RMT_CLK_SRC_DEFAULT,.resolution_hz=10000000,.mem_block_symbols=64,.trans_queue_depth=1};
 ESP_ERROR_CHECK(rmt_new_tx_channel(&config,&led_channel));
 rmt_copy_encoder_config_t encoder={0}; ESP_ERROR_CHECK(rmt_new_copy_encoder(&encoder,&led_encoder)); ESP_ERROR_CHECK(rmt_enable(led_channel));
}
static void leds(int r,int g,int b) {
 rmt_symbol_word_t symbols[LED_COUNT * 24 + 1]; uint8_t colors[3]={(uint8_t)g,(uint8_t)r,(uint8_t)b}; int n=0;
 for(int led=0;led<LED_COUNT;led++) for(int c=0;c<3;c++) for(int bit=7;bit>=0;bit--) {
  bool one=colors[c]&(1<<bit); symbols[n++]=(rmt_symbol_word_t){.level0=1,.duration0=one?7:3,.level1=0,.duration1=one?6:10};
 }
 symbols[n++]=(rmt_symbol_word_t){.level0=0,.duration0=500,.level1=0,.duration1=500};
 rmt_transmit_config_t tx={0}; ESP_ERROR_CHECK(rmt_transmit(led_channel,led_encoder,symbols,sizeof(symbols),&tx)); ESP_ERROR_CHECK(rmt_tx_wait_all_done(led_channel,100));
}
void app_main(void) {
 esp_err_t err=nvs_flash_init(); if(err==ESP_ERR_NVS_NO_FREE_PAGES||err==ESP_ERR_NVS_NEW_VERSION_FOUND){ESP_ERROR_CHECK(nvs_flash_erase());err=nvs_flash_init();} ESP_ERROR_CHECK(err);
 usb_serial_jtag_driver_config_t usb={.tx_buffer_size=1024,.rx_buffer_size=1024}; ESP_ERROR_CHECK(usb_serial_jtag_driver_install(&usb)); usb_serial_jtag_vfs_use_driver();
 xTaskCreate(serial_task,"provision",4096,NULL,3,NULL);
 nvs_handle_t h; char ssid[33]={0},password[64]={0},hex[33]={0};
 if(nvs_open("heartbeat",NVS_READONLY,&h)==ESP_OK) {size_t n=sizeof(ssid);nvs_get_str(h,"ssid",ssid,&n);n=sizeof(password);nvs_get_str(h,"password",password,&n);n=sizeof(hex);nvs_get_str(h,"key",hex,&n);nvs_close(h);}
 bool configured=ssid[0]&&strlen(hex)==32;
 if(configured) {
  for(int i=0;i<16;i++){char pair[3]={hex[2*i],hex[2*i+1],0};key[i]=strtoul(pair,NULL,16);}
  ESP_ERROR_CHECK(esp_netif_init()); ESP_ERROR_CHECK(esp_event_loop_create_default()); esp_netif_create_default_wifi_sta();
  wifi_init_config_t init=WIFI_INIT_CONFIG_DEFAULT(); ESP_ERROR_CHECK(esp_wifi_init(&init));
  ESP_ERROR_CHECK(esp_event_handler_register(WIFI_EVENT,ESP_EVENT_ANY_ID,wifi_event,NULL)); ESP_ERROR_CHECK(esp_event_handler_register(IP_EVENT,IP_EVENT_STA_GOT_IP,wifi_event,NULL));
  wifi_config_t wifi={0};memcpy(wifi.sta.ssid,ssid,strlen(ssid));memcpy(wifi.sta.password,password,strlen(password));
  ESP_ERROR_CHECK(esp_wifi_set_storage(WIFI_STORAGE_RAM)); ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA)); ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA,&wifi)); ESP_ERROR_CHECK(esp_wifi_start()); ESP_ERROR_CHECK(esp_wifi_set_ps(WIFI_PS_NONE)); memset(password,0,sizeof(password));
  xTaskCreate(udp_task,"radar-udp",4096,NULL,4,NULL);
 }
 uint64_t button_mask=0; for(int i=0;i<BUTTON_COUNT;i++) button_mask|=1ULL<<buttons[i];
 gpio_config_t io={.pin_bit_mask=button_mask,.mode=GPIO_MODE_INPUT,.pull_up_en=GPIO_PULLUP_ENABLE}; ESP_ERROR_CHECK(gpio_config(&io));
 led_init();
#ifdef BOARD_WAVESHARE
 waveshare_display_init();
 printf("WAVESHARE 172x320 ready\n"); fflush(stdout);
#else
 FfxDisplayContext display=ffx_display_init(FfxDisplaySpiBus2_nocs,4,5,FfxDisplayRotationRibbonBottom,render,NULL); assert(display);
#endif
 RadarUI ui = {.range = 6};
 int range_mode=0,rotation=0; bool light=true,show_scan=true,held[4]={0}; int64_t pressed[4]={0}; float phase=0; int64_t previous=esp_timer_get_time();
 for(;;) {
  int64_t now=esp_timer_get_time();
  for(int i=0;i<BUTTON_COUNT;i++) {bool down=!gpio_get_level(buttons[i]);if(down&&!held[i]&&now-pressed[i]>200000){pressed[i]=now;if(i==0)range_mode=(range_mode+1)%7;if(i==1)rotation=(rotation+1)%4;if(i==2)show_scan=!show_scan;if(i==3)light=!light;}held[i]=down;}
  uint8_t packet[PACKET_SIZE]; int64_t received;
  portENTER_CRITICAL(&mux); memcpy(packet,latest,sizeof(packet)); received=last_rx; portEXIT_CRITICAL(&mux);
  bool fresh=online&&received&&now-received<1800000;
  int state=fresh?packet[28]:0, count=state==2?packet[29]:0; float distance=count?u16(packet+32)/1000.f:0;
  // Same proximity cadence as the browser: faster as objects approach.
  float dt=(now-previous)/1000000.f; previous=now;
  float bounded=fmaxf(.5f,fminf(6.f,distance));
  float interval=1.7f-1.53f*powf((6.f-bounded)/5.5f,1.45f);
  phase+=dt/interval; phase-=floorf(phase); bool beat=count&&phase<.18f;
  const float ranges[]={0,1,2,3,6,12,24};
  radar_ui_update(&ui, count>0, distance, dt, ranges[range_mode]);
  portENTER_CRITICAL(&mux); display_range=ui.range; portEXIT_CRITICAL(&mux);
  const char *message=!configured?"USB SETUP":!online?"CONNECTING":!fresh?"NO LINK":state==0?"LIDAR OFFLINE":state==1?"LEARNING":"NO TARGET";
  portENTER_CRITICAL(&mux); display_stage=1; portEXIT_CRITICAL(&mux);
  radar_ui_draw(&ui, packet, state, rotation, show_scan, beat, message);
  portENTER_CRITICAL(&mux); display_stage=2; portEXIT_CRITICAL(&mux);
  if(!light)leds(0,0,0);else if(!online||!fresh||!state)leds(0,0,3);else if(state==1)leds(4,2,0);else if(beat)leds(28,1,0);else leds(0,2,0);
  portENTER_CRITICAL(&mux); display_stage=3; portEXIT_CRITICAL(&mux);
#ifdef BOARD_WAVESHARE
  waveshare_display_present();
#else
  while(!ffx_display_renderFragment(display)) {}
#endif
  portENTER_CRITICAL(&mux); display_frames++; display_sequence=u32(packet+24); display_distance=count?u16(packet+32):65535; display_completed=esp_timer_get_time(); display_stage=0; portEXIT_CRITICAL(&mux);
  vTaskDelay(pdMS_TO_TICKS(50));
 }
}
