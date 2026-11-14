import {test} from 'node:test';
import assert from 'node:assert/strict';
import {installDom,button} from './helpers/dom.mjs';
import {PageScope} from '../src/lib/session.js';
import renderWeather from '../src/pages/weather.js';
test('weather demo never fetches live weather or invents official alerts',async t=>{
 installDom(t);const scope=new PageScope();t.after(()=>scope.dispose());let calls=0;
 const root=await renderWeather({scope,demoMode:true,state:{gatewayId:'a'},dataSource:{getWeather:async()=>{calls++;}}});
 assert.equal(calls,0);assert.equal(button(root,'刷新天气').disabled,true);assert.match(root.textContent,/不是气象部门正式预警/);
});
test('weather renders unavailable and cross-device results as unknown',async t=>{
 installDom(t);const scope=new PageScope();t.after(()=>scope.dispose());
 let d={schemaVersion:1,gatewayId:'a',officialWarning:false,hardwareControl:false,available:false};
 const root=await renderWeather({scope,demoMode:false,state:{gatewayId:'a'},dataSource:{getWeather:async()=>d}});
 assert.match(root.textContent,/风险未知/);d={...d,gatewayId:'b',available:true};await button(root,'刷新天气').click();assert.match(root.textContent,/来源校验失败/);
});
test('weather AI requires an explicit click and displays saved manual advice evidence',async t=>{
 installDom(t);const scope=new PageScope();t.after(()=>scope.dispose());let calls=0;
 const forecast={schemaVersion:1,gatewayId:'a',officialWarning:false,hardwareControl:false,available:true,fetchedAt:Date.now(),expiresAt:Date.now()+1800000,risks:[],hours:[],summary:{minTemperatureC:0,maxTemperatureC:10,maxGustMs:3,totalRainMm:0}};
 const root=await renderWeather({scope,demoMode:false,state:{gatewayId:'a',user:{role:'admin'}},dataSource:{getWeather:async()=>forecast,generateWeatherAdvice:async()=>{calls++;return {schemaVersion:1,kind:'weather_advice',gatewayId:'a',readOnly:true,executed:false,requiresHumanConfirmation:true,persistence:{saved:true,recordId:9},summary:'人工核查保温条件',checks:[],limitations:['缺少棚内数据'],evidence:{fetchedAt:forecast.fetchedAt,expiresAt:forecast.expiresAt},sourceHash:'a'.repeat(64),provider:'deepseek',model:'test-model'};}}});
 assert.equal(calls,0);await button(root,'生成天气农事建议').click();assert.equal(calls,1);assert.match(root.textContent,/人工核查保温条件/);assert.match(root.textContent,/审计 #9/);
});
