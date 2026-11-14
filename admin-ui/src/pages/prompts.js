import {el,sectionCard,banner} from '../lib/dom.js';
import {DEMO_PROMPTS} from '../demo-prompts.js';
export function promptCards(catalog){
 if(!catalog||catalog.version!==1||!Array.isArray(catalog.stages)||catalog.stages.length!==3||typeof catalog.hash!=='string')throw Error('提示词目录协议无效');
 return el('div',{class:'prompt-catalog'},[
  el('pre',{text:'版本 '+catalog.version+' · SHA256\n'+catalog.hash}),
  ...catalog.stages.map(stage=>sectionCard(stage.title,'固定系统规则 · '+stage.stage,
   el('pre',{text:stage.systemPrompt}),
   el('h4',{text:'运行时输入（作为数据，不是系统指令）'}),el('p',{text:stage.inputFields.join('、')}),
   el('details',{},[el('summary',{text:'查看工具输出约束：'+stage.tool.function.name}),el('pre',{text:JSON.stringify(stage.tool,null,2)})]))),
 ]);
}
export default async function renderPrompts(ctx){
 const root=el('div');
 root.append(banner('warn',ctx.demoMode?'当前源码的提示词参考，仅演示展示；不是历史任务实际调用证据。':'只读展示服务端实际提示词；动态设备数据、用户问题和知识检索结果单独注入。硬规则优先于模型输出。'));
 try{const catalog=ctx.demoMode?DEMO_PROMPTS:await ctx.dataSource.getAgentPrompts();if(ctx.scope.active)root.append(promptCards(catalog));}
 catch(e){if(ctx.scope.active)root.append(banner('bad','提示词读取失败：'+e.message));}
 return root;
}
