#ifndef PENGAN_SAFETY_H
#define PENGAN_SAFETY_H
#include <stdbool.h>
#include <stdint.h>

/* Software demonstration only. No real actuator or sensor drivers. */
typedef struct {
  float co_ppm;
  float co2_ppm;
  uint64_t sampled_ms;
  bool valid;
  bool online;
  bool emergency;
} pg_snapshot;

enum pg_reason {
  PG_OK = 0,
  PG_EMERGENCY = 1u << 0,
  PG_OFFLINE = 1u << 1,
  PG_STALE = 1u << 2,
  PG_INVALID = 1u << 3,
  PG_CO_HIGH = 1u << 4,
  PG_CO2_HIGH = 1u << 5
};

typedef struct {
  bool running;
  uint64_t started_ms;
  uint32_t maximum_ms;
} pg_fan;

typedef enum { PG_FAN_IDLE, PG_FAN_RUNNING, PG_FAN_STOP_SAFE, PG_FAN_STOP_TIMEOUT, PG_FAN_STOP_EMERGENCY } pg_fan_result;

uint32_t pg_check(const pg_snapshot *snapshot, uint64_t now_ms);
bool pg_fan_start(pg_fan *fan, const pg_snapshot *snapshot, uint64_t now_ms);
pg_fan_result pg_fan_tick(pg_fan *fan, const pg_snapshot *snapshot, uint64_t now_ms);
#endif
