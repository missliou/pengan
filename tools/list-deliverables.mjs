import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {fingerprintNativeSources} from './native-source.mjs';
const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const json=async relative=>JSON.parse((await readFile(path.join(root,relative),'utf8')).replace(/^\uFEFF/,''));
const native=await json('output/hap/openharmony7/build-manifest.json');
const release=await json('output/release/release-manifest-api26.json');
const firmware=await json('firmware/hh-hsp101/dist/manifest.json');
const proof=await json('output/release/verification-api26.json');
if(native.nativeSourceSha256!==(await fingerprintNativeSources(root)).sha256)throw Error('候选源码已变化，请重新构建后生成位置说明');
if(proof.archiveSha256!==release.sha256||proof.hapSha256!==native.sha256)throw Error('交付校验记录已过期，请先重新打包并运行verify-release.mjs');
const files=[],candidates=[
 {kind:'DAYU200原生HAP',directory:'output/hap/openharmony7',name:native.artifact,sha256:native.sha256,bytes:native.bytes,note:'未签名候选；用install-native7.ps1按实际设备签名安装'},
 {kind:'完整源码与候选包ZIP',directory:'output/release',name:release.file,sha256:release.sha256,bytes:release.bytes,note:'包含源码、构建说明和离线候选，排除密钥、SDK与设备绑定签名'},
 {kind:'HH-HSP101固件',directory:'firmware/hh-hsp101/dist',name:firmware.file,sha256:firmware.sha256,bytes:firmware.bytes,note:'固件'+firmware.version+'候选；烧录与屏幕效果仍需实物核对'}
];
try{
 const report=await json('output/reports/report-manifest.json');
 candidates.push({kind:'最近真实记录JSON',directory:'output/reports',name:report.file,sha256:report.sha256,bytes:report.bytes,note:'导出时刻快照；采集'+(report.currentOnline?'在线':'离线/未知')+'，采集历史'+report.observationRecords+'条、文字AI历史'+report.analysisRecords+'条；不是完整历史'});
}catch(error){if(error.code!=='ENOENT')throw error;}
try{
 const diagnostics=await json('output/diagnostics/manifest.json');
 if(diagnostics.readOnly!==true||!Array.isArray(diagnostics.files)||diagnostics.files.length>2)throw Error('诊断清单无效');
 for(const file of diagnostics.files)candidates.push({kind:file.file.endsWith('.md')?'只读诊断说明':'只读就绪诊断JSON',directory:'output/diagnostics',name:file.file,sha256:file.sha256,bytes:file.bytes,note:'仅诊断时刻状态，不是模型调用、安装或烧录证据'});
}catch(error){if(error.code!=='ENOENT')throw error;}
for(const item of candidates){
 if(path.basename(item.name)!==item.name)throw Error('清单文件名无效');
 const absolute=path.join(root,item.directory,item.name),bytes=await readFile(absolute);
 if(bytes.length!==item.bytes||createHash('sha256').update(bytes).digest('hex')!==item.sha256)throw Error(item.kind+'文件与清单不符');
 files.push({...item,path:absolute});
}
const result={generatedAt:new Date().toISOString(),files,hardwareAcceptance:'pending',realModelAcceptance:'pending'};
await writeFile(path.join(root,'output/deliverables.json'),JSON.stringify(result,null,2));
const lines=['# 棚安交付文件位置','','生成时间：'+result.generatedAt,'','本说明逐项核对了文件大小、SHA256和原生源码来源。它不证明实际安装、烧录或外部模型验收。',''];
for(const item of files){lines.push('## '+item.kind,'','['+item.name+'](<'+item.path.replaceAll('\\','/')+'>)','','- 大小：'+item.bytes+' 字节','- SHA256：'+item.sha256,'- 状态：'+item.note,'');}
lines.push('最新进度：[进度.md](<'+path.join(root,'进度.md').replaceAll('\\','/')+'>)','','候选重新构建或打包后，应重新运行node tools/list-deliverables.mjs，避免使用过期文件说明。','');
await writeFile(path.join(root,'output/交付文件位置.md'),lines.join('\n'));console.log(JSON.stringify(result,null,2));
