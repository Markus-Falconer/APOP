"use strict";
// ============================================================ Aft Turbine V3 "Big Ben" model
// Same 1-D engine and wheel model as Aft Turbine V2, with the Big Ben geometry: a straight
// inlet tube, big pipes joined through windows in the tube's side wall (or at its end),
// necked exits, a hub cone on struts or guide vanes (or a spinner), and the twice-per-revolution
// loading the split puts on the wheel. The split between gas through the blades and gas that
// bypasses them is found from a pressure balance between the parallel paths.
const G = 1.335, RG = 287, CP = G * RG / (G - 1), PA = 101325;
const RM = (58 / 2 + 37.5 / 2) / 2 / 1000, HUB = 37.5, WHEEL = 58, INLET = 58.4, WHEEL_W = 6.8, SPAN = (58 - 37.5) / 2;
const N_RATED = 110500, N_OVER = 140000, CASE_R = 48.5, MOTOR_L = 57.5, MOTOR_D = 29.3, R_BRG = 11, STOCK_LEN = 241 - 40.4;
const A5 = Math.PI / 4 * (INLET * INLET - HUB * HUB) * 1e-6;
const A_BL = 0.9 * Math.PI / 4 * (WHEEL * WHEEL - HUB * HUB) * 1e-6;   // blade passage area (10% metal blockage)
const K_GAP = 1.2, CD_LIP = 0.62, VANE_X0 = 2, VANE_X1 = 14;
const TR = M => 1 + (G - 1) / 2 * M * M;
const PR = M => Math.pow(TR(M), G / (G - 1));
const mfp = M => Math.sqrt(G / RG) * M * Math.pow(TR(M), -(G + 1) / (2 * (G - 1)));
function machFromMfp(v) { if (v >= mfp(1)) return 1; let lo = 0, hi = 1; for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; if (mfp(m) < v) lo = m; else hi = m; } return (lo + hi) / 2; }
const rpmOf = U => U / RM * 60 / (2 * Math.PI);
const rad = d => d * Math.PI / 180;
const qOf = (P0, M) => P0 * (1 - 1 / PR(M));
const circA = d => Math.PI / 4 * d * d * 1e-6;

function baseline(p) {
  const VeM = p.Fmax / p.mdMax, TsM = p.T5max - VeM * VeM / (2 * CP), MeM = VeM / Math.sqrt(G * RG * TsM);
  const Aeff = p.mdMax / (PA / (RG * TsM) * VeM);
  const Me9 = Math.sqrt(p.F90 / (G * PA * Aeff)), Ts9 = p.T590 / TR(Me9), Ve9 = Me9 * Math.sqrt(G * RG * Ts9);
  return { Aeff,
    max: { N: 154000, F: p.Fmax, md: p.mdMax, T0: p.T5max, P0: PA * PR(MeM), dTt: 125 },
    p90: { N: 139000, F: p.F90, md: p.F90 / Ve9, T0: p.T590, P0: PA * PR(Me9), dTt: 105 } };
}

