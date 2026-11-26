/* Redaction, cropping and passwords. Loaded after app.js and pages.js; uses their globals.
 *
 * Redaction is real: every page with a redaction box is redrawn as a picture with the boxes
 * painted black, so the text, images and hidden layers under the boxes are gone from the file
 * (not just covered). The rest of that page's text can no longer be selected; OCR can bring
 * it back. Pages without boxes are not touched.
 */
'use strict';
(function () {
  const ICR = '<rect x="4" y="9" width="16" height="6" rx="1" class="f"/><rect x="4" y="9" width="16" height="6" rx="1"/><path d="M4 5h9M4 19h12"/>';
  const b = document.querySelector('#mk [data-tool="redact"]');
  if (b) b.innerHTML = icon(ICR) + '<span class="lb">' + b.textContent.trim() + '</span>';
  const tb = document.querySelector('#tools .tt [data-t="protect"]');
  TI.protect = '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>';
  TD.protect = ['Password', 'Lock a PDF with a password (AES-256), or take the password off one you can open.'];
  if (tb) tb.innerHTML = icon(TI.protect) + '<span>' + tb.textContent.trim() + '</span>';
})();

/* ---------- redaction ---------- */
function redactUi() {
  const n = V.ann.filter(a => a.type === 'redact').length;
  if (n) toast(n + ' area' + (n > 1 ? 's' : '') + ' marked for redaction', 0, { label: 'Apply redactions', fn: applyRedactions });
  else toast('');
}

async function renderShown(n, dpi) {
  const W = pageW(n), H = pageH(n), s = Math.min(dpi / 72, 4096 / Math.max(W, H));
  const c = document.createElement('canvas'); c.width = Math.round(W * s); c.height = Math.round(H * s);
  const x = c.getContext('2d', { alpha: false }); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
  if (V.native) {
    const bmp = await rawBitmap(await inv('pdf_render', { page: n - 1, width: c.width, prio: 2, raw: true }));
    x.drawImage(bmp, 0, 0, c.width, c.height); bmp.close();
  } else {
    const pg = await V.doc.getPage(n), vp = pg.getViewport({ scale: s });
    await pg.render({ canvasContext: x, viewport: vp }).promise;
  }
  return { c, x, s, W, H };
}

let redacting = false;
async function applyRedactions() {
  const boxes = V.ann.filter(a => a.type === 'redact');
  if (!boxes.length || redacting || !V.doc) return;
  const pgs = [...new Set(boxes.map(a => a.p))].sort((a, b) => a - b);
  if (!window.confirm('Redact ' + boxes.length + ' area(s) on ' + pgs.length + ' page(s)?\n\nThe content under the boxes is removed for good. Those pages become pictures, so their other text can no longer be selected or searched until you run "Text from scan".')) return;
  redacting = true; toast('Redacting…', 0);
  try {
    const base = V.rotBytes || await srcBytes(V.src), pdf = await PDFDocument.load(base, { ignoreEncryption: true });
    if (pdf.isEncrypted) throw Error('remove the password first (Tools, Password)');
    const refMap = new Map();
    for (const n of pgs) {
      const { c, x, s, W, H } = await renderShown(n, 200);
      x.fillStyle = '#000';
      boxes.filter(a => a.p === n).forEach(a => x.fillRect(a.r[0] * s, (H - a.r[3]) * s, (a.r[2] - a.r[0]) * s, (a.r[3] - a.r[1]) * s));
      const jpg = new Uint8Array(await (await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9))).arrayBuffer());
      const oldRef = pdf.getPage(n - 1).ref;
      pdf.removePage(n - 1);
      const np = pdf.insertPage(n - 1, [W, H]);
      refMap.set(oldRef, np.ref);
      np.drawImage(await pdf.embedJpg(jpg), { x: 0, y: 0, width: W, height: H });
      // OCR words under the boxes go too
      const o = V.ocr && V.ocr.pages && V.ocr.pages[n];
      if (o && o.words) o.words = o.words.filter(w => !boxes.some(a => a.p === n && w.b[0] < a.r[2] && w.b[2] > a.r[0] && w.b[1] < a.r[3] && w.b[3] > a.r[1]));
    }
    replaceRefs(pdf, refMap);
    dropUnreachable(pdf);
    // Document info can repeat what was redacted (title, subject); clear the free-text fields.
    ['Title', 'Subject', 'Keywords'].forEach(k => { try { pdf['set' + k](k === 'Keywords' ? [] : ''); } catch (e) { } });
    const out = new Uint8Array(await pdf.save({ useObjectStreams: false }));
    V.ann = V.ann.filter(a => a.type !== 'redact');
    V.pageOps = (V.pageOps || []).concat([{ k: 'raster', pages: pgs, bytes: true }]);
    await reopenBytes(out, pgs[0]);
    V.dirty = true; persist(); updateHistoryUi(); setTool('select');
    toast('Redacted · Save to keep it', 4000);
  } catch (e) { toast('Could not redact: ' + (e && e.message || e), 5000); }
  finally { redacting = false; }
}

