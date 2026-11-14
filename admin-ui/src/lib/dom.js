// 轻量 DOM 构建。约定：字符串一律走 textContent，绝不把后端文本塞进 innerHTML，
// 防注入优先于省事。只有本文件内手写的静态结构才允许少量模板字符串。

export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = String(v);
    else if (k === 'html') {
      // 仅限本仓库内静态字符串使用；任何外部数据禁止走这里。
      node.innerHTML = v;
    } else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'disabled' || k === 'checked' || k === 'selected') node[k] = Boolean(v);
    else if (k === 'value') node.value = String(v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const child of (Array.isArray(children) ? children : [children])) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function clear(node) { node.replaceChildren(); }
export function mount(container, ...nodes) { clear(container); container.append(...nodes); }

// 常用小组件
export const chip = (kind, text) => el('span', { class: 'chip ' + kind, text });
export const spinner = () => el('span', { class: 'spinner', 'aria-hidden': 'true' });
export const skeleton = (rows = 3) => el('div', { 'aria-hidden': 'true' }, Array.from({ length: rows }, () => el('div', { class: 'skeleton' })));

export function banner(kind, text) { return el('div', { class: 'banner ' + kind, role: kind === 'bad' ? 'alert' : 'status' }, [text]); }

export function emptyState(title, hint) {
  return el('div', { class: 'empty' }, [el('div', { class: 'big', text: '◌' }), el('div', { text: title }), hint ? el('div', { class: 'muted', text: hint }) : null]);
}

export function sectionCard(title, sub, ...body) {
  return el('section', { class: 'card' }, [
    el('h3', { text: title }),
    sub ? el('p', { class: 'card-sub', text: sub }) : null,
    ...body,
  ]);
}

export function statCard(label, valueNode, detail) {
  return el('section', { class: 'card stat' }, [
    el('div', { class: 'label', text: label }),
    el('div', { class: 'value' }, [valueNode]),
    detail ? el('div', { class: 'detail', text: detail }) : null,
  ]);
}

export function button(label, onClick, opts = {}) {
  return el('button', { class: 'btn ' + (opts.variant || ''), type: 'button', disabled: opts.disabled, onclick: onClick, title: opts.title }, [label]);
}
