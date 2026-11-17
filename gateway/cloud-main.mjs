import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {startCloudServer} from './cloud-server.mjs';
const args=process.argv.slice(2);
if(args.length!==2||args[0]!=='--config'||!path.isAbsolute(args[1]||'')){
 console.error('用法：node gateway/cloud-main.mjs --config <部署配置绝对路径>');process.exitCode=1;
}else{
 try{
  const config=JSON.parse(await readFile(args[1],'utf8'));
  const runtime=await startCloudServer(config);
  const host=config.publicOriginHost||'127.0.0.1';
  console.log('棚安云端服务已监听 '+host+':'+runtime.port+'（原站 '+runtime.publicOrigin+'）。');
  console.log('Web 管理台：'+runtime.publicOrigin+'/');
  console.log('DAYU200 上报入口：POST '+runtime.publicOrigin+'/api/v1/telemetry/current（Bearer 设备令牌）。');
  console.log(host==='127.0.0.1'?'公网访问需配置HTTPS反向代理。':'已对私有局域网开放明文HTTP，仅用于演示/联调；令牌与数据未加密，禁止用于公网。');
  let closing=false;
  const close=async()=>{if(closing)return;closing=true;await runtime.close();process.exit(0);};
  process.once('SIGINT',close);process.once('SIGTERM',close);
 }catch(error){console.error('云端启动失败：'+(/^[a-z0-9_]{1,80}$/.test(error.message)?error.message:'configuration_or_storage_unavailable'));process.exitCode=1;}
}
