import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {fingerprintNativeSources} from './native-source.mjs';
const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const require=createRequire(import.meta.url);
const JSZip=require(path.join(root,'openharmony/node_modules/@ohos/hvigor-ohos-plugin/node_modules/jszip'));
const manifestPath=path.resolve(root,process.argv[2]??'output/hap/build-manifest.json');
const manifest=JSON.parse((await readFile(manifestPath,'utf8')).replace(/^\uFEFF/,''));
if(manifest.nativeSourceSha256&&manifest.nativeSourceSha256!==(await fingerprintNativeSources(root)).sha256)throw new Error('当前原生源码与此候选不一致，需要重新构建');
const bytes=await readFile(path.join(path.dirname(manifestPath),manifest.artifact));
const hash=createHash('sha256').update(bytes).digest('hex');
if(hash!==manifest.sha256||bytes.length!==manifest.bytes)throw new Error('HAP与构建清单不一致');
const zip=await JSZip.loadAsync(bytes,{checkCRC32:true});
const module=JSON.parse(await zip.file('module.json').async('string'));
// API26+ additionally records the semantic API version. Compare package metadata
// against the build manifest rather than trusting a file name.
const expectedApi=String(manifest.targetApi);
const expectedMin=String(manifest.minApi);
const packageApi=(prefix,expected)=>expected.includes('.')
  ? [module.app[prefix+'APIVersion'],module.app[prefix+'MinorAPIVersion'],module.app[prefix+'PatchAPIVersion']].join('.')
  : String(module.app[prefix+'APIVersion']);
if(module.app.bundleName!=='com.pengan.greenhouse'||module.app.compileSdkType!=='OpenHarmony'||
  packageApi('min',expectedMin)!==expectedMin||packageApi('target',expectedApi)!==expectedApi||module.app.compileSdkVersion!==manifest.sdk)throw new Error('HAP平台、包名或API与构建清单不匹配');
const abc=await zip.file('ets/modules.abc').async('nodebuffer');
if(abc.toString('ascii',0,5)!=='PANDA')throw new Error('没有有效的Ark字节码');
if(Object.keys(zip.files).some(name=>/\.(html|css)$/.test(name)))throw new Error('原生包不应包含网页界面');
const permissionNames=module.module.requestPermissions.map(p=>p.name).sort();
if(JSON.stringify(permissionNames)!==JSON.stringify(['ohos.permission.CAMERA','ohos.permission.INTERNET','ohos.permission.MICROPHONE']))throw new Error('权限清单超出当前范围');
const assets=JSON.parse(await readFile(path.join(root,'openharmony/entry/src/main/resources/rawfile/alert-assets.json'),'utf8'));
for(const asset of assets){
 const file=zip.file('resources/rawfile/'+asset.file);if(!file)throw new Error('缺少语音 '+asset.file);
 const data=await file.async('nodebuffer');
 if(data.length!==asset.bytes||createHash('sha256').update(data).digest('hex')!==asset.sha256)throw new Error('语音校验不一致 '+asset.file);
}
console.log(JSON.stringify({ok:true,artifact:manifest.artifact,bytes:bytes.length,sha256:hash,bundle:module.app.bundleName,api:module.app.targetAPIVersion,arkBytecode:true,webPages:false,voiceClips:assets.length,signed:false,deviceInstalled:false},null,2));
