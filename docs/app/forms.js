/* Filling in PDF forms (AcroForm): text boxes, check boxes, radio buttons, drop-downs and lists.
 *
 * Fields are read with pdf-lib, shown as real inputs laid over the page (placed in percent of
 * the page, so zoom needs no work), and written back into the file on Save. Entries are kept
 * with the unsaved markup until then. Loaded after app.js and uses its globals (V, pageW...).
 */
'use strict';
// pdf-lib is minified, so class names are not usable: test with instanceof.
const FORM_TYPES = [['PDFTextField', 'text'], ['PDFCheckBox', 'check'], ['PDFRadioGroup', 'radio'], ['PDFDropdown', 'drop'], ['PDFOptionList', 'list']];
const formType = fd => { const t = FORM_TYPES.find(([c]) => fd instanceof PDFLib[c]); return t ? t[1] : null; };

/** Inverse of RasmAnnots.viewToUser: PDF user space -> shown page coordinates. */
function userToView(box, rot, p) {
  const { x, y, width: w, height: h } = box;
  switch (((rot % 360) + 360) % 360) {
    case 90: return [p[1] - y, x + w - p[0]];
    case 180: return [x + w - p[0], y + h - p[1]];
    case 270: return [y + h - p[1], p[0] - x];
    default: return [p[0] - x, p[1] - y];
  }
}

/** Reads the form of the open document. Leaves V.form null when there is none. */
async function formLoad(bytes) {
  V.form = null;
  let pdf;
  try { pdf = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false }); } catch (e) { return; }
  if (pdf.isEncrypted) return;
  let form, fields;
  try { form = pdf.getForm(); fields = form.getFields(); } catch (e) { return; }
  if (!fields.length) return;
  const { PDFName, PDFArray, PDFDict } = PDFLib;
  const pageOf = new Map();
  pdf.getPages().forEach((pg, i) => {
    const arr = pg.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    if (arr) for (let j = 0; j < arr.size(); j++) { const d = arr.lookupMaybe(j, PDFDict); if (d) pageOf.set(d, i); }
  });
  const out = [];
  for (const fd of fields) {
    const type = formType(fd);
    if (!type) continue;
    const f = { name: fd.getName(), type, readOnly: fd.isReadOnly(), widgets: [] };
    try {
      if (type === 'text') { f.value = fd.getText() || ''; f.multi = fd.isMultiline(); f.max = fd.getMaxLength(); f.secret = fd.isPassword(); }
      else if (type === 'check') f.value = fd.isChecked();
      else if (type === 'radio') { f.value = fd.getSelected() || ''; f.options = fd.getOptions(); }
      else { f.options = fd.getOptions(); const s = fd.getSelected(); f.value = type === 'list' ? s : (s[0] || ''); f.multiSel = type === 'list' && fd.isMultiselect(); }
    } catch (e) { continue; }
    const ws = fd.acroField.getWidgets();
    ws.forEach((w, k) => {
      const pi = pageOf.get(w.dict);
      if (pi == null) return;
      const page = pdf.getPage(pi), r = w.getRectangle(), box = page.getCropBox(), rot = page.getRotation().angle;
      const a = userToView(box, rot, [r.x, r.y]), b = userToView(box, rot, [r.x + r.width, r.y + r.height]);
      let on = null;
      if (type === 'radio') on = f.options[k] != null ? f.options[k] : String(k);
      f.widgets.push({ p: pi + 1, r: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])], on });
    });
    if (f.widgets.length) out.push(f);
  }
  if (out.length) V.form = { fields: out, values: {} };
}

const formDirty = () => !!(V.form && Object.keys(V.form.values).length);
const formVal = f => (V.form.values[f.name] !== undefined ? V.form.values[f.name] : f.value);

function formSet(name, v) {
  if (!V.form) return;
  V.form.values[name] = v;
  V.dirty = true; persist();
  // other widgets of the same field show the new value
  const f = V.form.fields.find(x => x.name === name);
  if (f && f.widgets.length > 1) f.widgets.forEach(w => formPaint(w.p));
}

