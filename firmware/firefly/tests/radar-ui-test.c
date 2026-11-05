#include "radar-ui.h"
#include <assert.h>
#include <math.h>
#include <stdio.h>
#include <string.h>

static void put16(uint8_t *p,int value) {p[0]=value&255;p[1]=(value>>8)&255;}
static void preview(const char *path, float distance, int state, bool multiple) {
    RadarUI ui={.range=6}; uint8_t packet[212]={0};
    radar_ui_update(&ui,state==2,distance,.1f,0);
    packet[29]=multiple?2:1;put16(packet+32,lroundf(distance*1000));
    put16(packet+180,lroundf(distance*.6f*1000));put16(packet+182,lroundf(distance*.8f*1000));
    if(multiple) {put16(packet+184,-3000);put16(packet+186,-4000);}
    for(int i=0;i<72;i++)put16(packet+36+i*2,900+i%9*25);
    radar_ui_draw(&ui,packet,state,0,true,false,state==2?"NO TARGET":"NO LINK");
    FILE *f=fopen(path,"wb");assert(f);fprintf(f,"P6\n240 240\n255\n");
    for(int i=0;i<240*240;i++) {uint16_t c=radar_pixels[i];unsigned char rgb[]={((c>>11)&31)*255/31,((c>>5)&63)*255/63,(c&31)*255/31};fwrite(rgb,1,3,f);}fclose(f);
}
int main(int argc,char **argv) {
    RadarUI ui={.range=6};
    radar_ui_update(&ui,true,.4f,.1f,0);assert(ui.range==1);
    radar_ui_update(&ui,true,8,.1f,0);assert(ui.range>=8/.85f); // rapid retreat stays inside
    float old=ui.range;radar_ui_update(&ui,true,.5f,.05f,0);assert(ui.range<old&&ui.range>1); // smooth zoom-in
    for(int i=0;i<200;i++)radar_ui_update(&ui,true,.5f,.05f,0);
    assert(ui.range>=1&&ui.range<1.12f);
    old=ui.range;for(int i=0;i<20;i++)radar_ui_update(&ui,false,0,.05f,0);assert(ui.range==old); // hold during occlusion
    for(int i=0;i<200;i++)radar_ui_update(&ui,false,0,.05f,0);assert(fabsf(ui.range-6)<.02f);
    radar_ui_update(&ui,true,3,.1f,1);assert(ui.range==1&&ui.manual);
    radar_ui_update(&ui,true,3,.1f,0);assert(ui.range>3&&!ui.manual); // auto restored after manual
    RadarUI near={.range=6};radar_ui_update(&near,true,.7f,.1f,0);
    old=near.range;for(int i=0;i<100;i++)radar_ui_update(&near,true,.7f+(.01f*(i%2)),.05f,0);assert(near.range==old);
    uint8_t packet[212]={0};packet[29]=1;put16(packet+32,500);put16(packet+182,500);
    radar_ui_draw(&near,packet,0,0,true,false,"NO LINK");
    uint16_t stale[240*240];memcpy(stale,radar_pixels,sizeof(stale));memset(packet,0,sizeof(packet));
    radar_ui_draw(&near,packet,0,0,true,false,"NO LINK");assert(!memcmp(stale,radar_pixels,sizeof(stale)));
    if(argc>1) {char path[512];snprintf(path,sizeof(path),"%s/near.ppm",argv[1]);preview(path,.53f,2,true);snprintf(path,sizeof(path),"%s/far.ppm",argv[1]);preview(path,4.2f,2,false);snprintf(path,sizeof(path),"%s/offline.ppm",argv[1]);preview(path,0,0,false);}
    puts("Radar UI: auto zoom, minimum, containment, smoothing, dropout, manual override and stale render passed.");
}
