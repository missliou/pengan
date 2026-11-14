// Cloud sessions are established by the backend; demo and explicit local debug
// do not grant backend authorization. No passwords or session secrets persist.
import { el, mount, clear, chip, spinner, button } from './lib/dom.js';
import { getEnv } from './lib/env.js';
import { getPref, setPref } from './lib/store.js';
import * as api from './lib/api.js';
import { DEMO, demoCall } from './demo.js';
import { PageScope, MutationGate } from './lib/session.js';
import { LiveObservations } from './lib/freshness.js';
import { createDataSource } from './lib/data-source.js';

import renderOverview from './pages/overview.js';
import renderModel from './pages/model.js';
import renderRecords from './pages/records.js';
import renderDevices from './pages/devices.js';
import renderTasks from './pages/tasks.js';
import renderAgentFlow from './pages/agent-flow.js';
import renderKnowledge from './pages/knowledge.js';
import renderReview from './pages/review.js';
import renderAlerts, { alertPendingTotal, applyAlertBadge } from './pages/alerts.js';
import renderSystem from './pages/system.js';
import renderMedia from './pages/media.js';
import renderPrompts from './pages/prompts.js';
import renderAssistant from './pages/assistant.js';
import {renderNavGroups} from './lib/nav-groups.js';
import renderTrends from './pages/trends.js';
import renderMultispectral from './pages/multispectral.js';
import renderWeather from './pages/weather.js';

// 侧栏只显示导航与已确认数量徽标，不再展示含义混杂的状态灯。
// 没有可靠信号的页面不画灯——灰点会被误读成"有问题"或"坏了"。
// badge 字段：导航数量徽标槽位。数字只来自服务端 counts（读不到就隐藏，
// 不显示推测值，也不用 0 冒充"没有问题"）。
const PAGES = [
  { id: 'overview', title: '运行总览', sec: '日常监测', render: renderOverview },
  { id: 'alerts', title: '告警中心', sec: '日常监测', badge: 'alerts', render: renderAlerts },
  { id: 'agri-qa', title: '智慧农业问答', sec: '农业助手', render: ctx=>renderAssistant(ctx,'agri-qa') },
  { id: 'environment-ai', title: '环境分析', sec: '农业助手', render: ctx=>renderAssistant(ctx,'environment-ai') },
  { id: 'farm-advice', title: '农事建议', sec: '农业助手', render: ctx=>renderAssistant(ctx,'farm-advice') },
  { id: 'inspection-ai', title: '巡检报告', sec: '农业助手', render: ctx=>renderAssistant(ctx,'inspection-ai') },
  { id: 'history-trends', title: '历史趋势分析', sec: '农业助手', render: renderTrends },
  { id: 'weather', title: '天气与预警', sec: '日常监测', render: renderWeather },
  { id: 'multispectral', title: '多光谱监测', sec: '农业助手', render: renderMultispectral },
  { id: 'records', title: '数据记录', sec: '数据资料', render: renderRecords },
  { id: 'media', title: '图片资料', sec: '数据资料', render: renderMedia },
  { id: 'knowledge', title: 'RAG 知识库', sec: '数据资料', render: renderKnowledge },
  { id: 'agent-flow', title: '智能体流程', sec: '智能体协作', render: renderAgentFlow },
  { id: 'tasks', title: 'AI 任务过程', sec: '智能体协作', render: renderTasks },
  { id: 'review', title: '人工审核', sec: '智能体协作', badge: 'review', render: renderReview },
  { id: 'prompts', title: '智能体提示词', sec: '智能体协作', render: renderPrompts },
  { id: 'devices', title: '设备管理', sec: '系统管理', render: renderDevices },
  { id: 'model', title: '模型配置', sec: '系统管理', render: renderModel },
  { id: 'system', title: '系统与审计', sec: '系统管理', render: renderSystem },
];

