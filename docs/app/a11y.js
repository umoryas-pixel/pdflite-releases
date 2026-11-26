/* Accessibility: names for icon buttons, pressed state for tools, announcements, and the text
 * of each page for screen readers. Loaded last; uses app.js globals.
 */
'use strict';
(function () {
  /* Icon-only buttons and unlabeled fields get their tooltip as an accessible name. */
  const visibleText = el => (el.textContent || '').replace(/\s+/g, '');
  function label(root) {
    (root.querySelectorAll ? root : document).querySelectorAll('button,select,input:not([type=hidden]),textarea').forEach(el => {
      if (el.hasAttribute('aria-label') || el.closest('[aria-hidden="true"]')) return;
      if (el.tagName === 'BUTTON' && visibleText(el)) return;
      if (el.id && document.querySelector('label[for="' + el.id + '"]')) return;
      if (el.closest('label')) return;
      const t = el.getAttribute('title') || el.getAttribute('placeholder');
      if (t) el.setAttribute('aria-label', t);
    });
  }
  let q = 0;
  new MutationObserver(ms => {
    // page drawing happens all the time inside the viewer and never adds buttons there
    if (ms.every(m => m.target.closest && m.target.closest('#viewer'))) return;
    if (!q) q = requestAnimationFrame(() => { q = 0; label(document); });
  })
    .observe(document.body, { childList: true, subtree: true });
  label(document);

  /* Announcements: the toast is a live region; dialogs are named by their heading. */
  const t = $('#toast'); if (t) { t.setAttribute('role', 'status'); t.setAttribute('aria-live', 'polite'); }
  document.querySelectorAll('dialog').forEach((d, i) => {
    const h = d.querySelector('h1,h2,h3'); if (!h || d.hasAttribute('aria-labelledby')) return;
    if (!h.id) h.id = 'dlg-h-' + i;
    d.setAttribute('aria-labelledby', h.id);
  });
  const mk = $('#mk'); if (mk) { mk.setAttribute('role', 'toolbar'); mk.setAttribute('aria-label', 'Markup tools'); }
  const th = $('#thumbs'); if (th) { th.setAttribute('role', 'list'); th.setAttribute('aria-label', 'Pages'); }
  const vw = $('#viewer'); if (vw) { vw.tabIndex = 0; vw.setAttribute('role', 'document'); vw.setAttribute('aria-label', 'Document pages. Use Page Up and Page Down to move between pages.'); }

  /* Tool buttons say which one is on. */
  const _setTool = setTool;
  setTool = function (tool) {
    _setTool(tool);
    document.querySelectorAll('#mk [data-tool]').forEach(b => b.setAttribute('aria-pressed', b.classList.contains('on') ? 'true' : 'false'));
  };
  document.querySelectorAll('#mk [data-tool]').forEach(b => b.setAttribute('aria-pressed', b.classList.contains('on') ? 'true' : 'false'));

  /* Page text for screen readers: pages are pictures on a canvas, so each visible page gets a
     visually hidden copy of its text (from the PDF, or from OCR for scans). */
  const SR = 'sr-pg';
  async function textOf(n) {
    if (V.native || (V.ocr && typeof ocrPage === 'function' && ocrPage(n))) {
      const ch = await pageText(n);
      return ch.map(c => c[0]).join('').replace(/[ \t]+/g, ' ').trim();
    }
    if (V.doc && V.doc.getPage) {
      const tc = await (await V.doc.getPage(n)).getTextContent();
      return tc.items.map(i => i.str + (i.hasEOL ? '\n' : ' ')).join('').replace(/[ \t]+/g, ' ').trim();
    }
    return '';
  }
  const io = new IntersectionObserver(es => es.forEach(async e => {
    const d = e.target;
    if (!e.isIntersecting || d.querySelector('.' + SR) || d._srBusy) return;
    d._srBusy = 1;
    const n = +d.dataset.n, doc = V.doc;
    try {
      const txt = await textOf(n);
      if (doc !== V.doc || !d.isConnected) return;
      const s = document.createElement('div');
      s.className = SR; s.setAttribute('role', 'region'); s.setAttribute('aria-label', 'Page ' + n);
      s.textContent = txt || 'This page has no text. Use Tools, Text from scan, to read it.';
      d.appendChild(s);
    } catch (err) { /* no text available */ } finally { d._srBusy = 0; }
  }), { root: vw, rootMargin: '200px 0px' });
  if (vw) new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => { if (n.classList && n.classList.contains('pg')) io.observe(n); })))
    .observe(vw, { childList: true });
})();
