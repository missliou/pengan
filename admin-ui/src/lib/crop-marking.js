export function regionFromPoints(start,end){
 if(!start||!end||![start.x,start.y,end.x,end.y].every(Number.isFinite))return null;
 const clamp=v=>Math.max(0,Math.min(100,v));
 const a={x:clamp(start.x),y:clamp(start.y)},b={x:clamp(end.x),y:clamp(end.y)};
 const region={x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),width:Math.abs(a.x-b.x),height:Math.abs(a.y-b.y)};
 if(region.width<.5||region.height<.5)return null;
 return region;
}
