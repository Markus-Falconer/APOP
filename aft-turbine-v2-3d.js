"use strict";
/* Aft Turbine V2 · build options in 3D.
 * A small WebGL viewer plus parametric geometry for three ways to build the
 * adjustable shroud and the two-pipe split. Reads the page's inputs (st) and
 * model (solve, score, constants) from aft-turbine-v2.html, so it must load
 * after the page's own scripts. Units are mm; x runs aft from the nozzle
 * flange, y is the split direction, z is up.
 */
(function () {
  const D2R = Math.PI / 180;
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const unit = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

  // Colour per part type; the page legend and the parts cards use the same keys.
  const COL = {
    cone: [0.85, 0.58, 0.24], bend: [0.47, 0.60, 0.76], tube: [0.70, 0.72, 0.75],
    filler: [0.88, 0.45, 0.36], plate: [0.30, 0.66, 0.58], guide: [0.60, 0.54, 0.84],
    cart: [0.46, 0.47, 0.51], wheel: [0.33, 0.34, 0.37], motor: [0.22, 0.48, 0.84],
    engine: [0.66, 0.65, 0.62], ref: [0.55, 0.55, 0.55]
  };
  const css = c => `rgb(${c.map(v => Math.round(v * 255)).join(",")})`;
  window.BO_COLORS = Object.fromEntries(Object.entries(COL).map(([k, v]) => [k, css(v)]));

  // ---------------------------------------------------------------- meshes
  // A grid of rows of points; consecutive rows are joined by triangles.
  function grid(rows, close, edges) {
    const n = rows.length, m = rows[0].length, pos = new Float32Array(n * m * 3), nrm = new Float32Array(n * m * 3), idx = [];
    rows.forEach((r, i) => r.forEach((p, j) => pos.set(p, (i * m + j) * 3)));
    const M = close ? m : m - 1;
    for (let i = 0; i < n - 1; i++) for (let j = 0; j < M; j++) {
      const a = i * m + j, b = i * m + (j + 1) % m, c = (i + 1) * m + j, d = (i + 1) * m + (j + 1) % m;
      idx.push(a, c, b, b, c, d);
    }
    for (let t = 0; t < idx.length; t += 3) {
      const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]];
      const pa = [pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2]], pb = [pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2]], pc = [pos[c * 3], pos[c * 3 + 1], pos[c * 3 + 2]];
      const f = cross(sub(pb, pa), sub(pc, pa));
      for (const v of [a, b, c]) { nrm[v * 3] += f[0]; nrm[v * 3 + 1] += f[1]; nrm[v * 3 + 2] += f[2]; }
    }
    for (let v = 0; v < n * m; v++) {
      const l = Math.hypot(nrm[v * 3], nrm[v * 3 + 1], nrm[v * 3 + 2]);
      if (l > 1e-12) { nrm[v * 3] /= l; nrm[v * 3 + 1] /= l; nrm[v * 3 + 2] /= l; } else nrm[v * 3] = 1;
    }
    const lines = [];
    if (edges) for (const r of [rows[0], rows[n - 1]]) for (let j = 0; j < (close ? m : m - 1); j++) lines.push(...r[j], ...r[(j + 1) % m]);
    return { pos, nrm, idx: new Uint16Array(idx), lines: new Float32Array(lines) };
  }
  function merge(list) {
    let nv = 0, ni = 0, nl = 0;
    for (const g of list) { nv += g.pos.length; ni += g.idx.length; nl += g.lines.length; }
    const pos = new Float32Array(nv), nrm = new Float32Array(nv), idx = new Uint16Array(ni), lines = new Float32Array(nl);
    let ov = 0, oi = 0, ol = 0;
    for (const g of list) {
      pos.set(g.pos, ov); nrm.set(g.nrm, ov);
      for (let k = 0; k < g.idx.length; k++) idx[oi + k] = g.idx[k] + ov / 3;
      lines.set(g.lines, ol); ov += g.pos.length; oi += g.idx.length; ol += g.lines.length;
    }
    return { pos, nrm, idx, lines };
  }
  const ringPts = (x, cy, cz, r, m) => Array.from({ length: m }, (_, j) => { const t = j / m * 2 * Math.PI; return [x, cy + r * Math.cos(t), cz + r * Math.sin(t)]; });
  // Surface of revolution about an axis parallel to x through (cy, cz); profile is [[x, r], ...].
  // Each profile segment is its own strip, so corners stay sharp and get an edge line.
  const revolve = (profile, cy = 0, cz = 0, m = 64) => merge(profile.slice(1).map((q, i) => grid([ringPts(profile[i][0], cy, cz, profile[i][1], m), ringPts(q[0], cy, cz, q[1], m)], true, true)));
  // Boundary of a star-shaped region seen from (cy, cz), found by bisection along rays.
  function starRing(x, cy, cz, inside, m, rmin = 0.01, rmax = 300) {
    return Array.from({ length: m }, (_, j) => {
      const t = j / m * 2 * Math.PI, c = Math.cos(t), s = Math.sin(t);
      let lo = rmin, hi = rmax;
      if (inside(cy + lo * c, cz + lo * s)) { for (let k = 0; k < 40; k++) { const md = (lo + hi) / 2; if (inside(cy + md * c, cz + md * s)) lo = md; else hi = md; } }
      return [x, cy + lo * c, cz + lo * s];
    });
  }
  // Flat plate at station x: the region given by inside(), with a round hole of radius holeR at (cy, cz).
  const plate = (x, cy, cz, holeR, inside, m = 72) => grid([ringPts(x, cy, cz, holeR, m), starRing(x, cy, cz, inside, m, holeR)], true, true);
  // Loft between two star-shaped outlines (functions of angle → radius) at x0 and x1; straight generators, so it can be made from sheet.
  function loft(x0, rho0, x1, rho1, m = 96, n = 6) {
    const rows = [];
    for (let i = 0; i <= n; i++) {
      const s = i / n, x = x0 + (x1 - x0) * s;
      rows.push(Array.from({ length: m }, (_, j) => { const t = j / m * 2 * Math.PI, r = (1 - s) * rho0(t) + s * rho1(t); return [x, r * Math.cos(t), r * Math.sin(t)]; }));
    }
    return grid(rows, true, true);
  }
  const rhoOf = (inside, rmax = 300) => t => { const c = Math.cos(t), s = Math.sin(t); let lo = 0, hi = rmax; for (let k = 0; k < 40; k++) { const md = (lo + hi) / 2; if (inside(md * c, md * s)) lo = md; else hi = md; } return lo; };
  // Planar centreline in the xy-plane: straights {L} and arcs {R, a} (a in degrees, + turns toward +y).
  function path(start, hDeg, segs, step = 2) {
    let p = [start[0], start[1], 0], h = hDeg * D2R;
    const out = [{ p: p.slice(), t: [Math.cos(h), Math.sin(h), 0] }];
    for (const sg of segs) {
      if (sg.L !== undefined) {
        if (sg.L <= 1e-6) continue;
        const n = Math.max(1, Math.ceil(sg.L / step)), p0 = p.slice();
        for (let k = 1; k <= n; k++) { p = [p0[0] + Math.cos(h) * sg.L * k / n, p0[1] + Math.sin(h) * sg.L * k / n, 0]; out.push({ p, t: [Math.cos(h), Math.sin(h), 0] }); }
      } else {
        const a = sg.a * D2R; if (Math.abs(a) < 1e-6) continue;
        const sgn = Math.sign(a), c = [p[0] - sgn * sg.R * Math.sin(h), p[1] + sgn * sg.R * Math.cos(h)], h0 = h, n = Math.max(2, Math.ceil(sg.R * Math.abs(a) / step));
        for (let k = 1; k <= n; k++) { h = h0 + a * k / n; p = [c[0] + sgn * sg.R * Math.sin(h), c[1] - sgn * sg.R * Math.cos(h), 0]; out.push({ p, t: [Math.cos(h), Math.sin(h), 0] }); }
      }
    }
    return out;
  }
  const sweep = (pts, r, m = 40) => grid(pts.map(({ p, t }) => {
    const n = [-t[1], t[0], 0];
    return Array.from({ length: m }, (_, j) => { const a = j / m * 2 * Math.PI; return [p[0] + r * Math.cos(a) * n[0], p[1] + r * Math.cos(a) * n[1], r * Math.sin(a)]; });
  }), true, true);
  function blades(xw, n = 24, beta = 47) {
    const list = [];
    for (let i = 0; i < n; i++) {
      const ph = i / n * 2 * Math.PI, rows = [];
      for (const r of [18.9, 24, 28.9]) rows.push(Array.from({ length: 5 }, (_, k) => {
        const s = k / 4, x = xw + 0.4 + s * 6.0, ang = ph + (s - 0.5) * 6.0 * Math.tan(beta * D2R) / r;
        return [x, r * Math.cos(ang), r * Math.sin(ang)];
      }));
      list.push(grid(rows, false, false));
    }
    return merge(list);
  }
  function dashes(pts, on = 4, off = 3) {
    const out = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1], L = Math.hypot(...sub(b, a));
      for (let s = 0; s < L; s += on + off) { const e = Math.min(L, s + on), f = k => a.map((v, q) => v + (b[q] - v) * k / L); out.push(...f(s), ...f(e)); }
    }
    return out;
  }
  const empty = () => ({ pos: new Float32Array(0), nrm: new Float32Array(0), idx: new Uint16Array(0), lines: new Float32Array(0) });

  // ---------------------------------------------------------------- geometry
  const CASE = 48.5, R_IN = INLET / 2, R_HUB = HUB / 2, TRAVEL = 25, MOTOR_L = 57.5, MOTOR_R = 29.3 / 2;
  const IN_TO_MM = 25.4, STOCK_LEN = 241 - 40.4;
  function common(exitOverride) {
    const travel = Math.max(TRAVEL, st.xw), Lc = travel + WHEEL_W + 2, a = st.cone * D2R;
    const rp = (st.legID + 1.8) / 2, exitID = Math.min(exitOverride || st.exitID, st.legID), re = (exitID + 1.8) / 2;
    return { travel, Lc, a, Rc: R_IN + Lc * Math.tan(a), rp, re, exitID, yc: st.tunnel / 2 + rp, xw: st.xw, Lr: re < rp - 0.2 ? 16 : 0 };
  }
  // Parts shared by every option: engine stub, cone shroud, turbine wheel.
  function base(c, parts) {
    const P = (g, k, o = {}) => parts.push({ g, k, c: COL[k], cut: true, env: true, ex: [0, 0, 0], ...o });
    P(merge([revolve([[-26, CASE], [-14, CASE], [-6, 45], [-1.5, 37], [0, 34]]), revolve([[0, 34], [0, R_IN]])]), "engine", { env: false, ex: [-25, 0, 0] });
    P(revolve([[-3, R_IN], [-3, R_HUB], [-3, 0.1]]), "wheel", { env: false, ex: [-25, 0, 0] });
    P(revolve([[0, R_IN], [c.Lc, c.Rc]], 0, 0, 80), "cone");
    P(merge([revolve([[c.xw, 0.1], [c.xw, R_HUB], [c.xw + WHEEL_W, R_HUB]]), blades(c.xw)]), "wheel", { cut: false, ex: [0, 0, 55] });
  }
  const internal = { cut: false, ex: [0, 0, 55] };
  function exitPipe(parts, c, s, x0, ex) {
    const xs = c.xEnd - c.Lr;
    parts.push({ g: revolve([[x0, c.rp], [xs, c.rp]], s * c.yc), k: "tube", c: COL.tube, cut: true, env: true, ex });
    if (c.Lr) parts.push({ g: revolve([[xs, c.rp], [c.xEnd, c.re]], s * c.yc), k: "cone", c: COL.cone, cut: true, env: true, ex });
  }
  function refLines(parts, xMax) {
    const L = [];
    for (let k = 0; k < 12; k++) { const t = k / 12 * 2 * Math.PI; L.push(...dashes([[0, CASE * Math.cos(t), CASE * Math.sin(t)], [xMax, CASE * Math.cos(t), CASE * Math.sin(t)]])); }
    for (const x of [0, xMax]) L.push(...dashes(ringPts(x, 0, 0, CASE, 96).concat([[x, CASE, 0]]), 3, 3));
    parts.push({ g: { ...empty(), lines: new Float32Array(L) }, k: "ref", c: COL.ref, cut: true, env: false, ex: [0, 0, 0], ref: true });
  }

  // Option A: two mandrel bends cut on the centre plane and welded into a Y ("pants"), joined to the cone by two filler cheeks.
  function optionA(ex) {
    const c = common(ex), parts = [], R = 1.5 * 2 * c.rp, ys = 0.9 * c.rp, Lboot = 16, xa = c.Lc + Lboot, dy = c.yc - ys;
    const Lmin = th => c.rp * Math.tan(th) + 2, lat = (th, L) => L * Math.sin(th) + R * (1 - Math.cos(th));
    let th = 40 * D2R, Ls = (dy - R * (1 - Math.cos(th))) / Math.sin(th);
    if (Ls < Lmin(th)) { let lo = 5 * D2R, hi = th; for (let k = 0; k < 50; k++) { const md = (lo + hi) / 2; if (lat(md, Lmin(md)) < dy) lo = md; else hi = md; } th = (lo + hi) / 2; Ls = Lmin(th); }
    const xPar = xa + Ls * Math.cos(th) + R * Math.sin(th), ay = c.rp / Math.cos(th);
    const xCr = xa + Math.max(0, ay - ys) / Math.tan(th), rG = 12.7, xM = xPar + c.xw;
    c.xEnd = xM + MOTOR_L + 4;
    base(c, parts);
    const fig8 = (y, z) => ((y - ys) / ay) ** 2 + (z / c.rp) ** 2 <= 1 || ((y + ys) / ay) ** 2 + (z / c.rp) ** 2 <= 1;
    parts.push({ g: loft(c.Lc, () => c.Rc, xa, rhoOf(fig8)), k: "filler", c: COL.filler, cut: true, env: true, ex: [14, 0, 0] });
    for (const s of [1, -1]) {
      const e = c.rp * Math.tan(th) + 4, start = [xa - e * Math.cos(th), s * (ys - e * Math.sin(th))];
      const pts = path(start, s * th / D2R, [{ L: e + Ls }, { R, a: -s * th / D2R }, { L: Math.max(2, c.xEnd - c.Lr - xPar) }]);
      parts.push({ g: sweep(pts, c.rp), k: "bend", c: COL.bend, cut: true, env: true, pl: [[1, 0, 0, -xa], [0, s, 0, 0]], ex: [30, s * 16, 0] });
      if (c.Lr) parts.push({ g: revolve([[c.xEnd - c.Lr, c.rp], [c.xEnd, c.re]], s * c.yc), k: "cone", c: COL.cone, cut: true, env: true, ex: [30, s * 16, 0] });
    }
    const rT = Math.min(st.tunnel, 38.1) / 2;
    parts.push({ g: merge([revolve([[xCr - 3, rG], [xPar - 8, rG], [xPar, rT], [c.xEnd, rT]])]), k: "guide", c: COL.guide, cut: true, env: true, ex: [30, 0, 0] });
    const xN = c.xw + WHEEL_W, xC = xM - 20;
    parts.push({ g: revolve([[xN, R_HUB], [xN + 14, 11], [xC, 11]]), k: "cart", c: COL.cart, ...internal });
    parts.push({ g: revolve([[xC, 10], [xC + 18, 10]]), k: "cart", c: COL.cart, ...internal });
    parts.push({ g: merge([revolve([[xM, 0.1], [xM, MOTOR_R], [xM + MOTOR_L, MOTOR_R], [xM + MOTOR_L, 0.1]])]), k: "motor", c: COL.motor, ...internal });
    refLines(parts, c.xEnd);
    const Lleg = Ls + R * th + Math.max(2, c.xEnd - c.Lr - xPar);
    return {
      parts, c, K: 0.30, xEnd: c.xEnd,
      dims: [
        ["Cone", `${fx(INLET, 1)} → ${fx(2 * c.Rc, 1)} mm ID over ${fx(c.Lc)} mm`],
        ["Filler cheeks", `${fx(Lboot)} mm long, round ${fx(2 * c.Rc)} → figure-8 ${fx(2 * (ys + ay))} × ${fx(2 * c.rp)} mm`],
        ["Leg inlets", `centres ±${fx(ys, 1)} mm, cut on the centre plane at x = ${fx(xa)}`],
        ["Leg bend", `${fx(th / D2R, 1)}° at ${fx(R)} mm CLR, after a ${fx(Ls, 1)} mm straight`],
        ["Legs parallel at", `x = ${fx(xPar)} mm, centres ±${fx(c.yc, 1)} mm`],
        ["Crotch", `x ≈ ${fx(xCr)} mm; 1 in guide tube passes through it`],
        ["Motor", `x = ${fx(xM)} to ${fx(xM + MOTOR_L)} mm`],
        ["Exits", `x = ${fx(c.xEnd)} mm, Ø${fx(c.exitID, 1)} ID`]
      ],
      bom: [
        `Cone: rolled ${fx(INLET, 1)} → ${fx(2 * c.Rc, 1)} mm, ${fx(c.Lc)} mm long (flat pattern below)`,
        `2 filler cheeks (top and bottom), 0.8 mm sheet, about ${fx(Lboot + 6)} × ${fx(Math.PI * c.Rc)} mm blanks`,
        `2 legs from ${fx(2 * c.rp, 1)} mm OD mandrel bends: ${fx(Ls, 1)} mm straight + ${fx(th / D2R, 0)}° bend at ${fx(R)} mm CLR + straight, about ${fx(Lleg)} mm centreline each`,
        `Weld seam along the centre plane where the two legs overlap, about ${fx(2 * (xCr - xa) + 20)} mm long`,
        `Guide: 1 in × 20 ga tube from the crotch, coned up to a ${fx(2 * rT, 1)} mm motor tunnel`,
        c.Lr ? `2 exit reducers ${fx(st.legID, 1)} → ${fx(c.exitID, 1)} mm ID` : `Exits: plain pipe ends, Ø${fx(c.exitID, 1)} ID`
      ]
    };
  }

  // Option B: a sheet-metal round-to-oval transition ("fishtail") spreads the flow sideways into two straight pipes.
  function optionB(ex) {
    const c = common(ex), parts = [], rG = 19.05, Wh = c.yc + c.rp, Hh = c.rp + 0.5;
    const flare = Wh - c.Rc, Lf = Math.max(24, flare / Math.tan(30 * D2R)), xa = c.Lc + Lf, xM = xa + 2 + c.xw;
    c.xEnd = xM + MOTOR_L + 4;
    base(c, parts);
    const stad = (W, H) => (y, z) => Math.abs(y) <= W - H ? Math.abs(z) <= H : (Math.abs(y) - (W - H)) ** 2 + z * z <= H * H;
    parts.push({ g: loft(c.Lc, () => c.Rc, xa, rhoOf(stad(Wh, Hh))), k: "filler", c: COL.filler, cut: true, env: true, ex: [14, 0, 0] });
    const gus = [];
    for (const sy of [1, -1]) for (const sz of [1, -1]) {
      const inside = (y, z) => sy * y >= 0 && sz * z >= 0 && Math.abs(z) <= Hh && Math.abs(y) <= c.yc && y * y + z * z >= rG * rG && (Math.abs(y) - c.yc) ** 2 + z * z >= c.rp * c.rp;
      gus.push(plate(xa, sy * c.yc / 2, sz * Math.min(Hh * 0.75, 14), 0.2, inside, 48));
    }
    parts.push({ g: merge(gus), k: "filler", c: COL.filler, cut: true, env: true, ex: [28, 0, 0] });
    for (const s of [1, -1]) exitPipe(parts, c, s, xa, [42, s * 12, 0]);
    parts.push({ g: revolve([[c.Lc, rG], [c.xEnd, rG]]), k: "guide", c: COL.guide, cut: true, env: true, ex: [42, 0, 0] });
    const xC = xM - 20;
    parts.push({ g: revolve([[c.xw + WHEEL_W, R_HUB], [c.xw + WHEEL_W + 4, 18], [xC, 18]]), k: "cart", c: COL.cart, ...internal });
    parts.push({ g: revolve([[xC, 14], [xC + 18, 14]]), k: "cart", c: COL.cart, ...internal });
    parts.push({ g: revolve([[xM, 0.1], [xM, MOTOR_R], [xM + MOTOR_L, MOTOR_R], [xM + MOTOR_L, 0.1]]), k: "motor", c: COL.motor, ...internal });
    refLines(parts, c.xEnd);
    const ang = Math.atan(flare / Lf) / D2R, angV = Math.atan((c.Rc - Hh) / Lf) / D2R;
    return {
      parts, c, K: 0.40, xEnd: c.xEnd, flareDeg: ang,
      dims: [
        ["Cone", `${fx(INLET, 1)} → ${fx(2 * c.Rc, 1)} mm ID over ${fx(c.Lc)} mm`],
        ["Fishtail", `round Ø${fx(2 * c.Rc)} → oval ${fx(2 * Wh)} × ${fx(2 * Hh)} mm over ${fx(Lf)} mm`],
        ["Fishtail wall angles", `${fx(ang)}° outward at the sides, ${fx(angV)}° inward top and bottom`],
        ["Pipes", `straight, centres ±${fx(c.yc, 1)} mm, from x = ${fx(xa)} mm`],
        ["Guide tube", `1.5 in, x = ${fx(c.Lc)} mm to the end; pipes weld to it`],
        ["Motor", `x = ${fx(xM)} to ${fx(xM + MOTOR_L)} mm`],
        ["Exits", `x = ${fx(c.xEnd)} mm, Ø${fx(c.exitID, 1)} ID`]
      ],
      bom: [
        `Cone: rolled ${fx(INLET, 1)} → ${fx(2 * c.Rc, 1)} mm, ${fx(c.Lc)} mm long (flat pattern below)`,
        `Fishtail: 2 halves (top and bottom) of 0.8 mm sheet, round Ø${fx(2 * c.Rc)} to oval ${fx(2 * Wh)} × ${fx(2 * Hh)} mm, ${fx(Lf)} mm long; laid out like an HVAC round-to-oval transition`,
        `4 small gussets closing the corners between the pipes and the guide tube`,
        `2 straight pipes, ${fx(2 * c.rp, 1)} mm OD, ${fx(c.xEnd - c.Lr - xa)} mm long`,
        `Guide: 1.5 in × 20 ga tube, ${fx(c.xEnd - c.Lc)} mm long`,
        c.Lr ? `2 exit reducers ${fx(st.legID, 1)} → ${fx(c.exitID, 1)} mm ID` : `Exits: plain pipe ends, Ø${fx(c.exitID, 1)} ID`
      ]
    };
  }

  // Option C: the cone dumps into a short box of two laser-cut plates and a wrapped strip; pipes and guide go straight through the rear plate.
  function optionC(ex) {
    const c = common(ex), parts = [], rG = 19.05, Wh = c.yc + c.rp + 2, Hh = Math.max(c.Rc, c.rp) + 2, Lb = Math.round(0.6 * st.legID);
    const xf = c.Lc, xr = xf + Lb, xM = xr + 2 + c.xw;
    c.xEnd = xM + MOTOR_L + 4;
    base(c, parts);
    const stad = (y, z) => Math.abs(y) <= Wh - Hh ? Math.abs(z) <= Hh : (Math.abs(y) - (Wh - Hh)) ** 2 + z * z <= Hh * Hh;
    parts.push({ g: plate(xf, 0, 0, c.Rc, stad, 96), k: "plate", c: COL.plate, cut: true, env: true, ex: [12, 0, 0] });
    const outline = starRing(0, 0, 0, stad, 120);
    parts.push({ g: grid([outline.map(p => [xf, p[1], p[2]]), outline.map(p => [xr, p[1], p[2]])], true, true), k: "filler", c: COL.filler, cut: true, env: true, ex: [24, 0, 0] });
    const yb = (rG + c.yc - c.rp) / 2;
    parts.push({ g: merge([
      plate(xr, 0, 0, rG, (y, z) => stad(y, z) && Math.abs(y) <= yb, 72),
      plate(xr, c.yc, 0, c.rp, (y, z) => stad(y, z) && y >= yb, 72),
      plate(xr, -c.yc, 0, c.rp, (y, z) => stad(y, z) && y <= -yb, 72)
    ]), k: "plate", c: COL.plate, cut: true, env: true, ex: [36, 0, 0] });
    for (const s of [1, -1]) exitPipe(parts, c, s, xr - 3, [48, s * 12, 0]);
    parts.push({ g: revolve([[xf, rG], [c.xEnd, rG]]), k: "guide", c: COL.guide, cut: true, env: true, ex: [48, 0, 0] });
    const xC = xM - 20;
    parts.push({ g: revolve([[c.xw + WHEEL_W, R_HUB], [c.xw + WHEEL_W + 4, 18], [xC, 18]]), k: "cart", c: COL.cart, ...internal });
    parts.push({ g: revolve([[xC, 14], [xC + 18, 14]]), k: "cart", c: COL.cart, ...internal });
    parts.push({ g: revolve([[xM, 0.1], [xM, MOTOR_R], [xM + MOTOR_L, MOTOR_R], [xM + MOTOR_L, 0.1]]), k: "motor", c: COL.motor, ...internal });
    refLines(parts, c.xEnd);
    const per = 2 * Math.PI * Hh + 4 * (Wh - Hh);
    return {
      parts, c, K: 0.75, xEnd: c.xEnd,
      dims: [
        ["Cone", `${fx(INLET, 1)} → ${fx(2 * c.Rc, 1)} mm ID over ${fx(c.Lc)} mm`],
        ["Box", `${fx(2 * Wh)} × ${fx(2 * Hh)} mm oval, ${fx(Lb)} mm deep, x = ${fx(xf)} to ${fx(xr)} mm`],
        ["Rear plate holes", `2 × Ø${fx(2 * c.rp, 1)} at ±${fx(c.yc, 1)} mm, Ø38.1 in the centre`],
        ["Pipes", `straight, centres ±${fx(c.yc, 1)} mm`],
        ["Motor", `x = ${fx(xM)} to ${fx(xM + MOTOR_L)} mm`],
        ["Exits", `x = ${fx(c.xEnd)} mm, Ø${fx(c.exitID, 1)} ID`]
      ],
      bom: [
        `Cone: rolled ${fx(INLET, 1)} → ${fx(2 * c.Rc, 1)} mm, ${fx(c.Lc)} mm long (flat pattern below)`,
        `Front plate: ${fx(2 * Wh)} × ${fx(2 * Hh)} mm oval with a Ø${fx(2 * c.Rc)} hole, 1.2 mm laser or waterjet cut`,
        `Rear plate: same oval with 2 × Ø${fx(2 * c.rp, 1)} holes at ±${fx(c.yc, 1)} mm and a Ø38.1 centre hole`,
        `Wrap: 0.8 mm strip ${fx(Lb)} × ${fx(per)} mm, rolled around the plates`,
        `2 straight pipes, ${fx(2 * c.rp, 1)} mm OD, ${fx(c.xEnd - c.Lr - xr + 3)} mm long`,
        `Guide: 1.5 in × 20 ga tube, ${fx(c.xEnd - xf)} mm long`,
        c.Lr ? `2 exit reducers ${fx(st.legID, 1)} → ${fx(c.exitID, 1)} mm ID` : `Exits: plain pipe ends, Ø${fx(c.exitID, 1)} ID`
      ]
    };
  }

  function envelope(parts) {
    let r = 0, zmax = 0, ymax = 0, xmax = 0;
    for (const p of parts) if (p.env) for (let i = 0; i < p.g.pos.length; i += 3) {
      const x = p.g.pos[i], y = p.g.pos[i + 1], z = p.g.pos[i + 2];
      r = Math.max(r, Math.hypot(y, z)); ymax = Math.max(ymax, Math.abs(y)); zmax = Math.max(zmax, Math.abs(z)); xmax = Math.max(xmax, x);
    }
    return { r, W: 2 * ymax, H: 2 * zmax, L: xmax };
  }

  // ---------------------------------------------------------------- viewer
  const VS = `attribute vec3 aP; attribute vec3 aN; uniform mat4 uVP; uniform vec3 uOff;
varying vec3 vM; varying vec3 vN; varying vec3 vW;
void main(){ vM = aP; vN = aN; vW = aP + uOff; gl_Position = uVP * vec4(vW, 1.0); }`;
  const FS = `precision highp float;
varying vec3 vM; varying vec3 vN; varying vec3 vW;
uniform vec3 uCol; uniform float uFlat; uniform float uA; uniform float uSec;
uniform vec4 uPl0; uniform vec4 uPl1; uniform vec3 uEye; uniform vec3 uKey;
void main(){
  if (dot(uPl0.xyz, uPl0.xyz) > 0.0 && dot(uPl0.xyz, vM) + uPl0.w < 0.0) discard;
  if (dot(uPl1.xyz, uPl1.xyz) > 0.0 && dot(uPl1.xyz, vM) + uPl1.w < 0.0) discard;
  if (uSec > 0.5 && vM.z > 0.05) discard;
  if (uFlat > 0.5) { gl_FragColor = vec4(uCol, uA); return; }
  vec3 n = normalize(vN); vec3 v = normalize(uEye - vW); if (dot(n, v) < 0.0) n = -n;
  float d = max(dot(n, uKey), 0.0); vec3 h = normalize(uKey + v); float s = pow(max(dot(n, h), 0.0), 48.0);
  gl_FragColor = vec4(uCol * (0.36 + 0.62 * d) + vec3(0.16 * s), 1.0);
}`;
  const PRESETS = { iso: [-58, 30], top: [-90, 89], side: [-90, 0], rear: [0, 0] };
  function persp(f, asp, n, fa) { const t = 1 / Math.tan(f / 2); return [t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (fa + n) / (n - fa), -1, 0, 0, 2 * fa * n / (n - fa), 0]; }
  function mmul(a, b) { const r = new Array(16).fill(0); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) r[i + 4 * j] += a[i + 4 * k] * b[k + 4 * j]; return r; }

  function View(host, label) {
    this.host = host; this.preset = "iso"; [this.yaw, this.pitch] = PRESETS.iso; this.zoom = 1; this.section = true; this.exp = 0; this.expTo = 0;
    host.innerHTML = `<div class="bo-bar">
      <div class="seg" role="group" aria-label="View">${Object.keys(PRESETS).map(k => `<button type="button" data-v="${k}">${k[0].toUpperCase() + k.slice(1)}</button>`).join("")}</div>
      <div class="seg" role="group" aria-label="Display"><button type="button" data-t="section">Cutaway</button><button type="button" data-t="exp">Exploded</button></div>
    </div><div class="bo-view"><canvas role="img" aria-label="${label}"></canvas><div class="bo-hint">Drag to rotate · pinch or Ctrl + scroll to zoom · double-click to reset</div></div>`;
    this.cv = host.querySelector("canvas");
    const gl = this.gl = this.cv.getContext("webgl", { antialias: true, alpha: true, premultipliedAlpha: false });
    if (!gl) { host.querySelector(".bo-view").innerHTML = `<p class="bo-fallback">This browser has WebGL turned off, so the 3D view can't be drawn. The parts list and dimensions below still apply.</p>`; return; }
    const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(o)); return o; };
    const pr = this.pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pr);
    this.u = {}; for (const n of ["uVP", "uOff", "uCol", "uFlat", "uA", "uSec", "uPl0", "uPl1", "uEye", "uKey"]) this.u[n] = gl.getUniformLocation(pr, n);
    this.aP = gl.getAttribLocation(pr, "aP"); this.aN = gl.getAttribLocation(pr, "aN");
    this.bufs = [];
    host.querySelectorAll("[data-v]").forEach(b => b.addEventListener("click", () => this.setPreset(b.dataset.v)));
    host.querySelector('[data-t="section"]').addEventListener("click", () => { this.section = !this.section; this.ui(); this.draw(); });
    host.querySelector('[data-t="exp"]').addEventListener("click", () => { this.expTo = this.expTo ? 0 : 1; this.ui(); this.animate(); });
    const ptr = new Map(); let pinch = 0;
    this.cv.addEventListener("pointerdown", e => { this.cv.setPointerCapture(e.pointerId); ptr.set(e.pointerId, [e.clientX, e.clientY]); if (ptr.size === 2) { const [a, b] = [...ptr.values()]; pinch = Math.hypot(a[0] - b[0], a[1] - b[1]); } });
    this.cv.addEventListener("pointermove", e => {
      if (!ptr.has(e.pointerId)) return;
      const prev = ptr.get(e.pointerId); ptr.set(e.pointerId, [e.clientX, e.clientY]);
      if (ptr.size === 1) { this.yaw -= (e.clientX - prev[0]) * 0.45; this.pitch = Math.max(-89, Math.min(89, this.pitch + (e.clientY - prev[1]) * 0.45)); this.preset = null; this.ui(); }
      else if (ptr.size === 2) { const [a, b] = [...ptr.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (pinch) this.zoom = Math.max(0.4, Math.min(6, this.zoom * d / pinch)); pinch = d; }
      this.draw();
    });
    const up = e => { ptr.delete(e.pointerId); pinch = 0; };
    this.cv.addEventListener("pointerup", up); this.cv.addEventListener("pointercancel", up);
    this.cv.addEventListener("dblclick", () => this.setPreset("iso"));
    this.cv.addEventListener("wheel", e => { if (!(e.ctrlKey || e.metaKey)) return; e.preventDefault(); this.zoom = Math.max(0.4, Math.min(6, this.zoom * Math.exp(-e.deltaY * 0.004))); this.draw(); }, { passive: false });
    new ResizeObserver(() => this.draw()).observe(this.cv);
    this.ui();
  }
  View.prototype.ui = function () {
    this.host.querySelectorAll("[data-v]").forEach(b => b.setAttribute("aria-pressed", b.dataset.v === this.preset));
    this.host.querySelector('[data-t="section"]').setAttribute("aria-pressed", this.section);
    this.host.querySelector('[data-t="exp"]').setAttribute("aria-pressed", !!this.expTo);
  };
  View.prototype.setPreset = function (k) { this.preset = k; [this.yaw, this.pitch] = PRESETS[k]; this.zoom = 1; this.fitDist = null; this.ui(); this.draw(); };
  View.prototype.animate = function () {
    const t0 = performance.now(), e0 = this.exp, step = now => { const k = Math.min(1, (now - t0) / 350); this.exp = e0 + (this.expTo - e0) * (1 - (1 - k) ** 3); this.fitDist = null; this.drawNow(); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  };
  View.prototype.set = function (parts) {
    const gl = this.gl; if (!gl) return;
    for (const b of this.bufs) for (const x of [b.p, b.n, b.i, b.l]) if (x) gl.deleteBuffer(x);
    const mk = (t, d) => { if (!d.length) return null; const o = gl.createBuffer(); gl.bindBuffer(t, o); gl.bufferData(t, d, gl.STATIC_DRAW); return o; };
    this.bufs = parts.map(p => ({ p: mk(gl.ARRAY_BUFFER, p.g.pos), n: mk(gl.ARRAY_BUFFER, p.g.nrm), i: mk(gl.ELEMENT_ARRAY_BUFFER, p.g.idx), ni: p.g.idx.length, l: mk(gl.ARRAY_BUFFER, p.g.lines), nl: p.g.lines.length / 3, part: p }));
    let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
    for (const p of parts) if (!p.ref) for (let i = 0; i < p.g.pos.length; i += 3) for (let q = 0; q < 3; q++) { lo[q] = Math.min(lo[q], p.g.pos[i + q]); hi[q] = Math.max(hi[q], p.g.pos[i + q]); }
    lo[0] = Math.max(lo[0], -30);
    this.pts = [];
    for (const p of parts) if (!p.ref) for (let i = 0; i < p.g.pos.length; i += 15) if (p.g.pos[i] > -16) this.pts.push([p.g.pos[i], p.g.pos[i + 1], p.g.pos[i + 2], p.ex]);
    const grew = !this.box || hi[0] - lo[0] > 1.1 * (this.box.hi[0] - this.box.lo[0]) || hi[0] - lo[0] < 0.8 * (this.box.hi[0] - this.box.lo[0]);
    this.box = { lo, hi };
    if (grew) this.fitDist = null;
    this.draw();
  };
  View.prototype.camera = function () {
    const lo2 = [1e9, 1e9, 1e9], hi2 = [-1e9, -1e9, -1e9];
    for (const [x, y0, z, e] of this.pts) { const q = [x + e[0] * this.exp, y0 + e[1] * this.exp, z + e[2] * this.exp]; for (let k = 0; k < 3; k++) { lo2[k] = Math.min(lo2[k], q[k]); hi2[k] = Math.max(hi2[k], q[k]); } }
    const tgt = lo2.map((v, q) => (v + hi2[q]) / 2), y = this.yaw * D2R, p = this.pitch * D2R;
    const dir = [Math.cos(p) * Math.cos(y), Math.cos(p) * Math.sin(y), Math.sin(p)];
    const zc = dir, xc = unit(cross([0, 0, 1], zc)), yc = cross(zc, xc);
    const f = 28 * D2R, asp = this.cv.width / this.cv.height, tx = Math.tan(f / 2) * asp, ty = Math.tan(f / 2);
    if (!this.fitDist) {
      let d = 1;
      for (const [x, y, z, e] of this.pts) {
        const v = sub([x + e[0] * this.exp, y + e[1] * this.exp, z + e[2] * this.exp], tgt);
        const X = dot(v, xc), Y = dot(v, yc), Z = dot(v, zc);
        d = Math.max(d, Z + Math.abs(X) / tx, Z + Math.abs(Y) / ty);
      }
      this.fitDist = d * 1.08;
    }
    const dist = this.fitDist / this.zoom, eye = tgt.map((v, q) => v + dir[q] * dist);
    const view = [xc[0], yc[0], zc[0], 0, xc[1], yc[1], zc[1], 0, xc[2], yc[2], zc[2], 0, -dot(xc, eye), -dot(yc, eye), -dot(zc, eye), 1];
    const key = unit([dir[0] + yc[0] * 0.7 - xc[0] * 0.4, dir[1] + yc[1] * 0.7 - xc[1] * 0.4, dir[2] + yc[2] * 0.7 - xc[2] * 0.4]);
    return { vp: mmul(persp(f, asp, dist / 40, dist * 6), view), eye, key };
  };
  View.prototype.draw = function () { if (!this.gl || this.raf) return; this.raf = requestAnimationFrame(() => { this.raf = 0; this.drawNow(); }); };
  View.prototype.drawNow = function () {
    const gl = this.gl, cv = this.cv; if (!gl || !this.box) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1), w = Math.round(cv.clientWidth * dpr), h = Math.round(cv.clientHeight * dpr);
    if (!w || !h) return;
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; this.fitDist = null; }
    const cam = this.camera(), u = this.u;
    gl.viewport(0, 0, w, h); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.useProgram(this.pr);
    gl.uniformMatrix4fv(u.uVP, false, new Float32Array(cam.vp)); gl.uniform3fv(u.uEye, cam.eye); gl.uniform3fv(u.uKey, cam.key);
    gl.enableVertexAttribArray(this.aP);
    const common = b => {
      const p = b.part, pl = p.pl || [];
      gl.uniform3fv(u.uOff, p.ex.map(v => v * this.exp));
      gl.uniform4fv(u.uPl0, pl[0] || [0, 0, 0, 0]); gl.uniform4fv(u.uPl1, pl[1] || [0, 0, 0, 0]);
      gl.uniform1f(u.uSec, this.section && p.cut ? 1 : 0);
    };
    gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1, 1);
    gl.uniform1f(u.uFlat, 0); gl.uniform1f(u.uA, 1); gl.disable(gl.BLEND);
    gl.enableVertexAttribArray(this.aN);
    for (const b of this.bufs) {
      if (!b.p) continue; common(b);
      gl.uniform3fv(u.uCol, b.part.c);
      gl.bindBuffer(gl.ARRAY_BUFFER, b.p); gl.vertexAttribPointer(this.aP, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, b.n); gl.vertexAttribPointer(this.aN, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, b.i); gl.drawElements(gl.TRIANGLES, b.ni, gl.UNSIGNED_SHORT, 0);
    }
    gl.disable(gl.POLYGON_OFFSET_FILL); gl.disableVertexAttribArray(this.aN); gl.vertexAttrib3f(this.aN, 1, 0, 0);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.uniform1f(u.uFlat, 1);
    for (const b of this.bufs) {
      if (!b.l) continue; common(b);
      gl.uniform3fv(u.uCol, b.part.ref ? b.part.c : b.part.c.map(v => v * 0.45)); gl.uniform1f(u.uA, b.part.ref ? 0.75 : 0.9);
      gl.bindBuffer(gl.ARRAY_BUFFER, b.l); gl.vertexAttribPointer(this.aP, 3, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.LINES, 0, b.nl);
    }
  };

  // ---------------------------------------------------------------- page glue
  const OPTIONS = [
    { id: "A", build: optionA, label: "Option A: bent-pipe pants, 3D model" },
    { id: "B", build: optionB, label: "Option B: sheet-metal fishtail, 3D model" },
    { id: "C", build: optionC, label: "Option C: flat-plate box, 3D model" }
  ];
  const views = {};
  function init() {
    for (const o of OPTIONS) { const host = document.getElementById("bo-view-" + o.id); if (host) views[o.id] = new View(host, o.label); }
    const sw = document.getElementById("bo-swatches");
    if (sw) sw.innerHTML = [["cone", "Cone section"], ["bend", "Bent pipe"], ["tube", "Straight tube"], ["filler", "Filler sheet metal"], ["plate", "Flat plate"], ["guide", "Guide tube"], ["cart", "Sliding cartridge"], ["motor", "Motor"], ["wheel", "Turbine wheel"]]
      .map(([k, l]) => `<span><i style="background:${BO_COLORS[k]}"></i>${l}</span>`).join("") + `<span><i style="background:transparent;border:1px dashed ${BO_COLORS.ref}"></i>97 mm engine case</span>`;
    document.querySelectorAll(".part[data-k]").forEach(el => { const i = el.querySelector("h3 i"); if (i) i.style.background = BO_COLORS[el.dataset.k]; });
  }
  let pending = 0;
  window.drawBuildOptions = function () {
    if (pending) return;
    pending = requestAnimationFrame(() => { pending = 0; update(); });
  };
  function update() {
    // Match each option's exit size so the engine sees the same 90% EGT rise as Option A at the current exit.
    // With fixed exits, extra duct loss shows up as engine back-pressure (hotter EGT), not lost thrust.
    const K = { A: 0.30, B: 0.40, C: 0.75 }, target = solve({ ...st, Kl: K.A }).r90.dEGT, exits = { A: st.exitID }, capped = {};
    for (const id of ["B", "C"]) {
      const egt = e => solve({ ...st, Kl: K[id], exitID: e }).r90.dEGT;
      let lo = 20, hi = st.legID;
      if (egt(hi) > target + 0.5) { exits[id] = hi; capped[id] = true; continue; }
      for (let k = 0; k < 22; k++) { const md = (lo + hi) / 2; if (egt(md) > target) lo = md; else hi = md; }
      exits[id] = (lo + hi) / 2;
    }
    const res = {};
    for (const o of OPTIONS) {
      const r = res[o.id] = o.build(exits[o.id]), env = envelope(r.parts);
      r.K = K[o.id]; r.exit = exits[o.id]; r.capped = capped[o.id];
      r.env = env;
      if (views[o.id]) views[o.id].set(r.parts);
      const d = document.getElementById("bo-dims-" + o.id), b = document.getElementById("bo-bom-" + o.id);
      if (d) d.innerHTML = r.dims.map(([k, v]) => `<div><span>${k}</span><span>${v}</span></div>`).join("") +
        `<div><span>Envelope (W × H × L)</span><span>${fx(env.W)} × ${fx(env.H)} × ${fx(env.L)} mm</span></div>`;
      if (b) b.innerHTML = r.bom.map(t => `<li>${t}</li>`).join("");
    }
    const fl = document.getElementById("bo-flare-B"); if (fl) fl.textContent = fx(res.B.flareDeg);
    // Comparison: same model as the rest of the page, with the split loss swapped per option.
    const rows = OPTIONS.map(o => {
      const r = res[o.id], S = solve({ ...st, Kl: r.K, exitID: r.exit }), out = Math.max(0, r.env.r - CASE), Lall = STOCK_LEN + r.env.L;
      const lbf90 = S.r90.F / LBF, lbfMax = S.rmax.F / LBF, din = out / IN_TO_MM, lin = Lall / IN_TO_MM;
      const pts = score.power(S.r90.Pel) + score.f90(lbf90) + score.fmax(lbfMax) + score.radial(din) + score.length(lin);
      return { r, S, out, Lall, lbf90, lbfMax, din, lin, pts };
    });
    const T = document.getElementById("bo-cmp");
    if (T) {
      const row = (l, f) => `<tr><td>${l}</td><td></td>${rows.map(x => `<td class="num">${f(x)}</td>`).join("")}</tr>`;
      T.innerHTML = `<tr><th>Quantity</th><th></th><th>A · bent-pipe pants</th><th>B · fishtail</th><th>C · plate box</th></tr>` +
        row("Split loss K (rough guess)", x => fx(x.r.K, 2)) +
        row("Exit ID, each", x => `${fx(x.r.exit, 1)} mm${x.r.capped ? " (pipe size)" : ""}`) +
        row("EGT change at 90%", x => `${x.S.r90.dEGT >= 0 ? "+" : ""}${fx(x.S.r90.dEGT)} K`) +
        row("Width × height", x => `${fx(x.r.env.W)} × ${fx(x.r.env.H)} mm`) +
        row("Outside the engine case by", x => `${fx(x.out, 1)} mm`) +
        row("Module length from flange", x => `${fx(x.r.env.L)} mm`) +
        row("Overall engine length", x => `${fx(x.Lall)} mm (${fx(x.lin, 1)} in)`) +
        row("Electrical power at 90%", x => `${fx(x.S.r90.Pel)} W`) +
        row("Thrust at 90%", x => `${fx(x.S.r90.F, 1)} N (${fx(x.lbf90, 1)} lbf)`) +
        row("Max thrust", x => `${fx(x.S.rmax.F, 1)} N (${fx(x.lbfMax, 1)} lbf)`) +
        row("Radial / length points", x => `${fx(score.radial(x.din), 1)} / ${fx(score.length(x.lin), 1)}`) +
        `<tr><td><b>Points modelled</b></td><td></td>${rows.map(x => `<td class="num"><b>${fx(x.pts, 1)}</b></td>`).join("")}</tr>`;
    }
    const c = res.A.c, sa = Math.sin(c.a), fp = document.getElementById("bo-flat");
    if (fp) fp.textContent = `For the current ${fx(st.cone, 1)}° cone (Ø${fx(INLET, 1)} → Ø${fx(2 * c.Rc, 1)} mm, ${fx(c.Lc)} mm long): an annular sector with inner radius ${fx(R_IN / sa)} mm, outer radius ${fx(c.Rc / sa)} mm and an included angle of ${fx(360 * sa, 1)}°, plus a seam allowance.`;
    const tv = document.getElementById("bo-travel");
    if (tv) tv.textContent = st.xw > TRAVEL ? `The wheel is set past 25 mm, so the cone is drawn ${fx(c.Lc)} mm long to hold it.` : `The cone is drawn ${fx(c.Lc)} mm long, enough for ${TRAVEL} mm of travel (shroud about Ø${fx(INLET + 2 * WHEEL_W / 2 * Math.tan(c.a))} to Ø${fx(INLET + 2 * (TRAVEL + WHEEL_W / 2) * Math.tan(c.a))} mm at the wheel).`;
  }
  init();
  drawBuildOptions();
})();
