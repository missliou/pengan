#include <assert.h>
#include "../src/dash_weather.h"
int main(void){
 dash_weather_t w={0};assert(dash_weather_parse("PGWX1 5 -20 100 180 0 600 9000",10000,&w));
 assert(dash_weather_fresh(&w,609999));assert(!dash_weather_fresh(&w,610000));assert(!strcmp(dash_weather_label(w.mask),"WX: STRONG WIND"));
 assert(!dash_weather_parse("PGWX1 64 0 1 0 0 600 9000",10000,&w));assert(!dash_weather_parse("PGWX1 0 0 1 0 0 601 9000",10000,&w));
 assert(!dash_weather_parse("PGWX1 0 0 1 0 0 600 1",10000,&w));assert(!dash_weather_parse("PGWX1 0 2 1 0 0 600 9000",10000,&w));
 assert(!dash_weather_parse("PGWX1 0 0 1 0 0 600 9000evil",10000,&w));assert(!dash_weather_parse("PGWX1 0 0 1 0 0 600 11000",10000,&w));
 assert(dash_weather_parse("PGWX1 0 0 1 0 0 1 4294967000",100,&w));assert(!dash_weather_fresh(&w,1100));
 puts("weather parser/expiry/wrap/range PASS");return 0;
}
