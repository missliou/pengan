// Scenarios share the authenticated, read-only pipeline; none grants device control.
export const ASSISTANTS = Object.freeze({
  'agri-qa': {title:'智慧农业问答', mark:'问', subtitle:'把农艺问题说清楚，让建议有据可查。', action:'提交农业问题', instruction:'以智慧农业问答形式解释问题，优先引用知识库，区分通用资料与现场判断。', examples:['番茄棚湿度偏高时，应该先检查哪些因素？','如何判断温湿度传感器的读数是否可靠？','番茄不同生育期应如何查阅适用的环境资料？']},
  'environment-ai': {title:'环境分析', mark:'析', subtitle:'从当前采集到的数据出发，找到异常与待核实项。', action:'分析当前环境', instruction:'分析当前设备的环境数据，明确采样有效性、异常和待核实项，不把历史数据当实时。', examples:['当前温湿度是否存在异常？请列出依据与缺失项。','温度突然升高，应该怎样排查传感器和现场环境？','哪些缺失数据会影响本次环境判断？']},
  'farm-advice': {title:'农事建议', mark:'策', subtitle:'先补充作物背景，再形成可核对的农事建议。', action:'生成农事建议', instruction:'生成有依据的农事检查建议，区分观察、资料和建议，缺少品种或生育期时先列出需要补充的问题，不编造用药用肥剂量。', examples:['请结合番茄生育期整理今日巡棚检查要点。','叶片萎蔫可能需要补充哪些信息？请给出排查顺序。','如何安排高温天气的人工巡查？']},
  'inspection-ai': {title:'巡检报告', mark:'记', subtitle:'把现场观察与采集依据整理成可复核的报告建议。', action:'整理巡检报告', instruction:'按现场观察、采集依据、未知项、建议复核步骤整理简短巡检报告；用户描述未经验证，未上传照片不得声称已检查图片。', examples:['请整理本次巡检摘要，分别列出已知、未知和待复核事项。','现场观察：棚内局部叶片卷曲。请整理需要继续记录的项目。','请生成交班巡检记录，说明数据来源和未完成检查。']},
});
export function assistantPrompt(mode,{question,crop='',growth=''}) {
  const scene=ASSISTANTS[mode]; if(!scene)throw Error('未知助手场景');
  const text=String(question).trim(); if(!text||text.length>700)throw Error('请填写 1–700 字的问题');
  return ['场景：'+scene.title,scene.instruction,'作物：'+String(crop).trim().slice(0,40)+'；生育期：'+String(growth).trim().slice(0,40),
    '用户问题：'+text,'仅提供只读解释和建议，不执行设备，不作人员安全准入结论。缺乏依据时明确未知，不补造传感器值或引用。'].join('\n');
}
export function assistantSession(state,mode,demoMode){
  state.aiWorkspace ||= {};
  const key=JSON.stringify([demoMode,state.gatewayId||'',mode]);
  return state.aiWorkspace[key] ||= {question:'',crop:'',growth:'',taskId:'',task:null,busy:false,uncertain:false};
}
export function checkedTask(task,id,gatewayId){
  if(!task||task.taskId!==id||task.gatewayId!==gatewayId||!['running','completed','failed'].includes(task.status))throw Error('任务身份或状态无效');
  return task;
}
