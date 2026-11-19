"use strict";
/* Aft Turbine V3 "Big Ben" · parametric 3D geometry.
 * Builds one version of the design from its inputs and the page's layout() so the
 * picture and the cycle model always agree. Drawn with viewer3d.js.
 * Units are mm; x runs aft from the nozzle flange, y is the split direction, z is up.
 */
(function () {
  const { COL, css, grid, merge, revolve, loft, rhoOf, path, sweep, blades, dashes, empty, View, D2R } = V3D;
  const CASE = 48.5, R_HUB = HUB / 2, R_IN = INLET / 2;
  const quad = (a, b, c, d) => grid([[a, b], [d, c]], false, true);
  const internal = { cut: false, ex: [0, 0, 55] };

  function build(v, L) {
    const parts = [], P = (g, k, o = {}) => parts.push({ g, k, c: COL[k], cut: true, ex: [0, 0, 0], ...o });
    const tee = !v.fair, th = L.th, thd = v.theta1;
    // Engine stub and the engine turbine face, for scale.
    P(merge([revolve([[-26, CASE], [-14, CASE], [-6, 45], [-1.5, 37], [0, 34]]), revolve([[0, 34], [0, R_IN]])]), "engine", { ex: [-25, 0, 0] });
    P(revolve([[-3, R_IN], [-3, R_HUB], [-3, 0.1]]), "wheel", { ex: [-25, 0, 0] });
    // The straight legs near the junction, as clip cylinders (a tube wall inside a pipe is cut away for welding).
    // Runs from where the mitre plane meets the far wall to a little way into the bend, which only matters near the tube end.
    const legCyl = s => ({ p: [L.xs, s * L.ys, 0], d: [Math.cos(th), s * Math.sin(th), 0], r: L.rp, t0: -L.rp / Math.tan(th) - 0.5, t1: L.Ls + 0.3 * L.R });
    const teeClip = tee ? { cy: [legCyl(1), legCyl(-1)] } : {};
    // Inlet tube (straight with a lip, or a cone).
    P(revolve([[0, L.Rt0], [L.xte, L.Rte]], 0, 0, 96), v.shroud === "cone" ? "cone" : "tube", teeClip);
    if (tee) P(revolve([[L.xte, 0.5], [L.xte, L.Rte]], 0, 0, 96), "tube", { ...teeClip, ex: [8, 0, 0] });
    else {
      const fig8 = (y, z) => ((y - L.ys) / L.ay) ** 2 + (z / L.rp) ** 2 <= 1 || ((y + L.ys) / L.ay) ** 2 + (z / L.rp) ** 2 <= 1;
      P(loft(L.xte, () => L.Rte, L.xj, rhoOf(fig8)), "filler", { ex: [14, 0, 0] });
    }
    // Legs: bent pipe, mitred on the centre plane where they meet.
    for (const s of [1, -1]) {
      const e = L.rp * Math.tan(th) + L.rp + 6, dir = [Math.cos(th), s * Math.sin(th)], start = [L.xs - e * dir[0], s * L.ys - e * dir[1]];
      const pts = path(start, s * thd, [{ L: e + L.Ls }, { R: L.R, a: -s * thd }, { L: Math.max(0.5, L.xn0 - L.xPar) }]);
      const o = { pl: [[0, s, 0, 0]].concat(tee ? [] : [[1, 0, 0, -L.xj]]), ex: [30, s * 18, 0] };
      if (tee) o.cy = [{ p: [0, 0, 0], d: [1, 0, 0], r: L.Rte, t0: -1e5, t1: L.xte }];
      P(sweep(pts, L.rp, 48), "bend", o);
      if (L.Lneck > 0) P(revolve([[L.xn0, L.rp], [L.xExit, L.re + v.pipeWall]], s * L.yc), "cone", { ex: [30, s * 18, 0] });
    }
    // Motor box between the legs (flat plates).
    const x0 = L.xBox, x1 = L.xBoxEnd, hw = L.bw, hh = L.bh / 2, C = (x, y, z) => [x, y, z];
    P(merge([
      quad(C(x0, hw, -hh), C(x1, hw, -hh), C(x1, hw, hh), C(x0, hw, hh)), quad(C(x0, -hw, -hh), C(x1, -hw, -hh), C(x1, -hw, hh), C(x0, -hw, hh)),
      quad(C(x0, -hw, hh), C(x1, -hw, hh), C(x1, hw, hh), C(x0, hw, hh)), quad(C(x0, -hw, -hh), C(x1, -hw, -hh), C(x1, hw, -hh), C(x0, hw, -hh)),
      quad(C(x0, -hw, -hh), C(x0, hw, -hh), C(x0, hw, hh), C(x0, -hw, hh))
    ]), "box", { ex: [30, 0, 0] });
    // Hub treatment between the engine hub and the wheel.
    if (v.hub === "struts") {
      P(revolve([[0.8, R_HUB], [Math.max(2, v.xw - 7), R_HUB], [Math.max(3, v.xw - 2.5), 15]]), "strut");
      const xa = 3, xb = Math.max(5, v.xw - 8), ro = L.Rt0 + 5, ang = [];
      for (let k = 0; k < v.nStruts; k++) ang.push(Math.PI / 2 + k * 2 * Math.PI / v.nStruts);
      P(merge(ang.map(a => { const c = Math.cos(a), sn = Math.sin(a); return quad([xa, R_HUB * c, R_HUB * sn], [xb, R_HUB * c, R_HUB * sn], [xb, ro * c, ro * sn], [xa, ro * c, ro * sn]); })), "strut");
    } else if (v.hub === "spinner") {
      const x0s = Math.max(1.5, v.xw - 24), prof = [];
      for (let k = 0; k <= 8; k++) { const u = k / 8; prof.push([x0s + (v.xw - x0s) * u, Math.max(2.5, R_HUB * Math.sqrt(u))]); }
      P(revolve(prof), "wheel", internal);
    }
    // Turbine wheel, then the bearing bracket (flat plate) or a rounded fairing, then the cartridge and motor.
    P(merge([revolve([[v.xw, 0.1], [v.xw, R_HUB], [L.xtr, R_HUB]]), blades(v.xw)]), "wheel", internal);
    const xc0 = L.xMot - 18;
    if (v.nose === "flat") {
      const xp = L.xtr + 7, hy = 15, hz = Math.min(L.Rte - 3, 22);
      P(merge([quad([xp, -hy, -hz], [xp, hy, -hz], [xp, hy, hz], [xp, -hy, hz]), revolve([[L.xtr + 0.5, 11], [xc0, 11]])]), "box", internal);
    } else P(revolve([[L.xtr + 0.5, R_HUB], [L.xtr + 10, 15.5], [L.xtr + 22, 11.5], [xc0, 11.5]]), "box", internal);
    P(revolve([[xc0, 10], [L.xMot - 2, 10]]), "cart", internal);
    P(revolve([[L.xMot, 0.1], [L.xMot, MOTOR_D / 2], [L.xMot + MOTOR_L, MOTOR_D / 2], [L.xMot + MOTOR_L, 0.1]]), "motor", internal);
    // 97 mm engine case, extended back as a dashed reference.
    const ln = [];
    for (let k = 0; k < 12; k++) { const t = k / 12 * 2 * Math.PI; ln.push(...dashes([[0, CASE * Math.cos(t), CASE * Math.sin(t)], [L.Lmod, CASE * Math.cos(t), CASE * Math.sin(t)]])); }
    parts.push({ g: { ...empty(), lines: new Float32Array(ln) }, k: "ref", c: COL.ref, cut: true, ex: [0, 0, 0], ref: true });
    return parts;
  }
  window.BigBen3D = { build, View, colors: Object.fromEntries(Object.entries(COL).map(([k, c]) => [k, css(c)])) };
})();