const state = {
  page: 'overview',
  connection: 'unknown',           // unknown | online | offline | demo
  health: null,
  unlocked: false,                 // 仅前端门槛，非后端鉴权
  user: null, gatewayId: '', devices: [],
  reviewPending: null,           // null=未知；数字=服务端确认的待审条数
  alertPending: null,            // null=未知；数字=服务端确认的未处理告警数（open+acknowledged）
  demoMode: getPref('ui.demoMode', getEnv().DEMO_MODE_DEFAULT) === true,
};

const gate = new MutationGate(), live = new LiveObservations();
let pageScope = null, dataSource = null, contextRevision = 0, probeBusy = false;
function resetContext() {
  contextRevision++;
  pageScope?.dispose(); live.reset();
  state.aiWorkspace = {};
  state.health = null; state.hardwareOnline = false; state.modelConfigured = null;
  state.reviewPending = null; state.alertPending = null;
  state.connection = state.demoMode ? 'demo' : 'unknown'; state.connDetail = '';
}

// 待审数量：只取 1 条记录，counts 由服务端按完整视图统计，因此代价小且数字真实。
async function probeReviewPending() {
  if (state.demoMode || !state.user) return;
  const revision = contextRevision;
  try {
    const data = await api.listReviewQueue({verdict: 'needs_human', reviewStatus: 'pending', limit: 1}, {gatewayId: state.gatewayId});
    if (revision !== contextRevision) return;
    const count = data?.counts?.pending;
    state.reviewPending = Number.isSafeInteger(count) ? count : null;
  } catch {
    if (revision === contextRevision) state.reviewPending = null;
  }
  markNavDots();
}

// 未处理告警数：与待审数同法——只取 1 条，counts 由服务端按该设备完整视图统计。
// 只读 counts，绝不拿 items.length 冒充总数；读不到就置 null（徽标隐藏）。
async function probeAlertPending() {
  if (state.demoMode || !state.user || !state.gatewayId) { state.alertPending = null; markNavDots(); return; }
  const revision = contextRevision;
  try {
    const data = await api.listAlerts({ limit: 1 }, {gatewayId: state.gatewayId});
    if (revision !== contextRevision) return;
    state.alertPending = alertPendingTotal(data?.counts);
  } catch {
    if (revision === contextRevision) state.alertPending = null;
  }
  markNavDots();
}

const root = () => document.getElementById('app');

// ---------- 连接探测（顶栏指示灯） ----------
let connEl = null;
function setConnection(kind, detail) {
  if (kind === 'online') state.connection = state.demoMode ? 'demo' : 'online';
  else state.connection = 'offline';
  state.connDetail = state.demoMode ? '样例数据' : detail || '';
  if (connEl) paintConnection(connEl);
}
function paintConnection(node) {
  clear(node);
  const map = {
    online: ['ok', '后端已连接'], offline: ['bad', '后端未连接'],
    demo: ['warn', '演示模式（非真实数据）'], unknown: ['unknown', '连接状态未知'],
  };
  const [kind, label] = map[state.connection] || map.unknown;
  node.append(chip(kind, label));
  if (state.connDetail) node.append(el('span', { class: 'muted', text: '· ' + state.connDetail }));
}

