// Outdoor forecast only. Never used for greenhouse admission or actuator control.
export const WEATHER_LOCATION = Object.freeze({name:'乌兰察布市（集宁城区参考点）',latitude:41.0275,longitude:113.10583,timezone:'Asia/Shanghai'});
const HOURLY=['temperature_2m','precipitation','wind_gusts_10m','snowfall','weather_code'];
export const WEATHER_URL='https://api.open-meteo.com/v1/forecast?'+new URLSearchParams({latitude:String(WEATHER_LOCATION.latitude),longitude:String(WEATHER_LOCATION.longitude),hourly:HOURLY.join(','),wind_speed_unit:'ms',timeformat:'unixtime',timezone:'Asia/Shanghai',forecast_days:'3'});
const TTL=30*60*1000, CACHE=10*60*1000;
export function summarizeWeather(raw,now){
 const h=raw?.hourly,u=raw?.hourly_units;
 if(!h||!u||u.time!=='unixtime'||u.temperature_2m!=='°C'||u.precipitation!=='mm'||u.wind_gusts_10m!=='m/s'||u.snowfall!=='cm'||u.weather_code!=='wmo code'||!Array.isArray(h.time)||h.time.length<24||h.time.length>100)throw Error('weather_invalid_response');
 for(const key of HOURLY)if(!Array.isArray(h[key])||h[key].length!==h.time.length)throw Error('weather_invalid_response');
 const start=Math.floor(now/3600000)*3600000,rows=[];let previous=0;
 for(let i=0;i<h.time.length;i++){
  const at=h.time[i]*1000;
  if(!Number.isSafeInteger(at)||at<=previous||previous&&at-previous!==3600000)throw Error('weather_invalid_response');previous=at;
  if(at<start||at>=start+24*3600000)continue;
  const values=HOURLY.map(k=>h[k][i]),ranges=[[-100,70],[0,500],[0,150],[0,100],[0,99]];
  if(values.some((v,j)=>typeof v!=='number'||!Number.isFinite(v)||v<ranges[j][0]||v>ranges[j][1]))throw Error('weather_missing_values');
  rows.push({at,temperatureC:values[0],rainMm:values[1],gustMs:values[2],snowCm:values[3],code:values[4]});
 }
 if(rows.length<24||rows[0].at>now||rows.at(-1).at<now+22*3600000)throw Error('weather_forecast_outdated');
 const rules=[
  ['frost','低温/霜冻风险',r=>r.temperatureC<=2,'预报气温≤2℃；人工检查保温与易冻管线。'],
  ['heat','高温风险',r=>r.temperatureC>=35,'预报气温≥35℃；人工核查棚内实测、遮阳和通风条件。'],
  ['wind','强阵风风险',r=>r.gustMs>=17.2,'预报阵风≥17.2m/s；人工检查棚膜、压膜线和固定件。'],
  ['rain','强降水风险',r=>r.rainMm>=10,'预报小时降水≥10mm；人工检查排水与电气防水。'],
  ['snow','积雪风险',r=>r.snowCm>=1,'预报小时降雪≥1cm；人工检查棚体荷载与除雪预案。'],
  ['thunder','雷暴风险',r=>r.code>=95,'预报天气代码95–99；关注当地气象部门正式预警。']
 ];
 const risks=rules.flatMap(([code,title,test,advice])=>{const hit=rows.filter(test);return hit.length?[{code,title,startsAt:hit[0].at,endsAt:hit.at(-1).at+3600000,hours:hit.length,advice}]:[];});
 return {schemaVersion:1,available:true,provider:'Open-Meteo',sourceUrl:'https://open-meteo.com/',location:WEATHER_LOCATION,fetchedAt:now,expiresAt:now+TTL,forecastFrom:rows[0].at,forecastTo:rows.at(-1).at+3600000,officialWarning:false,hardwareControl:false,risks,
  summary:{minTemperatureC:Math.min(...rows.map(r=>r.temperatureC)),maxTemperatureC:Math.max(...rows.map(r=>r.temperatureC)),maxGustMs:Math.max(...rows.map(r=>r.gustMs)),totalRainMm:Math.round(rows.reduce((s,r)=>s+r.rainMm,0)*10)/10},hours:rows};
}
export class WeatherService{
 constructor({fetchFn=fetch,now=Date.now}={}){this.fetchFn=fetchFn;this.now=now;this.cached=null;this.pending=null;this.retryAt=0;}
 async read(){
  const at=this.now();
  if(this.cached&&at>=this.cached.fetchedAt&&at-this.cached.fetchedAt<CACHE)return structuredClone(this.cached);
  if(this.pending)return structuredClone(await this.pending);
  if(at<this.retryAt)return this.unavailable('weather_retry_later');
  this.pending=this.load().finally(()=>{this.pending=null;});return structuredClone(await this.pending);
 }
 unavailable(reason){return {schemaVersion:1,available:false,provider:'Open-Meteo',location:WEATHER_LOCATION,fetchedAt:null,expiresAt:null,officialWarning:false,hardwareControl:false,risks:[],hours:[],reason};}
 async load(){
  try{
   const response=await this.fetchFn(WEATHER_URL,{signal:AbortSignal.timeout(7000),redirect:'error',headers:{accept:'application/json'}});
   if(!response.ok)throw Error('weather_provider_unavailable');
   const chunks=[];let size=0;
   for await(const chunk of response.body){size+=chunk.byteLength;if(size>131072)throw Error('weather_response_too_large');chunks.push(chunk);}
   const raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
   const result=summarizeWeather(raw,this.now());this.cached=result;return result;
  }catch{this.cached=null;this.retryAt=this.now()+60000;return this.unavailable('weather_provider_unavailable');}
 }
}
