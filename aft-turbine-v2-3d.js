"use strict";
/* Aft Turbine V2 · build options in 3D.
 * Parametric geometry for three ways to build the
 * adjustable shroud and the two-pipe split, drawn with viewer3d.js. Reads the page's inputs (st) and
 * model (solve, score, constants) from aft-turbine-v2.html, so it must load
 * after the page's own scripts. Units are mm; x runs aft from the nozzle
 * flange, y is the split direction, z is up.
 */
(function () {
  const { COL, css, grid, merge, ringPts, revolve, starRing, plate, loft, rhoOf, path, sweep, blades, dashes, empty, envelope, View, D2R } = V3D;
  window.BO_COLORS = Object.fromEntries(Object.entries(COL).map(([k, v]) => [k, css(v)]));

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
