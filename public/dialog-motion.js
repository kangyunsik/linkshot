// One transition owner for native dialogs: focus trapping, Esc, nested modals
// and preview cleanup still use the browser's real open/close lifecycle.
export class DialogMotion {
  constructor() {
    this.versions = new WeakMap(); this.exits = new WeakMap();
    for (const dialog of document.querySelectorAll('dialog')) {
      this.layout(dialog);
      const title = dialog.querySelector('h2');
      if (title) { title.id ||= `${dialog.id}-heading`; dialog.setAttribute('aria-labelledby', title.id); }
      dialog.addEventListener('cancel', (event) => { event.preventDefault(); if (!dialog.hasAttribute('data-persistent')) this.close(dialog); });
      dialog.addEventListener('close', () => { if (!dialog.open) { this.cancel(dialog); this.exits.delete(dialog); delete dialog.dataset.motion; } });
      dialog.addEventListener('click', (event) => {
        if (event.target.closest('[data-close]')) { this.close(dialog); return; }
        if (event.target !== dialog || dialog.hasAttribute('data-persistent')) return;
        const rect = dialog.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) this.close(dialog);
      });
    }
  }
  layout(dialog) {
    if (dialog.dataset.dialogLayout) return;
    dialog.dataset.dialogLayout = 'true';
    const form = dialog.querySelector(':scope > form');
    const frame = form?.querySelector(':scope > .dialog-heading') ? form : dialog;
    if (frame !== dialog) frame.classList.add('dialog-form-layout');
    const children = [...frame.children], heading = children.find((node) => node.classList.contains('dialog-heading')), footer = children.find((node) => node.classList.contains('dialog-footer'));
    const body = document.createElement('div'); body.className = 'dialog-body';
    for (const node of [...frame.childNodes]) if (node !== heading && node !== footer) body.append(node);
    if (heading) frame.append(heading); frame.append(body); if (footer) frame.append(footer);
  }
  cancel(dialog) { this.versions.set(dialog, (this.versions.get(dialog) || 0) + 1); for (const animation of dialog.getAnimations()) animation.cancel(); return this.versions.get(dialog); }
  show(dialog) {
    if (dialog.open && dialog.dataset.motion !== 'closing') return;
    const interrupted = dialog.open ? { opacity: getComputedStyle(dialog).opacity, transform: getComputedStyle(dialog).transform } : null;
    this.exits.delete(dialog);
    const version = this.cancel(dialog); if (!dialog.open) dialog.showModal(); dialog.dataset.motion = 'opening';
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { delete dialog.dataset.motion; return; }
    const animation = dialog.animate([interrupted || { opacity: 0, transform: 'translateY(18px) scale(.975)' }, { opacity: 1, transform: 'translateY(0) scale(1)' }], { duration: 240, easing: 'cubic-bezier(.16,1,.3,1)' });
    animation.finished.catch(() => {}).then(() => { if (this.versions.get(dialog) === version) delete dialog.dataset.motion; });
  }
  close(dialog, immediate = false) {
    if (!dialog.open) return Promise.resolve();
    if (!immediate && dialog.dataset.motion === 'closing' && this.exits.has(dialog)) return this.exits.get(dialog);
    const current = { opacity: getComputedStyle(dialog).opacity, transform: getComputedStyle(dialog).transform };
    const version = this.cancel(dialog);
    if (immediate || matchMedia('(prefers-reduced-motion: reduce)').matches) { dialog.close(); return Promise.resolve(); }
    dialog.dataset.motion = 'closing';
    const exit = dialog.animate([current, { opacity: 0, transform: 'translateY(10px) scale(.985)' }], { duration: 160, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' }).finished.catch(() => {}).then(() => { if (this.versions.get(dialog) === version) dialog.close(); });
    this.exits.set(dialog, exit); return exit;
  }
  closeAll() { for (const dialog of document.querySelectorAll('dialog[open]')) this.close(dialog, true); }
}