// ---------- 登录门（纯前端门槛） ----------
function renderLogin() {
  const username = el('input',{type:'text',autocomplete:'username','aria-label':'管理员账号'});
  const password = el('input',{type:'password',autocomplete:'current-password','aria-label':'密码'});
  const status = el('p',{role:'status',text:state.authNotice || ''});
  const login = button('登录', async () => {
    const revision = contextRevision;
    login.disabled = true; const credentials = {username:username.value,password:password.value}; password.value = '';
    status.textContent = '正在核验服务端会话…';
    try { const session = await api.adminLogin(credentials); if (revision !== contextRevision) {api.clearAdminSession();return;} await enterSession(session); }
    catch { if(revision === contextRevision) status.textContent = '登录未成功，请核对账号、密码与服务端连接。'; }
    finally { login.disabled = false; }
  });
  mount(root(), el('div', { class: 'login-wrap' }, [
    el('div', { class: 'login-card' }, [
      el('h1', { text: '棚安 · 云端管理平台' }),
      el('p', { class: 'sub', text: 'HH-HSP101 → DAYU200 → Ubuntu 云端' }),
      el('label',{class:'field'},['账号',username]), el('label',{class:'field'},['密码',password]), login, status,
      getEnv().ALLOW_LOCAL_DEBUG === true ? button('进入本机调试控制台', () => { resetContext(); state.user = {username:'local-debug',role:'admin'}; state.unlocked = true; render(); }) : null,
      el('p', {class:'login-note',text:'正式访问需要服务端管理会话；密码不在浏览器保存。演示模式只读，不访问真实配置。'}),
      el('p', { class: 'muted login-demo-hint', text: '无需登录也可以：打开演示模式查看界面结构。' }),
      el('div', { class: 'btn-row' }, [button('以演示模式浏览', () => { state.demoMode = true; setPref('ui.demoMode', true); resetContext(); state.unlocked = true; render(); }, { variant: 'secondary' })]),
    ]),
  ]));
}

async function enterSession(session) {
  resetContext(); state.user = session.user; state.demoMode = false; setPref('ui.demoMode',false);
  const revision = contextRevision;
  let devices = [];
  try { const response = await api.listDevices(); devices = Array.isArray(response?.items) ? response.items : []; } catch { /* empty selection remains explicit */ }
  if(revision !== contextRevision) return;
  state.devices = devices; state.gatewayId = devices.some(d=>d.gatewayId===state.gatewayId) ? state.gatewayId : devices[0]?.gatewayId || '';
  state.unlocked = true; render();
  void probeReviewPending(); void probeAlertPending();
}
async function restoreSession() {
  const revision = contextRevision;
  try { const session = await api.adminSession(); if(revision === contextRevision) await enterSession(session); }
  catch { if(revision === contextRevision) {state.unlocked=false;state.user=null;api.clearAdminSession();render();} }
}

// ---------- 主界面 ----------
let mainArea = null, pageHost = null;

function toggleSidebar(forceOpen) {
  const sb = document.getElementById('sidebar');
  const bd = document.getElementById('sidebar-backdrop');
  if (!sb) return;
  const open = typeof forceOpen === 'boolean' ? forceOpen : !sb.classList.contains('open');
  sb.classList.toggle('open', open);
  bd?.classList.toggle('open', open);
}

