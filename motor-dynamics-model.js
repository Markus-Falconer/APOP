"use strict";
// ============================================================ Motor Dynamics model
// First-order physics for running a hobby inrunner (donor motor) as a high-speed starter-generator.
// Everything here is a pure function of the inputs object `i` (lengths in mm, speeds in rpm,
// temperatures in °C) and returns SI values unless the name says otherwise. The page
// (motor-dynamics.html) draws the equation blocks from the returned object.
//
// Models used, all deliberately simple so every number can be traced to one equation:
//  - Magnet hoop stress: thin ring and rotating disk (Timoshenko).
//  - Sleeve: thin ring over a rigid shaft and a magnet with no hoop strength (assume it is cracked).
//  - Gap field: 2-pole diametric cylinder in an iron bore (2-D analytic), or a surface-magnet
//    magnetic circuit for 4+ poles. Kv is scaled from the donor's rated Kv by the field ratio.
//  - Generating point: back-EMF behind a six-diode bridge with resistance and commutation reactance.
//  - Losses: Dowell AC copper factor with six-pulse harmonics, Steinmetz iron loss scaled from a
//    1 T / 1 kHz loss density, Bilgen-Boulos windage, Palmgren bearing friction, diode drop.
//  - Rotordynamics: Jeffcott bending mode with a stiffer magnet section, rigid-body bounce and rocking
//    modes on the bearing stiffness, combined with Dunkerley.
//  - Starting: DC-motor torque line against a quadratic spool drag, integrated in time.
//
// Each relation carries an "Eq. (x.y)" tag that matches the Key equations panel on the page.
(function (root) {
  const MU0 = 4e-7 * Math.PI, RHO_CU20 = 1.724e-8, A_CU = 0.00393, RHO_FE = 7650;
  const AIR_RHO = 1.2, AIR_MU = 1.85e-5, NU_MAG = 0.24, NU_SH = 0.3, DRAG_REF_RPM = 20000, PRELOAD_N = 20;
  const w = rpm => rpm * 2 * Math.PI / 60;
  const rpmOf = om => om * 60 / (2 * Math.PI);

  // Magnet materials. tens = tensile strength (MPa), alpha = radial CTE averaged over a diametric
  // magnet (NdFeB is about +5 ppm/K along the magnetisation and about -1 ppm/K across it).
  const MAG = {
    ndsh: { name: "NdFeB N42SH", rho: 7500, Br: 1.30, aBr: -0.0012, tens: 80, Tmax: 150, E: 160e9, alpha: 2e-6, cond: 0.7e6 },
    nduh: { name: "NdFeB N38UH", rho: 7500, Br: 1.24, aBr: -0.0012, tens: 80, Tmax: 180, E: 160e9, alpha: 2e-6, cond: 0.7e6 },
    ndeh: { name: "NdFeB N35EH", rho: 7500, Br: 1.19, aBr: -0.0012, tens: 80, Tmax: 200, E: 160e9, alpha: 2e-6, cond: 0.7e6 },
    smco: { name: "SmCo 2:17 (30 MGOe)", rho: 8400, Br: 1.10, aBr: -0.00035, tens: 35, Tmax: 300, E: 120e9, alpha: 10e-6, cond: 1.2e6 },
    smco26: { name: "SmCo 2:17 (26 MGOe, high temp)", rho: 8400, Br: 1.04, aBr: -0.0003, tens: 35, Tmax: 350, E: 120e9, alpha: 10e-6, cond: 1.2e6 },
  };
  // Sleeve materials. ult = hoop strength used for the allowable (MPa; yield for metals),
  // E = hoop modulus, Tlim = resin glass transition or metal limit, metal = conducts (eddy loss).
  const SLV = {
    cf700: { name: "Carbon/epoxy T700, hoop wound", rho: 1580, E: 125e9, ult: 2000, alpha: 0.3e-6, Tlim: 150, metal: false },
    cf800: { name: "Carbon/epoxy T800/T1000, hoop wound", rho: 1600, E: 160e9, ult: 2500, alpha: 0.0, Tlim: 150, metal: false },
    cfhm: { name: "Carbon/epoxy M46J (high modulus)", rho: 1620, E: 250e9, ult: 1800, alpha: -0.5e-6, Tlim: 150, metal: false },
    cfhot: { name: "Carbon/BMI or cyanate ester (hot resin)", rho: 1600, E: 140e9, ult: 2000, alpha: 0.2e-6, Tlim: 230, metal: false },
    aramid: { name: "Aramid (Kevlar 49)/epoxy", rho: 1380, E: 75e9, ult: 1300, alpha: -2e-6, Tlim: 120, metal: false },
    glass: { name: "S-glass/epoxy", rho: 2000, E: 50e9, ult: 1600, alpha: 6e-6, Tlim: 150, metal: false },
    inco: { name: "Inconel 718 can", rho: 8190, E: 200e9, ult: 1030, alpha: 13e-6, Tlim: 650, metal: true },
    ti64: { name: "Ti-6Al-4V can", rho: 4430, E: 114e9, ult: 880, alpha: 8.6e-6, Tlim: 350, metal: true },
  };
  const SHAFT = {
    steel: { name: "Steel", E: 200e9, rho: 7850, alpha: 11.5e-6 },
    ti: { name: "Titanium", E: 114e9, rho: 4430, alpha: 8.6e-6 },
    inco: { name: "Inconel", E: 200e9, rho: 8190, alpha: 13e-6 },
  };
  // Lamination loss density p (W/kg) at 1.0 T and 1 kHz, and the hysteresis share of it there.
  // Typical catalogue values; replace with the datasheet curve for the real steel.
  const LAM = {
    m35: { name: "0.35 mm silicon steel (M19 / 35W)", p: 80, hf: 0.30, t: 0.35, Bsat: 1.7 },
    no20: { name: "0.20 mm NO20", p: 40, hf: 0.40, t: 0.20, Bsat: 1.7 },
    no10: { name: "0.10 mm NO10", p: 25, hf: 0.55, t: 0.10, Bsat: 1.65 },
    si65: { name: "0.10 mm 6.5% Si (JNHF)", p: 18, hf: 0.55, t: 0.10, Bsat: 1.3 },
    amor: { name: "Amorphous (2605SA1, 25 µm)", p: 6, hf: 0.50, t: 0.025, Bsat: 1.5 },
  };
  // DN = bearing bore (mm) x rpm. Rule-of-thumb ceilings; f0 and viscosity feed Palmgren friction.
  const LUB = {
    sgrease: { name: "Steel balls, grease", DN: 0.6e6, f0: 2.0, nu: 20 },
    hgrease: { name: "Hybrid ceramic, high-speed grease", DN: 1.0e6, f0: 1.5, nu: 15 },
    hmist: { name: "Hybrid ceramic, oil mist", DN: 1.5e6, f0: 1.0, nu: 10 },
    hairoil: { name: "Hybrid ceramic, air-oil / jet", DN: 2.0e6, f0: 1.0, nu: 7 },
  };

  // Connection change from one wiring to another: Kv and line-line resistance factors.
  function conn(from, to) {
    if (from === to) return { kv: 1, r: 1 };
    return to === "D" ? { kv: Math.sqrt(3), r: 1 / 3 } : { kv: 1 / Math.sqrt(3), r: 3 };
  }

  // Fundamental peak radial field at the stator bore.
  function gapB(model, poles, Br, rm, ri, Rs, gMag, kc) {
    if (model === "diam" && poles === 2) {
      // Uniformly magnetised cylinder (bore ri) inside an iron bore Rs: a 2-D dipole plus its image.  Eq. (4.2)
      return Br * (rm * rm - ri * ri) / (Rs * Rs) / kc;
    }
    const lm = rm - ri, arc = 0.85;   // surface magnets, 85% pole arc.  Eq. (4.3)
    return 4 / Math.PI * Math.sin(Math.PI * arc / 2) * Br * lm / (lm + 1.05 * kc * gMag);
  }

  // Dowell AC resistance factor for m layers of round strands of diameter d at skin depth delta.
  function dowell(d, delta, m) {
    const D = Math.max((Math.PI / 4) ** 0.75 * d / delta * Math.sqrt(0.8), 1e-3);
    const t1 = (Math.sinh(2 * D) + Math.sin(2 * D)) / (Math.cosh(2 * D) - Math.cos(2 * D));
    const t2 = (Math.sinh(D) - Math.sin(D)) / (Math.cosh(D) + Math.cos(D));
    return D * (t1 + 2 * (m * m - 1) / 3 * t2);
  }

  // Bilgen & Boulos torque coefficient for a cylinder spinning in a concentric bore.
  function windCM(Re, gr) {
    const k = Math.pow(gr, 0.3);
    if (Re < 64) return 10 * k / Re;
    if (Re < 500) return 2 * k / Math.pow(Re, 0.6);
    if (Re < 1e4) return 1.03 * k / Math.sqrt(Re);
    return 0.065 * k / Math.pow(Re, 0.2);
  }

  function run(i) {
    const mag = MAG[i.mag] || MAG.ndsh, magS = MAG[i.magStock] || MAG.ndsh, slv = SLV[i.sleeve] || SLV.cf700;
    const sh = SHAFT[i.shaftMat] || SHAFT.steel, lam = LAM[i.lam] || LAM.no20, lub = LUB[i.lub] || LUB.hmist;
    const mm = v => v * 1e-3;
    const poles = +i.poles, pp = poles / 2;
    const model = poles === 2 ? i.field : "surf";
    const o = { mag, magS, slv, sh, lam, lub, poles, pp, model, i };

    // ---------- geometry
    const Rs = mm(i.Dbore) / 2, rm = mm(i.dmOD) / 2, ri = mm(i.dmID) / 2, t = mm(i.ts);
    const rso = rm + t, rsm = rm + t / 2, Lm = mm(i.Lm), Lstk = mm(i.Lstk), Leff = Math.min(Lm, Lstk);
    const clr = Rs - rso, gMag = Rs - rm;
    Object.assign(o, { Rs, rm, ri, t, rso, rsm, Lm, Lstk, Leff, clr, gMag, fits: clr > 0 && rm > ri && t > 0 });

    // ---------- 1. speeds  Eq. (1.1)
    const wD = w(i.nDesign), wG = w(i.nGen), wM = w(i.nMax);
    Object.assign(o, { wD, wG, wM, feD: pp * i.nDesign / 60, feG: pp * i.nGen / 60,
      vMag: wD * rm, vSlv: wD * rso, vSlvG: wG * rso });

    // ---------- 2. unsupported magnet
    const nu = NU_MAG;
    o.sRing = mag.rho * (wD * rm) ** 2;                               // Eq. (2.1)
    o.sBore = ri > 0 ?   /* Eq. (2.2) */ (3 + nu) / 4 * mag.rho * wD ** 2 * (rm * rm + (1 - nu) / (3 + nu) * ri * ri)
                     : (3 + nu) / 8 * mag.rho * wD ** 2 * rm * rm;
    o.magMargin = mag.tens * 1e6 / o.sBore;

    // ---------- 3. sleeve and interference
    o.pc = mag.rho * wD ** 2 * (rm ** 3 - ri ** 3) / (3 * rm);       // Eq. (3.1)
    o.sSelf = slv.rho * (wD * rsm) ** 2;
    o.sLift = (o.pc + i.pres * 1e6) * rsm / t + o.sSelf;            // Eq. (3.2) sleeve stress needed at speed
    o.aIn = ri > 0 ? (mag.alpha * (rm - ri) + sh.alpha * ri) / rm : mag.alpha;
    o.dT = i.Trotor - i.Tasm;
    o.sTh = slv.E * (o.aIn - slv.alpha) * o.dT;                      // Eq. (3.3) + means heating tightens the fit
    o.s0 = o.sLift - Math.min(0, o.sTh);                             // Eq. (3.4) static stress to build in
    o.sMax = o.s0 + Math.max(0, o.sTh);
    o.allow = slv.ult * 1e6 / i.SF;
    o.slvMargin = o.allow / o.sMax;                                  // Eq. (3.4)
    o.p0 = o.s0 * t / rsm;
    o.dSleeve = o.s0 * rsm / slv.E;
    o.dMag = o.p0 * (rm - ri) / mag.E;
    o.dShaft = ri > 0 ? o.p0 * (rm / ri) * ri * (1 - NU_SH) / sh.E : 0;
    o.interf = 2 * (o.dSleeve + o.dMag + o.dShaft);                  // Eq. (3.5) diametral, m
    o.governs = o.sTh < 0 ? "hot at speed" : "cold at speed";
    // Eq. (3.6) burst estimate with no preload (a glued sleeve): both terms of (3.2) scale with n²
    o.sLift0 = o.pc * rsm / t + o.sSelf;
    o.nBurst = i.nDesign * Math.sqrt(slv.ult * 1e6 / o.sLift0);

    // ---------- 4. field
    const BrT = (m, T) => m.Br * (1 + m.aBr * (T - 20));
    o.BrHot = BrT(mag, i.Trotor);                                    // Eq. (4.1)
    o.BStock = gapB(model, poles, magS.Br, mm(i.dmStockOD) / 2, mm(i.dmStockID) / 2, Rs, Rs - mm(i.dmStockOD) / 2, i.kc);
    o.B20 = gapB(model, poles, mag.Br, rm, ri, Rs, gMag, i.kc);
    o.BHot = gapB(model, poles, o.BrHot, rm, ri, Rs, gMag, i.kc);
    o.Bcore = o.BHot * i.Bratio;

    // ---------- 5. Kv scaling
    const cRun = conn(i.connRated, i.connRun), LeffStock = Math.min(mm(i.LmStock), Lstk);
    o.kvGeom = (o.BStock / o.B20) * (LeffStock / Leff) / i.turns * cRun.kv;   // Eq. (5.1)
    o.Kv20 = i.KvRated * o.kvGeom;
    o.KvHot = o.Kv20 * o.B20 / o.BHot;
    o.Kt = 60 / (2 * Math.PI * o.KvHot);                              // Eq. (5.2)
    o.KtRated = 60 / (2 * Math.PI * i.KvRated);
    const VLL = (n, kv) => n / kv;
    o.volts = [["Idle", i.nIdle], ["Generating", i.nGen], ["Engine max", i.nMax], ["Design (overspeed)", i.nDesign]]
      .map(([k, n]) => ({ k, n, VpkHot: VLL(n, o.KvHot), VdcHot: 3 / Math.PI * VLL(n, o.KvHot), VdcCold: 3 / Math.PI * VLL(n, o.Kv20) }));
    o.VocMaxCold = 3 / Math.PI * VLL(Math.max(i.nDesign, i.nMax), o.Kv20);   // Eq. (5.2)

    // ---------- 6. electrical resistance and inductance of the candidate winding
    o.rFac = i.turns * i.turns * cRun.r;
    o.R20 = i.RllRated * 1e-3 * o.rFac;
    o.Rhot = o.R20 * (1 + A_CU * (i.Twind - 20));
    o.Lll = i.LllRated * 1e-6 * o.rFac;

    // AC factor at the generating frequency, weighted over six-pulse current harmonics (amplitude 1/h)
    const rhoCu = RHO_CU20 * (1 + A_CU * (i.Twind - 20));
    o.delta = Math.sqrt(rhoCu / (Math.PI * o.feG * MU0));            // Eq. (7.1)
    o.dOverDelta = mm(i.strand) / o.delta;
    const H = [1, 5, 7, 11, 13, 17, 19];
    let num = 0, den = 0;
    H.forEach(h => { const dl = Math.sqrt(rhoCu / (Math.PI * h * o.feG * MU0)); num += dowell(mm(i.strand), dl, i.layers) / (h * h); den += 1 / (h * h); });
    o.Fac1 = dowell(mm(i.strand), o.delta, i.layers);
    o.Fac = num / den;
    o.Rac = o.Rhot * o.Fac;

    // ---------- 6b. generating point (six-diode bridge)
    o.Edc = 3 / Math.PI * i.nGen / o.KvHot;
    o.V0 = o.Edc - 2 * i.Vd;                                         // Eq. (6.1)
    o.Rx = 3 / Math.PI * (2 * Math.PI * o.feG) * (o.Lll / 2);        // commutation drop, not a loss
    o.Req = o.Rac + o.Rx;                                            // Eq. (6.1)
    o.Pmax = o.V0 > 0 ? o.V0 * o.V0 / (4 * o.Req) : 0;
    const disc = o.V0 * o.V0 - 4 * o.Req * i.Pdc;
    o.canMake = disc >= 0 && o.V0 > 0;
    o.Idc = o.canMake ? (o.V0 - Math.sqrt(disc)) / (2 * o.Req) : NaN;  // Eq. (6.2)
    o.Vdc = i.Pdc / o.Idc;
    o.Rload = o.Vdc / o.Idc;
    o.Iph = Math.sqrt(2 / 3) * o.Idc;
    o.Pcu = o.Rac * o.Idc ** 2;                                      // Eq. (7.1)
    o.Pdiode = 2 * i.Vd * o.Idc;                                     // Eq. (7.4)
    o.Pem = i.Pdc + o.Pcu + o.Pdiode;
    o.Tem = o.Pem / wG;                                              // Eq. (6.3)
    o.shear = o.Tem / (2 * Math.PI * Rs * Rs * Leff);
    o.ripple = 1 - Math.cos(Math.PI / 6);
    o.Icont = i.Icont;
    o.Pthermal = Math.max(0, (o.V0 - o.Req * i.Icont) * i.Icont);     // DC power at the continuous current limit

    // ---------- 7. losses at the generating speed
    o.mFe = RHO_FE * Lstk * Math.PI / 4 * (mm(i.Dso) ** 2 - (2 * Rs) ** 2) * (1 - i.slotFrac);
    const fr = o.feG / 1000, B2 = o.Bcore ** 2;
    o.pFeH = lam.p * lam.hf * fr * B2;
    o.pFeE = lam.p * (1 - lam.hf) * fr * fr * B2;
    o.Pfe = i.kfe * o.mFe * (o.pFeH + o.pFeE);                       // Eq. (7.2)
    o.ReW = AIR_RHO * wG * rso * Math.max(o.clr, 1e-5) / AIR_MU;
    o.CM = windCM(o.ReW, Math.max(o.clr, 1e-5) / rso);
    o.Pwind = 0.5 * o.CM * Math.PI * AIR_RHO * wG ** 3 * rso ** 4 * Lm;   // Eq. (7.3)
    o.dm = (i.dBrg + i.DBrg) / 2;
    const nuN = lub.nu * i.nGen;
    o.M0 = (nuN >= 2000 ? 1e-7 * lub.f0 * Math.pow(nuN, 2 / 3) : 160e-7 * lub.f0) * o.dm ** 3;   // N·mm
    o.M1 = 0.0007 * PRELOAD_N * o.dm;                                                           // N·mm
    o.Pbrg = 2 * (o.M0 + o.M1) * 1e-3 * wG;                          // Eq. (7.4)
    o.Ploss = o.Pcu + o.Pdiode + o.Pfe + o.Pwind + o.Pbrg;
    o.Pshaft = o.Pem + o.Pfe + o.Pwind + o.Pbrg;
    o.Tshaft = o.Pshaft / wG;
    o.eff = i.Pdc / o.Pshaft;                                        // Eq. (7.5)

    // ---------- 8. bearings  Eq. (8.1)
    o.DN = i.dBrg * i.nDesign;
    o.ndm = o.dm * i.nDesign;
    o.DNlim = lub.DN;

    // ---------- 9. rotor mass, inertia, critical speeds
    o.mMag = mag.rho * Math.PI * (rm * rm - ri * ri) * Lm;
    o.mSlv = slv.rho * Math.PI * (rso * rso - rm * rm) * Lm;
    const rsh = mm(i.dShaft) / 2, span = mm(i.span);
    o.mShaft = sh.rho * Math.PI * rsh * rsh * Math.max(0, span - Lm);   // stub shafts between magnet and bearings
    o.mCore = sh.rho * Math.PI * ri * ri * Lm;                            // shaft (or core) inside the magnet
    o.mRot = o.mMag + o.mSlv + o.mShaft + o.mCore;
    o.Jrot = 0.5 * o.mMag * (rm * rm + ri * ri) + 0.5 * o.mSlv * (rso * rso + rm * rm) + 0.5 * (o.mShaft * rsh * rsh + o.mCore * ri * ri);
    o.It = o.mRot * (3 * rm * rm + Lm * Lm) / 12;                      // transverse inertia, rotor as a cylinder
    const EIs = sh.E * Math.PI * Math.pow(2 * rsh, 4) / 64;
    const EIc = /* Eq. (9.2) */ sh.E * Math.PI * Math.pow(2 * ri, 4) / 64 + i.kStack * (mag.E * Math.PI * (Math.pow(2 * rm, 4) - Math.pow(2 * ri, 4)) / 64
      + slv.E * Math.PI * (Math.pow(2 * rso, 4) - Math.pow(2 * rm, 4)) / 64);
    const a = Math.max(0, (span - Lm) / 2), half = span / 2;
    const flex = 2 * /* Eq. (9.1) */ (Math.pow(Math.min(a, half), 3) / (12 * EIs) + (half ** 3 - Math.pow(Math.min(a, half), 3)) / (12 * Math.max(EIc, 1e-12)));
    o.kShaft = 1 / flex;
    o.EIs = EIs; o.EIc = EIc;
    const kb = i.kBrg * 1e6;
    o.wBend = Math.sqrt(o.kShaft / o.mRot);                           // Eq. (9.3)
    o.wBounce = Math.sqrt(2 * kb / o.mRot);
    o.wRock = Math.sqrt(2 * kb * half * half / o.It);
    o.w1 = 1 / Math.sqrt(1 / o.wBend ** 2 + 1 / o.wBounce ** 2);      // Eq. (9.4) Dunkerley: bending + bounce
    o.modes = [
      { k: "Bounce on bearings (rigid body)", rpm: rpmOf(o.wBounce), rigid: true },
      { k: "Rocking on bearings (rigid body, no gyroscopic stiffening)", rpm: rpmOf(o.wRock), rigid: true },
      { k: "Shaft bending, rigid bearings", rpm: rpmOf(o.wBend), rigid: false },
      { k: "First mode, bending + bearings (Dunkerley)", rpm: rpmOf(o.w1), rigid: false },
    ];
    o.bendRatio = rpmOf(o.w1) / i.nDesign;

    // ---------- 10. balance and stored energy  Eq. (10.1)
    o.ecc = i.G * 1e-3 / wD;
    o.Fub = o.mRot * o.ecc * wD * wD;
    o.Ures = o.mRot * 1e3 * o.ecc * 1e3;                               // g·mm
    o.KE = 0.5 * o.Jrot * wD * wD;

    // ---------- 11. starting
    const cS = conn(i.connRun, i.connStart);
    o.KvStart = o.Kv20 * o.B20 / gapB(model, poles, mag.Br, rm, ri, Rs, gMag, i.kc) * cS.kv;   // cold rotor
    o.KtStart = 60 / (2 * Math.PI * o.KvStart);
    o.Rstart = o.R20 * cS.r;
    o.nNoLoad = o.KvStart * i.Vbat;
    o.Istall = Math.min(i.Iesc, i.Vbat / o.Rstart);
    o.Tstall = o.KtStart * o.Istall;
    o.Jtot = i.Jeng * 1e-6 + o.Jrot;
    const Tm = n => /* Eq. (11.1) */ o.KtStart * Math.min(i.Iesc, Math.max(0, (i.Vbat - n / o.KvStart) / o.Rstart));
    const Td = n => i.Tdrag * 1e-3 * (n / DRAG_REF_RPM) ** 2;
    o.Tm = Tm; o.Td = Td;
    let lo = 0, hi = o.nNoLoad;
    for (let k = 0; k < 60; k++) { const m = (lo + hi) / 2; if (Tm(m) - Td(m) > 0) lo = m; else hi = m; }
    o.nEq = lo;
    o.canStart = o.nEq > i.nHand;
    if (o.canStart) {
      const N = 400, dn = i.nHand / N; let tt = 0;
      for (let k = 0; k < N; k++) { const n = (k + 0.5) * dn; tt += o.Jtot * w(dn) / (Tm(n) - Td(n)); }   // Eq. (11.2)
      o.tStart = tt;
    } else o.tStart = NaN;

    // ---------- 11b. stock starter as the reference requirement (brushed DC, e.g. RK-370SD-5028)
    const KtR = 60 / (2 * Math.PI * i.refKv);
    const Tr = n => /* Eq. (11.3) */ Math.max(0, KtR * ((i.refV - n / i.refKv) / i.refR - i.refI0));
    o.Tr = Tr; o.KtRef = KtR;
    o.refNoLoad = i.refKv * (i.refV - i.refI0 * i.refR);
    o.refStall = Tr(0);
    o.refPmax = i.refV * i.refV / (4 * i.refR);
    // worst ratio of candidate torque to stock torque from 0 to the handoff speed
    let worst = Infinity, worstN = 0;
    for (let k = 0; k <= 200; k++) { const n = k / 200 * i.nHand, tr = Tr(n); if (tr > 1e-6) { const r = Tm(n) / tr; if (r < worst) { worst = r; worstN = n; } } }
    o.refRatio = worst; o.refRatioN = worstN;
    o.vMatch = (o.refNoLoad + 0) / o.KvStart;                          // start voltage for the same no-load speed
    o.iMatch = o.refStall / o.KtStart;                                // start current for the same stall torque
    let lo2 = 0, hi2 = o.refNoLoad;
    for (let k = 0; k < 60; k++) { const m = (lo2 + hi2) / 2; if (Tr(m) - Td(m) > 0) lo2 = m; else hi2 = m; }
    o.refEq = lo2;
    if (o.refEq > i.nHand) {
      const N = 400, dn = i.nHand / N; let tt = 0;
      for (let k = 0; k < N; k++) { const n = (k + 0.5) * dn; tt += (i.Jeng * 1e-6) * w(dn) / (Tr(n) - Td(n)); }
      o.tRef = tt;
    } else o.tRef = NaN;
    return o;
  }

  const api = { run, MAG, SLV, SHAFT, LAM, LUB, dowell, windCM, gapB, conn, DRAG_REF_RPM, rpmOf, w };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.MotorModel = api;
})(this);
