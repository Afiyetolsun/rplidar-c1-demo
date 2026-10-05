#include "sl_lidar.h"
#include "sl_lidar_driver.h"
#include <chrono>
#include <csignal>
#include <cstdio>
#include <fcntl.h>
#include <memory>
#include <unistd.h>

static volatile sig_atomic_t stopping = 0;
static void requestStop(int) { stopping = 1; }

// Own only the USB connection. Decode all C1 scan formats with SLAMTEC's SDK.
// EOF on stdin is a watchdog: exiting/reloading the Node server stops the motor.
int main(int argc, char** argv) {
    if (argc != 2) return 2;
    signal(SIGINT, requestStop);
    signal(SIGTERM, requestStop);
    signal(SIGPIPE, requestStop);
    fcntl(STDIN_FILENO, F_SETFL, O_NONBLOCK);
    auto channel = std::unique_ptr<sl::IChannel>(*sl::createSerialPortChannel(argv[1], 460800));
    auto driver = std::unique_ptr<sl::ILidarDriver>(*sl::createLidarDriver());
    if (!channel || !driver || SL_IS_FAIL(driver->connect(channel.get()))) {
        fprintf(stderr, "Cannot open RPLIDAR USB port.\n"); return 3;
    }
    sl_lidar_response_device_info_t info{};
    sl_lidar_response_device_health_t health{};
    int result = 0;
    do {
        driver->stop();
        if (SL_IS_FAIL(driver->getDeviceInfo(info)) || SL_IS_FAIL(driver->getHealth(health))) {
            fprintf(stderr, "C1 did not answer at 460800 baud. Check USB power and port.\n"); result = 4; break;
        }
        if (health.status == SL_LIDAR_STATUS_ERROR) {
            fprintf(stderr, "LiDAR reports internal error %u. Reconnect USB.\n", health.error_code); result = 5; break;
        }
        driver->setMotorSpeed();
        sl::LidarScanMode mode{};
        if (SL_IS_FAIL(driver->startScan(false, true, 0, &mode))) {
            fprintf(stderr, "Could not start C1 scan.\n"); result = 6; break;
        }
        fprintf(stdout, "{\"kind\":\"device\",\"firmware\":\"%u.%02u\",\"scanMode\":\"%s\"}\n", info.firmware_version >> 8, info.firmware_version & 255, mode.scan_mode);
        fflush(stdout);
        unsigned frame = 0, missed = 0;
        while (!stopping) {
            char input;
            if (read(STDIN_FILENO, &input, 1) == 0) break;
            sl_lidar_response_measurement_node_hq_t nodes[8192];
            size_t count = 8192;
            if (SL_IS_FAIL(driver->grabScanDataHq(nodes, count, 700))) {
                if (++missed >= 4) { fprintf(stderr, "C1 scan timed out. Check USB connection.\n"); result = 7; break; }
                continue;
            }
            missed = 0;
            driver->ascendScanData(nodes, count);
            auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count();
            fprintf(stdout, "{\"kind\":\"scan\",\"frameNumber\":%u,\"timestamp\":%lld,\"samples\":[", ++frame, static_cast<long long>(ms));
            bool separator = false;
            for (size_t i = 0; i < count; ++i) {
                if (!nodes[i].dist_mm_q2 || !nodes[i].quality) continue;
                fprintf(stdout, "%s[%.4f,%.4f]", separator ? "," : "", nodes[i].angle_z_q14 * 90.0 / 16384.0, nodes[i].dist_mm_q2 / 4000.0);
                separator = true;
            }
            fputs("]}\n", stdout);
            fflush(stdout);
        }
    } while (false);
    driver->stop();
    driver->setMotorSpeed(0);
    driver->disconnect();
    return result;
}
