import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(fileURLToPath(new URL('.', import.meta.url)));
const types = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8'};
const server=http.createServer(async(req,res)=>{
  try {
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(pathname.startsWith('/api/')) {
      const allowed=['/api/health','/api/device','/api/command','/api/demo/scenario','/api/agent/status','/api/agent/plan'];
      const origin=req.headers.origin;
      const localOrigin=`http://127.0.0.1:${server.address().port}`;
      if(origin&&origin!==localOrigin&&origin!==localOrigin.replace('127.0.0.1','localhost')){res.writeHead(403).end();return;}
      if(!allowed.includes(pathname)||!['GET','POST'].includes(req.method)){res.writeHead(404).end();return;}
      let body='';for await(const part of req){body+=part;if(body.length>8192){res.writeHead(413).end();return;}}
      try{
        const upstream=await fetch('http://127.0.0.1:5187'+pathname,{method:req.method,headers:{'Content-Type':'application/json'},body:req.method==='POST'?body:undefined,signal:AbortSignal.timeout(pathname==='/api/agent/plan'?30000:6000)});
        res.writeHead(upstream.status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}).end(await upstream.text());
      }catch{res.writeHead(503,{'Content-Type':'application/json'}).end(JSON.stringify({error:'gateway_unavailable',simulated:true}));}
      return;
    }
    if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405).end();return;}
    const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
    if(!file.startsWith(root+path.sep)&&file!==path.join(root,'index.html')){res.writeHead(403).end();return;}
    if(!['.html','.css','.js'].includes(path.extname(file))){res.writeHead(404).end();return;}
    const body=await readFile(file);
    res.writeHead(200,{'Content-Type':types[path.extname(file)],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}).end(body);
  }catch {res.writeHead(404).end('Not found');}
});
server.on('error',error=>{console.error('本地服务启动失败：'+error.message);process.exitCode=1;});
server.listen(Number(process.env.PORT||5186),'127.0.0.1',()=>console.log('棚安原型 http://127.0.0.1:'+server.address().port));