function renderShell() {
  const navButtons = PAGES.map((p) => el('button', {
    dataset: { page: p.id },
    class: state.page === p.id ? 'active' : '',
    'aria-current': state.page === p.id ? 'page' : null,
    onclick: () => navigate(p.id),
  }, [
    el('span', { text: p.title }),
    // 数量徽标（待审数 / 未处理告警数）：只有确实读到数字时才显示，不显示推测值。
    p.badge ? el('span', {class: 'nav-badge', dataset: {badge: p.badge}, hidden: true}) : null,
  ]));

  const pref=getPref('ui.navCollapsed',{});
  const collapsed=pref&&typeof pref==='object'&&!Array.isArray(pref)?pref:{};
  const sections=renderNavGroups(PAGES,navButtons,{currentPage:state.page,collapsed,onToggle:(name,closed)=>{collapsed[name]=closed;setPref('ui.navCollapsed',collapsed);}});

  const demoToggle = el('button', {
    class: 'nav-demo-toggle', type: 'button',
    onclick: () => {
      state.demoMode = !state.demoMode;
      setPref('ui.demoMode', state.demoMode);
      resetContext();
      if (!state.demoMode && !state.user) {state.unlocked=false;render();restoreSession();return;}
      if (state.demoMode) state.connection = 'demo'; else probeConnection();
      render();
    },
  }, [state.demoMode ? '退出演示模式' : '进入演示模式']);

  mount(root(), el('div', { class: 'app-shell' }, [
    el('div', { class: 'sidebar-backdrop', id: 'sidebar-backdrop', onclick: () => toggleSidebar(false) }),
    el('aside', { class: 'sidebar', id: 'sidebar' }, [
      el('div', { class: 'brand' }, [
        el('div', { class: 'mark', text: '棚' }),
        el('div', {}, [el('div', { class: 'name', text: '棚安管理平台' }), el('div', { class: 'env', text: '构建 ' + getEnv().BUILD })]),
      ]),
      el('nav', { class: 'nav', 'aria-label': '主导航' }, sections),
      el('div', { class: 'foot' }, [
        demoToggle,
        el('button', { type: 'button', onclick: async () => { state.authNotice='';try {if(state.user && state.user.username !== 'local-debug') await api.adminLogout();} catch {state.authNotice='退出请求未确认，请关闭浏览器并核对服务端会话。';} state.user=null;state.unlocked = false; resetContext(); render(); } }, ['退出登录']),
        el('span', { text: 'v0.1.0 · 本地/云同套代码' }),
      ]),
    ]),
    el('div', { class: 'main-col' }, [
      state.demoMode ? el('div', { class: 'demo-ribbon', text: '演示模式：当前展示的是样例数据，未连接真实后端，操作不会保存任何内容' }) : null,
      el('header', { class: 'topbar' }, [
        el('button', { class: 'menu-btn', type: 'button', 'aria-label': '菜单', onclick: () => toggleSidebar() }, ['☰']),
        el('h2', { id: 'page-title', text: '' }),
        (connEl = el('div', { class: 'conn' })),
        el('select',{'aria-label':'当前设备',onchange:event=>{state.gatewayId=event.target.value;resetContext();render();void probeAlertPending();}}, state.devices.map(d=>el('option',{value:d.gatewayId,selected:d.gatewayId===state.gatewayId,text:d.gatewayId}))),
        button('刷新', () => renderPage(), { variant: 'secondary small' }),
      ]),
      (mainArea = el('main', { id: 'main', tabindex: '-1' })),
    ]),
  ]));
  paintConnection(connEl);
}

function navigate(id) {
  state.page = id;
  toggleSidebar(false);
  render();
}

async function renderPage() {
  pageScope?.dispose();
  const scope = new PageScope(); pageScope = scope;
  const demoMode = state.demoMode;
  dataSource = createDataSource({ scope, demoMode, gate, live, gatewayId:state.gatewayId,role:state.user?.role || 'viewer' });
  const page = PAGES.find((p) => p.id === state.page);
  const host = mainArea.querySelector('[data-page-host]') || (() => { const d = el('div', { 'data-page-host': '' }); mainArea.append(d); return d; })();
  const title = document.getElementById('page-title');
  if (title) title.textContent = page.title;
  clear(host);
  const loading = el('div', {}, [spinner(), ' 正在加载…']);
  host.append(loading);
  const ctx = { state, dataSource, scope, gate, live, demoMode, api, demo: DEMO, navigate,
    markStatus: () => { if (scope.active) markNavDots(); },
    setConnection: (...args) => { if (scope.active) setConnection(...args); },
    notify: (kind, text) => { if (scope.active) notify(kind, text); } };
  try {
    const content = await page.render(ctx);
    if (!scope.active || !state.unlocked) return;
    clear(host);
    host.append(content);
  } catch (error) {
    if (!scope.active || !state.unlocked) return;
    clear(host);
    const offline = error && (error.kind === 'offline');
    host.append(el('div', { class: 'banner ' + (offline ? 'bad' : 'warn'), role: 'alert' }, [
      offline ? '后端未连接：无法加载本页真实数据。请确认云端服务已启动，或先在侧栏进入演示模式查看界面。' : ('页面加载失败：' + (error?.message || error)),
    ]));
  }
  markNavDots();
}

let notifyTimer = null;
function notify(kind, text) {
  let box = document.querySelector('.top-notify');
  if (!box) { box = el('div', { class: 'top-notify', role: 'status' }); document.body.append(box); }
  clear(box);
  box.append(el('div', { class: 'banner ' + kind, text }));
  clearTimeout(notifyTimer);
  notifyTimer = setTimeout(() => box.remove(), 6000);
}

