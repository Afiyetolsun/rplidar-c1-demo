#include "radar-ui.h"
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

uint16_t radar_pixels[RADAR_WIDTH * RADAR_HEIGHT];
#define pixels radar_pixels
static uint16_t rgb(int r, int g, int b) { return ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3); }
static uint16_t u16(const uint8_t *p) { return p[0] | (p[1] << 8); }
static void dot(int x, int y, uint16_t c) { if (x >= 0 && x < RADAR_WIDTH && y >= 0 && y < RADAR_HEIGHT) pixels[y * RADAR_WIDTH + x] = c; }
static void disc(int x, int y, int r, uint16_t c) { for (int j=-r;j<=r;j++) for(int i=-r;i<=r;i++) if(i*i+j*j<=r*r) dot(x+i,y+j,c); }
static void line(int x, int y, int xx, int yy, uint16_t c) {
  int dx=abs(xx-x), sx=x<xx?1:-1, dy=-abs(yy-y), sy=y<yy?1:-1, e=dx+dy;
  for (;;) { dot(x,y,c); if(x==xx && y==yy) break; int e2=2*e; if(e2>=dy){e+=dy;x+=sx;} if(e2<=dx){e+=dx;y+=sy;} }
}
static void circle(int x,int y,int r,uint16_t c) { for(int a=0;a<360;a++){float t=a*0.017453293f;dot(x+lroundf(sinf(t)*r),y+lroundf(cosf(t)*r),c);} }
// Original 5x7 bitmap alphabet, columns stored top-to-bottom.
static const uint8_t font[][5] = {
 {62,81,73,69,62},{0,66,127,64,0},{66,97,81,73,70},{33,65,69,75,49},{24,20,18,127,16},
 {39,69,69,69,57},{60,74,73,73,48},{1,113,9,5,3},{54,73,73,73,54},{6,73,73,41,30},
 {126,17,17,17,126},{127,73,73,73,54},{62,65,65,65,34},{127,65,65,34,28},{127,73,73,73,65},
 {127,9,9,9,1},{62,65,73,73,122},{127,8,8,8,127},{0,65,127,65,0},{32,64,65,63,1},
 {127,8,20,34,65},{127,64,64,64,64},{127,2,12,2,127},{127,4,8,16,127},{62,65,65,65,62},
 {127,9,9,9,6},{62,65,81,33,94},{127,9,25,41,70},{38,73,73,73,50},{1,1,127,1,1},
 {63,64,64,64,63},{31,32,64,32,31},{63,64,56,64,63},{99,20,8,20,99},{3,4,120,4,3},{97,81,73,69,67}
};
static void text(int x,int y,const char *s,int scale,uint16_t c) {
 for(;*s;s++,x+=6*scale){ int n=(*s>='0'&&*s<='9')?*s-'0':(*s>='A'&&*s<='Z')?*s-'A'+10:-1;
  for(int col=0;col<5;col++) for(int row=0;row<7;row++) {
   bool on=n>=0?(font[n][col]&(1<<row)):(*s=='.'?row==6&&col==2:*s=='-'?row==3:false);
   if(on) for(int a=0;a<scale;a++) for(int b=0;b<scale;b++) dot(x+col*scale+a,y+row*scale+b,c);
  }
 }
}

void radar_ui_update(RadarUI *ui, bool target, float distance, float dt, float manual_range) {
    dt = fmaxf(0, fminf(dt, .25f));
    if (!isfinite(ui->range) || ui->range < 1) ui->range = 6;
    ui->manual = manual_range > 0;
    if (ui->manual) { ui->range = fmaxf(1, manual_range); ui->had_target = false; return; }
    target = target && isfinite(distance) && distance > 0;
    if (target) {
        // 28% headroom, quarter-metre steps and a deadband avoid breathing with noise.
        float wanted = fmaxf(1, ceilf(distance / .72f * 4) / 4);
        if (!ui->had_target) ui->range = wanted;
        else if (fabsf(wanted - ui->range) > ui->range * .10f) {
            float tau = wanted > ui->range ? .25f : .9f;
            ui->range += (wanted - ui->range) * (1 - expf(-dt / tau));
        }
        // A new or rapidly retreating nearest contact must never leave the screen.
        ui->range = fmaxf(ui->range, distance / .85f);
        ui->missing_seconds = 0;
        ui->had_target = true;
    } else {
        ui->missing_seconds += dt;
        // Preserve zoom through a short occlusion, but never preserve the contact.
        if (ui->missing_seconds > 2) {
            ui->range += (6 - ui->range) * (1 - expf(-dt / 1.2f));
            ui->had_target = false;
        }
    }
    ui->range = fmaxf(1, ui->range);
}

static void thick_line(int x, int y, int xx, int yy, uint16_t color) {
    line(x,y,xx,yy,color); line(x+1,y,xx+1,yy,color);
}
static void edge_arrow(int cx, int cy, float angle, uint16_t color) {
    float sx=sinf(angle), sy=-cosf(angle);
    int tipx=cx+sx*73, tipy=cy+sy*73;
    int bx=cx+sx*64, by=cy+sy*64;
    thick_line(bx+sy*4,by-sx*4,tipx,tipy,color);
    thick_line(bx-sy*4,by+sx*4,tipx,tipy,color);
}

