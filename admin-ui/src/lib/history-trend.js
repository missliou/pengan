const specs=[['temperatureC','temperatureValid','温度','℃',-40,85],['humidityPct','humidityValid','湿度','%',0,100],['gasRaw','gasValid','ADC','',0,4095]];
export function historyTrend(data,gatewayId){
  if(!data||data.gatewayId!==gatewayId||data.simulated!==false||data.historical!==true||data.isCurrent!==false||!Array.isArray(data.items)||data.items.length>200)throw Error('历史数据身份或范围无效');
  const ids=new Set();
  const rows=data.items.filter(r=>{
    if(!Number.isSafeInteger(r.seq)||r.seq<1||ids.has(r.seq))return false;
    ids.add(r.seq);return true;
  });
  const readings=rows.filter(r=>Number.isFinite(r.observation?.receivedAt)&&r.observation.receivedAt>0).sort((a,b)=>a.observation.receivedAt-b.observation.receivedAt);
  const metrics=specs.map(([key,quality,label,unit,min,max])=>{
    const valid=readings.filter(r=>r.observation.quality?.[quality]===true&&Number.isFinite(r.observation.values?.[key])&&r.observation.values[key]>=min&&r.observation.values[key]<=max);
    const values=valid.map(r=>r.observation.values[key]);
    return {key,label,unit,count:values.length,missing:rows.length-values.length,min:values.length?Math.min(...values):null,max:values.length?Math.max(...values):null,first:values[0]??null,last:values.at(-1)??null,points:valid.map(r=>({at:r.observation.receivedAt,value:r.observation.values[key],seq:r.seq}))};
  });
  return {gatewayId,total:rows.length,replayed:rows.filter(r=>r.replayed===true).length,from:readings[0]?.observation.receivedAt??null,to:readings.at(-1)?.observation.receivedAt??null,metrics,seqs:readings.map(r=>r.seq),sessions:new Set(rows.map(r=>r.sessionBootId).filter(Boolean)).size};
}
export function trendQuestion(summary){
  if(!summary.total||!summary.from||!summary.to)throw Error('暂无有效时间范围的历史可供分析');
  const n=v=>v===null?'未知':Number(v.toFixed(2)).toString();
  return ['请复核以下历史采集摘要并解释变化和数据缺口；不是当前状态，不执行设备，不作准入判断。',
    '设备：'+summary.gatewayId+'；历史窗口：'+new Date(summary.from).toISOString()+'至'+new Date(summary.to).toISOString(),
    '本次最多200条中的'+summary.total+'条，补发'+summary.replayed+'条，采集会话'+summary.sessions+'个；不是全量历史。',
    ...summary.metrics.map(m=>m.label+'：有效'+m.count+'，未知'+m.missing+'；最低'+n(m.min)+'，最高'+n(m.max)+'，首末'+n(m.first)+'→'+n(m.last)+m.unit),
    '记录序号（首末）：'+(summary.seqs[0]??'未知')+' / '+(summary.seqs.at(-1)??'未知')+'。上述为浏览器计算的待复核摘要；不可推断因果或把ADC当气体浓度。'].join('\n').slice(0,700);
}
