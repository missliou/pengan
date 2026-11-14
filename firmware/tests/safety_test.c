#include "../core/pengan_safety.h"
#include <assert.h>
#include <math.h>
#include <stdio.h>

static pg_snapshot normal(void) {
  pg_snapshot s = {4.0f, 680.0f, 100000, true, true, false};
  return s;
}

int main(void) {
  pg_snapshot s = normal();
  assert(pg_check(&s,100000)==PG_OK);
  s.co_ppm=30; assert(pg_check(&s,100000)&PG_CO_HIGH);
  s=normal(); s.co2_ppm=1500; assert(pg_check(&s,100000)&PG_CO2_HIGH);
  s=normal(); s.co_ppm=NAN; assert(pg_check(&s,100000)&PG_INVALID);
  s=normal(); s.co2_ppm=-1; assert(pg_check(&s,100000)&PG_INVALID);
  s=normal(); s.online=false; assert(pg_check(&s,100000)&PG_OFFLINE);
  s=normal(); assert(pg_check(&s,115001)&PG_STALE);
  assert(pg_check(&s,99999)&PG_STALE);
  assert(pg_check(NULL,100000)&PG_INVALID);
  pg_fan fan={false,0,20000};
  s=normal(); s.co_ppm=65;
  assert(pg_fan_start(&fan,&s,100000));
  assert(!pg_fan_start(&fan,&s,100001));
  assert(pg_fan_tick(&fan,&s,100100)==PG_FAN_RUNNING);
  s.emergency=true;
  assert(pg_fan_tick(&fan,&s,100200)==PG_FAN_STOP_EMERGENCY);
  assert(!fan.running);
  assert(!pg_fan_start(&fan,&s,100300));
  s=normal(); s.co_ppm=65;
  assert(pg_fan_start(&fan,&s,100400));
  s.sampled_ms=120400;
  assert(pg_fan_tick(&fan,&s,120400)==PG_FAN_STOP_TIMEOUT);
  s=normal(); s.co_ppm=65;
  assert(pg_fan_start(&fan,&s,100500));
  s.co_ppm=4; s.sampled_ms=100700;
  assert(pg_fan_tick(&fan,&s,100700)==PG_FAN_STOP_SAFE);
  assert(!fan.running);
  puts("PASS: CO/CO2, invalid, offline, stale, emergency, duplicate, timeout, recovery");
  return 0;
}