void radar_ui_draw(const RadarUI *ui, const uint8_t packet[212], int state, int rotation,
                   bool show_scan, bool beat, const char *message) {
    const uint16_t green=rgb(70,255,145), grid=rgb(27,64,54), room=rgb(80,117,104);
    const uint16_t white=rgb(244,255,248), red=rgb(255,96,66), secondary=rgb(163,199,178);
    const int wide=RADAR_WIDTH==240;
    const int cx=wide?120:RADAR_WIDTH/2, cy=wide?111:135, radius=wide?73:64, mark=wide?77:72;
    int count=state==2?packet[29]:0;
    float turn=rotation*1.5707963f;
    memset(pixels,0,sizeof(radar_pixels));
    char label[32];
    snprintf(label,sizeof(label),"%s %.1fM",ui->manual?"FIX":"AUTO",ui->range);
    text(8,8,label,2,green);
    snprintf(label,sizeof(label),"%d OBJ",count); text(wide?172:RADAR_WIDTH-42,10,label,1,secondary);
    line(8,wide?29:28,wide?231:RADAR_WIDTH-9,wide?29:28,grid);
    circle(cx,cy,radius,grid); circle(cx,cy,radius/2,grid);
    line(cx-radius,cy,cx+radius,cy,grid); line(cx,cy-radius,cx,cy+radius,grid);
    // Cardinal labels refer to the currently rotated sensor orientation.
    const char *cardinal[]={"F","R","B","L"};
    for(int i=0;i<4;i++) {
        float a=i*1.5707963f+turn;
        text(cx+lroundf(sinf(a)*mark)-3,cy-lroundf(cosf(a)*mark)-3,cardinal[i],1,secondary);
    }
    if(state && show_scan) for(int i=0;i<72;i++) {
        int mm=u16(packet+36+i*2);
        if(!mm || mm>ui->range*1000) continue;
        float a=(i+.5f)*6.2831853f/72+turn, r=mm*radius/(ui->range*1000);
        dot(cx+lroundf(sinf(a)*r),cy-lroundf(cosf(a)*r),room);
    }
    // Draw secondary contacts first, so the primary marker always wins overlap.
    for(int i=count-1;i>=0;i--) {
        float x=(int16_t)u16(packet+180+i*4)/1000.f;
        float y=(int16_t)u16(packet+182+i*4)/1000.f;
        float d=hypotf(x,y), a=atan2f(x,y)+turn;
        if(d>ui->range) {edge_arrow(cx,cy,a,i==0?red:secondary);continue;}
        float r=d/ui->range*radius;
        int tx=cx+lroundf(sinf(a)*r),ty=cy-lroundf(cosf(a)*r);
        if(i==0) {
            line(cx,cy,tx,ty,green);
            disc(tx,ty,10,0); circle(tx,ty,9,white); circle(tx,ty,8,white);
            disc(tx,ty,6,red); disc(tx,ty,2,white);
            if(beat) circle(tx,ty,12,red);
        } else {circle(tx,ty,4,secondary);disc(tx,ty,2,secondary);}
    }
    // A small oriented triangle marks the sensor, distinct from round targets.
    float sx=sinf(turn),sy=-cosf(turn);
    int tipx=cx+sx*7,tipy=cy+sy*7,bx=cx-sx*4,by=cy-sy*4;
    thick_line(bx+sy*4,by-sx*4,tipx,tipy,green);
    thick_line(bx-sy*4,by+sx*4,tipx,tipy,green);
    line(bx+sy*4,by-sx*4,bx-sy*4,by+sx*4,green);
    line(8,wide?193:242,wide?231:RADAR_WIDTH-9,wide?193:242,grid);
    if(count) {
        float distance=u16(packet+32)/1000.f;
        snprintf(label,sizeof(label),"%.2f",distance);
        int scale=distance>=10?3:4;
        int number_y=wide?202:252;
        text(8,number_y,label,scale,white);
        text(8+(int)strlen(label)*6*scale,wide?214:number_y+12,"M",2,secondary);
        float angle=atan2f((int16_t)u16(packet+180),(int16_t)u16(packet+182));
        int degrees=((int)lroundf(angle*57.2957795f)+360)%360;
        const char *direction=degrees<45||degrees>=315?"FRONT":degrees<135?"RIGHT":degrees<225?"BACK":"LEFT";
        text(wide?164:8,wide?201:number_y+40,direction,2,green);
        snprintf(label,sizeof(label),"%03d DEG",degrees);text(wide?164:RADAR_WIDTH-56,wide?222:number_y+58,label,1,secondary);
    } else {
        // Retain a real empty/offline state, with no stale target or bearing.
        int message_y=wide?203:258;
        text(8,message_y,message,!wide||strlen(message)>10?2:3,state==0?red:white);
        text(8,wide?231:message_y+28,state==1?"KEEP SCAN AREA CLEAR":state==2?"MOVE IN THE SCAN PLANE":"CHECK SENSOR AND CONNECTION",1,secondary);
    }
}
