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
  console.log('棚安云端服务已监听本机回环端口 '+runtime.port+'；公网访问需配置HTTPS反向代理。');
  let closing=false;
  const close=async()=>{if(closing)return;closing=true;await runtime.close();process.exit(0);};
  process.once('SIGINT',close);process.once('SIGTERM',close);
 }catch(error){console.error('云端启动失败：'+(/^[a-z0-9_]{1,80}$/.test(error.message)?error.message:'configuration_or_storage_unavailable'));process.exitCode=1;}
}