/** Draws the inputs of page n (called when pages are built and after a value changes elsewhere). */
function formPaint(n) {
  const d = pages()[n - 1];
  if (!d) return;
  let lay = d.querySelector('.fm');
  if (!V.form) { if (lay) lay.remove(); return; }
  const W = pageW(n), H = pageH(n), pc = v => (+v.toFixed(4)) + '%';
  const here = [];
  V.form.fields.forEach(f => f.widgets.forEach((w, k) => { if (w.p === n) here.push([f, w, k]); }));
  if (!here.length) { if (lay) lay.remove(); return; }
  if (!lay) { lay = document.createElement('div'); lay.className = 'fm'; d.appendChild(lay); }
  lay.innerHTML = '';
  for (const [f, w] of here) {
    const r = w.r, v = formVal(f);
    let el;
    if (f.type === 'text') {
      el = document.createElement(f.multi ? 'textarea' : 'input');
      if (!f.multi) el.type = f.secret ? 'password' : 'text';
      el.value = v || '';
      if (f.max) el.maxLength = f.max;
      el.oninput = () => formSet(f.name, el.value);
      el.style.fontSize = Math.max(8, Math.min(14, (r[3] - r[1]) * 0.62)) * V.scale + 'px';
    } else if (f.type === 'check') {
      el = document.createElement('input'); el.type = 'checkbox'; el.checked = !!v;
      el.onchange = () => formSet(f.name, el.checked);
    } else if (f.type === 'radio') {
      el = document.createElement('input'); el.type = 'radio'; el.name = 'rf-' + f.name; el.checked = v === w.on;
      el.onchange = () => { if (el.checked) formSet(f.name, w.on); };
    } else {
      el = document.createElement('select');
      if (f.multiSel) el.multiple = true;
      if (f.type === 'drop') el.append(new Option('', ''));
      f.options.forEach(o => el.append(new Option(o, o, false, Array.isArray(v) ? v.includes(o) : v === o)));
      el.onchange = () => formSet(f.name, f.type === 'list' ? [...el.selectedOptions].map(o => o.value) : el.value);
    }
    el.className = 'ff ff-' + f.type;
    el.disabled = !!f.readOnly;
    el.title = f.name;
    el.setAttribute('aria-label', f.name);
    Object.assign(el.style, { left: pc(r[0] / W * 100), top: pc((H - r[3]) / H * 100), width: pc((r[2] - r[0]) / W * 100), height: pc((r[3] - r[1]) / H * 100) });
    lay.appendChild(el);
  }
}
const formPaintAll = () => { if (V.form) for (let n = 1; n <= V.doc.numPages; n++) formPaint(n); else document.querySelectorAll('#viewer .fm').forEach(e => e.remove()); };

/** Writes the entries into `pdf` (pdf-lib) before saving. */
async function formApply(pdf) {
  const form = pdf.getForm();
  let plain = true;
  for (const [name, v] of Object.entries(V.form.values)) {
    let fd;
    try { fd = form.getField(name); } catch (e) { continue; }
    const t = formType(fd);
    try {
      if (t === 'text') { fd.setText(v || ''); if (/[^\x00-\xff]/.test(v || '')) plain = false; }
      else if (t === 'check') v ? fd.check() : fd.uncheck();
      else if (t === 'radio') { if (v) fd.select(v); else fd.clear(); }
      else if (t === 'drop') { if (v) fd.select(v); else fd.clear(); }
      else if (t === 'list') { if (v && v.length) fd.select(v); else fd.clear(); }
    } catch (e) { /* option no longer valid: leave the field as it was */ }
  }
  // The standard PDF fonts cannot draw Arabic and other scripts: let the reader draw those fields.
  if (!plain) {
    form.acroForm.dict.set(PDFLib.PDFName.of('NeedAppearances'), PDFLib.PDFBool.True);
    return { updateFieldAppearances: false };
  }
  try { form.updateFieldAppearances(); } catch (e) { form.acroForm.dict.set(PDFLib.PDFName.of('NeedAppearances'), PDFLib.PDFBool.True); }
  return {};
}
