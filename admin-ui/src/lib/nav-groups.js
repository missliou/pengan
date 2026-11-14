import {el} from './dom.js';

export function renderNavGroups(pages,buttons,{currentPage,collapsed={},onToggle=()=>{}}={}){
  const groups=[...new Set(pages.map(p=>p.sec))];
  return groups.map((name,index)=>{
    const members=pages.filter(p=>p.sec===name),active=members.some(p=>p.id===currentPage);
    let closed=active?false:typeof collapsed[name]==='boolean'?collapsed[name]:!['日常监测','农业助手'].includes(name);
    const panelId='nav-group-'+index;
    const panel=el('div',{class:'nav-group-items',id:panelId,hidden:closed},members.map(p=>buttons.find(b=>b.dataset.page===p.id)));
    const arrow=el('span',{class:'nav-group-arrow','aria-hidden':'true',text:closed?'›':'⌄'});
    const toggle=el('button',{type:'button',class:'nav-sec nav-group-toggle','aria-controls':panelId,'aria-expanded':String(!closed),onclick:()=>{
      closed=!closed;panel.hidden=closed;toggle.setAttribute('aria-expanded',String(!closed));arrow.textContent=closed?'›':'⌄';onToggle(name,closed);
    }},[el('span',{text:name}),arrow]);
    return el('section',{class:'nav-group','aria-label':name},[toggle,panel]);
  });
}
