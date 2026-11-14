import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import net from 'node:net';
import {hspHttpUrl} from '../gateway/hsp-http.mjs';
const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const args=process.argv.slice(2);
if(args.includes('--help')){
 console.log('node tools/system.mjs [--host 192.168.1.89] [--serial COM7 | --wifi 192.168.1.100] [--mode hardware|simulation]\n默认真实数据模式，只启动回环HTTP服务；串口需明确指定，使用PowerShell7，只读采集。演示模式必须显式--mode simulation。Ctrl+C停止本次启动的服务。');
 process.exit(0);
}
const options={host:'127.0.0.1',serial:null,wifi:null,mode:'hardware'};
for(let i=0;i<args.length;i+=2){
 if(!['--host','--serial','--wifi','--mode'].includes(args[i])||!args[i+1])throw Error('invalid_arguments');
 options[args[i].slice(2)]=args[i+1];
}
if(net.isIP(options.host)!==4||! /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(options.host))throw Error('host_must_be_private_ipv4');
if(options.serial&&!/^COM\d+$/.test(options.serial))throw Error('serial_must_be_explicit_COM_port');
if(!['hardware','simulation'].includes(options.mode))throw Error('invalid_operation_mode');
if(options.wifi)hspHttpUrl(options.wifi);
if(options.wifi&&options.serial)throw Error('choose_serial_or_wifi');
if(options.wifi&&options.mode!=='hardware')throw Error('wifi_requires_hardware_mode');
let stopping=false;
const children=[];
const stop=code=>{if(stopping)return;stopping=true;for(const child of children)if(!child.killed)child.kill();process.exitCode=code;};
const gateway=spawn(process.execPath,[path.join(root,'gateway/demo.mjs')],{cwd:root,env:{...process.env,PENGAN_HTTP_HOST:options.host,PENGAN_OPERATION_MODE:options.mode},stdio:'inherit',windowsHide:true});
children.push(gateway);
gateway.on('error',e=>{console.error('网关启动失败：'+e.message);stop(1);});
gateway.on('exit',code=>{if(!stopping)stop(code||0);});
if(options.serial){
 const reader=spawn('pwsh.exe',['-NoProfile','-File',path.join(root,'tools/read-hsp.ps1'),'-Port',options.serial,'-Reconnect'],{cwd:root,stdio:'inherit',windowsHide:true});
 children.push(reader);
 reader.on('error',e=>console.error('采集启动失败（需PowerShell7）：'+e.message));
 reader.on('exit',()=>{if(!stopping)console.error('串口采集已停止；硬件数据将在10秒后标记未知，网关继续运行。');});
}else if(options.wifi){
 const reader=spawn(process.execPath,[path.join(root,'tools/read-hsp-http.mjs'),'--ip',options.wifi],{cwd:root,stdio:'inherit',windowsHide:true});
 children.push(reader);
 reader.on('error',()=>console.error('无线采集进程启动失败'));
 reader.on('exit',()=>{if(!stopping)console.error('无线采集已停止，旧数据不会刷新。');});
}else console.log('未启动串口或无线采集；真实设备按数据时效显示，不使用模拟读数补齐。');
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>stop(0));
console.log(`棚安控制台：http://${options.host}:5187/ · ${options.mode==='hardware'?'真实数据模式':'显式软件演示模式'}`);
