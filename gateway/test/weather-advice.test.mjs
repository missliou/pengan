import {test} from 'node:test';
import assert from 'node:assert/strict';
import {weatherAdvice,weatherAdviceInput} from '../weather-advice.mjs';
const snapshot=()=>({available:true,provider:'Open-Meteo',location:{name:'乌兰察布市'},fetchedAt:Date.now(),expiresAt:Date.now()+1800000,forecastFrom:Date.now(),forecastTo:Date.now()+86400000,summary:{minTemperatureC:-4,maxTemperatureC:5,maxGustMs:15,totalRainMm:0},risks:[{code:'frost',title:'低温风险'}]});
const config={provider:'deepseek',model:'synthetic-test-model',key:'synthetic_test_key'};
const toolResult=()=>({summary:'预报有低温风险，先人工检查保温条件。',checks:[{title:'检查覆盖物',reason:'室外预报低温，棚内情况未知。'}],limitations:['缺少棚内实测和作物生育期。']});
const response=args=>Response.json({choices:[{message:{tool_calls:[{function:{name:'weather_farm_advice',arguments:JSON.stringify(args)}}]}}]});
test('weather advice sends server forecast as evidence and only produces manual checks',async()=>{
 const d=await weatherAdvice({weather:snapshot(),body:{crop:'番茄'},config,fetchFn:async(url,o)=>{assert.equal(url,'https://api.deepseek.com/chat/completions');assert.equal(o.redirect,'error');const b=JSON.parse(o.body);assert.equal(b.tool_choice.function.name,'weather_farm_advice');assert.match(b.messages[1].content,/乌兰察布/);assert.match(b.messages[0].content,/不要下发/);return response(toolResult());}});
 assert.equal(d.executed,false);assert.equal(d.readOnly,true);assert.equal(d.requiresHumanConfirmation,true);assert.match(d.sourceHash,/^[a-f0-9]{64}$/);assert.equal(d.checks.length,1);
});
test('weather advice fails on expired/unconfigured input and rejects injected control fields',async()=>{
 assert.throws(()=>weatherAdviceInput({weather:{}}),/invalid_weather_advice/);
 for(const options of [{weather:{...snapshot(),expiresAt:0},config},{weather:snapshot(),config:{}}])await assert.rejects(weatherAdvice({...options,body:{},fetchFn:()=>{throw Error('must not fetch');}}));
 for(const change of [{executed:true},{checks:[{title:'x',reason:'x',action:'open_door'}]},{summary:'x'.repeat(1501)}])await assert.rejects(weatherAdvice({weather:snapshot(),body:{},config,fetchFn:async()=>response({...toolResult(),...change})}),/weather_ai_invalid_response/);
});