// Layout: every position the model and the 3D view share. x is mm aft of the nozzle flange.
function layout(v) {
  const a = v.shroud === "cone" ? rad(v.cone) : 0, side = v.junction === "side", boot = v.junction === "boot";
  const Rt0 = v.tubeID / 2, xw = v.xw, xtr = xw + WHEEL_W, Ds = v.tubeID + 2 * (xw + WHEEL_W / 2) * Math.tan(a);
  const ri = v.pipeID / 2, rp = ri + v.pipeWall, th = rad(v.theta1), R = v.rd * 2 * rp, ay = rp / Math.cos(th);
  const sn = Math.sin(th), cot = Math.cos(th) / sn;
  let xte, Rte, xs, ys, xj, Lboot = 0, LsMin = 1, Rw = 0, xw0 = 0, xw1 = 0;
  if (side) {
    // Pipes join through windows in the side wall. Their centrelines cross the engine axis at xs and the
    // tube wall at the window centre xWin; the tube carries on past the windows to an end cap.
    Rw = Rt0 + v.xWin * Math.tan(a); xs = v.xWin - Rw * cot; ys = 0;
    xw0 = v.xWin - ri / sn; xw1 = v.xWin + ri / sn;
    xte = v.xWin + rp / sn + 1; Rte = Rt0 + xte * Math.tan(a); xj = xw0; LsMin = Rw / sn + 2;
  } else {
    xte = v.tubeLen; Rte = Rt0 + xte * Math.tan(a);
    if (boot) { ys = 0.5 * rp; const flare = Math.max(0, ys + ay - Rte); Lboot = Math.max(12, flare / Math.tan(rad(40))); xj = xte + Lboot; xs = xj; }
    else { ys = 0; xs = xte + Math.max(0, ay - Rte) / Math.tan(th); xj = xte; }
  }
  // Openings split at the blade mid-chord. Gas leaving through the opening ahead of it never does work (bypass);
  // gas that went through the wheel leaves through the opening behind it (side windows) or the open tube end.
  // Each side's window is capped at its pipe bore, which is the most it can pass.
  const over = side ? 0 : Math.max(0, Math.min(WHEEL_W, xtr - xte)), xmid = xw + WHEEL_W / 2;
  let Aup = 0, Adn = Infinity;
  if (side) {
    const g = { xs, Rw, th, ri }, Aside = windowArea(g, xw0, xw1), cap = Math.min(1, Math.PI * ri * ri / Math.max(1, Aside));
    Aup = 2 * cap * windowArea(g, xw0, Math.min(xmid, xw1)); Adn = 2 * cap * windowArea(g, Math.max(xmid, xw0), xw1);
  } else Aup = Math.PI * Ds * Math.max(0, Math.min(xmid, xtr) - xte);
  const Aover = Aup;
  // First straight sized so the legs end up the requested gap apart, and (side entry) clear of the tube wall before bending.
  const ycReq = rp + v.gap / 2, Ls = Math.max(LsMin, (ycReq - ys - R * (1 - Math.cos(th))) / Math.sin(th));
  const yc = ys + Ls * Math.sin(th) + R * (1 - Math.cos(th)), xPar = xs + Ls * Math.cos(th) + R * Math.sin(th);
  // Motor box between the legs, starting where the legs' inner walls clear it.
  const bw = Math.min(MOTOR_D / 2 + 6, yc - rp - 1), bh = Math.max(2 * rp, MOTOR_D + 12);
  let xBox = xPar;
  if (side) xBox = xte; else { const n = 200; for (let k = 0; k <= n; k++) { const s = k / n, P = legPoint(xs, ys, th, Ls, R, s * (Ls + R * th)); if (P.y - rp / Math.cos(P.h) >= bw - 0.5) { xBox = P.x; break; } } }
  const xMot = Math.max(xBox + 10, xtr + 50), xBoxEnd = xMot + MOTOR_L + 5;
  const re = Math.min(v.exitID, v.pipeID) / 2, Lneck = re < ri - 0.2 ? (ri - re) / Math.tan(rad(v.neck)) : 0;
  const xn0 = Math.max(xPar + 5, xBoxEnd - Lneck), xExit = xn0 + Lneck;
  const Lmod = Math.max(xExit, xBoxEnd), W = 2 * (yc + rp), out = Math.max(0, yc + rp - CASE_R);
  const Lleg = Ls + R * th + (xn0 - xPar) + Lneck;
  const settle = side ? xw0 - xtr : xte - xtr, inWin = side && xtr > xw0 && xw < xw1;
  return { a, side, boot, Rt0, xte, Rte, Rw, xw0, xw1, xw, xtr, xmid, Ds, over, Aup, Adn, Aover, inWin, settle, ri, rp, th, R, ay, xs, ys, xj, Lboot, Ls, yc,
    wide: !side && yc > ycReq + 0.5, xPar, bw, bh, xBox, xMot, xBoxEnd, re, Lneck, xn0, xExit, Lmod, W, out, Lleg, Lall: STOCK_LEN + Lmod,
    winArea: side ? windowArea({ xs, Rw, th, ri }, xw0, xw1) : 0,
    hitPipes: !side && over > 0.3 && rp < WHEEL / 2, hitCap: side && xtr > xte - 1.5, pastWin: side && xmid >= xw1, vaneHit: !!v.gv && xw < VANE_X1 + 2 };
}
// Arc width (mm) of one side window at station x: points on the tube wall that lie inside the pipe bore.
function winWidth(g, x) {
  const ct = Math.cos(g.th), st = Math.sin(g.th);
  const inside = phi => { const qx = x - g.xs, qy = g.Rw * Math.cos(phi), qz = g.Rw * Math.sin(phi), t = qx * ct + qy * st; return t > 0 && qx * qx + qy * qy + qz * qz - t * t < g.ri * g.ri; };
  if (!inside(0)) return 0;
  if (inside(Math.PI / 2)) return Math.PI * g.Rw;
  let lo = 0, hi = Math.PI / 2; for (let k = 0; k < 30; k++) { const m = (lo + hi) / 2; if (inside(m)) lo = m; else hi = m; }
  return 2 * g.Rw * lo;
}
// Window area (mm², one side) between stations x0 and x1.
function windowArea(g, x0, x1) {
  if (!(x1 > x0)) return 0;
  const n = 24, dx = (x1 - x0) / n; let A = 0;
  for (let k = 0; k < n; k++) A += winWidth(g, x0 + (k + 0.5) * dx) * dx;
  return A;
}
// Point on a leg centreline (right leg) at arc length s: straight Ls at angle th, then an arc of radius R back to axial.
function legPoint(xs, ys, th, Ls, R, s) {
  if (s <= Ls) return { x: xs + s * Math.cos(th), y: ys + s * Math.sin(th), h: th };
  const b = Math.min(th, (s - Ls) / R), x0 = xs + Ls * Math.cos(th), y0 = ys + Ls * Math.sin(th);
  const cx = x0 + R * Math.sin(th), cy = y0 - R * Math.cos(th), h = th - b;
  return { x: cx - R * Math.sin(h), y: cy + R * Math.cos(h), h };
}

