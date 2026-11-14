import {randomUUID} from 'node:crypto';
import {evaluate} from '../prototype/safety.js';
import {DEVICE_ID,validateCommand} from './protocol.mjs';

// Software device with the same safety/control boundaries intended for the MCU.
export class SimulatedDevice {
  constructor({now=Date.now}={}){
    this.now=now;this.bootId=randomUUID();this.seq=0;this.seen=new Map();this.executions=0;
    this.env={co:4,co2:680,at:now(),sensorOnline:true,emergency:false};
    this.fan=false;this.fanAt=0;this.maxRunMs=20000;this.hold=false;this.paused=false;
  }
  scenario(name){
    if(!['normal','co','co2','stale','emergency','clear_emergency','offline','online'].includes(name))throw new Error('unknown_scenario');
    if(name==='emergency'){this.env.emergency=true;this.fan=false;return;}
    if(name==='clear_emergency'){this.env.emergency=false;return;}
    if(name==='offline'||name==='online'){this.paused=name==='offline';this.env.sensorOnline=!this.paused;return;}
    this.env.co=name==='co'?65:4;this.env.co2=name==='co2'?2200:680;
    this.hold=name==='stale';this.env.at=this.now()-(this.hold?60000:0);
  }
  telemetry(){
    return {version:1,deviceId:DEVICE_ID,bootId:this.bootId,seq:this.seq++,sampledAt:new Date(this.env.at).toISOString(),sampleAgeMs:Math.max(0,this.now()-this.env.at),values:{coPpm:this.env.co,co2Ppm:this.env.co2,temperatureC:25.6,humidityPct:64,soilPct:48,lightLux:12600},quality:{coValid:true,co2Valid:true},state:{emergency:this.env.emergency,fan:this.fan},simulated:true};
  }
  execute(c,{retained=false}={}){
    const error=validateCommand(c,{now:this.now(),retained});
    const reply=(status,reason)=>({version:1,deviceId:DEVICE_ID,commandId:typeof c?.commandId==='string'?c.commandId:'invalid',action:c?.action,status,reason,at:this.now(),simulated:true});
    if(error)return reply('rejected',error);
    const existing=this.seen.get(c.commandId);
    if(existing){
      if(existing.fingerprint!==JSON.stringify(c))return reply('rejected','command_id_conflict');
      return {...existing.ack,duplicate:true};
    }
    let ack;
    if(this.env.emergency&&c.action!=='query_environment'&&c.action!=='stop_ventilation')ack=reply('rejected','emergency_active');
    else if(c.action==='request_access'){
      const check=evaluate(this.env,this.now());
      ack=reply(check.allowed?'executed':'rejected',check.allowed?'simulated_access_only':check.reasons.join('；'));
    }else if(c.action==='ventilate'){
      if(this.fan)ack=reply('executed','already_running');
      else{this.fan=true;this.fanAt=this.now();this.maxRunMs=c.parameters.maxRunMs;this.executions++;ack=reply('executed','simulated_fan_started');}
    }else if(c.action==='stop_ventilation'){this.fan=false;ack=reply('executed','simulated_fan_stopped');}
    else ack=reply('executed','snapshot_requested');
    this.seen.set(c.commandId,{fingerprint:JSON.stringify(c),ack});
    // Commands expire within 10 seconds. Keep dedup results longer than their lifetime.
    for(const [id,item] of this.seen)if(item.ack.at<this.now()-60000)this.seen.delete(id);
    return ack;
  }
  tick(){
    // Communication loss must not stop the local runtime / timeout watchdog.
    if(!this.hold&&this.env.sensorOnline){this.env.at=this.now();if(this.fan){this.env.co=Math.max(4,this.env.co-9);this.env.co2=Math.max(680,this.env.co2-260);}}
    if(!this.fan)return null;
    let reason;
    if(this.env.emergency)reason='emergency_active';
    else if(this.now()-this.fanAt>=this.maxRunMs)reason='fan_timeout';
    else if(evaluate(this.env,this.now()).allowed)reason='verification_passed';
    if(reason){this.fan=false;return {event:'fan_stopped',reason,at:this.now(),simulated:true};}
    return null;
  }
}
