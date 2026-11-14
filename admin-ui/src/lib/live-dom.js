// Patch read-only dashboard trees without remounting cards, focus or animations.
// This deliberately does not reconcile editable form state or replace handlers.
export function syncLiveChildren(parent, next) {
  const before = [...parent.childNodes], after = [...next.childNodes];
  for (let i = 0; i < after.length; i++) {
    const old = before[i], fresh = after[i];
    if (!old) { parent.append(fresh); continue; }
    if (old.nodeType !== fresh.nodeType || old.nodeName !== fresh.nodeName) {
      parent.replaceChild(fresh, old); continue;
    }
    if (old.nodeType === 3) {
      if (old.nodeValue !== fresh.nodeValue) old.nodeValue = fresh.nodeValue;
      continue;
    }
    for (const { name } of [...old.attributes]) {
      if (!fresh.hasAttribute(name)) old.removeAttribute(name);
    }
    for (const { name, value } of [...fresh.attributes]) {
      if (old.getAttribute(name) !== value) old.setAttribute(name, value);
    }
    syncLiveChildren(old, fresh);
  }
  for (let i = after.length; i < before.length; i++) parent.removeChild(before[i]);
}