/* ---------- crop ---------- */
$('#bCrop').onclick = () => { if (!V.doc) return; setTool('crop'); toast('Drag a box around the part of the page to keep', 3500); };
function cropAsk(n, r) {
  const d = pages()[n - 1]; if (!d) return;
  V._crop = { n, r };
  V.ann.push({ id: -7, type: 'cropbox', p: n, r }); paintAnn(n); V.ann = V.ann.filter(a => a.id !== -7);
  showPop($('#bCrop'), '<div class="pmenu"><button data-crop="one">Crop page ' + n + '</button><button data-crop="all">Crop all ' + V.doc.numPages + ' pages the same</button><button data-crop="no">Cancel</button></div>');
}
$('#pop').addEventListener('click', e => {
  const b = e.target.closest('[data-crop]'); if (!b) return; hidePop();
  const c = V._crop; V._crop = null; setTool('select'); if (!c) return;
  if (b.dataset.crop === 'no') { paintAnn(c.n); return; }
  const pages = b.dataset.crop === 'all' ? 'all' : [c.n];
  pageEdit({ k: 'crop', pages, r: c.r.map(v => Math.round(v * 100) / 100) }, pages === 'all' ? 'Pages cropped' : 'Page ' + c.n + ' cropped');
});

/* ---------- passwords (Tools > Password) ---------- */
const pwMode = () => (document.querySelector('input[name="tpwm"]:checked') || {}).value || 'add';
const _renderTools = renderTools;
renderTools = function () {
  _renderTools();
  const on = tt === 'protect', add = pwMode() === 'add';
  $('#tpwbox').hidden = !on;
  if (!on) return;
  $('#tlvl').hidden = true;
  $('#tpw2').hidden = !add; $('#tpwlim').hidden = !add;
  $('#tpw1').placeholder = add ? 'New password' : 'Current password';
  const useOpen = !tfiles.length && V.doc;
  $('#tpwnote').textContent = !T ? 'Passwords are available in the Windows app.' : useOpen ? 'No file chosen: this uses the open PDF "' + V.src.name + '", with your markup.' : '';
  $('#tgo').textContent = add ? 'Add password' : 'Remove password';
  $('#tgo').disabled = !T || !(tfiles.length || V.doc);
};
$('#tpwbox').addEventListener('change', e => { if (e.target.name === 'tpwm') renderTools(); });

const _go = $('#tgo').onclick;
$('#tgo').onclick = async e => {
  if (tt !== 'protect') return _go(e);
  const msg = $('#tmsg'), add = pwMode() === 'add', pw = $('#tpw1').value;
  if (!pw) { msg.textContent = 'Enter the password.'; return; }
  if (add && pw !== $('#tpw2').value) { msg.textContent = 'The two passwords are not the same.'; return; }
  $('#tgo').disabled = true; msg.textContent = 'Working…'; lastSaved = null;
  try {
    let bytes, name;
    if (tfiles.length) { bytes = new Uint8Array(await tfiles[0].arrayBuffer()); name = tfiles[0].name; }
    else { bytes = add ? await bakedBytes() : await srcBytes(V.src); name = V.src.name; }
    const enc = encodeURIComponent;
    const out = add
      ? await inv('pdf_protect', bytes, { headers: { user: enc(pw), owner: '', printcopy: $('#tpwpc').checked ? '0' : '1' } })
      : await inv('pdf_unlock', bytes, { headers: { password: enc(pw) } });
    await save(out, name.replace(/\.pdf$/i, '') + (add ? '-protected' : '-unlocked') + '.pdf');
    $('#tpw1').value = $('#tpw2').value = '';
    msg.innerHTML = add ? '<b>Done.</b> The copy asks for the password when it is opened. Keep the password safe: it cannot be recovered.' : '<b>Done.</b> The copy opens without a password.';
    if (lastSaved) { msg.insertAdjacentHTML('beforeend', '<div style="margin-top:10px"><button id="tOpen" class="pri">Open file</button></div>'); $('#tOpen').onclick = () => { $('#tools').close(); openSaved(lastSaved); }; }
  } catch (err) {
    const s = String(err && err.message || err);
    msg.textContent = s === 'Save cancelled' ? '' : 'Could not finish: ' + s;
  } finally { $('#tgo').disabled = false; }
};