const K = {
  hub: v => v.hub === "none" ? 0.15 : v.hub === "struts" ? 0.03 + 0.035 * v.nStruts : 0.04,
  shroud: v => v.shroud === "cone" ? 0.08 : 0.03,
  tee: (v, L) => (0.08 + 1.0 * (1 - Math.cos(L.th))) * (L.boot ? 0.55 : L.side && v.fair ? 0.75 : 1),
  nose: v => v.nose === "flat" ? 0.12 : 0.03,
  edge: (v, L) => L.side ? (v.fair ? 0.03 : 0.10) : 0,
  dump: (v, L, ratio) => ratio >= 1 ? (1 - 1 / ratio) ** 2 * (L.boot ? 0.35 : L.side && v.fair ? 0.6 : 1) : 0.1 * (1 - ratio),
  distort: (v, L) => (L.boot ? 0.45 : L.side && v.fair ? 0.6 : 1) * (v.nose === "flat" ? 1.15 : 1),
  bends: (v, L) => (L.th / rad(90)) * (0.13 + 0.12 / Math.pow(v.rd, 1.2)),
  friction: (v, L) => 0.02 * L.Lleg / v.pipeID,
  Cd: v => 0.985 - 0.085 * Math.pow(v.neck / 45, 1.3)
};

// One operating point with the core turbine-exit pressure scaled by x.
// Discharge coefficient of the openings: side windows (sharp, or flared edges), or the lip.
const cdOpen = (v, s, L) => L.side ? (v.fair ? Math.min(0.98, s.cdw * 1.15) : s.cdw) : CD_LIP;
// Turbine path for a given mass flow through the blade passages: Euler work on the load line, blade losses,
// the tip gap in parallel with the blades, then the opening behind the wheel in series.
function wheelPath(mbl, rho, v, s, L, a1, kU) {
  const tb2 = Math.tan(rad(s.beta2)), Ag = Math.max(0, Math.PI / 4 * (L.Ds * L.Ds - WHEEL * WHEEL) * 1e-6);
  const Vx = mbl / (rho * A_BL), C = Vx * (Math.tan(a1) + tb2), U = kU > 0 ? C * mbl / (mbl + kU) : C;
  const w = U * (C - U), W2 = Vx / Math.cos(rad(s.beta2)), wt1 = Vx * Math.tan(a1) - U, W1 = Math.hypot(Vx, wt1);
  const inc = Math.atan2(wt1, Vx) - rad(s.beta1m), zi = inc < 0 ? s.zinc : 4 * s.zinc;
  const dPloss = 0.5 * rho * (s.zeta * W2 * W2 + zi * (W1 * Math.sin(inc)) ** 2), dProw = rho * w + dPloss;
  const mg = Ag * Math.sqrt(2 * rho * Math.max(0, dProw) / K_GAP), mt = mbl + mg;
  const Ad = L.Adn * 1e-6 * cdOpen(v, s, L);
  const dPdn = !Number.isFinite(Ad) ? 0 : Ad > 0 ? mt * mt / (2 * rho * Ad * Ad) : (mt > 0 ? Infinity : 0);
  return { mbl, Vx, C, U, w, W1, W2, inc, dPloss, dProw, mg, mt, dPdn, dPt: dProw + dPdn };
}
// Split the flow so the turbine path and the bypass (opening ahead of the wheel) see the same total-pressure drop.
function splitFlow(md, rho, v, s, L, a1, kU) {
  const Au = L.Aup * 1e-6 * cdOpen(v, s, L), byp = mb => Au > 0 ? mb * mb / (2 * rho * Au * Au) : (mb > 1e-9 ? Infinity : 0);
  let lo = 0, hi = md;
  for (let i = 0; i < 60; i++) {
    const m = (lo + hi) / 2, r = wheelPath(m, rho, v, s, L, a1, kU), mb = md - r.mt;
    if (mb < 0) hi = m; else if (Au > 0) { if (byp(mb) > r.dPt) lo = m; else hi = m; } else lo = m;
  }
  const r = wheelPath(lo, rho, v, s, L, a1, kU), mb = Math.max(0, md - r.mt);
  return { ...r, mb, dP: Au > 0 ? byp(mb) : r.dPt };
}

