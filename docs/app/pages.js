/* Page organizer: move, delete, rotate and insert pages from the thumbnails.
 *
 * Every change is an operation applied to the working copy of the PDF (V.rotBytes) with
 * pdf-lib, then the document is reopened from those bytes. Markup, OCR results and
 * calibrations follow their pages. The list of operations is kept with the unsaved markup and
 * replayed when the file is opened again, until the user saves.
 * Loaded after app.js and uses its globals.
 */
'use strict';

/** Applies one operation to a pdf-lib document. */
async function pageOpApply(pdf, op) {
  const N = pdf.getPageCount();
  switch (op.k) {
    case 'move': {
      if (op.from < 1 || op.from > N || op.to < 1 || op.to > N || op.from === op.to) return;
      const pg = pdf.getPage(op.from - 1);
      pdf.removePage(op.from - 1);
      pdf.insertPage(op.to - 1, pg);
      return;
    }
    case 'del':
      if (N > 1 && op.n >= 1 && op.n <= N) pdf.removePage(op.n - 1);
      return;
    case 'rot': {
      const pg = pdf.getPage(op.n - 1);
      if (pg) pg.setRotation(degrees((((pg.getRotation().angle + op.deg) % 360) + 360) % 360));
      return;
    }
    case 'blank':
      pdf.insertPage(op.after, [op.w || 595.28, op.h || 841.89]);
      return;
    case 'crop': {
      // op.r is in shown-page coordinates; each page gets the same box, clipped to the page.
      const list = op.pages === 'all' ? pdf.getPageIndices().map(i => i + 1) : op.pages;
      for (const n of list) {
        const pg = pdf.getPage(n - 1); if (!pg) continue;
        const box = pg.getCropBox(), rot = pg.getRotation().angle, sw = rot % 180 ? box.height : box.width, sh = rot % 180 ? box.width : box.height;
        const r = [Math.max(0, op.r[0]), Math.max(0, op.r[1]), Math.min(sw, op.r[2]), Math.min(sh, op.r[3])];
        if (r[2] - r[0] < 1 || r[3] - r[1] < 1) continue;
        const m = RasmAnnots.viewToUser(box, rot), P = q => [m[0] * q[0] + m[2] * q[1] + m[4], m[1] * q[0] + m[3] * q[1] + m[5]];
        const a = P([r[0], r[1]]), b = P([r[2], r[3]]);
        pg.setCropBox(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
      }
      return;
    }
    case 'raster': return; // redaction: already in the bytes, cannot be replayed
    case 'ins': {
      let bytes = op.bytes;
      if (!bytes && op.path && T) bytes = new Uint8Array(await inv('read_file', { path: op.path }));
      if (!bytes) throw Error('the inserted file is no longer available');
      const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
      if (src.isEncrypted) throw Error('password-protected PDFs cannot be inserted');
      const got = await pdf.copyPages(src, src.getPageIndices());
      got.forEach((p, i) => pdf.insertPage(op.after + i, p));
      op.count = got.length;
      return;
    }
  }
}

/* Points every reference to an old page at its replacement (bookmarks, links, named destinations). */
function replaceRefs(pdf, map) {
  const { PDFDict, PDFArray, PDFRef, PDFStream } = PDFLib;
  const seen = new Set();
  const fix = o => {
    if (!o || seen.has(o)) return; seen.add(o);
    if (o instanceof PDFDict) o.entries().forEach(([k, v]) => { if (v instanceof PDFRef && map.has(v)) o.set(k, map.get(v)); else if (!(v instanceof PDFRef)) fix(v); });
    else if (o instanceof PDFArray) for (let i = 0; i < o.size(); i++) { const v = o.get(i); if (v instanceof PDFRef && map.has(v)) o.set(i, map.get(v)); else if (!(v instanceof PDFRef)) fix(v); }
    else if (o instanceof PDFStream) fix(o.dict);
  };
  for (const [, obj] of pdf.context.enumerateIndirectObjects()) fix(obj);
}
/* pdf-lib writes every object it holds, used or not: drop what the document no longer reaches,
   so the removed pages' text and pictures are really gone from the saved file. */
function dropUnreachable(pdf) {
  const { PDFDict, PDFArray, PDFRef, PDFStream } = PDFLib;
  const ctx = pdf.context, seen = new Set(), stack = [];
  const push = v => { if (v instanceof PDFRef) { if (!seen.has(v)) { seen.add(v); const o = ctx.lookup(v); if (o) stack.push(o); } } else if (v && typeof v === 'object') stack.push(v); };
  const t = ctx.trailerInfo; [t.Root, t.Info, t.Encrypt].forEach(push);
  while (stack.length) {
    const o = stack.pop();
    if (o instanceof PDFDict) o.entries().forEach(([, v]) => push(v));
    else if (o instanceof PDFArray) o.asArray().forEach(push);
    else if (o instanceof PDFStream) push(o.dict);
  }
  for (const [ref] of ctx.enumerateIndirectObjects()) if (!seen.has(ref)) ctx.delete(ref);
}

/** Where page n (1-based) ends up after op, or 0 when it is deleted. */
function pageOpMap(op, n, total) {
  switch (op.k) {
    case 'move': {
      if (n === op.from) return op.to;
      if (op.from < op.to && n > op.from && n <= op.to) return n - 1;
      if (op.from > op.to && n >= op.to && n < op.from) return n + 1;
      return n;
    }
    case 'del': return total <= 1 ? n : n === op.n ? 0 : n > op.n ? n - 1 : n;
    case 'blank': return n > op.after ? n + 1 : n;
    case 'ins': return n > op.after ? n + (op.count || 0) : n;
    default: return n;
  }
}

function remapAfter(op, total) {
  if (op.k === 'crop') {
    // the shown page now starts at the crop box's corner
    const hit = n => op.pages === 'all' || op.pages.includes(n), dx = -Math.max(0, op.r[0]), dy = -Math.max(0, op.r[1]);
    V.ann = V.ann.map(a => hit(a.p) ? moveAnn(a, dx, dy) : a);
    return;
  }
  const m = n => pageOpMap(op, n, total);
  V.ann = V.ann.filter(a => m(a.p)).map(a => ({ ...a, p: m(a.p) }));
  if (V.cal && V.cal.pages) { const np = {}; for (const [k, v] of Object.entries(V.cal.pages)) { const t = m(+k); if (t) np[t] = v; } V.cal.pages = np; }
  if (V.ocr && V.ocr.pages) { const np = {}; for (const [k, v] of Object.entries(V.ocr.pages)) { const t = m(+k); if (t) np[t] = v; } V.ocr.pages = np; }
}

/** Reopens the document from bytes (page structure changed). */
async function reopenBytes(out, keepPage) {
  let sizes = null, doc, b;
  if (V.native) { sizes = await inv('pdf_open_bytes', out, { headers: { key: encodeURIComponent(tkey(V.src)) } }); doc = { numPages: sizes.length, native: true }; b = { width: sizes[0][0], height: sizes[0][1] }; }
  else { doc = await pj().getDocument({ data: out.slice() }).promise; const vp = (await doc.getPage(1)).getViewport({ scale: 1 }); b = { width: vp.width, height: vp.height }; }
  if (V.doc && V.doc.destroy) V.doc.destroy();
  Object.assign(V, { doc, sizes, base: b, rotBytes: out, sel: null, hits: [], hi: -1, selId: null, undo: [], redo: [] });
  V.cache.clear();
  $('#pn').textContent = doc.numPages;
  if (V.form) { const vals = V.form.values; await formLoad(out); if (V.form) V.form.values = vals; }
  fitScale(); build(); buildSide(); goTo(Math.min(keepPage || 1, doc.numPages));
}

let pageBusy = false;
async function pageEdit(op, label) {
  if (!V.doc || !V.src || licLocked || pageBusy) return;
  pageBusy = true;
  try {
    const base = V.rotBytes || await srcBytes(V.src), pdf = await PDFDocument.load(base, { ignoreEncryption: true });
    if (pdf.isEncrypted) { toast('Password-protected PDFs cannot be changed here', 3500); return; }
    const total = pdf.getPageCount();
    if (op.k === 'del' && total <= 1) { toast('A PDF needs at least one page', 2500); return; }
    await pageOpApply(pdf, op);
    if (op.k === 'del') dropUnreachable(pdf); // a deleted page's content must not stay in the file
    const out = new Uint8Array(await pdf.save({ useObjectStreams: false }));
    remapAfter(op, total);
    V.pageOps = (V.pageOps || []).concat([op]);
    const keep = op.k === 'move' ? op.to : op.k === 'del' ? Math.max(1, op.n - 1) : op.k === 'blank' || op.k === 'ins' ? op.after + 1 : op.k === 'crop' ? V.cur : op.n;
    await reopenBytes(out, keep);
    V.dirty = true; persist(); updateHistoryUi();
    toast(label + ' · Save to keep it in the PDF', 3000);
  } catch (e) { toast('Could not change the pages: ' + (e && e.message || e), 4500); }
  finally { pageBusy = false; }
}

/* Replays the stored operations on freshly opened bytes. Returns the new bytes, or null. */
async function pageOpsReplay(bytes, ops) {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
  if (pdf.isEncrypted) return null;
  for (const op of ops) await pageOpApply(pdf, op);
  if (ops.some(o => o.k === 'del')) dropUnreachable(pdf);
  return new Uint8Array(await pdf.save({ useObjectStreams: false }));
}

async function insertFromFile(after) {
  let op = null;
  if (T) {
    const p = await inv('pick_pdf');
    if (p) op = { k: 'ins', after, path: p };
  } else {
    const f = await new Promise(res => { const i = document.createElement('input'); i.type = 'file'; i.accept = '.pdf,application/pdf'; i.onchange = () => res(i.files[0] || null); i.click(); });
    if (f) op = { k: 'ins', after, bytes: new Uint8Array(await f.arrayBuffer()), name: f.name };
  }
  if (op) pageEdit(op, 'Pages inserted');
}

function pageMenu(n, anchor) {
  const N = V.doc.numPages;
  showPop(anchor, '<div class="pmenu">' +
    '<button data-po="rl">Rotate left</button><button data-po="rr">Rotate right</button>' +
    (n > 1 ? '<button data-po="up">Move up</button>' : '') + (n < N ? '<button data-po="dn">Move down</button>' : '') +
    '<button data-po="blank">Insert blank page after</button><button data-po="ins">Insert pages from a PDF after…</button>' +
    (N > 1 ? '<button data-po="del" class="danger">Delete page</button>' : '') + '</div>');
  $('#pop').dataset.page = n;
}
function pageMenuAct(act, n) {
  const [w, h] = [pageW(n), pageH(n)];
  if (act === 'rl' || act === 'rr') return pageEdit({ k: 'rot', n, deg: act === 'rl' ? -90 : 90 }, 'Page ' + n + ' rotated');
  if (act === 'up') return pageEdit({ k: 'move', from: n, to: n - 1 }, 'Page moved');
  if (act === 'dn') return pageEdit({ k: 'move', from: n, to: n + 1 }, 'Page moved');
  if (act === 'blank') return pageEdit({ k: 'blank', after: n, w, h }, 'Blank page added');
  if (act === 'ins') return insertFromFile(n);
  if (act === 'del') return pageEdit({ k: 'del', n }, 'Page ' + n + ' deleted');
}

/* thumbnails: right-click or the ⋯ button for the menu, drag to reorder, keys when focused */
(function () {
  const th = $('#thumbs');
  th.addEventListener('contextmenu', e => { const t = e.target.closest('.th'); if (!t || !V.doc) return; e.preventDefault(); pageMenu(+t.dataset.n, t); });
  th.addEventListener('click', e => { const b = e.target.closest('.thm'); if (!b) return; e.stopPropagation(); const t = b.closest('.th'); if (!$('#pop').hidden && $('#pop').dataset.page === t.dataset.n) { hidePop(); return; } pageMenu(+t.dataset.n, b); }, true);
  $('#pop').addEventListener('click', e => { const b = e.target.closest('[data-po]'); if (!b) return; hidePop(); pageMenuAct(b.dataset.po, +$('#pop').dataset.page); });
  let from = 0;
  th.addEventListener('dragstart', e => { const t = e.target.closest('.th'); if (!t) return; from = +t.dataset.n; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(from)); t.classList.add('drag'); });
  th.addEventListener('dragend', e => { const t = e.target.closest('.th'); if (t) t.classList.remove('drag'); th.querySelectorAll('.drop-b,.drop-a').forEach(x => x.classList.remove('drop-b', 'drop-a')); });
  const target = e => { const t = e.target.closest('.th'); if (!t) return null; const r = t.getBoundingClientRect(); return { t, after: e.clientY > r.top + r.height / 2 }; };
  th.addEventListener('dragover', e => { if (!from) return; const g = target(e); if (!g) return; e.preventDefault(); th.querySelectorAll('.drop-b,.drop-a').forEach(x => x.classList.remove('drop-b', 'drop-a')); g.t.classList.add(g.after ? 'drop-a' : 'drop-b'); });
  th.addEventListener('drop', e => {
    const g = target(e); if (!from || !g) return; e.preventDefault();
    const n = +g.t.dataset.n; let to = g.after ? n + 1 : n; if (to > from) to--;
    const f = from; from = 0;
    if (to !== f) pageEdit({ k: 'move', from: f, to }, 'Page moved');
  });
  th.addEventListener('keydown', e => {
    const t = e.target.closest('.th'); if (!t || !V.doc) return; const n = +t.dataset.n;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goTo(n); }
    else if (e.key === 'Delete') { e.preventDefault(); pageMenuAct('del', n); }
    else if (e.altKey && e.key === 'ArrowUp' && n > 1) { e.preventDefault(); pageMenuAct('up', n); }
    else if (e.altKey && e.key === 'ArrowDown' && n < V.doc.numPages) { e.preventDefault(); pageMenuAct('dn', n); }
    else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); pageMenu(n, t); }
  });
})();
