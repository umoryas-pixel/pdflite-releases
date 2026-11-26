/* Markup <-> real PDF annotations.
 *
 * Rasm keeps markup in page coordinates as the page is shown (points, origin bottom-left,
 * after the page's /Rotate). On save each mark becomes a standard PDF annotation (Highlight,
 * Underline, StrikeOut, Ink, Line, Square, Circle, FreeText, Stamp, PolyLine, Polygon) with its
 * own appearance stream, so Acrobat, Edge, Chrome and phones show it, and people can select,
 * move or delete it there. The text under a highlight stays selectable.
 *
 * Every annotation Rasm writes also carries /RasmAnn: the mark exactly as Rasm stores it.
 * When Rasm opens the file again those annotations are taken out of the page (so the engine
 * does not draw them twice) and turned back into editable markup.
 *
 * Works in the page (window.RasmAnnots) and in Node tests (globalThis.RasmAnnots).
 */
(function (g) {
  'use strict';
  const L = () => g.PDFLib;
  const KEY = 'RasmAnn', CAL = 'RasmCal', MARKER = '/' + KEY;
  const VERSION = 1;

  const n2 = v => (Math.round(v * 1000) / 1000).toString();
  const hex = c => {
    const m = /^#?([0-9a-f]{6})$/i.exec(c || '') || /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(c || '');
    if (!m) return [0, 0, 0];
    const h = m.length === 2 ? m[1] : m[1] + m[1] + m[2] + m[2] + m[3] + m[3];
    return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
  };
  const rgb = c => hex(c).map(n2).join(' ');

  /** Matrix from shown-page coordinates to PDF user space, for a page box and /Rotate. */
  function viewToUser(box, rot) {
    const { x, y, width: w, height: h } = box;
    switch (((rot % 360) + 360) % 360) {
      case 90: return [0, 1, -1, 0, x + w, y];
      case 180: return [-1, 0, 0, -1, x + w, y + h];
      case 270: return [0, -1, 1, 0, x, y + h];
      default: return [1, 0, 0, 1, x, y];
    }
  }
  const apply = (m, p) => [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
  function userRect(m, b) {
    const ps = [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]].map(p => apply(m, p));
    const xs = ps.map(p => p[0]), ys = ps.map(p => p[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  }

  /** Quick check on raw file bytes: does this PDF hold markup written by Rasm? */
  function hasMarker(bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const k = [...MARKER].map(c => c.charCodeAt(0)), n = k.length;
    outer: for (let i = u8.indexOf(k[0]); i >= 0 && i <= u8.length - n; i = u8.indexOf(k[0], i + 1)) {
      for (let j = 1; j < n; j++) if (u8[i + j] !== k[j]) continue outer;
      return true;
    }
    return false;
  }

  /* ---------- appearance streams ---------- */
  const ellipsePath = (cx, cy, rx, ry) => {
    const k = 0.5523, ox = rx * k, oy = ry * k;
    return `${n2(cx + rx)} ${n2(cy)} m ${n2(cx + rx)} ${n2(cy + oy)} ${n2(cx + ox)} ${n2(cy + ry)} ${n2(cx)} ${n2(cy + ry)} c ` +
      `${n2(cx - ox)} ${n2(cy + ry)} ${n2(cx - rx)} ${n2(cy + oy)} ${n2(cx - rx)} ${n2(cy)} c ` +
      `${n2(cx - rx)} ${n2(cy - oy)} ${n2(cx - ox)} ${n2(cy - ry)} ${n2(cx)} ${n2(cy - ry)} c ` +
      `${n2(cx + ox)} ${n2(cy - ry)} ${n2(cx + rx)} ${n2(cy - oy)} ${n2(cx + rx)} ${n2(cy)} c`;
  };
  function arrowOps(fx, fy, tx, ty, w, U) {
    const ang = Math.atan2(ty - fy, tx - fx), s = Math.max(9 * U, (w || 0) * 4.5);
    const b = [tx - Math.cos(ang) * s, ty - Math.sin(ang) * s], px = -Math.sin(ang) * s * 0.4, py = Math.cos(ang) * s * 0.4;
    return `${n2(fx)} ${n2(fy)} m ${n2(b[0])} ${n2(b[1])} l S ` +
      `${n2(tx)} ${n2(ty)} m ${n2(b[0] + px)} ${n2(b[1] + py)} l ${n2(b[0] - px)} ${n2(b[1] - py)} l h f`;
  }

  /** Vector drawing (in shown-page coordinates) for the simple kinds, or null. */
  function vectorOps(a, U) {
    const c = rgb(a.c);
    switch (a.type) {
      case 'hl':
        return { gs: { ca: 0.38, BM: 'Multiply' }, ops: `/G0 gs ${c} rg ` + a.rects.map(r => `${n2(r[0])} ${n2(r[1])} ${n2(r[2] - r[0])} ${n2(r[3] - r[1])} re`).join(' ') + ' f' };
      case 'ul': case 'st':
        return {
          ops: `${c} RG 1 J ` + a.rects.map(r => {
            const h = r[3] - r[1], y = a.type === 'ul' ? r[1] + h * 0.14 : (r[1] + r[3]) / 2, w = Math.max(1.3 * U, h * 0.075);
            return `${n2(w)} w ${n2(r[0])} ${n2(y)} m ${n2(r[2])} ${n2(y)} l S`;
          }).join(' ')
        };
      case 'pen':
        if (!a.pts || !a.pts.length) return null;
        return { ops: `${c} RG ${n2(a.w)} w 1 J 1 j ` + a.pts.map((p, i) => `${n2(p[0])} ${n2(p[1])} ${i ? 'l' : 'm'}`).join(' ') + (a.pts.length === 1 ? ` ${n2(a.pts[0][0] + 0.01)} ${n2(a.pts[0][1])} l` : '') + ' S' };
      case 'line':
        return { ops: `${c} RG ${n2(a.w)} w 1 J ${n2(a.fx)} ${n2(a.fy)} m ${n2(a.tx)} ${n2(a.ty)} l S` };
      case 'arrow':
        return { ops: `${c} RG ${c} rg ${n2(a.w || 1.5 * U)} w 1 J ` + arrowOps(a.fx, a.fy, a.tx, a.ty, a.w, U) };
      case 'rect': {
        const r = a.r;
        return { ops: `${c} RG ${n2(a.w)} w 1 j ${n2(r[0])} ${n2(r[1])} ${n2(r[2] - r[0])} ${n2(r[3] - r[1])} re S` };
      }
      case 'ellipse': {
        const r = a.r;
        return { ops: `${c} RG ${n2(a.w)} w ` + ellipsePath((r[0] + r[2]) / 2, (r[1] + r[3]) / 2, (r[2] - r[0]) / 2, (r[3] - r[1]) / 2) + ' S' };
      }
    }
    return null;
  }

  const SUBTYPE = { hl: 'Highlight', ul: 'Underline', st: 'StrikeOut', pen: 'Ink', line: 'Line', arrow: 'Line', rect: 'Square', ellipse: 'Circle', text: 'FreeText', callout: 'FreeText', img: 'Stamp', count: 'Circle' };
  const subtypeOf = a => a.type === 'meas' ? (a.kind === 'area' ? 'Polygon' : 'PolyLine') : SUBTYPE[a.type] || 'Square';

  async function embedDataUrl(pdf, src) {
    const m = /^data:image\/(png|jpe?g);base64,(.*)$/i.exec(src || '');
    if (!m) return null;
    const bin = typeof atob === 'function' ? Uint8Array.from(atob(m[2]), c => c.charCodeAt(0)) : new Uint8Array(Buffer.from(m[2], 'base64'));
    return /png/i.test(m[1]) ? pdf.embedPng(bin) : pdf.embedJpg(bin);
  }

  /**
   * Writes `anns` into `pdf` (a pdf-lib PDFDocument) as annotations. Old Rasm annotations must
   * have been removed first (see strip). Options:
   *   size(n)      -> [w, h] of page n as shown
   *   bbox(a)      -> [x0, y0, x1, y1] of mark a, shown-page coordinates
   *   unit(n)      -> line unit for page n (Rasm's UN)
   *   raster(a, bbox) -> Promise<Uint8Array PNG> of mark a cut to bbox (for text, stamps, counts, measurements)
   *   text(a)      -> plain text for /Contents, or ''
   *   cal          -> measurement calibration to keep with the file
   */
  async function write(pdf, anns, opt) {
    const { PDFName, PDFHexString, PDFString, PDFNumber } = L();
    const ctx = pdf.context, pages = pdf.getPages(), now = PDFString.fromDate(new Date());
    let written = 0;
    for (const a of anns) {
      const page = pages[a.p - 1];
      if (!page) continue;
      const rot = page.getRotation().angle, box = page.getCropBox(), m = viewToUser(box, rot);
      const sz = opt.size(a.p), U = opt.unit(a.p);
      const vb = opt.bbox(a).slice(), pad = Math.max(1, (a.w || 0) / 2 + 1);
      vb[0] -= pad; vb[1] -= pad; vb[2] += pad; vb[3] += pad;
      const rect = userRect(m, vb);
      const res = {}, cm = m.map(n2).join(' ') + ' cm ';
      let ops;
      const vec = vectorOps(a, U);
      if (vec) {
        ops = 'q ' + cm + vec.ops + ' Q';
        if (vec.gs) res.ExtGState = { G0: ctx.obj({ Type: 'ExtGState', ...vec.gs }) };
      } else {
        let img = null;
        if (a.type === 'img') { try { img = await embedDataUrl(pdf, a.src); } catch (e) { img = null; } }
        let ib = img ? [a.x, a.y, a.x + a.w, a.y + a.h] : vb;
        if (!img) { const png = await opt.raster(a, vb); img = await pdf.embedPng(png); }
        res.XObject = { I0: img.ref };
        ops = `q ${cm}${n2(ib[2] - ib[0])} 0 0 ${n2(ib[3] - ib[1])} ${n2(ib[0])} ${n2(ib[1])} cm /I0 Do Q`;
      }
      const ap = ctx.register(ctx.stream(ops, { Type: 'XObject', Subtype: 'Form', BBox: rect, Resources: res }));
      const sub = subtypeOf(a), col = hex(a.c);
      const d = {
        Type: 'Annot', Subtype: sub, Rect: rect, F: a.kind === 'sig' ? 4 | 128 : 4,
        AP: { N: ap }, P: page.ref, M: now,
        NM: PDFString.of('rasm-' + (a.id || 0) + '-' + (a.ts || 0)),
        T: PDFHexString.fromText('Rasm'),
      };
      if (a.c && a.type !== 'img') d.C = col;
      const text = (opt.text && opt.text(a)) || (a.type === 'img' ? (a.kind === 'sig' ? 'Signature' : (a.label || 'Stamp')) : '');
      if (text) d.Contents = PDFHexString.fromText(text);
      if (['hl', 'ul', 'st'].includes(a.type)) {
        d.QuadPoints = [].concat(...a.rects.map(r => {
          const q = [[r[0], r[3]], [r[2], r[3]], [r[0], r[1]], [r[2], r[1]]].map(p => apply(m, p));
          return [].concat(...q);
        }));
        if (a.type === 'hl') d.CA = 1;
      }
      if (a.type === 'pen') d.InkList = [[].concat(...a.pts.map(p => apply(m, p)))];
      if (a.type === 'line' || a.type === 'arrow') {
        d.L = [...apply(m, [a.fx, a.fy]), ...apply(m, [a.tx, a.ty])];
        d.LE = [PDFName.of('None'), PDFName.of(a.type === 'arrow' ? 'ClosedArrow' : 'None')];
        if (a.type === 'arrow') d.IC = col;
      }
      if (a.type === 'meas' && a.pts) d.Vertices = [].concat(...a.pts.map(p => apply(m, p)));
      if (a.w && a.type !== 'img') d.BS = { W: a.w, S: PDFName.of('S') };
      if (a.type === 'text' || a.type === 'callout') {
        d.DA = PDFString.of(`/Helv ${n2(a.size || 12)} Tf ${rgb(a.c)} rg`);
        if (a.type === 'callout') {
          d.IT = PDFName.of('FreeTextCallout');
          d.CL = [...apply(m, [a.tx, a.ty]), ...apply(m, [a.x, a.y])];
        }
      }
      if (a.type === 'img') d.Name = PDFName.of(a.kind === 'sig' ? 'Signature' : 'Draft');
      d[KEY] = PDFHexString.fromText(JSON.stringify({ v: VERSION, r: rot, w: n2(sz[0]), h: n2(sz[1]), a }));
      const ref = ctx.register(ctx.obj(d));
      page.node.addAnnot(ref);
      written++;
    }
    if (opt.cal && opt.cal.def || opt.cal && Object.keys(opt.cal.pages || {}).length) {
      pdf.catalog.set(PDFName.of(CAL), PDFHexString.fromText(JSON.stringify(opt.cal)));
    } else pdf.catalog.delete(PDFName.of(CAL));
    void PDFNumber;
    return written;
  }

  /**
   * Removes Rasm's annotations from every page of `pdf` and returns them as markup.
   * size(n) gives the shown size of page n *before* the strip, to check the page was not
   * rotated or resized elsewhere since Rasm saved; marks that no longer fit are left in the
   * file as ordinary annotations.
   */
  function strip(pdf, opt) {
    const { PDFName, PDFArray, PDFDict } = L();
    const k = PDFName.of(KEY), annsKey = PDFName.of('Annots');
    const out = [];
    let removed = 0;
    pdf.getPages().forEach((page, i) => {
      const arr = page.node.lookupMaybe(annsKey, PDFArray);
      if (!arr) return;
      const rot = page.getRotation().angle;
      for (let j = arr.size() - 1; j >= 0; j--) {
        const d = arr.lookupMaybe(j, PDFDict);
        const raw = d && d.get(k);
        if (!raw || !raw.decodeText) continue;
        let rec = null;
        try { rec = JSON.parse(raw.decodeText()); } catch (e) { rec = null; }
        if (!rec || !rec.a) continue;
        const sz = opt && opt.size ? opt.size(i + 1) : null;
        if (rec.r !== rot || (sz && (Math.abs(sz[0] - rec.w) > 1 || Math.abs(sz[1] - rec.h) > 1))) continue;
        rec.a.p = i + 1;
        out.unshift(rec.a);
        dropObjects(pdf, arr.get(j), d);
        arr.remove(j);
        removed++;
      }
      if (arr.size() === 0) page.node.delete(annsKey);
    });
    let cal = null;
    const c = pdf.catalog.get(PDFName.of(CAL));
    if (c && c.decodeText) { try { cal = JSON.parse(c.decodeText()); } catch (e) { cal = null; } }
    return { anns: out, cal, removed };
  }

  /* pdf-lib writes every object it knows about, referenced or not: delete the annotation, its
     appearance and the appearance's image so no trace of the old mark stays in the file. */
  function dropObjects(pdf, ref, d) {
    const { PDFRef, PDFName, PDFDict, PDFStream } = L();
    const ctx = pdf.context;
    const del = r => { if (r instanceof PDFRef) ctx.delete(r); };
    const ap = d.lookupMaybe(PDFName.of('AP'), PDFDict);
    if (ap) {
      const nRef = ap.get(PDFName.of('N')), n = ap.lookup(PDFName.of('N'));
      const res = n instanceof PDFStream ? n.dict.lookupMaybe(PDFName.of('Resources'), PDFDict) : null;
      const xo = res && res.lookupMaybe(PDFName.of('XObject'), PDFDict);
      if (xo) xo.entries().forEach(([, v]) => del(v));
      del(nRef);
    }
    del(ref);
  }

  g.RasmAnnots = { write, strip, hasMarker, viewToUser, KEY };
})(typeof window !== 'undefined' ? window : globalThis);
