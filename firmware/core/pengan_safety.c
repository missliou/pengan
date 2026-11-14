#include "pengan_safety.h"
#include <math.h>
#include <stddef.h>

uint32_t pg_check(const pg_snapshot *s, uint64_t now) {
  if (s == NULL) return PG_INVALID;
  uint32_t reason = PG_OK;
  if (s->emergency) reason |= PG_EMERGENCY;
  if (!s->online) reason |= PG_OFFLINE;
  if (s->sampled_ms > now || now - s->sampled_ms > 15000u) reason |= PG_STALE;
  if (!s->valid || !isfinite(s->co_ppm) || !isfinite(s->co2_ppm) || s->co_ppm < 0 || s->co2_ppm < 0) reason |= PG_INVALID;
  if (isfinite(s->co_ppm) && s->co_ppm >= 30.0f) reason |= PG_CO_HIGH;
  if (isfinite(s->co2_ppm) && s->co2_ppm >= 1500.0f) reason |= PG_CO2_HIGH;
  return reason;
}

bool pg_fan_start(pg_fan *fan, const pg_snapshot *s, uint64_t now) {
  if (fan == NULL || s == NULL || s->emergency || fan->running || fan->maximum_ms == 0) return false;
  fan->running = true;
  fan->started_ms = now;
  return true;
}

pg_fan_result pg_fan_tick(pg_fan *fan, const pg_snapshot *s, uint64_t now) {
  if (fan == NULL || !fan->running) return PG_FAN_IDLE;
  /* Fail closed if the local emergency input cannot be read. */
  if (s == NULL || s->emergency) { fan->running = false; return PG_FAN_STOP_EMERGENCY; }
  /* Check timeout first; never report a successful verification after the deadline. */
  if (now < fan->started_ms || now - fan->started_ms >= fan->maximum_ms) {
    fan->running = false;
    return PG_FAN_STOP_TIMEOUT;
  }
  if (pg_check(s, now) == PG_OK) { fan->running = false; return PG_FAN_STOP_SAFE; }
  return PG_FAN_RUNNING;
}
