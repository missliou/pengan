// Minimal event/DOM host for real page modules. No layout or browser acceptance.
export class TestNode {
  constructor(tag = '#text', text = '') { this.tagName = tag; this.childNodes = []; this.dataset = {}; this.listeners = {}; this._text = text; this.className = ''; this.disabled = false; this._value = ''; }
  get children() { return this.childNodes.filter(n => n.tagName !== '#text'); }
  get classList() { const n = this; return {
    toggle(name, yes) { const items = new Set(n.className.split(/\s+/).filter(Boolean)); const add = yes ?? !items.has(name); if (add) items.add(name); else items.delete(name); n.className = [...items].join(' '); },
  }; }
  get value() { return this.tagName === 'select' ? (this.children.find(n => n.selected) || this.children[0])?.value || '' : this._value; }
  set value(v) { if (this.tagName === 'select') for (const child of this.children) child.selected = child.value === v; this._value = v; }
  get nodeType() { return this.tagName === '#text' ? 3 : 1; }
  get nodeName() { return this.tagName; }
  get nodeValue() { return this._text; }
  set nodeValue(text) { this._text = String(text); }
  get attributes() { return Object.entries({ ...this._attrs, ...(this.className ? { class: this.className } : {}) }).map(([name, value]) => ({ name, value })); }
  getAttribute(key) { return key === 'class' ? this.className || null : this._attrs?.[key] ?? null; }
  hasAttribute(key) { return this.getAttribute(key) !== null; }
  removeAttribute(key) { if (key === 'class') this.className = ''; else { delete this._attrs?.[key]; delete this[key]; } }
  get textContent() { return this._text + this.childNodes.map(n => n.textContent).join(''); }
  set textContent(text) { this._text = this.nodeType === 3 ? String(text) : ''; this.childNodes = this.nodeType === 3 || !text ? [] : [new TestNode('#text', String(text))]; }
  append(...nodes) { this.childNodes.push(...nodes.map(n => n instanceof TestNode ? n : new TestNode('#text', String(n)))); }
  replaceChildren(...nodes) { this.childNodes = []; this._text = ''; this.append(...nodes); }
  setAttribute(key, value) { (this._attrs ||= {})[key] = String(value); if (key === 'class') this.className = String(value); else this[key] = value; }
  replaceChild(fresh, old) { const index = this.childNodes.indexOf(old); if (index < 0) throw Error('Child missing'); this.childNodes[index] = fresh; }
  removeChild(old) { const index = this.childNodes.indexOf(old); if (index < 0) throw Error('Child missing'); this.childNodes.splice(index, 1); }
  addEventListener(name, handler) { (this.listeners[name] ||= []).push(handler); }
  async click() { if (!this.disabled) for (const handler of this.listeners.click || []) await handler({ target: this }); }
}
export function installDom(t) {
  for (const [name, value] of Object.entries({ Node: TestNode, window: { confirm: () => true }, document: {
    createElement: tag => new TestNode(tag), createTextNode: text => new TestNode('#text', text),
  } })) { const old = Object.getOwnPropertyDescriptor(globalThis, name); Object.defineProperty(globalThis, name, { configurable: true, writable: true, value }); t.after(() => old ? Object.defineProperty(globalThis, name, old) : delete globalThis[name]); }
}
export function find(root, predicate) { if (predicate(root)) return root; for (const node of root.childNodes) { const result = find(node, predicate); if (result) return result; } }
export const button = (root, text) => find(root, n => n.tagName === 'button' && n.textContent === text);
export const input = (root, id) => find(root, n => n.id === id);
export const flush = () => new Promise(resolve => setImmediate(resolve));
