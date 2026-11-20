"use strict";
/* Measuring CAD faces for the Big Ben CAD page.
 * Takes the tessellated output of occt-import-js (one triangle range per B-rep face), and fits
 * planes, cylinders, cones and tori (pipe bends) to individual faces. Also finds the coaxial
 * partner face of a tube or pipe wall, so inside diameter and wall thickness can be read off.
 * Works in the browser (window.CADFit) and in Node (module.exports). Units: mm.
 */
(function (root) {
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const len = a => Math.hypot(a[0], a[1], a[2]);
  const unit = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const perp = a => unit(Math.abs(a[0]) < 0.9 ? cross(a, [1, 0, 0]) : cross(a, [0, 1, 0]));

  // Symmetric 3×3 eigen-decomposition (Jacobi). Returns values ascending with matching vectors.
  function eig3(A) {
    const a = A.map(r => r.slice()), v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    for (let sweep = 0; sweep < 50; sweep++) {
      let off = Math.abs(a[0][1]) + Math.abs(a[0][2]) + Math.abs(a[1][2]); if (off < 1e-14) break;
      for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
        if (Math.abs(a[p][q]) < 1e-18) continue;
        const th = (a[q][q] - a[p][p]) / (2 * a[p][q]), t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < 3; k++) { const akp = a[k][p], akq = a[k][q]; a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq; }
        for (let k = 0; k < 3; k++) { const apk = a[p][k], aqk = a[q][k]; a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk; }
        for (let k = 0; k < 3; k++) { const vkp = v[k][p], vkq = v[k][q]; v[k][p] = c * vkp - s * vkq; v[k][q] = s * vkp + c * vkq; }
      }
    }
    return [0, 1, 2].map(i => ({ val: a[i][i], vec: [v[0][i], v[1][i], v[2][i]] })).sort((x, y) => x.val - y.val);
  }
  // Least-squares circle through 2-D points (Kasa fit).
  function circle2(pts) {
    let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0, sz = 0; const n = pts.length;
    for (const [x, y] of pts) { const z = x * x + y * y; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; sxz += x * z; syz += y * z; sz += z; }
    const M = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]], b = [-sxz, -syz, -sz];
    const det = m => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    const D = det(M); if (Math.abs(D) < 1e-20) return null;
    const sol = [0, 1, 2].map(i => det(M.map((r, j) => r.map((v, k) => k === i ? b[j] : v))) / D);
    const cx = -sol[0] / 2, cy = -sol[1] / 2, r = Math.sqrt(Math.max(0, cx * cx + cy * cy - sol[2]));
    let e = 0; for (const [x, y] of pts) e += (Math.hypot(x - cx, y - cy) - r) ** 2;
    return { cx, cy, r, rms: Math.sqrt(e / n) };
  }

  // Merge occt-import-js meshes into one triangle list with a face id per triangle.
  function buildCad(result) {
    let nv = 0, nt = 0;
    for (const m of result.meshes) { nv += m.attributes.position.array.length / 3; nt += m.index.array.length / 3; }
    const pos = new Float64Array(nv * 3), nrm = new Float64Array(nv * 3), tri = new Uint32Array(nt * 3), faceOf = new Int32Array(nt), faces = [];
    let ov = 0, ot = 0;
    for (const m of result.meshes) {
      const P = m.attributes.position.array, N = m.attributes.normal ? m.attributes.normal.array : null, I = m.index.array;
      pos.set(P, ov * 3); if (N) nrm.set(N, ov * 3);
      for (let k = 0; k < I.length; k++) tri[ot * 3 + k] = I[k] + ov;
      const bf = m.brep_faces && m.brep_faces.length ? m.brep_faces : [{ first: 0, last: I.length / 3 - 1 }];
      for (const f of bf) {
        const id = faces.length; faces.push({ id, t0: ot + f.first, t1: ot + f.last + 1, mesh: m.name || "" });
        for (let t = f.first; t <= f.last; t++) faceOf[ot + t] = id;
      }
      ov += P.length / 3; ot += I.length / 3;
    }
    if (!result.meshes.every(m => m.attributes.normal)) computeNormals(pos, nrm, tri);
    for (const f of faces) { // bounding box per face
      const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
      for (let t = f.t0; t < f.t1; t++) for (let k = 0; k < 3; k++) { const v = tri[t * 3 + k]; for (let q = 0; q < 3; q++) { lo[q] = Math.min(lo[q], pos[v * 3 + q]); hi[q] = Math.max(hi[q], pos[v * 3 + q]); } }
      f.lo = lo; f.hi = hi;
    }
    return { pos, nrm, tri, faceOf, faces, fits: new Map() };
  }
  function computeNormals(pos, nrm, tri) {
    nrm.fill(0);
    for (let t = 0; t < tri.length; t += 3) {
      const [a, b, c] = [tri[t], tri[t + 1], tri[t + 2]], pa = [pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2]];
      const n = cross(sub([pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2]], pa), sub([pos[c * 3], pos[c * 3 + 1], pos[c * 3 + 2]], pa));
      for (const v of [a, b, c]) for (let q = 0; q < 3; q++) nrm[v * 3 + q] += n[q];
    }
    for (let v = 0; v < nrm.length; v += 3) { const l = Math.hypot(nrm[v], nrm[v + 1], nrm[v + 2]) || 1; nrm[v] /= l; nrm[v + 1] /= l; nrm[v + 2] /= l; }
  }
  function faceVerts(cad, fid) {
    const f = cad.faces[fid], seen = new Set(), P = [], N = [];
    for (let t = f.t0; t < f.t1; t++) for (let k = 0; k < 3; k++) {
      const v = cad.tri[t * 3 + k]; if (seen.has(v)) continue; seen.add(v);
      P.push([cad.pos[v * 3], cad.pos[v * 3 + 1], cad.pos[v * 3 + 2]]); N.push([cad.nrm[v * 3], cad.nrm[v * 3 + 1], cad.nrm[v * 3 + 2]]);
    }
    return { P, N };
  }

  // Fit one face. Returns { type: "plane" | "cyl" | "cone" | "torus" | "other", ... }.
  function fitFace(cad, fid) {
    if (cad.fits.has(fid)) return cad.fits.get(fid);
    const { P, N } = faceVerts(cad, fid), n = P.length;
    let fit = { type: "other", n };
    if (n >= 4) {
      const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
      for (const v of N) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) M[i][j] += v[i] * v[j] / n;
      const E = eig3(M), c0 = P.reduce((s, p) => add(s, mul(p, 1 / n)), [0, 0, 0]);
      if (E[2].val > 0.995) {
        const mn = unit(N.reduce((s, v) => add(s, v), [0, 0, 0])), nn = dot(mn, E[2].vec) < 0 ? mul(E[2].vec, -1) : E[2].vec;
        let ext = 0; for (const p of P) ext = Math.max(ext, len(sub(p, c0)));
        fit = { type: "plane", normal: nn, point: c0, extent: ext, n };
      } else if (E[0].val < 0.35) fit = refineAxis(P, E[0].vec, c0) || torusFit(P, N) || fit;   // cylinders, and cones up to ~35° half-angle
      else fit = torusFit(P, N) || fit;
    }
    fit.fid = fid; cad.fits.set(fid, fit); return fit;
  }
  // Cylinder or cone about axis direction a.
  function fitRevolved(P, a, c0, loose) {
    const u = perp(a), w = cross(a, u), c = circle2(P.map(p => { const d = sub(p, c0); return [dot(d, u), dot(d, w)]; }));
    if (!c) return null;
    const ctr = add(c0, add(mul(u, c.cx), mul(w, c.cy)));
    let st = 0, sr = 0, stt = 0, str = 0, tmin = 1e9, tmax = -1e9; const n = P.length, TR = [];
    for (const p of P) { const d = sub(p, ctr), t = dot(d, a), r = len(sub(d, mul(a, t))); TR.push([t, r]); st += t; sr += r; stt += t * t; str += t * r; tmin = Math.min(tmin, t); tmax = Math.max(tmax, t); }
    const den = n * stt - st * st, k = Math.abs(den) > 1e-9 ? (n * str - st * sr) / den : 0, r0 = (sr - k * st) / n;
    let e = 0; for (const [t, r] of TR) e += (r - (r0 + k * t)) ** 2;
    const rms = Math.sqrt(e / n), rmean = sr / n;
    if (!loose && rms > Math.max(0.05, 0.01 * rmean)) return null;
    const cone = Math.abs(k) > Math.tan(1 * Math.PI / 180) && tmax - tmin > 0.5;
    return { type: cone ? "cone" : "cyl", axis: a, center: ctr, r: rmean, r0, k: cone ? k : 0, tmin, tmax, rmin: r0 + Math.min(k * tmin, k * tmax), rmax: r0 + Math.max(k * tmin, k * tmax),
      halfAngle: cone ? Math.atan(Math.abs(k)) * 180 / Math.PI : 0, rms, n };
  }
  // Tilt the axis in small steps to minimise the radius residual (the normals give it to within a degree or so).
  function refineAxis(P, a0, c0) {
    let best = fitRevolved(P, a0, c0, true); if (!best) return null;
    let a = a0, step = 2 * Math.PI / 180;
    while (step > 2e-5) {
      let moved = false; const u = perp(a), w = cross(a, u);
      for (const [p, q] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const b = unit(add(a, add(mul(u, p * step), mul(w, q * step)))), g = fitRevolved(P, b, c0, true);
        if (g && g.rms < best.rms - 1e-9) { best = g; a = b; moved = true; }
      }
      if (!moved) step /= 2;
    }
    return best.rms > Math.max(0.05, 0.01 * best.r) ? null : best;
  }
  // Torus (a pipe bend): offsetting each point along its normal by the minor radius lands it on the bend centreline arc.
  function torusFit(P, N) {
    let n = P.length; if (n < 12) return null;
    const score = (sgn, r) => {
      const m = P.length, Q = P.map((p, i) => sub(p, mul(N[i], sgn * r))), c0 = Q.reduce((s, q) => add(s, mul(q, 1 / m)), [0, 0, 0]);
      const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; for (const q of Q) { const d = sub(q, c0); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i][j] += d[i] * d[j] / m; }
      const E = eig3(C), nb = E[0].vec, u = E[2].vec, w = cross(nb, u);
      const c = circle2(Q.map(q => { const d = sub(q, c0); return [dot(d, u), dot(d, w)]; })); if (!c) return { s: 1e9 };
      return { s: Math.sqrt(Math.max(0, E[0].val)) + c.rms, Q, c0, nb, u, w, c };
    };
    // Coarse scan of the minor radius (both normal directions), then golden-section refinement.
    const Pk = n > 400 ? P.filter((_, i) => i % Math.ceil(n / 400) === 0) : P, Nk = n > 400 ? N.filter((_, i) => i % Math.ceil(n / 400) === 0) : N;
    const P0 = P, N0 = N; P = Pk; N = Nk;
    let best = null, seed = null;
    for (const sgn of [1, -1]) for (let r = 1; r <= 120; r *= 1.06) { const sc = score(sgn, r); if (!seed || sc.s < seed.s) seed = { s: sc.s, sgn, r }; }
    P = P0; N = N0;
    { let lo = seed.r / 1.07, hi = seed.r * 1.07;
      for (let k = 0; k < 50; k++) { const m1 = lo + (hi - lo) * 0.382, m2 = lo + (hi - lo) * 0.618; if (score(seed.sgn, m1).s < score(seed.sgn, m2).s) hi = m2; else lo = m1; }
      const r = (lo + hi) / 2; best = { ...score(seed.sgn, r), r }; }
    if (!best || !best.c || best.s > 0.05 * best.r + 0.3 || best.c.r < best.r) return null;   // tessellation limits accuracy to a few tenths of a mm
    const O = add(best.c0, add(mul(best.u, best.c.cx), mul(best.w, best.c.cy)));
    const ang = best.Q.map(q => { const d = sub(q, O); return Math.atan2(dot(d, best.w), dot(d, best.u)); }).sort((a, b) => a - b);
    let gap = 0, gi = 0; for (let i = 0; i < ang.length; i++) { const g = (i + 1 < ang.length ? ang[i + 1] : ang[0] + 2 * Math.PI) - ang[i]; if (g > gap) { gap = g; gi = i; } }
    const a1 = ang[(gi + 1) % ang.length], a0 = ang[gi], span = 2 * Math.PI - gap;
    const at = a => add(O, add(mul(best.u, best.c.r * Math.cos(a)), mul(best.w, best.c.r * Math.sin(a))));
    return { type: "torus", center: O, normal: best.nb, R: best.c.r, r: best.r, bend: span * 180 / Math.PI, ends: [at(a1), at(a1 + span)], rms: best.s, n };
  }
  // Coaxial partner of a tube or pipe wall (the other side of the wall), searched among nearby faces.
  function wallPair(cad, fit) {
    if (!fit || !["cyl", "cone", "torus"].includes(fit.type)) return null;
    const f0 = cad.faces[fit.fid], pad = 8;
    let best = null;
    for (const f of cad.faces) {
      if (f.id === fit.fid || f.hi[0] < f0.lo[0] - pad || f.lo[0] > f0.hi[0] + pad || f.hi[1] < f0.lo[1] - pad || f.lo[1] > f0.hi[1] + pad || f.hi[2] < f0.lo[2] - pad || f.lo[2] > f0.hi[2] + pad) continue;
      const g = fitFace(cad, f.id);
      if (fit.type === "torus") {
        if (g.type !== "torus" || len(sub(g.center, fit.center)) > 1 || Math.abs(Math.abs(dot(g.normal, fit.normal)) - 1) > 1e-3 || Math.abs(g.R - fit.R) > 1) continue;
        const d = Math.abs(g.r - fit.r); if (d > 0.2 && d < 6 && (!best || d < best.d)) best = { d, g };
      } else {
        if (g.type !== fit.type || Math.abs(Math.abs(dot(g.axis, fit.axis)) - 1) > 1e-3) continue;
        const off = sub(g.center, fit.center), miss = len(sub(off, mul(fit.axis, dot(off, fit.axis))));
        if (miss > 0.5 + 0.01 * fit.r) continue;
        const t0 = dot(sub(g.center, fit.center), fit.axis), gs = Math.sign(dot(g.axis, fit.axis)), gt = [t0 + gs * g.tmin, t0 + gs * g.tmax].sort((a, b) => a - b);
        const ov = Math.min(fit.tmax, gt[1]) - Math.max(fit.tmin, gt[0]);
        if (ov < Math.min(2, 0.3 * Math.min(fit.tmax - fit.tmin, gt[1] - gt[0]))) continue;   // must actually share length, not just touch
        const d = Math.abs(g.r - fit.r); if (d > 0.2 && d < 6 && (!best || d < best.d)) best = { d, g };
      }
    }
    if (!best) return null;
    const rIn = Math.min(fit.r, best.g.r), rOut = Math.max(fit.r, best.g.r);
    return { rIn, rOut, wall: rOut - rIn, partner: best.g.fid };
  }
  // Ray–triangle picking (Möller–Trumbore), with vertices mapped by xf (or as stored if xf is null).
  // keep(hit) can reject hits, e.g. in the half removed by a cutaway.
  function pick(cad, xf, o, d, keep) {
    let best = { t: Infinity, tri: -1 };
    const P = xf ? i => xf([cad.pos[i * 3], cad.pos[i * 3 + 1], cad.pos[i * 3 + 2]]) : i => [cad.pos[i * 3], cad.pos[i * 3 + 1], cad.pos[i * 3 + 2]];
    for (let t = 0; t < cad.tri.length / 3; t++) {
      const a = P(cad.tri[t * 3]), b = P(cad.tri[t * 3 + 1]), c = P(cad.tri[t * 3 + 2]);
      const e1 = sub(b, a), e2 = sub(c, a), h = cross(d, e2), det = dot(e1, h); if (Math.abs(det) < 1e-12) continue;
      const f = 1 / det, s = sub(o, a), u = f * dot(s, h); if (u < 0 || u > 1) continue;
      const q = cross(s, e1), v = f * dot(d, q); if (v < 0 || u + v > 1) continue;
      const tt = f * dot(e2, q); if (tt <= 1e-6 || tt >= best.t) continue;
      const hit = add(o, mul(d, tt)); if (keep && !keep(hit)) continue;
      best = { t: tt, tri: t, hit };
    }
    return best.tri >= 0 ? { ...best, fid: cad.faceOf[best.tri] } : null;
  }
  // Closest points between two lines (p + s·a, q + t·b).
  function lineLine(p, a, q, b) {
    const w = sub(p, q), aa = dot(a, a), bb = dot(b, b), ab = dot(a, b), aw = dot(a, w), bw = dot(b, w), den = aa * bb - ab * ab;
    const s = Math.abs(den) < 1e-12 ? 0 : (ab * bw - bb * aw) / den, t = Math.abs(den) < 1e-12 ? bw / bb : (aa * bw - ab * aw) / den;
    const P1 = add(p, mul(a, s)), P2 = add(q, mul(b, t)); return { s, t, P1, P2, dist: len(sub(P1, P2)) };
  }
  const api = { eig3, circle2, buildCad, fitFace, wallPair, pick, lineLine, vec: { dot, sub, add, mul, cross, len, unit, perp } };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.CADFit = api;
})(typeof window !== "undefined" ? window : globalThis);