function markNavDots() {
  if (!state.demoMode) state.hardwareOnline = live.current()?.hardware.deviceOnline === true;
  // 数量徽标：只在读到真实数字时显示。告警徽标与页面共用同一条渲染路径（applyAlertBadge），
  // 数字来自服务端 counts.open + counts.acknowledged，任一缺失即隐藏，绝不当 0 处理。
  document.querySelectorAll('.nav-badge[data-badge]').forEach((badge) => {
    if (badge.dataset.badge === 'alerts') { applyAlertBadge(badge, state.alertPending); return; }
    const count = state.reviewPending;
    if (Number.isSafeInteger(count) && count > 0) { badge.hidden = false; badge.textContent = String(count); }
    else { badge.hidden = true; badge.textContent = ''; }
  });
}

async function probeConnection() {
  if (state.demoMode) { state.connection = 'demo'; if (connEl) paintConnection(connEl); return; }
  if (probeBusy || document.hidden || !state.unlocked) return;
  const revision = contextRevision; probeBusy = true;
  try { const h = await api.getHealth(); if (revision !== contextRevision) return; state.connection = 'online'; state.health = h; }
  catch { if (revision !== contextRevision) return; state.connection = 'offline'; state.hardwareOnline = false; state.reviewPending = null; state.alertPending = null; live.invalidate(); }
  finally { probeBusy = false; }
  if (connEl) paintConnection(connEl); markNavDots();
  if (state.connection === 'online') { void probeReviewPending(); void probeAlertPending(); }
}

let first = true;
function render() {
  pageScope?.dispose();
  if (!state.unlocked) { renderLogin(); return; }
  if (first) { renderShell(); first = false; renderPage(); return; }
  renderShell();
  renderPage();
}

// 顶栏刷新按钮之外，页面内部轮询统一走这里
export const runtime = { state, get dataSource() { return dataSource; }, setConnection, notify, navigate };

// 顶栏滚动阴影与移动端 Escape 收起侧栏
if (typeof window !== 'undefined') {
  const mainEl = () => document.getElementById('main');
  const topbarEl = () => document.querySelector('.topbar');
  const onScroll = () => {
    const m = mainEl(); const t = topbarEl();
    if (!t) return;
    const scrolled = (window.scrollY || document.documentElement?.scrollTop || m?.scrollTop || 0) > 8;
    t.classList.toggle('scrolled', scrolled);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') toggleSidebar(false);
  });
}

// 启动
render();
if (!state.demoMode) restoreSession();
window.addEventListener('pengan-session-expired', () => { if(state.demoMode)return; state.user=null;state.unlocked=false;resetContext();render(); });
if (!state.demoMode) probeConnection();
window.addEventListener('offline', () => {
  contextRevision++; live.invalidate('网络已断开，当前状态未知'); state.connection = 'offline'; state.hardwareOnline = false; state.alertPending = null;
  pageScope?.dispose(); if (connEl) paintConnection(connEl); markNavDots();
  if (state.unlocked) { clear(mainArea); mainArea.append(el('p', { class: 'banner bad', text: '网络已断开，当前数据与操作结果未确认。恢复后将重新读取，不自动重发写操作。' })); }
});
window.addEventListener('online', () => { if (state.unlocked && !document.hidden) render(); });
document.addEventListener('visibilitychange', () => {
  contextRevision++; pageScope?.dispose(); live.invalidate('页面进入后台，当前状态未确认'); state.hardwareOnline = false; state.alertPending = null;
  if (document.hidden) {
    state.connection = state.demoMode ? 'demo' : 'unknown';
    if (connEl) paintConnection(connEl); markNavDots();
    if (state.unlocked) { clear(mainArea); mainArea.append(el('p', { class: 'muted', text: '页面在后台，恢复后重新核验状态。' })); }
  } else if (state.unlocked) render();
});
// 每 10s 只做轻量健康探测（对齐网关 2s 采集之上、避免刷屏）
setInterval(() => { if (state.unlocked && !state.demoMode) probeConnection(); }, 10_000);
