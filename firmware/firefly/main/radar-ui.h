#ifndef FIREFLY_RADAR_UI_H
#define FIREFLY_RADAR_UI_H
#include <stdbool.h>
#include <stdint.h>

#ifndef RADAR_WIDTH
#define RADAR_WIDTH 240
#define RADAR_HEIGHT 240
#endif
typedef struct {
    float range;
    float missing_seconds;
    bool had_target;
    bool manual;
} RadarUI;
extern uint16_t radar_pixels[RADAR_WIDTH * RADAR_HEIGHT];
void radar_ui_update(RadarUI *ui, bool target, float distance, float dt, float manual_range);
void radar_ui_draw(const RadarUI *ui, const uint8_t packet[212], int state, int rotation,
                   bool show_scan, bool beat, const char *message);
#endif
