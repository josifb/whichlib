// whichlib site: copy buttons, install tabs, and the right address in commands.
(() => {
  'use strict';
  // Commands are written for https://whichlib.com; served from another host
  // (the temporary address before the domain, localhost in dev) they show that origin.
  if (location.origin !== 'https://whichlib.com' && /^https?:/.test(location.origin)) {
    for (const el of document.querySelectorAll('[data-origin]')) el.textContent = el.textContent.replaceAll('https://whichlib.com', location.origin);
  }
  for (const btn of document.querySelectorAll('[data-copy]')) {
    btn.addEventListener('click', async () => {
      const target = document.getElementById(btn.dataset.copy);
      try {
        await navigator.clipboard.writeText(target.textContent.trim());
        btn.textContent = 'Copied';
      } catch {
        btn.textContent = 'Select and copy';
      }
      setTimeout(() => { btn.textContent = 'Copy'; }, 1600);
    });
  }
  for (const list of document.querySelectorAll('[role="tablist"]')) {
    const tabs = [...list.querySelectorAll('[role="tab"]')];
    const select = (tab) => {
      for (const t of tabs) {
        const on = t === tab;
        t.setAttribute('aria-selected', String(on));
        document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
      }
    };
    for (const t of tabs) t.addEventListener('click', () => select(t));
  }
})();
