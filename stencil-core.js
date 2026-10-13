/* stencil-core: KiCad Gerber (Edge.Cuts + Paste) -> 3D printable stencil mesh */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('clipper-lib'), require('earcut'));
  else root.StencilCore = factory(root.ClipperLib, root.earcut);
})(typeof self !== 'undefined' ? self : this, function (CL, earcut) {
  'use strict';
  const S = 1e5;          // integer units per mm for Clipper
  const ARC_TOL = 0.004;  // mm, chord tolerance for arcs and circles
  const TAU = Math.PI * 2;

  // ---------- messages ----------
  const MESSAGES = {
    en: {
      macroPrim: 'Ignored unsupported macro primitive (code {0})',
      noAperture: 'Undefined aperture D{0}',
      noMacro: 'Undefined macro {0}',
      approxDraw: 'Approximated a draw made with a non-circular aperture',
      macroDraw: 'Ignored a draw made with a macro aperture',
      incremental: 'Incremental coordinates are not supported',
      stepRepeat: 'Step & repeat (SR) is not supported',
      apTransform: 'Aperture transform ({0}) is not supported',
      negative: 'Negative image (IPNEG) is not supported',
      edgePrefix: 'Edge: ',
      pastePrefix: 'Paste: ',
      openLines: '{0} unclosed outline segment(s) ignored',
      noOutline: 'No closed board outline found. Check that the file is the Edge.Cuts Gerber.',
      clipped: 'Trimmed apertures extending past the board outline ({0} mm²)',
      islands: 'Filled {0} floating island(s) inside apertures',
    },
    ja: {
      macroPrim: '未対応のマクロ図形 (コード {0}) を無視しました',
      noAperture: '未定義のアパーチャ D{0}',
      noMacro: '未定義のマクロ {0}',
      approxDraw: '円以外のアパーチャによる線描画を近似しました',
      macroDraw: 'マクロアパーチャでの線描画は無視しました',
      incremental: 'インクリメンタル座標は未対応です',
      stepRepeat: 'ステップ&リピート (SR) は未対応です',
      apTransform: 'アパーチャ変形 ({0}) は未対応です',
      negative: 'ネガ画像 (IPNEG) は未対応です',
      edgePrefix: '外形: ',
      pastePrefix: 'ペースト: ',
      openLines: '外形に閉じていない線が {0} 本あります（無視しました）',
      noOutline: '外形ファイルから閉じた基板外形が見つかりませんでした。Edge.Cuts レイヤーの Gerber か確認してください。',
      clipped: '基板外形からはみ出した開口を切り詰めました ({0} mm²)',
      islands: '開口の内側に浮いてしまう島が {0} 個あったため、開口として埋めました',
    },
  };
  let lang = 'en';
  const msg = (k, ...a) => (MESSAGES[lang] || MESSAGES.en)[k].replace(/\{(\d)\}/g, (_, i) => a[i]);

  // ---------- small geometry helpers (float mm) ----------
  const area = (pts) => { let a = 0; for (let i = 0, n = pts.length; i < n; i++) { const p = pts[i], q = pts[(i + 1) % n]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
  const ccw = (pts) => (area(pts) < 0 ? pts.slice().reverse() : pts);
  const segsFor = (r, sweep) => Math.max(2, Math.ceil(sweep / (2 * Math.acos(Math.max(-1, 1 - ARC_TOL / Math.max(r, 1e-6))))));
  const rot = (pts, deg) => { if (!deg) return pts; const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); return pts.map(([x, y]) => [x * c - y * s, x * s + y * c]); };
  function circle(cx, cy, r) { const n = Math.max(8, segsFor(r, TAU)); const o = []; for (let i = 0; i < n; i++) { const a = TAU * i / n; o.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } return o; }
  const rect = (w, h, cx = 0, cy = 0) => [[cx - w / 2, cy - h / 2], [cx + w / 2, cy - h / 2], [cx + w / 2, cy + h / 2], [cx - w / 2, cy + h / 2]];
  function obround(w, h) {
    if (Math.abs(w - h) < 1e-9) return circle(0, 0, w / 2);
    const r = Math.min(w, h) / 2, d = (Math.max(w, h) - 2 * r) / 2, n = segsFor(r, Math.PI), o = [];
    const ends = w > h ? [[d, 0, -Math.PI / 2], [-d, 0, Math.PI / 2]] : [[0, d, 0], [0, -d, Math.PI]];
    for (const [cx, cy, a0] of ends) for (let i = 0; i <= n; i++) { const a = a0 + Math.PI * i / n; o.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
    return o;
  }
  function regPoly(d, n, deg, cx = 0, cy = 0) { const o = []; for (let i = 0; i < n; i++) { const a = (deg || 0) * Math.PI / 180 + TAU * i / n; o.push([cx + d / 2 * Math.cos(a), cy + d / 2 * Math.sin(a)]); } return o; }
  function vline(w, x1, y1, x2, y2) {
    const L = Math.hypot(x2 - x1, y2 - y1) || 1e-9, nx = -(y2 - y1) / L * w / 2, ny = (x2 - x1) / L * w / 2;
    return [[x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x2 - nx, y2 - ny], [x2 + nx, y2 + ny]];
  }

  // ---------- Clipper helpers (integer paths) ----------
  const toInt = (pts) => pts.map(([x, y]) => ({ X: Math.round(x * S), Y: Math.round(y * S) }));
  const NZ = CL.PolyFillType.pftNonZero;
  function clip(a, b, type) {
    const c = new CL.Clipper(); c.PreserveCollinear = true;
    if (a.length) c.AddPaths(a, CL.PolyType.ptSubject, true);
    if (b && b.length) c.AddPaths(b, CL.PolyType.ptClip, true);
    const sol = new CL.Paths(); c.Execute(type, sol, NZ, NZ); return sol;
  }
  const union = (a, b) => clip(a, b || [], CL.ClipType.ctUnion);
  const diff = (a, b) => clip(a, b, CL.ClipType.ctDifference);
  const inter = (a, b) => clip(a, b, CL.ClipType.ctIntersection);
  function offset(paths, d, endType) {
    const co = new CL.ClipperOffset(2, ARC_TOL * S);
    co.AddPaths(paths, CL.JoinType.jtRound, endType == null ? CL.EndType.etClosedPolygon : endType);
    const sol = new CL.Paths(); co.Execute(sol, d * S); return sol;
  }
  const iarea = (p) => CL.Clipper.Area(p) / (S * S);

  // ---------- Gerber tokenizer / macro expressions ----------
  function tokenize(text) {
    const out = []; let i = 0; const n = text.length;
    while (i < n) {
      const c = text[i];
      if (c === '%') {
        const j = text.indexOf('%', i + 1); if (j < 0) break;
        out.push({ ext: true, stmts: text.slice(i + 1, j).split('*').map((s) => s.replace(/[\r\n]+/g, '').trim()).filter((s) => s.length) });
        i = j + 1;
      } else if (/\s/.test(c)) i++;
      else { const j = text.indexOf('*', i); if (j < 0) break; out.push({ ext: false, s: text.slice(i, j).replace(/\s+/g, ' ').trim() }); i = j + 1; }
    }
    return out;
  }
  function evalExpr(str, vars) {
    const s = str.replace(/\s+/g, ''); let i = 0;
    const num = () => {
      const c = s[i];
      if (c === '(') { i++; const v = expr(); i++; return v; }
      if (c === '-') { i++; return -num(); }
      if (c === '+') { i++; return num(); }
      if (c === '$') { i++; const j = i; while (/\d/.test(s[i])) i++; return vars[+s.slice(j, i)] || 0; }
      const j = i; while (i < s.length && /[\d.]/.test(s[i])) i++; return parseFloat(s.slice(j, i)) || 0;
    };
    const term = () => { let v = num(); while (s[i] === 'x' || s[i] === 'X' || s[i] === '/') { const op = s[i++]; const r = num(); v = op === '/' ? v / r : v * r; } return v; };
    const expr = () => { let v = term(); while (s[i] === '+' || s[i] === '-') { const op = s[i++]; const r = term(); v = op === '+' ? v + r : v - r; } return v; };
    return expr();
  }

  // Aperture -> list of {on, pts} in file units at origin
  function macroPrims(body, params, warn) {
    const v = {}; params.forEach((p, k) => { v[k + 1] = p; });
    const prims = [];
    for (const st of body) {
      if (st[0] === '0' && (st.length === 1 || st[1] === ' ' || st[1] === ',')) continue; // comment
      const asg = st.match(/^\$(\d+)=(.+)$/); if (asg) { v[+asg[1]] = evalExpr(asg[2], v); continue; }
      const parts = st.split(','); const code = parseInt(parts[0], 10); const a = parts.slice(1).map((e) => evalExpr(e, v));
      const on = a[0] !== 0;
      if (code === 1) prims.push({ on, pts: rot(circle(a[2] || 0, a[3] || 0, a[1] / 2), a[4]) });
      else if (code === 20 || code === 2) prims.push({ on, pts: rot(vline(a[1], a[2], a[3], a[4], a[5]), a[6]) });
      else if (code === 21) prims.push({ on, pts: rot(rect(a[1], a[2], a[3], a[4]), a[5]) });
      else if (code === 22) prims.push({ on, pts: rot(rect(a[1], a[2], a[3] + a[1] / 2, a[4] + a[2] / 2), a[5]) });
      else if (code === 4) { const n = a[1]; const pts = []; for (let k = 0; k < n; k++) pts.push([a[2 + 2 * k], a[3 + 2 * k]]); prims.push({ on, pts: rot(pts, a[2 + 2 * (n + 1)]) }); }
      else if (code === 5) prims.push({ on, pts: rot(regPoly(a[4], a[1], 0, a[2], a[3]), a[5]) });
      else if (code === 7) {
        const [cx, cy, od, id, gap, r] = a;
        prims.push({ on: true, pts: rot(circle(cx, cy, od / 2), r) });
        prims.push({ on: false, pts: rot(circle(cx, cy, id / 2), r) });
        prims.push({ on: false, pts: rot(rect(od + 1, gap, cx, cy), r) });
        prims.push({ on: false, pts: rot(rect(gap, od + 1, cx, cy), r) });
      } else warn(msg('macroPrim', code));
    }
    return prims;
  }

  // ---------- Gerber parser ----------
  function parseGerber(text) {
    const warnings = new Set(); const warn = (m) => warnings.add(m);
    const fmt = { xi: 3, xd: 6, yd: 6, zero: 'L' }; let unit = 1;
    const aps = {}, macros = {}, apCache = {};
    let x = 0, y = 0, interp = 1, single = false, region = null, pol = 'D', cur = null, lastOp = 1, fileFunction = '';
    const items = [], strokes = []; let track = null;

    const coord = (str, dec) => {
      let neg = false; if (str[0] === '-' || str[0] === '+') { neg = str[0] === '-'; str = str.slice(1); }
      let v; if (str.includes('.')) v = parseFloat(str);
      else { if (fmt.zero === 'T') str = str.padEnd(fmt.xi + dec, '0'); v = parseInt(str, 10) / Math.pow(10, dec); }
      return (neg ? -v : v) * unit;
    };
    const apShape = (code) => {
      if (apCache[code]) return apCache[code];
      const ap = aps[code]; if (!ap) { warn(msg('noAperture', code)); return (apCache[code] = []); }
      const u = ap.unit, p = ap.params.map((q) => q * u); let prims;
      switch (ap.tpl) {
        case 'C': prims = [{ on: true, pts: circle(0, 0, p[0] / 2) }]; break;
        case 'R': prims = [{ on: true, pts: rect(p[0], p[1]) }]; break;
        case 'O': prims = [{ on: true, pts: obround(p[0], p[1]) }]; break;
        case 'P': prims = [{ on: true, pts: regPoly(p[0], Math.round(ap.params[1]), ap.params[2] || 0) }]; break;
        default: {
          const body = macros[ap.tpl];
          if (!body) { warn(msg('noMacro', ap.tpl)); prims = []; break; }
          prims = macroPrims(body, ap.params, warn).map((pr) => ({ on: pr.on, pts: pr.pts.map(([a, b]) => [a * u, b * u]) }));
        }
      }
      let acc = [];
      for (const pr of prims) { const ip = [toInt(ccw(pr.pts))]; acc = pr.on ? union(acc, ip) : diff(acc, ip); }
      return (apCache[code] = acc);
    };
    const flushTrack = () => {
      if (!track) return; const t = track; track = null;
      const ap = aps[t.ap]; if (!ap) return;
      const ip = [toInt(t.pts)];
      let w, et;
      if (ap.tpl === 'C') { w = ap.params[0] * ap.unit; et = CL.EndType.etOpenRound; }
      else if (ap.tpl === 'R' || ap.tpl === 'O') { w = Math.min(ap.params[0], ap.params[1]) * ap.unit; et = ap.tpl === 'R' ? CL.EndType.etOpenSquare : CL.EndType.etOpenRound; warn(msg('approxDraw')); }
      else { warn(msg('macroDraw')); return; }
      if (w > 0) items.push({ pol: t.pol, paths: offset(ip, w / 2, et) });
    };
    const arcPts = (x0, y0, x1, y1, i, j, cw) => {
      let cx, cy;
      if (!single) { cx = x0 + i; cy = y0 + j; }
      else {
        let best = null;
        for (const sx of [1, -1]) for (const sy of [1, -1]) {
          const ccx = x0 + sx * Math.abs(i), ccy = y0 + sy * Math.abs(j);
          const a0 = Math.atan2(y0 - ccy, x0 - ccx), a1 = Math.atan2(y1 - ccy, x1 - ccx);
          let sw = cw ? a0 - a1 : a1 - a0; while (sw < 0) sw += TAU; while (sw > TAU) sw -= TAU;
          if (sw > Math.PI / 2 + 1e-4) continue;
          const err = Math.abs(Math.hypot(x0 - ccx, y0 - ccy) - Math.hypot(x1 - ccx, y1 - ccy));
          if (!best || err < best.err) best = { err, ccx, ccy };
        }
        if (!best) return [[x0, y0], [x1, y1]];
        cx = best.ccx; cy = best.ccy;
      }
      const a0 = Math.atan2(y0 - cy, x0 - cx), a1 = Math.atan2(y1 - cy, x1 - cx);
      const r0 = Math.hypot(x0 - cx, y0 - cy), r1 = Math.hypot(x1 - cx, y1 - cy);
      let sw = cw ? a0 - a1 : a1 - a0; while (sw <= 1e-9) sw += TAU; while (sw > TAU + 1e-9) sw -= TAU;
      if (single && Math.hypot(x1 - x0, y1 - y0) < 1e-9) return [[x0, y0], [x1, y1]];
      const n = segsFor(Math.max(r0, r1), sw), out = [[x0, y0]];
      for (let k = 1; k < n; k++) { const t = k / n, a = a0 + (cw ? -1 : 1) * sw * t, r = r0 + (r1 - r0) * t; out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
      out.push([x1, y1]); return out;
    };

    for (const tok of tokenize(text)) {
      if (tok.ext) {
        const st0 = tok.stmts[0] || '';
        if (st0.startsWith('FS')) {
          const m = st0.match(/^FS([LTD])?([AI])?X(\d)(\d)Y(\d)(\d)/);
          if (m) { fmt.zero = m[1] || 'L'; fmt.xi = +m[3]; fmt.xd = +m[4]; fmt.yd = +m[6]; if (m[2] === 'I') warn(msg('incremental')); }
        } else if (st0.startsWith('MO')) unit = st0 === 'MOIN' ? 25.4 : 1;
        else if (st0.startsWith('AM')) macros[st0.slice(2)] = tok.stmts.slice(1);
        else if (st0.startsWith('AD')) {
          for (const st of tok.stmts) {
            const m = st.match(/^ADD(\d+)([^,]+),?(.*)$/); if (!m) continue;
            aps[+m[1]] = { tpl: m[2], params: m[3] ? m[3].split('X').map(Number) : [], unit };
          }
        } else if (st0.startsWith('LP')) { flushTrack(); pol = st0[2] === 'C' ? 'C' : 'D'; }
        else if (st0.startsWith('TF.FileFunction')) fileFunction = st0.slice(16);
        else if (st0.startsWith('SR') && !/^SR(X1Y1)?/.test(st0.replace(/I[\d.]+J[\d.]+/, ''))) warn(msg('stepRepeat'));
        else if ((st0.startsWith('LR') && parseFloat(st0.slice(2)) !== 0) || (st0.startsWith('LM') && st0 !== 'LMN') || (st0.startsWith('LS') && parseFloat(st0.slice(2)) !== 1)) warn(msg('apTransform', st0));
        else if (st0.startsWith('IP') && st0 !== 'IPPOS') warn(msg('negative'));
        continue;
      }
      const s = tok.s;
      if (/^G0?4(\D|$)/.test(s) || !s) continue;
      const re = /([GDMXYIJ])([+-]?[\d.]+)/g; let m, d = null, X = null, Y = null, I = 0, J = 0;
      while ((m = re.exec(s))) {
        const k = m[1], v = m[2];
        if (k === 'G') {
          const g = parseInt(v, 10);
          if (g === 1 || g === 2 || g === 3) interp = g;
          else if (g === 74) single = true;
          else if (g === 75) single = false;
          else if (g === 36) { flushTrack(); region = { contours: [], cur: null }; }
          else if (g === 37 && region) {
            if (region.cur && region.cur.length > 2) region.contours.push(region.cur);
            const paths = region.contours.map((c) => toInt(c));
            if (paths.length) items.push({ pol, paths: union(paths) });
            region = null;
          } else if (g === 70) unit = 25.4; else if (g === 71) unit = 1;
          else if (g === 91) warn(msg('incremental'));
        } else if (k === 'D') d = parseInt(v, 10);
        else if (k === 'M') { /* M02 end */ }
        else if (k === 'X') X = coord(v, fmt.xd); else if (k === 'Y') Y = coord(v, fmt.yd);
        else if (k === 'I') I = coord(v, fmt.xd); else if (k === 'J') J = coord(v, fmt.yd);
      }
      if (d != null && d >= 10) { flushTrack(); cur = d; continue; }
      let op = d;
      if (op == null) { if (X == null && Y == null) continue; op = lastOp; }
      lastOp = op;
      const nx = X == null ? x : X, ny = Y == null ? y : Y;
      if (op === 2) {
        if (region) { if (region.cur && region.cur.length > 2) region.contours.push(region.cur); region.cur = [[nx, ny]]; }
        else flushTrack();
      } else if (op === 1) {
        const pts = interp === 1 ? [[x, y], [nx, ny]] : arcPts(x, y, nx, ny, I, J, interp === 2);
        if (region) { if (!region.cur) region.cur = [[x, y]]; region.cur.push(...pts.slice(1)); }
        else {
          strokes.push(pts);
          if (track && track.ap === cur && track.pol === pol) track.pts.push(...pts.slice(1));
          else { flushTrack(); track = { ap: cur, pol, pts: pts.slice() }; }
        }
      } else if (op === 3) {
        flushTrack();
        const shp = apShape(cur), dx = Math.round(nx * S), dy = Math.round(ny * S);
        if (shp.length) items.push({ pol, paths: shp.map((p) => p.map((q) => ({ X: q.X + dx, Y: q.Y + dy }))) });
      }
      x = nx; y = ny;
    }
    flushTrack();
    return { items, strokes, warnings: [...warnings], fileFunction };
  }

  // Combine dark/clear items in order into one region (integer paths)
  function flatten(items) {
    let acc = [], i = 0;
    while (i < items.length) {
      const pol = items[i].pol, group = [];
      while (i < items.length && items[i].pol === pol) group.push(...items[i++].paths);
      acc = pol === 'D' ? union(acc, group) : diff(acc, group);
    }
    return acc;
  }

  // Chain Edge.Cuts strokes into closed loops
  function chainLoops(strokes, tol = 0.02) {
    const segs = strokes.filter((s) => s.length >= 2 && s.some((p) => Math.hypot(p[0] - s[0][0], p[1] - s[0][1]) > 1e-9)).map((s) => s.slice());
    const used = new Array(segs.length).fill(false), loops = [], open = [];
    const near = (a, b) => Math.abs(a[0] - b[0]) < tol && Math.abs(a[1] - b[1]) < tol;
    for (let k = 0; k < segs.length; k++) {
      if (used[k]) continue; used[k] = true; let chain = segs[k].slice();
      let grew = true;
      while (!near(chain[0], chain[chain.length - 1]) && grew) {
        grew = false; const end = chain[chain.length - 1];
        for (let j = 0; j < segs.length; j++) {
          if (used[j]) continue; const s = segs[j];
          if (near(s[0], end)) { chain.push(...s.slice(1)); used[j] = grew = true; break; }
          if (near(s[s.length - 1], end)) { chain.push(...s.slice(0, -1).reverse()); used[j] = grew = true; break; }
        }
      }
      if (chain.length > 3 && near(chain[0], chain[chain.length - 1])) { chain.pop(); loops.push(chain); }
      else open.push(chain);
    }
    return { loops, open };
  }

  function detectRole(name, text) {
    const ff = (text.match(/%TF\.FileFunction,([^*]*)\*%/) || [])[1] || '';
    if (/^Profile/i.test(ff)) return 'edge';
    if (/^Paste,Top/i.test(ff)) return 'F';
    if (/^Paste,Bot/i.test(ff)) return 'B';
    const n = name.toLowerCase();
    if (/edge[_.\- ]?cuts|\.gko$|\.gm1$|outline|profile/.test(n)) return 'edge';
    if (/f[_.\-]paste|\.gtp$|top[_\-]?paste|pastetop/.test(n)) return 'F';
    if (/b[_.\-]paste|\.gbp$|bot(tom)?[_\-]?paste|pastebot/.test(n)) return 'B';
    return null;
  }

  // ---------- mesh ----------
  function polysOf(paths) {
    const c = new CL.Clipper(); c.PreserveCollinear = true; c.AddPaths(paths, CL.PolyType.ptSubject, true);
    const tree = new CL.PolyTree(); c.Execute(CL.ClipType.ctUnion, tree, NZ, NZ);
    const out = [];
    const orient = (p, wantPos) => ((CL.Clipper.Area(p) > 0) === wantPos ? p : p.slice().reverse());
    const walk = (node) => { for (const ch of node.Childs()) { out.push({ outer: orient(ch.Contour(), true), holes: ch.Childs().map((h) => orient(h.Contour(), false)) }); for (const h of ch.Childs()) walk(h); } };
    walk(tree); return out;
  }
  function meshBuilder() {
    const t = [];
    const tri = (a, b, c) => t.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    const cap = (polys, z, up) => {
      for (const poly of polys) {
        const flat = [], holes = []; const push = (c) => { for (const p of c) flat.push(p.X / S, p.Y / S); };
        push(poly.outer); for (const h of poly.holes) { holes.push(flat.length / 2); push(h); }
        const idx = earcut(flat, holes.length ? holes : null, 2);
        // earcut drops collinear boundary points, which leaves T-junctions against the walls.
        // Find boundary vertices lying on each triangle edge and re-fan those triangles from their centroid.
        const G = 1, grid = new Map(), nv = flat.length / 2;
        for (let v = 0; v < nv; v++) { const gk = Math.floor(flat[2 * v] / G) + ',' + Math.floor(flat[2 * v + 1] / G); (grid.get(gk) || grid.set(gk, []).get(gk)).push(v); }
        const onEdge = (a, b) => {
          const ax = flat[2 * a], ay = flat[2 * a + 1], bx = flat[2 * b], by = flat[2 * b + 1], L2 = (bx - ax) ** 2 + (by - ay) ** 2, hits = [];
          for (let gx = Math.floor(Math.min(ax, bx) / G); gx <= Math.floor(Math.max(ax, bx) / G); gx++)
            for (let gy = Math.floor(Math.min(ay, by) / G); gy <= Math.floor(Math.max(ay, by) / G); gy++)
              for (const v of grid.get(gx + ',' + gy) || []) {
                const px = flat[2 * v], py = flat[2 * v + 1];
                if ((px === ax && py === ay) || (px === bx && py === by)) continue;
                const t = ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / L2;
                if (t <= 0 || t >= 1) continue;
                const cr = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
                if (Math.abs(cr) / Math.sqrt(L2) < 2e-5) hits.push([t, v]);
              }
          return hits.sort((p, q) => p[0] - q[0]).map((h) => h[1]);
        };
        const P = (v) => [flat[2 * v], flat[2 * v + 1], z];
        const emit = (A, B, C) => { const cr = (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]); if ((cr > 0) === up) tri(A, B, C); else tri(A, C, B); };
        for (let k = 0; k < idx.length; k += 3) {
          const a = idx[k], b = idx[k + 1], c = idx[k + 2];
          // skip slivers: their vertex gets absorbed by the neighbours' edge splits
          const ux = flat[2 * b] - flat[2 * a], uy = flat[2 * b + 1] - flat[2 * a + 1], vx = flat[2 * c] - flat[2 * a], vy = flat[2 * c + 1] - flat[2 * a + 1];
          const longest = Math.sqrt(Math.max(ux * ux + uy * uy, vx * vx + vy * vy, (vx - ux) ** 2 + (vy - uy) ** 2));
          if (Math.abs(ux * vy - uy * vx) / longest < 2e-5) continue;
          const ring = [a, ...onEdge(a, b), b, ...onEdge(b, c), c, ...onEdge(c, a)];
          if (ring.length === 3) { emit(P(a), P(b), P(c)); continue; }
          const m = [(flat[2 * a] + flat[2 * b] + flat[2 * c]) / 3, (flat[2 * a + 1] + flat[2 * b + 1] + flat[2 * c + 1]) / 3, z];
          for (let i = 0; i < ring.length; i++) emit(m, P(ring[i]), P(ring[(i + 1) % ring.length]));
        }
      }
    };
    const walls = (polys, z0, z1) => {
      for (const poly of polys) for (const c of [poly.outer, ...poly.holes]) {
        for (let i = 0, n = c.length; i < n; i++) {
          const p = c[i], q = c[(i + 1) % n], px = p.X / S, py = p.Y / S, qx = q.X / S, qy = q.Y / S;
          tri([px, py, z0], [qx, qy, z0], [qx, qy, z1]); tri([px, py, z0], [qx, qy, z1], [px, py, z1]);
        }
      }
    };
    return { t, cap, walls };
  }
  function checkMesh(t) {
    const key = (i) => t[i] + ',' + t[i + 1] + ',' + t[i + 2];
    const e = new Map(); let vol = 0;
    for (let i = 0; i < t.length; i += 9) {
      const k = [key(i), key(i + 3), key(i + 6)];
      for (let j = 0; j < 3; j++) { const id = k[j] + '|' + k[(j + 1) % 3]; e.set(id, (e.get(id) || 0) + 1); }
      const [ax, ay, az, bx, by, bz, cx, cy, cz] = t.slice(i, i + 9);
      vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
    }
    let bad = 0;
    for (const [id, n] of e) { const [a, b] = id.split('|'); if (n !== 1 || e.get(b + '|' + a) !== 1) bad++; }
    return { badEdges: bad, volume: vol };
  }

  function stl(t, name) {
    const n = t.length / 9, buf = new ArrayBuffer(84 + n * 50), dv = new DataView(buf);
    const hdr = ('stencil ' + (name || '')).slice(0, 79); for (let i = 0; i < hdr.length; i++) dv.setUint8(i, hdr.charCodeAt(i) & 0x7f);
    dv.setUint32(80, n, true);
    for (let k = 0; k < n; k++) {
      const o = 84 + k * 50, i = k * 9;
      const ux = t[i + 3] - t[i], uy = t[i + 4] - t[i + 1], uz = t[i + 5] - t[i + 2], vx = t[i + 6] - t[i], vy = t[i + 7] - t[i + 1], vz = t[i + 8] - t[i + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1;
      dv.setFloat32(o, nx / l, true); dv.setFloat32(o + 4, ny / l, true); dv.setFloat32(o + 8, nz / l, true);
      for (let j = 0; j < 9; j++) dv.setFloat32(o + 12 + j * 4, t[i + j], true);
    }
    return buf;
  }

  /**
   * opts: { side:'F'|'B', thickness, lip, lipHeight, clearance, wall, flange, shrink }
   * Output mesh is in print orientation: squeegee face on the bed (z=0), lip pointing up.
   */
  function generate(edgeText, pasteText, opts) {
    const o = Object.assign({ side: 'F', thickness: 0.25, lip: true, lipHeight: 1.2, clearance: 0.15, wall: 1.6, flange: 0, shrink: 0 }, opts);
    const warnings = [];
    const eg = parseGerber(edgeText), pg = parseGerber(pasteText);
    warnings.push(...eg.warnings.map((w) => msg('edgePrefix') + w), ...pg.warnings.map((w) => msg('pastePrefix') + w));
    const { loops, open } = chainLoops(eg.strokes);
    if (open.length) warnings.push(msg('openLines', open.length));
    if (!loops.length) throw new Error(msg('noOutline'));
    let outline = loops.reduce((a, b) => (Math.abs(area(b)) > Math.abs(area(a)) ? b : a));
    outline = ccw(outline);
    const xs = outline.map((p) => p[0]), ys = outline.map((p) => p[1]);
    const bb = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
    const cx = (bb.x0 + bb.x1) / 2, cy = (bb.y0 + bb.y1) / 2;
    const flipY = o.side === 'F' ? -1 : 1; // F: rotate 180° about X so the squeegee face lands on the bed
    const tf = ([px, py]) => [px - cx, flipY * (py - cy)];
    const outlineP = union([toInt(ccw(outline.map(tf)))]);

    // apertures
    const pads0 = flatten(pg.items);
    const icx = Math.round(cx * S), icy = Math.round(cy * S);
    let pads = union(pads0.map((p) => p.map((q) => ({ X: q.X - icx, Y: flipY * (q.Y - icy) }))));
    if (o.shrink) pads = offset(pads, -o.shrink);
    const inside = offset(outlineP, -0.05);
    const clipped = inter(pads, inside);
    const clippedArea = pads.reduce((s, p) => s + Math.abs(iarea(p)), 0) - clipped.reduce((s, p) => s + Math.abs(iarea(p)), 0);
    if (clippedArea > 0.01) warnings.push(msg('clipped', clippedArea.toFixed(2)));
    const apPolys = polysOf(clipped);
    const islands = apPolys.reduce((s, p) => s + p.holes.length, 0);
    if (islands) warnings.push(msg('islands', islands));
    const apertures = apPolys.map((p) => p.outer);

    // plate & lip
    const clr = Math.max(0, o.clearance), wall = Math.max(0.2, o.wall), fl = Math.max(0, o.flange);
    const pocket = offset(outlineP, clr);
    const ringOuter = offset(outlineP, clr + wall);
    const plateOuter = fl > 0 ? offset(outlineP, clr + wall + fl) : ringOuter;
    const A = diff(plateOuter, apertures);
    const T = o.thickness, L = o.lipHeight;
    const mb = meshBuilder();
    const polysA = polysOf(A);
    mb.cap(polysA, 0, false);
    mb.walls(polysA, 0, T);
    if (o.lip && L > 0) {
      const B = diff(ringOuter, pocket), polysB = polysOf(B);
      mb.cap(polysOf(diff(A, B)), T, true);
      mb.walls(polysB, T, T + L);
      mb.cap(polysB, T + L, true);
    } else mb.cap(polysA, T, true);

    // stats
    const sizes = apertures.map((p) => {
      const X = p.map((q) => q.X / S), Y = p.map((q) => q.Y / S);
      return { w: Math.max(...X) - Math.min(...X), h: Math.max(...Y) - Math.min(...Y), a: Math.abs(iarea(p)) };
    });
    const minOpen = sizes.length ? Math.min(...sizes.map((s) => Math.min(s.w, s.h))) : 0;
    const po = plateOuter.flat(); const PX = po.map((q) => q.X / S), PY = po.map((q) => q.Y / S);
    const check = checkMesh(mb.t);
    const toF = (p) => p.map((q) => [q.X / S, q.Y / S]);
    return {
      tris: mb.t,
      check,
      warnings,
      stats: {
        board: { w: bb.x1 - bb.x0, h: bb.y1 - bb.y0 },
        size: { w: Math.max(...PX) - Math.min(...PX), d: Math.max(...PY) - Math.min(...PY), h: T + (o.lip ? L : 0) },
        apertures: apertures.length,
        minOpen,
        pasteArea: sizes.reduce((s, x) => s + x.a, 0),
        triangles: mb.t.length / 9,
        innerLoops: loops.length - 1,
      },
      // 2D preview in board coordinates (top view, Y up)
      preview: {
        outline,
        pads: pads0.map((p) => p.map((q) => [q.X / S, q.Y / S])),
        plate: toF(plateOuter[0] || []).map(([px, py]) => [px + cx, flipY * py + cy]),
      },
      options: o,
    };
  }

  const setLang = (l) => { lang = MESSAGES[l] ? l : 'en'; };
  return { parseGerber, generate, detectRole, stl, chainLoops, flatten, setLang };
});