// One operating point with the core turbine-exit pressure scaled by x.
function chain(op, x, v, s, L, loaded) {
  const P04 = 0.95 * PA * (1 + 1.9 * Math.pow(op.N / 154000, 2)), ex = (G - 1) / G;
  const f0 = 1 - Math.pow(P04 / op.P0, -ex), f1 = 1 - Math.pow(P04 / (op.P0 * x), -ex);
  const dEGT = f1 > 0.01 ? (f0 / f1 - 1) * (op.T0 + op.dTt) : 9999, T5 = op.T0 + dEGT, md = op.md;
  const loss = [], drop = (k, name, q, Kc) => { const d = Kc * q; loss.push({ k, name, K: Kc, dP: d }); return d; };
  let P0 = op.P0 * x;
  const M5 = machFromMfp(md * Math.sqrt(T5) / (P0 * A5)), q5 = qOf(P0, M5), a1 = v.gv ? rad(v.alpha) : 0;
  if (v.gv) {
    P0 -= drop("hub", "Hub cone carried by the guide vanes", q5, 0.03);
    P0 -= drop("vanes", `${v.nVanes} guide vanes turning ${v.alpha}°`, q5, s.Kvane / Math.cos(a1) ** 2);
  } else P0 -= drop("hub", v.hub === "none" ? "Open hub cavity" : v.hub === "struts" ? `Hub cone on ${v.nStruts} struts` : "Spinner gap", q5, K.hub(v));
  P0 -= drop("shroud", v.shroud === "cone" ? "Cone shroud" : "Inlet tube", q5, K.shroud(v));
  // Gas just ahead of the wheel (density for the flow split).
  const Aw = Math.PI / 4 * (L.Ds * L.Ds - HUB * HUB) * 1e-6, Mu = machFromMfp(md * Math.sqrt(T5) / (P0 * Aw));
  const rho = P0 / PR(Mu) / (RG * T5 / TR(Mu));
  const kU = loaded ? Math.pow(60 / (2 * Math.PI * RM), 2) / (s.Kv_rpm * s.Kv_rpm * v.R * s.etaGen) : 0;
  const n = splitFlow(md, rho, v, s, L, a1, kU);
  const Psh = n.mbl * n.w, N = rpmOf(n.U), V = N / s.Kv_rpm, Pel = Psh * s.etaGen, T6 = T5 - Psh / (md * CP);
  loss.push({ k: "work", name: "Turbine path: work extracted (ρ·w)", K: null, dP: rho * n.w, work: true });
  loss.push({ k: "blade", name: "Turbine path: blade passage and incidence losses", K: null, dP: n.dPloss });
  if (L.side) loss.push({ k: "wdn", name: "Turbine path: window behind the wheel", K: null, dP: Number.isFinite(n.dPdn) ? n.dPdn : 0 });
  const rest = n.dP - (rho * n.w + n.dPloss + (Number.isFinite(n.dPdn) ? n.dPdn : 0));
  if (rest > 1) loss.push({ k: "byp", name: "Bypass only (turbine path blocked)", K: null, dP: rest });
  if (n.mb > 1e-6) loss.push({ k: "bypinfo", name: `Bypass path: window ahead of the wheel (${(n.mb / md * 100).toFixed(0)}% of the gas)`, K: null, dP: n.dP, info: true });
  P0 -= n.dP;
  // Twice-per-rev loading: the back-pressure pattern of gas leaving behind the wheel, decayed over the settling distance.
  const Rj = L.side ? L.Rw : L.Rte, Aj = (Math.PI * Rj * Rj - Math.PI * R_BRG * R_BRG) * 1e-6, Mj = machFromMfp(md * Math.sqrt(T6) / (P0 * Aj)), qj = qOf(P0, Mj);
  const tf = md > 0 ? n.mt / md : 0, dPb = n.dProw;
  const Leff = (L.side ? L.xtr > L.xw0 : L.over > 0) ? 0 : Math.max(0, L.settle) + 0.5 * L.Lboot, decay = Math.exp(-2 * Leff / (L.Ds / 2));
  const dPpp = qj * (0.15 + 0.85 * (1 - Math.cos(L.th))) * K.distort(v, L) * decay * (L.side ? tf * tf : 1);
  const sw = dPb > 1 ? dPpp / 2 / dPb : 0;
  const swS = dPb > 1 ? (v.gv ? 0.05 * q5 * Math.exp(-Math.max(0, v.xw - VANE_X1) / 12) / dPb : v.hub === "struts" ? 0.12 * q5 * Math.exp(-6 / 12) / dPb : 0) : 0;
  const swT = Math.hypot(sw, swS), wl = n.w + n.dPloss / rho, etaRow = wl > 0 ? n.w / wl : 0;
  const dPd = s.kd * Math.min(swT, 1.5) ** 2 * rho * n.w * (md > 0 ? n.mbl / md : 0);
  if (dPd > 0) { loss.push({ k: "dist", name: "Uneven blade loading (2/rev)", K: null, dP: dPd }); P0 -= dPd; }
  const eta = wl > 0 ? n.w / (wl + (md > 0 && n.mbl > 0 ? dPd * md / n.mbl / rho : 0)) : 0;
  // Junction, legs and exits.
  const Ap2 = 2 * circA(v.pipeID), ratio = Ap2 / Aj;
  const Ml = machFromMfp(md * Math.sqrt(T6) / (P0 * Ap2)), ql = qOf(P0, Ml);
  if (L.side) {
    P0 -= drop("entry", v.fair ? "Turn into the pipe, flared windows" : "Turn into the pipe, sharp windows", ql, (v.fair ? 0.3 : 0.6) * (1 - Math.cos(L.th)));
    P0 -= drop("nose", v.nose === "flat" ? "Flat end cap (gas behind the wheel)" : "Cone splitter on the end cap", qj * tf * tf, K.nose(v));
  } else {
    P0 -= drop("dump", ratio >= 1 ? "Sudden expansion into the legs" : "Contraction into the legs", qj, K.dump(v, L, ratio));
    P0 -= drop("tee", L.boot ? "Faired split" : "Tee split", qj, K.tee(v, L));
    P0 -= drop("nose", v.nose === "flat" ? "Flat bearing bracket in the crotch" : "Rounded bearing fairing", qj, K.nose(v));
  }
  P0 -= drop("bends", "Return bends", ql, K.bends(v, L));
  P0 -= drop("fric", "Pipe friction", ql, K.friction(v, L));
  const npr = Math.max(1.0001, P0 / PA), Me = Math.min(1, Math.sqrt((Math.pow(npr, ex) - 1) * 2 / (G - 1)));
  const Ts = T6 / TR(Me), Ve = Me * Math.sqrt(G * RG * Ts), Aneed = md / (PA / (RG * Ts) * Ve);
  return { x, dEGT, T5, Vx: n.Vx, C: n.C, U: n.U, N, V, I: V > 0 ? Pel / V : 0, Psh, Pel, Ml, Mj, Me, Ve, F: md * Ve, Aneed,
    frac: n.mbl / md, bypass: 1 - n.mbl / md, shWin: n.mb / md, shGap: n.mg / md, Nfree: rpmOf(n.C), inc: n.inc * 180 / Math.PI,
    Pceil: n.mbl * n.C * n.C / 4 * s.etaGen, dP5: op.P0 * (x - 1), sw, swS, swT, eta, etaRow, dPb, dPpp, decay, loss, qj, q5, rho, dPregion: n.dP };
}
function solvePoint(op, v, s, L, loaded) {
  const Ae = 2 * circA(Math.min(v.exitID, v.pipeID)) * K.Cd(v);
  let lo = 0.8, hi = 1.6;
  for (let i = 0; i < 40; i++) { const x = (lo + hi) / 2; if (chain(op, x, v, s, L, loaded).Aneed > Ae) lo = x; else hi = x; }
  return chain(op, (lo + hi) / 2, v, s, L, loaded);
}
function solve(v, s) {
  const b = baseline(s), L = layout(v);
  return { b, L, r90: solvePoint(b.p90, v, s, L, true), rmax: solvePoint(b.max, v, s, L, !s.unloadMax), rfree: solvePoint(b.max, v, s, L, false) };
}
function loadFor(v, s, target) {
  const P = R => solve({ ...v, R }, s).r90.Pel;
  let best = { R: v.R, P: -1 }, prev = null;
  for (let R = 60; R >= 0.4; R /= 1.06) {
    const p = P(R); if (p > best.P) best = { R, P: p };
    if (p >= target) { let lo = R, hi = prev ?? R; for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (P(m) >= target) lo = m; else hi = m; } return { R: lo, ok: true }; }
    prev = R;
  }
  return { R: best.R, ok: false, P: best.P };
}
// Exit size giving the target 90% EGT change (bigger exits → less back-pressure → cooler).
function exitFor(v, s, target) {
  const egt = e => solve({ ...v, exitID: e }, s).r90.dEGT;
  let lo = 18, hi = v.pipeID;
  if (egt(hi) > target) return { exitID: hi, ok: false };
  for (let k = 0; k < 30; k++) { const m = (lo + hi) / 2; if (egt(m) > target) lo = m; else hi = m; }
  return { exitID: (lo + hi) / 2, ok: true };
}
const score = {
  power: P => Math.min(100, Math.max(0, 0.1 * P)),
  f90: lbf => lbf > 20 ? 20 : lbf < 10 ? 0 : 2 * lbf - 20,
  fmax: lbf => lbf > 19 ? 10 : lbf < 15 ? 0 : 2.5 * lbf - 37.5,
  radial: din => din > 4 ? 0 : 15 - 3.75 * din,
  length: lin => lin <= 10 ? 15 : lin > 15 ? 0 : 45 - 3 * lin
};
// Forcing orders the wheel sees: the two-leg split (and its harmonics) plus any struts.
function orders(v) { const o = [2, 4, 6, 8]; if (v.gv) o.push(v.nVanes, 2 * v.nVanes); else if (v.hub === "struts" && v.nStruts) o.push(v.nStruts, 2 * v.nStruts); return [...new Set(o)].sort((a, b) => a - b); }

