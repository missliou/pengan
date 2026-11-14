import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(fileURLToPath(new URL('..',import.meta.url))),require=createRequire(import.meta.url);
const JSZip=require(path.join(root,'openharmony/node_modules/@ohos/hvigor-ohos-plugin/node_modules/jszip'));
const directory=path.join(root,'output/release'),release=JSON.parse(await fs.readFile(path.join(directory,'release-manifest-api26.json'),'utf8'));
if(path.basename(release.file)!==release.file)throw Error('invalid archive filename');
const data=await fs.readFile(path.join(directory,release.file)),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
if(hash(data)!==release.sha256||data.length!==release.bytes)throw Error('archive manifest mismatch');
const zip=await JSZip.loadAsync(data,{checkCRC32:true}),contents=JSON.parse(await zip.file('release-contents.json').async('string'));
const declared=new Set(contents.files.map(row=>row.path)),source=[];
for(const [name,entry] of Object.entries(zip.files)){
 if(entry.dir)continue;
 if(/(^|\/)(node_modules|\.env)(\/|$)|device-debug|\.(p12|p7b|pem|key|jks|cer)$|tmp\/runtime/i.test(name))throw Error('excluded file in archive');
 if(name!=='release-contents.json'&&!declared.has(name))throw Error('undeclared archive file');
}
for(const row of contents.files){
 const entry=zip.file(row.path);if(!entry)throw Error('missing declared file');
 const bytes=await entry.async('nodebuffer');if(bytes.length!==row.bytes||hash(bytes)!==row.sha256)throw Error('archive content mismatch');
 if(row.path.startsWith('openharmony/'))source.push({path:row.path.slice(12),bytes:bytes.length,sha256:hash(bytes)});
}
source.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
const manifest=JSON.parse((await zip.file('output/hap/openharmony7/build-manifest.json').async('string')).replace(/^\uFEFF/,''));
if(hash(JSON.stringify(source))!==manifest.nativeSourceSha256||source.length!==manifest.nativeSourceFiles)throw Error('archive native source mismatch');
const proof={verifiedAt:new Date().toISOString(),archive:release.file,archiveSha256:release.sha256,entries:release.entries,nativeSourceFiles:source.length,nativeSourceSha256:manifest.nativeSourceSha256,hapSha256:manifest.sha256,crcAndContentHashes:true,excludedSensitiveFiles:true,signed:false,installedOnDevice:false,realProviderInvoked:false};
await fs.writeFile(path.join(directory,'verification-api26.json'),JSON.stringify(proof,null,2));console.log(JSON.stringify(proof,null,2));
