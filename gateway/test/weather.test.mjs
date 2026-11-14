import {test} from 'node:test';
import assert from 'node:assert/strict';
import {WeatherService,summarizeWeather,WEATHER_URL} from '../weather.mjs';
import {startCloudServer} from '../cloud-server.mjs';
import {CloudSecurity} from '../cloud-security.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
const now=Date.UTC(2026,10,5,2,31),base=Math.floor(now/3600000)*3600;
function forecast(){return {hourly_units:{time:'unixtime',temperature_2m:'°C',precipitation:'mm',wind_gusts_10m:'m/s',snowfall:'cm',weather_code:'wmo code'},hourly:{time:Array.from({length:48},(_,i)=>base+i*3600),temperature_2m:Array(48).fill(15),precipitation:Array(48).fill(0),wind_gusts_10m:Array(48).fill(3),snowfall:Array(48).fill(0),weather_code:Array(48).fill(0)}};}
test('weather separates outdoor forecast thresholds from official warning and controls',()=>{
 const f=forecast();f.hourly.temperature_2m[0]=2;f.hourly.temperature_2m[2]=35;f.hourly.wind_gusts_10m[3]=17.2;f.hourly.precipitation[4]=10;f.hourly.snowfall[5]=1;f.hourly.weather_code[6]=95;
 const d=summarizeWeather(f,now);assert.equal(d.hours.length,24);assert.equal(d.risks.length,6);assert.equal(d.officialWarning,false);assert.equal(d.hardwareControl,false);assert.equal(d.summary.totalRainMm,10);assert.equal(d.expiresAt,now+1800000);
 assert.equal(summarizeWeather(f,Math.floor(now/3600000)*3600000).hours.length,24);
});
test('weather rejects gaps, missing channels, wrong units and stale forecasts',()=>{
 for(const mutate of [f=>f.hourly.temperature_2m[0]=null,f=>f.hourly_units.wind_gusts_10m='km/h',f=>f.hourly.time[3]++,f=>f.hourly.time=f.hourly.time.map(t=>t-10*86400),f=>f.hourly.temperature_2m.pop()]){const f=forecast();mutate(f);assert.throws(()=>summarizeWeather(f,now));}
});
test('weather coalesces/cache fetches, bounds provider body and fails closed after cache expiry',async()=>{
 let calls=0,time=now,broken=false;
 const service=new WeatherService({now:()=>time,fetchFn:async(url,options)=>{assert.equal(url,WEATHER_URL);assert.equal(options.redirect,'error');calls++;if(broken)throw Error('offline');return new Response(JSON.stringify(forecast()));}});
 const [a,b]=await Promise.all([service.read(),service.read()]);assert.equal(calls,1);a.risks.push({});assert.equal(b.risks.length,0);await service.read();assert.equal(calls,1);
 time+=600001;broken=true;const bad=await service.read();assert.equal(bad.available,false);assert.deepEqual(bad.risks,[]);await service.read();assert.equal(calls,2);
 const oversized=new WeatherService({fetchFn:async()=>new Response(' '.repeat(131073))});assert.equal((await oversized.read()).available,false);
});
test('weather HTTP requires admin session or device token and ignores forged device scope',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'pengan-weather-'));let runtime,calls=0;
 t.after(async()=>{await runtime?.close();await rm(dir,{recursive:true,force:true});});
 const token='synthetic-weather-token-012345678901234',password='synthetic-weather-password';
 runtime=await startCloudServer({dataDir:dir,publicOrigin:'http://127.0.0.1:0',users:[{username:'admin',role:'admin',passwordHash:await CloudSecurity.hashPassword(password)}],devices:[{gatewayId:'a',tokenSha256:createHash('sha256').update(token).digest('hex')}],fetchFn:async(url,options)=>{calls++;if(url!==WEATHER_URL){const b=JSON.parse(options.body);assert.equal(b.tool_choice.function.name,'weather_farm_advice');return Response.json({choices:[{message:{tool_calls:[{function:{name:'weather_farm_advice',arguments:JSON.stringify({summary:'低温时人工检查棚体保温。',checks:[{title:'人工检查',reason:'室外预报不等于棚内实测。'}],limitations:['棚内实测未知']})}}]}}]});}const f=forecast(),start=Math.floor(Date.now()/3600000)*3600;f.hourly.time=f.hourly.time.map((_,i)=>start+i*3600);return Response.json(f);}});
 assert.equal((await fetch(runtime.publicOrigin+'/admin-api/weather?gatewayId=a')).status,401);
 assert.equal((await fetch(runtime.publicOrigin+'/api/v1/device/weather')).status,401);assert.equal(calls,0);
 const device=await fetch(runtime.publicOrigin+'/api/v1/device/weather?gatewayId=b',{headers:{authorization:'Bearer '+token,'x-pengan-gateway-id':'a'}});const d=await device.json();assert.equal(d.gatewayId,'a');assert.equal(d.available,true);
 const login=await fetch(runtime.publicOrigin+'/admin-api/session/login',{method:'POST',headers:{origin:runtime.publicOrigin,'content-type':'application/json'},body:JSON.stringify({username:'admin',password})});
 const session=await login.json(),headers={cookie:login.headers.get('set-cookie').split(';')[0],origin:runtime.publicOrigin,'x-pengan-csrf':session.csrfToken,'content-type':'application/json'};
 const admin=await fetch(runtime.publicOrigin+'/admin-api/weather?gatewayId=a',{headers});assert.equal((await admin.json()).available,true);assert.equal(calls,1);
 assert.equal((await fetch(runtime.publicOrigin+'/api/agent/config',{method:'POST',headers,body:JSON.stringify({provider:'deepseek',model:'synthetic-weather-model',key:'synthetic_weather_test_key'})})).status,200);
 const advice=await fetch(runtime.publicOrigin+'/admin-api/weather/advice?gatewayId=a',{method:'POST',headers,body:JSON.stringify({crop:'番茄'})});const result=await advice.json();assert.equal(advice.status,200);assert.equal(result.executed,false);assert.equal(result.gatewayId,'a');assert.equal(result.persistence.saved,true);
 const record=runtime.history.rows.find(r=>r.seq===result.persistence.recordId);assert.equal(record.data.event,'weather_advice_saved');assert.equal(record.data.advice.sourceHash,result.sourceHash);
});
