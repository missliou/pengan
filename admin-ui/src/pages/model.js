import { el, chip, sectionCard, banner, button, skeleton } from '../lib/dom.js';
import { fmtDateTime, fmtAiError } from '../lib/format.js';
import { ModelEditor } from '../lib/model-editor.js';

export default async function renderModel(ctx) {
  const wrap = el('div'), stateHost = el('div'), formHost = el('div'), result = el('div');
  const editor = new ModelEditor(ctx);
  let keyInput = null;
  wrap.append(stateHost, formHost, result);
  ctx.scope.onDispose(() => { if (keyInput) keyInput.value = ''; });
  function paint() {
    if (!ctx.scope.active) return;
    const cfg = editor.config, st = editor.status, cc = st?.connectionCheck;
    const known = typeof st?.configured === 'boolean';
    ctx.state.modelConfigured = known ? st.configured : null;
    ctx.markStatus();
    stateHost.replaceChildren(sectionCard('当前配置状态', ctx.demoMode ? '演示样例：不读取真实配置、不保存、不调用模型。' : '配置、上次测试结果、当前服务状态分别显示。',
      ...editor.errors.map(text => banner('bad', text)),
      el('dl', { class: 'kv' }, [
        el('dt', { text: '配置' }), el('dd', {}, [chip(known ? st.configured ? 'ok' : 'warn' : 'unknown', known ? st.configured ? '已配置' : '未配置' : '未知／未确认')]),
        el('dt', { text: '服务商 / 模型' }), el('dd', { text: st ? `${st.provider || '未设置'} / ${st.model || '未设置'}` : '未知' }),
        el('dt', { text: '密钥' }), el('dd', { text: cfg ? cfg.keySaved ? '服务器已保存（不回显）' : '无已保存密钥' : '未知／未读取' }),
        el('dt', { text: '上次连接测试' }), el('dd', {}, [chip(cc?.state === 'passed' ? 'ok' : cc?.state === 'failed' ? 'bad' : 'unknown', cc?.state === 'passed' ? '上次通过' : cc?.state === 'failed' ? '上次失败' : '尚未确认'), cc?.checkedAt ? ' · ' + fmtDateTime(cc.checkedAt) : '']),
      ])));
    if (editor.busy) return;
    const blocked = ctx.demoMode || ctx.gate.busy || ctx.state.user?.role === 'viewer';
    const provider = el('select', { id: 'f-provider' }, ['deepseek','qwen'].map(name => el('option', { value: name, selected: name === cfg?.provider, text: name === 'qwen' ? '阿里云百炼 / 通义千问' : 'DeepSeek' })));
    const model = el('input', { id: 'f-model', type: 'text', value: cfg?.model || '', maxlength: '150', placeholder: '例如 deepseek-chat' });
    const workspace = el('input', { id: 'f-workspace', type: 'text', value: cfg?.workspaceId || '', maxlength: '64', placeholder: '千问北京工作空间ID（可选）' });
    if (keyInput) keyInput.value = '';
    keyInput = el('input', { id: 'f-key', type: 'password', autocomplete: 'new-password', maxlength: '500', placeholder: cfg?.keySaved ? '留空保留同一服务商密钥' : '填写密钥' });
    const inputs = [provider, model, workspace, keyInput];
    for (const input of inputs) input.disabled = blocked;
    const buttons = [];
    function lock() { for (const item of [...buttons, ...inputs]) item.disabled = true; }
    async function execute(kind) {
      if (!ctx.scope.active || editor.busy || blocked) return;
      if (kind === 'clear' && !window.confirm('只清除服务器当前已保存配置的密钥，未保存的表单不会提交。确认继续？')) return;
      const draft = { provider: provider.value, model: model.value, workspaceId: workspace.value, key: keyInput.value };
      keyInput.value = ''; lock();
      result.replaceChildren(banner('info', '正在处理，结果尚未确认；请勿重复提交。'));
      try {
        const pending = editor.perform(kind, draft); paint();
        const out = await pending;
        if (!ctx.scope.active) return;
        const detail = out.kind === 'test' ? `模型测试通过：${out.result.provider} / ${out.result.model}，${out.result.roundTripMs}ms；仅代表这一次合成请求。` : out.kind === 'clear' ? '服务器已确认清除密钥。' : '服务器已确认保存配置，旧测试结果已作废。';
        result.replaceChildren(banner(out.refreshed ? 'ok' : 'warn', detail + (out.refreshed ? '' : '配置重读失败，请刷新核对。')));
      } catch (error) {
        if (ctx.scope.active) result.replaceChildren(banner('bad', '操作未确认：' + (error.message || fmtAiError(error.code)) + '；请刷新配置核对，不自动重发。'));
      } finally { if (ctx.scope.active) paint(); }
    }
    buttons.push(button('保存配置', () => execute('save'), { disabled: blocked || !cfg?.csrfToken }),
      button('清除密钥', () => execute('clear'), { variant: 'danger', disabled: blocked || !cfg?.keySaved }),
      button('手动连接测试', () => execute('test'), { variant: 'ghost', disabled: blocked || !st?.configured || !cfg?.csrfToken }));
    const reload = button('刷新配置', async () => {
      if (editor.busy) return;
      reload.disabled = true;
      try { await editor.load(); } catch { /* disposed context */ }
      if (ctx.scope.active) paint();
    }, { variant: 'secondary' });
    formHost.replaceChildren(sectionCard('模型配置', blocked ? ctx.demoMode ? '演示模式仅浏览，所有写入和模型测试均禁用。' : ctx.state.user?.role === 'viewer' ? '当前账号只有浏览权限，配置修改和模型测试需要管理员。' : '上一项服务器操作尚未结束，请等待后刷新。' : '密钥只在提交请求中传递，服务器已存密钥不回显。',
      el('div', { class: 'grid cols-2' }, [field('服务商', provider), field('模型名', model), field('工作空间（仅千问）', workspace), field('密钥', keyInput)]),
      el('div', { class: 'btn-row' }, [...buttons, reload])));
  }
  stateHost.append(skeleton(3));
  await editor.load();
  if (ctx.scope.active) paint();
  return wrap;
}
function field(label, input) { return el('label', { class: 'field' }, [el('span', { text: label }), input]); }
