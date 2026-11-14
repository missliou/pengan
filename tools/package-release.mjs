import {readFile,readdir,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {fingerprintNativeSources} from './native-source.mjs';
const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const require=createRequire(import.meta.url);
const JSZip=require(path.join(root,'openharmony/node_modules/@ohos/hvigor-ohos-plugin/node_modules/jszip'));
const native7=process.argv.includes('--api26');
if(process.argv.slice(2).some(arg=>arg!=='--api26'))throw new Error('未知打包参数');
const nativeDir=native7?'output/hap/openharmony7':'output/hap';
let nativeManifest=null,hspManifest=null;
if(native7){
 nativeManifest=JSON.parse((await readFile(path.join(root,nativeDir,'build-manifest.json'),'utf8')).replace(/^\uFEFF/,''));
 if(nativeManifest.targetApi!=='26.0.0'||nativeManifest.minApi!=='26.0.0'||path.basename(nativeManifest.artifact)!==nativeManifest.artifact)throw new Error('不是有效API26候选清单');
 if(!nativeManifest.nativeSourceSha256||nativeManifest.nativeSourceSha256!==(await fingerprintNativeSources(root)).sha256)throw new Error('原生源码与候选构建指纹不一致，请重新执行build-native7.ps1');
 const candidate=await readFile(path.join(root,nativeDir,nativeManifest.artifact));
 if(createHash('sha256').update(candidate).digest('hex')!==nativeManifest.sha256||candidate.length!==nativeManifest.bytes)throw new Error('候选HAP与构建清单不一致');
 hspManifest=JSON.parse(await readFile(path.join(root,'firmware/hh-hsp101/dist/manifest.json'),'utf8'));
 if(path.basename(hspManifest.file)!==hspManifest.file)throw new Error('固件清单文件名无效');
 const firmware=await readFile(path.join(root,'firmware/hh-hsp101/dist',hspManifest.file));
 if(createHash('sha256').update(firmware).digest('hex')!==hspManifest.sha256)throw new Error('固件校验不匹配');
}
const excludedDirs=new Set(['node_modules','oh_modules','.hvigor','.git','build']);
const excludedFile=name=>['local.properties','.env','cloud-config.json','device-credential.json','model-config.json','cloud-writer.lock'].includes(name)||/\.(p12|p7b|pem|key|jks|cer)$/i.test(name)||name.includes('device-debug');
const paths=[];
async function collect(dir){for(const item of await readdir(path.join(root,dir),{withFileTypes:true})){if(excludedDirs.has(item.name)||excludedFile(item.name))continue;const relative=path.posix.join(dir,item.name);if(native7&&relative.startsWith('firmware/hh-hsp101/dist/')&&![hspManifest.file,'manifest.json','linked-features.txt','build.log'].includes(item.name))continue;if(item.isDirectory())await collect(relative);else if(item.isFile())paths.push(relative);}}
for(const folder of ['openharmony','gateway','prototype','firmware','tests','tools','docs','admin-ui',nativeDir])await collect(folder);
paths.push('README.md','进度.md','待办.md','AGENTS.md','QWEN.md','规则.md','目录简介.md','.gitignore','start_server.py','setup_cloud.py');paths.sort();
const zip=new JSZip(),records=[];
for(const relative of paths){const data=await readFile(path.join(root,relative));zip.file(relative,data);records.push({path:relative,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')});}
const info={targetApi:native7?'26.0.0':'historical',hardwareAcceptance:'pending',version:'0.1.0',createdAt:new Date().toISOString(),nativeHapSigned:false,installedOnDevice:false,excluded:['SDK','node_modules','private keys','device-bound signed profiles','temporary data'],files:records};
zip.file('release-contents.json',JSON.stringify(info,null,2));
const result=await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE',compressionOptions:{level:6}});
const check=await JSZip.loadAsync(result,{checkCRC32:true});
for(const record of records){const bytes=await check.file(record.path).async('nodebuffer');if(createHash('sha256').update(bytes).digest('hex')!==record.sha256)throw new Error('ZIP文件校验失败 '+record.path);}
const out=path.join(root,'output/release');await mkdir(out,{recursive:true});
const name=native7?'棚安-OpenHarmony7-离线候选-0.1.0.zip':'棚安-原生应用雏形-0.1.0.zip';await writeFile(path.join(out,name),result);
const summary={file:name,bytes:result.length,entries:records.length+1,sha256:createHash('sha256').update(result).digest('hex'),nativeHapSigned:false,installedOnDevice:false};
await writeFile(path.join(out,native7?'release-manifest-api26.json':'release-manifest.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));
