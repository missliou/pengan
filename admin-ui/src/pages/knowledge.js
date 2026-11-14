import { el, button, sectionCard, banner } from '../lib/dom.js';
export default async function renderKnowledge(ctx){
 const wrap=el('div'),list=el('div'),results=el('div'),status=el('p',{role:'status'});
 const title=el('input',{id:'knowledge-title',placeholder:'文档标题',maxlength:160}),source=el('input',{id:'knowledge-source',placeholder:'资料出处 / 版本（仅标签，不会抓取URL）',maxlength:500}),text=el('textarea',{id:'knowledge-text',placeholder:'粘贴可引用的知识正文；不要填写密码或密钥',rows:8,maxlength:40000}),query=el('input',{id:'knowledge-query',placeholder:'检索问题',maxlength:1000});
 const writable=!ctx.demoMode&&ctx.state.user?.role==='admin';let busy=false,searchEpoch=0;
 const save=button('保存知识文档',async()=>{
  if(busy)return;busy=true;save.disabled=true;status.textContent='正在保存';
  try{await ctx.dataSource.saveKnowledge({title:title.value.trim(),source:source.value.trim(),text:text.value});if(!ctx.scope.active)return;status.textContent='服务端已确认保存';text.value='';await reload();}
  catch(e){if(ctx.scope.active)status.textContent='保存未确认：'+e.message;}
  finally{busy=false;if(ctx.scope.active)save.disabled=!writable;}
 },{disabled:!writable});
 const search=button('检索知识库',async()=>{
  const version=++searchEpoch;
  try{const data=await ctx.dataSource.searchKnowledge({query:query.value.trim()});if(!ctx.scope.active||version!==searchEpoch)return;
   if(!Array.isArray(data?.items))throw Error('检索响应无效');
   results.replaceChildren(el('p',{text:'命中 '+data.items.length+' 块；无命中不会补造依据。'}),...data.items.map(item=>sectionCard(item.title,item.source,el('p',{text:'块 '+item.chunkId+' · 分值 '+item.score+' · SHA256 '+item.contentSha256}),el('pre',{class:'pre-wrap',text:item.content}))));
  }catch(e){if(ctx.scope.active&&version===searchEpoch)results.replaceChildren(banner('bad','检索失败：'+e.message));}
 },{disabled:!writable});
 wrap.append(banner('warn','按当前设备隔离的文本知识库。资料仅供引用，不能修改硬规则；首版采用词法检索，不会联网抓取资料。'),
 sectionCard('新增知识文档 · '+(ctx.state.gatewayId||'未选择设备'),null,title,source,text,save,status),
 sectionCard('已保存文档',null,list),sectionCard('检索验证',null,query,search,results));
 async function reload(){try{const data=await ctx.dataSource.listKnowledge();if(!ctx.scope.active)return;if(!Array.isArray(data?.items))throw Error('列表协议无效');list.replaceChildren(...(data.items.length?data.items.map(doc=>el('p',{text:doc.title+' · '+doc.source+' · '+doc.id})):[el('p',{text:'本设备暂无知识文档'})]));}catch(e){if(ctx.scope.active)list.replaceChildren(banner('bad','知识库读取失败：'+e.message));}}
 if(ctx.demoMode){
  title.value='番茄温湿度资料（界面样例）';source.value='本地演示样例，不是正式农艺标准';
  text.value='番茄生长环境应结合生育期、品种和现场条件评估温湿度。出现异常时先核验传感器，再查阅适用资料。本样例仅演示检索资料结构，不提供人员准入或设备控制依据。';
  title.disabled=true;source.disabled=true;text.disabled=true;
  list.append(banner('warn','静态知识样例，仅展示文本结构；未向服务端保存或检索。'),el('p',{text:'示例文档：番茄温湿度资料 · 来源：本地演示样例 · 文档ID：demo-document（非真实登记）'}));
  results.append(el('p',{text:'实际任务会展示命中文档、块ID、原文、来源、分值和内容哈希；本页不伪造当前检索命中。'}));
 }else await reload();
 ctx.scope.onDispose(()=>searchEpoch++);return wrap;
}
