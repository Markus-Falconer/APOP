"use strict";
// ============================================================ Magnetic coupler model
// Coaxial synchronous permanent-magnet coupler between the Lehner 1525 front shaft (inner rotor)
// and the JetCat P100 compressor nut (outer cup). Pure functions of the inputs object `i`
// (lengths in mm, speeds in rpm, temperatures in °C, masses in g); results are SI unless the
// name says otherwise. The page (magnetic-coupler.html) draws its numbers and the Key equations
// panel from the object that run() returns.
//
// Models, all chosen so every number traces to one equation:
//  - Torque: 2-D magnetic-charge model. Magnets have mu_r = 1, iron is ideal (mu = inf) at the
//    shaft surface and at the cup bore, and each angular harmonic is solved exactly with the
//    Green's function between the two iron cylinders. Parallel- or radially-magnetised arcs.
//    3-D end leakage is a single factor (0.85 default; a 3-D charge model gave 0.87 at 8 mm).
//  - Back iron: fundamental flux entering the cup, carried around the wall at a chosen flux density.
//  - Radial pull: planar two-array energy at the gap radius, differentiated with respect to gap.
//  - Torsional dynamics: the coupler is a spring k = p * Tmax between the motor rotor and the
//    much heavier engine rotor; equal-area step limit, re-lock speed, inertia torque.
//  - Retention: thin rings loaded by magnets that have no hoop strength.
//  - Motor rotor modes: Euler-Bernoulli beam FE with rotary inertia (no gyroscopics), the same
//    rotor model as the project's earlier 1525 studies, plus the coupler half as distributed mass.
//  - Load application: one-degree-of-freedom time simulation of the motor rotor on the coupler
//    spring with CR, CC or CP load laws and a first-order load-bank lag.
//
// Each relation carries an "Eq. (x.y)" tag that matches the Key equations panel on the page.
(function (root) {
  const MU0 = 4e-7 * Math.PI;
  const w = rpm => rpm * 2 * Math.PI / 60;
  const rpmOf = om => om * 60 / (2 * Math.PI);

  // Magnet grades: Br at 20 °C (T), Br temperature coefficient (1/K), Hcj at 20 °C (A/m) and its
  // temperature coefficient (1/K). Br values are conservative catalogue minimums.
  const MAG = {
    smco: { name: "SmCo 2:17, H grade (Hcj ≥ 25 kOe)", rho: 8400, Br: 1.08, aBr: -0.00035, Hcj: 1990e3, aHcj: -0.0025, Tmax: 300 },
    nduh: { name: "NdFeB N42UH", rho: 7500, Br: 1.25, aBr: -0.0012, Hcj: 1990e3, aHcj: -0.0055, Tmax: 180 },
    ndsh: { name: "NdFeB N42SH", rho: 7500, Br: 1.30, aBr: -0.0012, Hcj: 1592e3, aHcj: -0.0055, Tmax: 150 },
    ndeh: { name: "NdFeB N35EH", rho: 7500, Br: 1.19, aBr: -0.0012, Hcj: 2388e3, aHcj: -0.0055, Tmax: 200 },
  };
  const SLEEVE = {
    ti64: { name: "Ti-6Al-4V", rho: 4430, yld: 880 },
    cf: { name: "Carbon/epoxy, hoop wound", rho: 1580, yld: 2000 },
  };
  const IRON = {
    s4140: { name: "4140 / 1144, heat treated", rho: 7850, yld: 650, Bsat: 1.9 },
    s1018: { name: "1018 low-carbon", rho: 7850, yld: 300, Bsat: 2.0 },
    ph17: { name: "17-4PH H900", rho: 7800, yld: 1170, Bsat: 1.2 },
  };
  const HUB = { ti: { name: "Titanium hub", rho: 4430 }, st: { name: "One-piece steel", rho: 7850 } };

  // ---------- 2-D field model -------------------------------------------------------------
  // Radii are normalised by the cup bore R = b2 so high harmonics stay inside double range.
  // Eq. (3.1): phi = R * g(rho, s) cos(m theta) for a sheet sigma = cos(m theta) at radius s.
  function green(r, s, m, a0, b2) {          // all radii normalised (b2 = 1 normally)
    const uin = x => a0 > 0 ? Math.pow(x, m) - Math.pow(a0, 2 * m) * Math.pow(x, -m) : Math.pow(x, m);
    const uout = x => Math.pow(x, -m) - Math.pow(b2, -2 * m) * Math.pow(x, m);
    const duin = x => a0 > 0 ? m * Math.pow(x, m - 1) + m * Math.pow(a0, 2 * m) * Math.pow(x, -m - 1) : m * Math.pow(x, m - 1);
    const duout = x => -m * Math.pow(x, -m - 1) - m * Math.pow(b2, -2 * m) * Math.pow(x, m - 1);
    const W = uin(s) * duout(s) - duin(s) * uout(s);
    return {
      g: r <= s ? -uin(r) * uout(s) / W : -uin(s) * uout(r) / W,
      dg: r <= s ? -duin(r) * uout(s) / W : -uin(s) * duout(r) / W,
    };
  }

  // Eq. (2.3): angular Fourier coefficient (harmonic m = n p, n odd) of the charges of a ring of
  // 2p arcs, pole-arc fraction alpha, magnetisation M. Returns [[radius, amplitude], ...] and the
  // surface coefficient (= M_r coefficient at the faces).
  function ringSheets(rIn, rOut, M, p, alpha, mode, n, nsh) {
    const m = n * p, h = alpha * Math.PI / (2 * p);
    let as;
    if (mode === "radial") as = 4 * p / (Math.PI * m) * Math.sin(m * h) * M;
    else {
      const I = m === 1 ? h + Math.sin(2 * h) / 2 : Math.sin((m - 1) * h) / (m - 1) + Math.sin((m + 1) * h) / (m + 1);
      as = 2 * p / Math.PI * I * M;
    }
    const sheets = [[rOut, as]];
    if (rIn > 0) sheets.push([rIn, -as]);
    const dr = (rOut - rIn) / nsh;
    for (let k = 0; k < nsh; k++) {
      const r = rIn + (k + 0.5) * dr;
      if (mode === "radial") sheets.push([r, -as / r * dr]);                  // rho = -M_r / r
      else sheets.push([r, -4 * p / Math.PI * M * Math.sin(h) * Math.cos(m * h) * dr / r]); // arc side faces
    }
    return { sheets, as };
  }

  // Torque-angle curve per metre of length (2-D), plus the per-harmonic data for field checks.
  function field2D(g) {
    const { a0, a1, b1, b2, p, alpha, mode, Mi, Mo, shaftIron } = g;
    const R = b2, nmax = 9, nsh = 16;
    const H = [];
    for (let n = 1; n <= nmax; n += 2) {
      const m = n * p;
      const inn = ringSheets(a0 / R, a1 / R, Mi, p, alpha, mode, n, nsh);
      const out = ringSheets(b1 / R, b2 / R, Mo, p, alpha, mode, n, nsh);
      const A0 = shaftIron ? a0 / R : 0;
      let E = 0;                                                  // Eq. (4.1) energy amplitude
      for (const [s1, c1] of inn.sheets) for (const [s2, c2] of out.sheets) E += c1 * c2 * green(s2, s1, m, A0, 1).g * s2;
      E *= MU0 * Math.PI * R * R;
      H.push({ n, m, E, inn, out, A0 });
    }
    const curve = [];
    const N = 180;
    for (let k = 0; k <= N; k++) {
      const d = k / N * Math.PI / p;
      let T = 0;
      for (const h of H) T += h.m * h.E * Math.sin(h.m * d);       // Eq. (4.1) T = -dW/d(delta)
      curve.push([d, -T]);                                         // positive = restoring torque
    }
    let Tpk = 0, dpk = 0;
    for (const [d, T] of curve) if (T > Tpk) { Tpk = T; dpk = d; }
    return { H, curve, Tpk, dpk, R };
  }

  // radial field (A/m) at radius r (m), angle theta, inner rotated by delta; harmonics included
  function Hr(F, r, theta, delta) {
    let H = 0;
    for (const h of F.H) {
      for (const [s, c] of h.inn.sheets) H += -c * green(r / F.R, s, h.m, h.A0, 1).dg * Math.cos(h.m * (theta - delta));
      for (const [s, c] of h.out.sheets) H += -c * green(r / F.R, s, h.m, h.A0, 1).dg * Math.cos(h.m * theta);
    }
    return H;
  }

  // ---------- planar two-array energy for the normal stress (radial pull) -------------------
  // Eq. (6.1): W = mu0 M1^2/4 [G(a,a) + G(b,b) - 2 G(a,b) cos(k delta)], charges at y = a, b.
  function planarW(gap, hIn, hOut, Br1, Br2, lam, alpha) {
    const k = 2 * Math.PI / lam, c = 4 / (Math.PI * MU0) * Math.sin(Math.PI * alpha / 2);
    const M1 = c * Br1, M2 = c * Br2, L = hIn + hOut + gap;
    const G = (y1, y2) => Math.sinh(k * Math.min(y1, y2)) * Math.sinh(k * (L - Math.max(y1, y2))) / (k * Math.sinh(k * L));
    const a = hIn, b = hIn + gap;
    return MU0 / 4 * (M1 * M1 * G(a, a) + M2 * M2 * G(b, b) - 2 * M1 * M2 * G(a, b));
  }

  // ---------- beam FE of the 1525 rotor ------------------------------------------------------
  function beamMats(L, EI, m, Id) {
    const k = [[12, 6 * L, -12, 6 * L], [6 * L, 4 * L * L, -6 * L, 2 * L * L], [-12, -6 * L, 12, -6 * L], [6 * L, 2 * L * L, -6 * L, 4 * L * L]].map(r => r.map(v => v * EI / L ** 3));
    const mt = [[156, 22 * L, 54, -13 * L], [22 * L, 4 * L * L, 13 * L, -3 * L * L], [54, 13 * L, 156, -22 * L], [-13 * L, -3 * L * L, -22 * L, 4 * L * L]].map(r => r.map(v => v * m * L / 420));
    const mr = [[36, 3 * L, -36, 3 * L], [3 * L, 4 * L * L, -3 * L, -L * L], [-36, -3 * L, 36, -3 * L], [3 * L, -L * L, -3 * L, 4 * L * L]].map(r => r.map(v => v * Id / (30 * L)));
    return { k, mt, mr };
  }
  // Eq. (11.1): first natural frequency (rpm) of the rotor on two bearings of stiffness kb (N/m).
  // adds: [{ m (kg), x (m from shaft tip), Id (kg m^2) }]. x = 0 at the front tip of the shaft.
  function rotorMode(kb, frontExt, adds) {
    const xb1 = frontExt + 2e-3, span = 43.5e-3, xb2 = xb1 + span, xend = xb2 + 2e-3;
    const magLen = 25e-3, xm0 = (xb1 + xb2) / 2 - magLen / 2, xm1 = xm0 + magLen;
    const pts = [xb1, xb2, xm0, xm1, ...adds.map(a => a.x)];
    const grid = []; const ne = 44;
    for (let k = 0; k <= ne; k++) grid.push(k / ne * xend);
    let nodes = [...grid, ...pts].sort((a, b) => a - b).filter((v, k, arr) => k === 0 || v - arr[k - 1] > 1e-6);
    const n = nodes.length, N = 2 * n;
    const K = Array.from({ length: N }, () => new Float64Array(N)), M = Array.from({ length: N }, () => new Float64Array(N));
    const Es = 200e9, rs = 7850, Em = 160e9, rm = 7500, ds = 5e-3, dm = 14.5e-3;
    const Is = Math.PI * ds ** 4 / 64, As = Math.PI * ds ** 2 / 4, Im = Math.PI * (dm ** 4 - ds ** 4) / 64, Am = Math.PI * (dm ** 2 - ds ** 2) / 4;
    for (let e = 0; e < n - 1; e++) {
      const L = nodes[e + 1] - nodes[e], xc = (nodes[e] + nodes[e + 1]) / 2, inMag = xc >= xm0 && xc <= xm1;
      const EI = Es * Is + (inMag ? 0.2 * Em * Im : 0), m = rs * As + (inMag ? rm * Am : 0), Id = rs * Is + (inMag ? rm * Im : 0);
      const { k, mt, mr } = beamMats(L, EI, m, Id);
      for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) { K[2 * e + a][2 * e + b] += k[a][b]; M[2 * e + a][2 * e + b] += mt[a][b] + mr[a][b]; }
    }
    const near = x => { let j = 0; for (let k = 1; k < n; k++) if (Math.abs(nodes[k] - x) < Math.abs(nodes[j] - x)) j = k; return j; };
    for (const xb of [xb1, xb2]) { const j = near(xb); K[2 * j][2 * j] += kb; }
    for (const a of adds) { const j = near(a.x); M[2 * j][2 * j] += a.m; M[2 * j + 1][2 * j + 1] += a.Id; }
    // Cholesky of K, then inverse iteration on K^-1 M
    const Lc = Array.from({ length: N }, () => new Float64Array(N));
    for (let r = 0; r < N; r++) for (let c = 0; c <= r; c++) {
      let s = K[r][c]; for (let q = 0; q < c; q++) s -= Lc[r][q] * Lc[c][q];
      Lc[r][c] = r === c ? Math.sqrt(s) : s / Lc[c][c];
    }
    const solve = b => { const y = new Float64Array(N); for (let r = 0; r < N; r++) { let s = b[r]; for (let q = 0; q < r; q++) s -= Lc[r][q] * y[q]; y[r] = s / Lc[r][r]; }
      const x = new Float64Array(N); for (let r = N - 1; r >= 0; r--) { let s = y[r]; for (let q = r + 1; q < N; q++) s -= Lc[q][r] * x[q]; x[r] = s / Lc[r][r]; } return x; };
    const mul = (A, x) => { const y = new Float64Array(N); for (let r = 0; r < N; r++) { let s = 0; const Ar = A[r]; for (let c = 0; c < N; c++) s += Ar[c] * x[c]; y[r] = s; } return y; };
    let x = new Float64Array(N).map((_, k) => k % 2 ? 0 : 1 + 0.1 * Math.sin(k));
    let lam = 0;
    for (let it = 0; it < 400; it++) {
      x = solve(mul(M, x));
      let nx = 0; for (const v of x) nx = Math.max(nx, Math.abs(v)); for (let k = 0; k < N; k++) x[k] /= nx;
    }
    const Kx = mul(K, x), Mx = mul(M, x); let num = 0, den = 0; for (let k = 0; k < N; k++) { num += x[k] * Kx[k]; den += x[k] * Mx[k]; }
    lam = num / den;
    return rpmOf(Math.sqrt(lam));
  }

  function couplerAdds(mHalf, rOut, standoff, Lin, washer, frontExt) {
    // coupler half spread over 4 pieces from (face - standoff - Lin) to (face - standoff); face at x = frontExt
    const adds = [], np = 4, x0 = frontExt - standoff - Lin, x1 = frontExt - standoff;
    for (let k = 0; k < np; k++) {
      const x = x0 + (k + 0.5) * (x1 - x0) / np, m = mHalf / np;
      adds.push({ m, x, Id: m * (rOut * rOut / 4 + ((x1 - x0) / np) ** 2 / 12) });
    }
    if (washer && standoff >= 1.5e-3) adds.push({ m: 0.5e-3, x: frontExt - (standoff - 1e-3), Id: 0.5e-3 * 6e-3 ** 2 / 4 });
    return adds;
  }

  // ---------- load application: 1-DOF time simulation ---------------------------------------
  // Eq. (13.1): J phi'' = T_L - T_c(phi), phi = lag of the motor rotor (mechanical rad),
  // omega_m = omega_0 - phi'. Load laws: CR T = k omega_m, CC T = const, CP T = P / omega_m,
  // each reached through a first-order load-bank lag tau and ramped over t_ramp.
  function simulate(o, s) {
    const J = o.J, w0 = o.wGen, p = o.p;
    const curve = o.curveHot;                                  // [[delta, T]] over 0..pi/p, restoring
    const per = 2 * Math.PI / p, half = Math.PI / p;
    const Tc = phi => {                                        // periodic, odd torque-angle curve
      let d = ((phi % per) + per) % per, sg = 1;
      if (d > half) { d = per - d; sg = -1; }
      const x = d / half * (curve.length - 1), k = Math.min(curve.length - 2, Math.floor(x)), f = x - k;
      return sg * (curve[k][1] * (1 - f) + curve[k + 1][1] * f);
    };
    const P = s.P, t0 = 0.02, tr = Math.max(0, s.ramp), tau = Math.max(0, s.tau), zeta = s.zeta;
    const kth = p * o.TmaxHot, cS = 2 * zeta * Math.sqrt(kth * J);
    const ramp = t => tr > 0 ? Math.min(1, Math.max(0, (t - t0) / tr)) : (t >= t0 ? 1 : 0);
    const cmd = (t, wm) => {
      const r = ramp(t);
      if (s.mode === "CR") return P / (w0 * w0) * r * wm;
      if (s.mode === "CC") return P / w0 * r;
      return wm > 1 ? P * r / wm : 0;
    };
    const tEnd = t0 + tr + s.hold, dt = 2e-5;
    let phi = 0, v = 0, TL = 0, t = 0, maxE = 0, slipped = false, tSlip = NaN, Tpeak = 0;
    const out = []; const every = Math.max(1, Math.round(tEnd / dt / 1500));
    const f = (t, y) => {                                      // y = [phi, v, TL]
      const wm = w0 - y[1], c = cmd(t, wm);
      const dTL = tau > 0 ? (c - y[2]) / tau : 0;
      const TLx = tau > 0 ? y[2] : c;
      return [y[1], (TLx - Tc(y[0]) - cS * y[1]) / J, dTL];
    };
    let y = [0, 0, 0], k = 0;
    while (t < tEnd) {
      const k1 = f(t, y), k2 = f(t + dt / 2, y.map((v, j) => v + dt / 2 * k1[j])), k3 = f(t + dt / 2, y.map((v, j) => v + dt / 2 * k2[j])), k4 = f(t + dt, y.map((v, j) => v + dt * k3[j]));
      y = y.map((v, j) => v + dt / 6 * (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j]));
      t += dt; k++;
      phi = y[0];
      const eDeg = p * phi * 180 / Math.PI, Tcx = Tc(phi);
      if (!slipped && Math.abs(p * phi) > Math.PI) { slipped = true; tSlip = t; }
      if (!slipped) { maxE = Math.max(maxE, Math.abs(eDeg)); Tpeak = Math.max(Tpeak, Math.abs(Tcx)); }
      if (k % every === 0) out.push([t, eDeg, Tcx, tau > 0 ? y[2] : cmd(t, w0 - y[1])]);
      if (slipped && t > tSlip + 0.05) break;
    }
    return { trace: out, maxE, slipped, tSlip, Tpeak, tEnd };
  }

  // ---------- main ---------------------------------------------------------------------------
  function run(i) {
    const o = { i };
    const mi = MAG[i.magIn], mo = MAG[i.magOut], sl = SLEEVE[i.sleeveMat], fe = IRON[i.ironMat], hub = HUB[i.hubMat];
    o.mi = mi; o.mo = mo; o.sl = sl; o.fe = fe; o.hub = hub;
    const mm = 1e-3, p = Math.round(i.p); o.p = p;
    // ---- geometry (m)
    o.a0 = i.dShaft / 2 * mm; o.a1 = i.dMag / 2 * mm; o.tSl = i.tSleeve * mm; o.clr = i.clr * mm;
    o.b1 = o.a1 + o.tSl + o.clr; o.b2 = o.b1 + i.tRing * mm; o.tW = i.tWall * mm; o.rc = o.b2 + o.tW;
    o.gapMag = o.tSl + o.clr;
    o.Lin = i.Lin * mm; o.Lout = i.Lout * mm;
    o.overlap = Math.max(0, o.Lin - Math.max(0, Math.abs(i.zOff) * mm - Math.max(0, (o.Lout - o.Lin) / 2)));
    o.overlap = Math.min(o.overlap, o.Lout);

    // ---- speeds and running torque. Eq. (1.1), (1.2)
    o.wGen = w(i.nGen); o.wLow = w(i.nLow); o.wMax = w(i.nMax); o.wTest = w(i.nTest);
    o.Tnom = i.Pnom / o.wGen;
    o.Tworst = i.Pworst / o.wLow;
    o.Tcr = o.Tnom * i.nMax / i.nGen; o.Pcr = o.Tcr * o.wMax;

    // ---- magnets. Eq. (2.1)
    o.BrIn20 = mi.Br; o.BrOut20 = mo.Br;
    o.BrInHot = mi.Br * (1 + mi.aBr * (i.Tin - 20)); o.BrOutHot = mo.Br * (1 + mo.aBr * (i.Tout - 20));
    o.Mi = mi.Br / MU0; o.Mo = mo.Br / MU0;

    // ---- 2-D torque. Eq. (4.1), (4.2)
    const F = field2D({ a0: o.a0, a1: o.a1, b1: o.b1, b2: o.b2, p, alpha: i.alpha, mode: i.mode, Mi: o.Mi, Mo: o.Mo, shaftIron: i.shaftIron });
    o.F = F; o.T2D = F.Tpk; o.dPk = F.dpk;
    o.TmaxCold = F.Tpk * o.overlap * i.kEnd;
    o.hotRatio = (o.BrInHot / o.BrIn20) * (o.BrOutHot / o.BrOut20);   // Eq. (4.3)
    o.TmaxHot = o.TmaxCold * o.hotRatio;
    o.curveCold = F.curve.map(([d, T]) => [d, T * o.overlap * i.kEnd]);
    o.curveHot = o.curveCold.map(([d, T]) => [d, T * o.hotRatio]);
    o.marginWorst = o.TmaxHot / o.Tworst; o.marginNom = o.TmaxHot / o.Tnom;
    o.angRun = Math.asin(Math.min(1, o.Tnom / o.TmaxHot)) * 180 / Math.PI;   // electrical degrees, sine approx

    // ---- back iron. Eq. (5.1)
    const h1 = F.H[0];
    o.HrCup = Hr({ H: [h1], R: F.R }, o.b2 * (1 - 1e-7), 0, 0);
    o.Bcup = Math.abs(MU0 * o.HrCup + MU0 * h1.out.as);
    o.tWallNeed = o.b2 * o.Bcup / (p * i.Bwall);
    o.HrSh = Hr({ H: [h1], R: F.R }, o.a0 * (1 + 1e-7), 0, 0);
    o.Bsh = Math.abs(MU0 * o.HrSh + MU0 * h1.inn.as);
    o.tShNeed = o.a0 * o.Bsh / (p * i.Bwall);
    o.Bwall = o.b2 * o.Bcup / (p * o.tW);

    // ---- demagnetising field at the pole faces. Eq. (9.1)
    const dSlip = Math.PI / p;
    o.HinPk = Hr(F, o.a1 * (1 - 1e-6), o.dPk, o.dPk); o.HoutPk = Hr(F, o.b1 * (1 + 1e-6), 0, o.dPk);
    o.HinSlip = Hr(F, o.a1 * (1 - 1e-6), dSlip, dSlip); o.HoutSlip = Hr(F, o.b1 * (1 + 1e-6), 0, dSlip);
    // sign: pole 0 of each ring points outward (+r), so negative H_r is demagnetising for the inner
    // pole at its outer face; for the outer pole 0 (also +r) negative H_r is demagnetising too.
    o.HcjIn = mi.Hcj * (1 + mi.aHcj * (i.Tin - 20)); o.HcjOut = mo.Hcj * (1 + mo.aHcj * (i.Tout - 20));
    o.demagIn = Math.max(0, -o.HinSlip) / (0.9 * o.HcjIn); o.demagOut = Math.max(0, -o.HoutSlip) / (0.9 * o.HcjOut);

    // ---- radial pull. Eq. (6.1)
    const Rg = o.a1 + o.gapMag / 2, lam = 2 * Math.PI * Rg / p, dg = 1e-6;
    const sig = g => -(planarW(g + dg, o.a1 - o.a0, o.b2 - o.b1, mi.Br, mo.Br, lam, i.alpha) - planarW(g, o.a1 - o.a0, o.b2 - o.b1, mi.Br, mo.Br, lam, i.alpha)) / dg;
    o.sigN = sig(o.gapMag);
    o.dSigDg = (sig(o.gapMag + dg) - o.sigN) / dg;
    o.kr = Math.PI * Rg * o.overlap * Math.abs(o.dSigDg) * i.kEnd;
    o.Fr = o.kr * i.offset * mm;

    // ---- masses (kg)
    o.mMagIn = mi.rho * Math.PI * (o.a1 ** 2 - o.a0 ** 2) * o.Lin * i.alpha;
    o.mSleeve = sl.rho * Math.PI * ((o.a1 + o.tSl) ** 2 - o.a1 ** 2) * (o.Lin + 0.5e-3);
    o.mMotor = o.mMagIn + o.mSleeve;
    o.mMagOut = mo.rho * Math.PI * (o.b2 ** 2 - o.b1 ** 2) * o.Lout * i.alpha;
    o.mIron = fe.rho * Math.PI * (o.rc ** 2 - o.b2 ** 2) * (o.Lout + 1e-3);
    const rLand = 13.25e-3 / 2;
    o.mHub = hub.rho * (Math.PI * o.rc ** 2 * i.tBase * mm + Math.PI * ((rLand + 1.1e-3) ** 2 - rLand ** 2) * 5e-3);
    o.mEngine = o.mMagOut + o.mIron + o.mHub;

    // ---- retention at the test speed. Eq. (8.1), (8.2)
    const W2 = o.wTest ** 2;
    o.pIn = mi.rho * W2 * (o.a1 ** 3 - o.a0 ** 3) / (3 * o.a1);
    const rs = o.a1 + o.tSl / 2;
    o.sSleeve = o.pIn * rs / o.tSl + sl.rho * W2 * rs * rs;
    o.pOut = mo.rho * W2 * (o.b2 ** 3 - o.b1 ** 3) / (3 * o.b2);
    const rw = o.b2 + o.tW / 2;
    o.sIron = o.pOut * rw / o.tW + fe.rho * W2 * rw * rw;
    o.vIn = o.wTest * (o.a1 + o.tSl); o.vOut = o.wTest * o.rc;

    // ---- torsional dynamics. Eq. (7.1)-(7.6)
    o.Jrotor = i.Jrotor * 1e-6;                                   // input in kg mm^2
    o.Jhalf = o.mMagIn * (o.a1 ** 2 + o.a0 ** 2) / 2 + o.mSleeve * (o.a1 + o.tSl / 2) ** 2;
    o.J = o.Jrotor + o.Jhalf;
    o.kth = p * o.TmaxHot; o.kthCold = p * o.TmaxCold;
    o.fn = Math.sqrt(o.kth / o.J) / (2 * Math.PI); o.fnCold = Math.sqrt(o.kthCold / o.J) / (2 * Math.PI);
    o.cCR = o.Tnom / o.wGen;                                       // dT/d(omega) of a constant-R load
    o.zetaCR = o.cCR / (2 * Math.sqrt(o.kth * o.J));
    o.stepLim = 0.725 * o.TmaxHot;                                // equal-area criterion
    o.dwRelock = Math.sqrt(4 * o.TmaxHot / (p * o.J)); o.nRelock = rpmOf(o.dwRelock);
    o.alphaSpool = w(i.nMax - i.nIdle) / i.tSpool; o.Tacc = o.J * o.alphaSpool;
    o.fRipple = 6 * i.nGen / 60; o.ripple = (o.fn / o.fRipple) ** 2;

    // ---- starting. Eq. (12.1)
    o.Kt = 60 / (2 * Math.PI * i.Kv);
    o.TstartBase = i.Tmeas > 0 ? i.Tmeas * 1e-3 : o.TmaxCold;      // measured pull-out if entered
    o.TstartLim = 0.5 * o.TstartBase;
    o.Ilim = o.TstartLim / o.Kt;

    // ---- balance. Eq. (10.1)
    o.ecc = i.G * 1e-3 / w(i.nCap);
    o.Uallow = (i.mEngRotor * 1e-3 + o.mEngine) * o.ecc;
    o.Uhalf = o.mEngine * i.eccHalf * 1e-6;
    o.UallowMotor = (0.037 + o.mMotor) * o.ecc;

    // ---- motor rotor modes. Eq. (11.1)
    const frontExt = (i.standoff + i.Lin + 2) * mm;
    const adds = couplerAdds(o.mMotor, o.a1 + o.tSl, i.standoff * mm, o.Lin, i.washer, frontExt);
    o.frontExt = frontExt;
    o.modes = [6e6, 10e6, 20e6].map(kb => rotorMode(kb, frontExt, adds));
    o.modesBare = [6e6, 10e6, 20e6].map(kb => rotorMode(kb, 16e-3, []));
    o.modePass = 1.1 * i.nTest;
    return o;
  }

  function massSweep(o, i, kb) {                    // first mode vs coupler-half mass at the current layout
    const mm = 1e-3, frontExt = (i.standoff + i.Lin + 2) * mm, res = [];
    for (let g = 0; g <= 10.001; g += 0.5) res.push([g, rotorMode(kb, frontExt, couplerAdds(g * 1e-3, o.a1 + o.tSl, i.standoff * mm, o.Lin, i.washer, frontExt))]);
    return res;
  }

  const api = { run, simulate, massSweep, rotorMode, couplerAdds, MAG, SLEEVE, IRON, HUB, rpmOf, w, MU0 };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.CouplerModel = api;
})(this);