// Presets: best estimates from the CAD screenshots. Replace with Ben's measured values.
const VERSIONS = {
  drawn: { name: "Ben's layout", tag: "pipes joined on the tube sides",
    junction: "side", tubeID: 60, tubeLen: 34, xWin: 50, shroud: "lip", cone: 8, xw: 31, theta1: 60, rd: 1.5, gap: 52, pipeID: 47.5, pipeWall: 1.65,
    exitID: 36.8, neck: 15, fair: false, hub: "struts", nStruts: 2, nose: "flat", R: 3.97, gv: false, alpha: 20, nVanes: 11 },
  faired: { name: "V3-1 Faired", tag: "side windows, cleaned up",
    junction: "side", tubeID: 60, tubeLen: 34, xWin: 55, shroud: "lip", cone: 8, xw: 31, theta1: 45, rd: 1.5, gap: 52, pipeID: 47.5, pipeWall: 1.65,
    exitID: 34.5, neck: 15, fair: true, hub: "spinner", nStruts: 2, nose: "round", R: 3.68, gv: false, alpha: 20, nVanes: 11 },
  cone: { name: "V3-2 Cone + gentle split", tag: "cone shroud, 35° legs",
    junction: "boot", tubeID: 60, tubeLen: 40, xWin: 50, shroud: "cone", cone: 8, xw: 20, theta1: 35, rd: 1.5, gap: 36, pipeID: 42.65, pipeWall: 0.9,
    exitID: 33.7, neck: 12, fair: true, hub: "spinner", nStruts: 2, nose: "round", R: 3.93, gv: false, alpha: 20, nVanes: 11 }
};
const SHARED = { beta2: 47.4, beta1m: 45, zeta: 0.06, zinc: 0.05, cdw: 0.85, Kvane: 0.06, Kv_rpm: 1441, etaGen: 0.87, unloadMax: true, kd: 0.2, fb: 20, egtT: 30,
  Fmax: 100, mdMax: 0.235, T5max: 1000, F90: 71.3, T590: 940 };
