// v2 feedback primitives (README "Feedback"): toast() replaces alert(), confirm() replaces confirm().
// Hosts live in index.html: #toast-root (popover, so it stacks above open modal dialogs) and #confirm-dialog.
import { dom } from './dom.js';

const TOAST_MS = 4000;
let toastTimer = 0;

function icon(name, size) {
    const span = document.createElement('span');
    span.className = 'gct-toast__icon';
    span.innerHTML = typeof window.gctIconSvg === 'function' ? window.gctIconSvg(name, size) : '';
    return span;
}

function hideToast() {
    clearTimeout(toastTimer);
    dom.toastRoot.replaceChildren();
    dom.toastRoot.hidePopover?.();
}

// One toast at a time; a new one replaces the current. Text is set as text, never HTML.
export function toast({ text, tone, icon: iconName, action } = {}) {
    const root = dom.toastRoot;
    const el = document.createElement('div');
    el.className = 'gct-toast' + (tone ? ' gct-toast--' + tone : '');
    el.setAttribute('role', tone === 'danger' ? 'alert' : 'status');
    el.append(icon(tone === 'success' ? 'check-circle' : tone === 'danger' ? 'alert' : (iconName || 'info'), 18), String(text ?? ''));
    if (action) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'gct-toast__action';
        btn.textContent = action.label;
        btn.addEventListener('click', () => { hideToast(); action.run?.(); });
        el.append(btn);
    }
    clearTimeout(toastTimer);
    root.replaceChildren(el);
    // Re-show so the toast lands on top of any modal opened since the last one.
    root.hidePopover?.();
    root.showPopover?.();
    toastTimer = setTimeout(hideToast, TOAST_MS);
}

// Resolves to the chosen action's value, or null on Escape / scrim click.
export function confirm({ title, body = '', actions = [] }) {
    const dlg = dom.confirmDialog;
    return new Promise((resolve) => {
        let value = null;
        const box = document.createElement('div');
        box.className = 'gct-dialog';
        const h = document.createElement('h2');
        h.className = 'gct-dialog__title';
        h.id = 'confirm-dialog-title';
        h.textContent = title;
        const p = document.createElement('p');
        p.className = 'gct-dialog__body';
        p.textContent = body;
        const list = document.createElement('div');
        list.className = 'gct-dialog__actions';
        for (const a of actions) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'gct-btn gct-btn--' + (a.kind || 'secondary');
            btn.style.width = '100%';
            btn.textContent = a.label;
            // Initial focus on the cancel action, so Enter never triggers a destructive one.
            if (a.value == null) btn.autofocus = true;
            btn.addEventListener('click', () => { value = a.value ?? null; dlg.close(); });
            list.append(btn);
        }
        box.append(h, p, list);
        dlg.replaceChildren(box);
        dlg.onclick = (e) => { if (e.target === dlg) dlg.close(); }; // click on the backdrop
        dlg.onclose = () => { dlg.onclose = null; resolve(value); };
        dlg.showModal();
    });
}
