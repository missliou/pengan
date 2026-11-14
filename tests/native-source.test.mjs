import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fingerprintNativeSources} from '../tools/native-source.mjs';
test('原生构建来源：源码/资源变化可发现，构建产物与本地签名不混入来源',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'pengan-source-')),native=path.join(root,'openharmony');
 try{
  await mkdir(path.join(native,'entry'),{recursive:true});await writeFile(path.join(native,'entry','Index.ets'),'original');
  const original=await fingerprintNativeSources(root);assert.equal(original.files,1);
  for(const folder of ['node_modules','build','.hvigor','oh_modules']){await mkdir(path.join(native,folder));await writeFile(path.join(native,folder,'generated'),'temporary');}
  await writeFile(path.join(native,'local.properties'),'machine local');await writeFile(path.join(native,'debug.key'),'private test key');
  assert.deepEqual(await fingerprintNativeSources(root),original);
  await writeFile(path.join(native,'entry','Index.ets'),'changed');assert.notEqual((await fingerprintNativeSources(root)).sha256,original.sha256);
  await writeFile(path.join(native,'entry','Index.ets'),'original');await writeFile(path.join(native,'entry','resource.pcm'),new Uint8Array([1,2,3]));
  assert.notEqual((await fingerprintNativeSources(root)).sha256,original.sha256);assert.equal((await fingerprintNativeSources(root)).files,2);
 }finally{await rm(root,{recursive:true,force:true});}
});
