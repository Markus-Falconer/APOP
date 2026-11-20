"use strict";
/* Big Ben CAD page: finding the Big Ben features among the CAD faces, setting up the page frame
 * from them, and measuring what the V3 model needs. Uses cadfit.js for the face fits.
 * Page frame: x runs aft along the engine axis from the nozzle flange, y toward the first tagged
 * pipe, z = x × y. Works in the browser (window.BigBenCAD) and in Node (module.exports). Units: mm.
 */
(function (root) {
  const CF = typeof module !== "undefined" && module.exports ? require("./cadfit.js") : root.CADFit;
  const { dot, sub, add, mul, cross, len, unit, perp } = CF.vec;
  const DEG = 180 / Math.PI;
  const isRev = f => f && (f.type === "cyl" || f.type === "cone");
  const lateral = (v, X) => sub(v, mul(X, dot(v, X)));

  // Face areas (mm²), cached on the cad object.
  function areas(cad) {
    if (cad.area) return cad.area;
    const A = new Float64Array(cad.faces.length), p = i => [cad.pos[i * 3], cad.pos[i * 3 + 1], cad.pos[i * 3 + 2]];
    for (const f of cad.faces) for (let t = f.t0; t < f.t1; t++) {
      const a = p(cad.tri[t * 3]); A[f.id] += len(cross(sub(p(cad.tri[t * 3 + 1]), a), sub(p(cad.tri[t * 3 + 2]), a))) / 2;
    }
    return (cad.area = A);
  }
  // The inside of a wall: whichever of the face and its coaxial partner has the smaller radius.
  function inner(cad, fid) {
    const f = CF.fitFace(cad, fid);
    if (!["cyl", "cone", "torus"].includes(f.type)) return { f, wall: null };
    const wp = CF.wallPair(cad, f);
    if (!wp) return { f, wall: null };
    const g = CF.fitFace(cad, wp.partner);
    return g.r < f.r ? { f: g, wall: wp.wall, picked: "outside" } : { f, wall: wp.wall, picked: "inside" };
  }
  // Axial position (along unit X from O) of the two ends of a cylinder or cone face.
  const xRange = (f, O, X) => [f.tmin, f.tmax].map(t => dot(sub(add(f.center, mul(f.axis, t)), O), X)).sort((a, b) => a - b);

  // Page frame from the tagged faces. Needs the tube bore; the flange (or else the pipe) says which way is aft.
  function frameOf(cad, tags, flip) {
    if (tags.bore == null) return null;
    const bore = CF.fitFace(cad, tags.bore);
    if (!isRev(bore)) return null;
    const a = bore.axis, c = bore.center, get = k => tags[k] != null ? CF.fitFace(cad, tags[k]) : null;
    const fl = get("flange"), pipe = get("pipe"), leg = get("leg");
    let s = 0, how = "";
    if (fl && fl.type === "plane") { const d = dot(sub(c, fl.point), a); if (Math.abs(d) > 1e-3) { s = Math.sign(d); how = "flange"; } }
    if (!s && pipe && pipe.type === "cyl") {
      // A pipe leaves the tube heading aft, so its face lies aft of where its centreline meets the engine axis.
      const ll = CF.lineLine(c, a, pipe.center, pipe.axis), d = dot(sub(pipe.center, ll.P1), a);
      if (Math.abs(d) > 0.5) { s = Math.sign(d); how = "pipe"; }
    }
    if (!s && leg && leg.type === "cyl") { const d = dot(sub(leg.center, c), a); if (Math.abs(d) > 0.5) { s = Math.sign(d); how = "leg"; } }
    if (!s) { s = 1; how = "guess"; }
    if (flip) s = -s;
    const X = mul(a, s);
    const O = fl && fl.type === "plane" ? add(c, mul(a, dot(sub(fl.point, c), a))) : add(c, mul(a, s > 0 ? bore.tmin : bore.tmax));
    let Y = null;
    if (pipe && pipe.type === "cyl") { const ll = CF.lineLine(O, X, pipe.center, pipe.axis), d = lateral(sub(pipe.center, ll.P1), X); if (len(d) > 1e-3) Y = unit(d); }
    if (!Y && leg && leg.type === "cyl") { const d = lateral(sub(leg.center, O), X); if (len(d) > 1e-3) Y = unit(d); }
    if (!Y) Y = perp(X);
    const Z = cross(X, Y);
    return {
      O, X, Y, Z, how, flipped: !!flip,
      toPage: p => { const d = sub(p, O); return [dot(d, X), dot(d, Y), dot(d, Z)]; },
      dirToPage: d => [dot(d, X), dot(d, Y), dot(d, Z)],
      toCad: q => add(O, add(mul(X, q[0]), add(mul(Y, q[1]), mul(Z, q[2])))),
      dirToCad: q => add(mul(X, q[0]), add(mul(Y, q[1]), mul(Z, q[2])))
    };
  }

  // Best guesses for each feature, from the shapes alone. Every guess can be re-picked on the page.
  function autoDetect(cad) {
    const A = areas(cad), F = cad.faces.map(f => CF.fitFace(cad, f.id)), tags = {};
    const big = list => list.reduce((b, f) => !b || A[f.fid] > A[b.fid] ? f : b, null);
    let bore = big(F.filter(f => isRev(f) && f.rmin >= 27 && f.rmax <= 42 && f.tmax - f.tmin >= 10));
    if (!bore) return tags;
    bore = inner(cad, bore.fid).f; tags.bore = bore.fid;
    const ax = bore.axis, c = bore.center, rB = bore.r, cosA = f => Math.abs(dot(f.axis, ax));
    const off = p => lateral(sub(p, c), ax);
    // Straight pipe runs that leave the tube at an angle, with centrelines through the engine axis.
    const pipes = F.filter(f => f.type === "cyl" && f.r >= 12 && f.r <= 35 && cosA(f) < Math.cos(10 / DEG) && cosA(f) > Math.cos(89 / DEG) &&
      CF.lineLine(c, ax, f.center, f.axis).dist < 0.3 * rB);
    const out = f => { const ll = CF.lineLine(c, ax, f.center, f.axis); return lateral(sub(f.center, ll.P1), ax); };
    let pipe = big(pipes);
    if (pipe) {
      const latP = out(pipe), ip = inner(cad, pipe.fid); pipe = ip.f; tags.pipe = pipe.fid;
      const rIn = pipe.r, rOut = ip.wall ? rIn + ip.wall : null, sameR = r => Math.abs(r - rIn) < 0.8 || (rOut && Math.abs(r - rOut) < 0.8);
      const p2 = big(pipes.filter(f => dot(out(f), latP) < 0 && sameR(f.r)));
      if (p2) tags.pipe2 = inner(cad, p2.fid).f.fid;
      const sameSide = p => dot(off(p), latP) > 0;
      let leg = big(F.filter(f => f.type === "cyl" && cosA(f) > 0.999 && sameR(f.r) && len(off(f.center)) > rB + 2 && sameSide(f.center)));
      if (leg) { leg = inner(cad, leg.fid).f; tags.leg = leg.fid; }
      const bend = big(F.filter(f => f.type === "torus" && sameR(f.r) && f.ends.some(sameSide)));
      if (bend) tags.bend = inner(cad, bend.fid).f.fid;
      if (leg) {
        const neck = big(F.filter(f => f.type === "cone" && cosA(f) > 0.999 && CF.lineLine(leg.center, leg.axis, f.center, f.axis).dist < 1.5));
        if (neck) tags.neck = inner(cad, neck.fid).f.fid;
      }
    }
    // Flat faces square to the engine axis: flange at the front of the bore, end cap at the back, wheel face in between.
    const fr = frameOf(cad, tags, false);
    if (fr) {
      const [x0, x1] = xRange(bore, fr.O, fr.X);
      const flats = F.filter(f => f.type === "plane" && Math.abs(dot(f.normal, ax)) > 0.999 && len(off(f.point)) < 0.5 * rB).map(f => ({ f, x: dot(sub(f.point, fr.O), fr.X) }));
      const fl = big(flats.filter(o => Math.abs(o.x - x0) < 2 && o.f.extent >= 0.8 * rB).map(o => o.f));
      if (fl) tags.flange = fl.fid;
      const cap = big(flats.filter(o => Math.abs(o.x - x1) < 3 && o.f.extent >= 0.5 * rB).map(o => o.f));
      if (cap) tags.cap = cap.fid;
      const inside = flats.filter(o => o.x > x0 + 1 && o.x < x1 - 1 && o.f.extent >= 0.4 * rB && o.f.extent <= rB + 0.5).sort((p, q) => p.x - q.x);
      if (inside.length) tags.wheel = inside[0].f.fid;
    }
    return tags;
  }

  // Measurements for the model. opts.wall: pipe wall to use if overridden (affects the gap and bend ratio).
  function measure(cad, tags, F, opts = {}) {
    const vals = {}, checks = [], info = {};
    const put = (k, v, src, note) => { if (v !== undefined && v !== null && (typeof v !== "number" || Number.isFinite(v))) vals[k] = { v, src, note }; };
    const chk = (l, v, ok, note) => checks.push({ l, v, ok, note });
    if (!F) return { vals, checks, info };
    const { O, X } = F, has = k => tags[k] != null;
    // Tube bore
    const B = inner(cad, tags.bore), bf = B.f;
    const xb = xRange(bf, O, X); info.boreX = xb;
    let Rt0 = bf.r, ta = 0;
    if (bf.type === "cone") {
      const drdx = bf.k * dot(bf.axis, X); ta = drdx;
      Rt0 = bf.r0 + bf.k * dot(sub(O, bf.center), bf.axis);
      put("shroud", "cone", "Tube bore"); put("cone", Math.atan(Math.abs(drdx)) * DEG, "Tube bore");
      if (drdx < 0) chk("Cone direction", "narrows going aft", false, "The model only handles a cone that widens aft; it uses the angle as if it widened.");
    } else put("shroud", "lip", "Tube bore");
    put("tubeID", 2 * Rt0, "Tube bore", bf.type === "cone" ? "at the flange" : "");
    info.tubeWall = B.wall; info.Rt0 = Rt0;
    chk("Tube bore", `Ø${(2 * Rt0).toFixed(2)} mm, ${(xb[1] - xb[0]).toFixed(1)} mm long${B.wall ? `, wall ${B.wall.toFixed(2)} mm` : ""}`, 2 * Rt0 >= 58.5,
      2 * Rt0 < 58.5 ? "Smaller than the 58 mm wheel plus a minimum tip gap." : B.picked === "outside" ? "Measured on the inside face next to the one tagged." : "");
    if (has("flange")) {
      const fl = CF.fitFace(cad, tags.flange);
      if (fl.type === "plane") chk("Flange face", `square to the axis within ${(Math.acos(Math.min(1, Math.abs(dot(fl.normal, X)))) * DEG).toFixed(2)}°; bore starts ${xb[0].toFixed(1)} mm from it`,
        Math.abs(dot(fl.normal, X)) > 0.9998 && Math.abs(xb[0]) < 3);
    }
    // Pipe leaving the tube
    let pf = null, th = null, xs = null, sEnd = null, wallUsed = opts.wall;
    if (has("pipe")) {
      const P = inner(cad, tags.pipe); pf = P.f;
      if (pf.type === "cyl") {
        put("pipeID", 2 * pf.r, "Pipe"); if (P.wall) put("pipeWall", P.wall, "Pipe");
        if (wallUsed == null) wallUsed = P.wall;
        th = Math.acos(Math.min(1, Math.abs(dot(pf.axis, X))));
        put("theta1", th * DEG, "Pipe");
        const ll = CF.lineLine(O, X, pf.center, pf.axis); xs = ll.s;
        const dir = dot(sub(pf.center, ll.P2), pf.axis) >= 0 ? pf.axis : mul(pf.axis, -1);
        sEnd = Math.max(...[pf.tmin, pf.tmax].map(t => dot(sub(add(pf.center, mul(pf.axis, t)), ll.P2), dir)));
        const cot = Math.cos(th) / Math.sin(th), xWin = (xs + Rt0 * cot) / (1 - ta * cot);
        info.xs = xs; info.xWin = xWin; info.sEnd = sEnd; info.th = th;
        const side = xb[1] > xWin + 1;
        put("junction", side ? "side" : "end", "Pipe + bore");
        if (side) put("xWin", xWin, "Pipe + bore", "where the pipe centreline meets the bore");
        else put("tubeLen", xb[1], "Tube bore", "the pipes start past the end of the tube");
        chk("Pipe centreline vs engine axis", `${ll.dist.toFixed(2)} mm apart`, ll.dist < 1, ll.dist >= 1 ? "The model assumes the pipe centrelines meet the engine axis." : "");
        if (!P.wall) chk("Pipe wall", "only one side of the wall found", false, "Enter the wall, or check that both pipe surfaces are in the export.");
      } else chk("Pipe", `tagged face is a ${pf.type}, not a cylinder`, false);
    }
    // Bend
    let Rtor = null;
    if (has("bend")) {
      const T = inner(cad, tags.bend), tf = T.f;
      if (tf.type === "torus") {
        Rtor = tf.R; info.Rtor = Rtor; info.bendAng = tf.bend;
        if (th != null) chk("Bend angle", `${tf.bend.toFixed(1)}° (pipes leave at ${(th * DEG).toFixed(1)}°)`, Math.abs(tf.bend - th * DEG) < 3, "Read off the tessellated surface, so good to about a degree.");
        if (pf && Math.abs(tf.r - pf.r) > 0.6 && (!T.wall || Math.abs(tf.r - pf.r) > 0.6)) chk("Bend vs pipe", `bend tube Ø${(2 * tf.r).toFixed(1)} vs pipe Ø${(2 * pf.r).toFixed(1)}`, false);
      } else chk("Bend", `tagged face is a ${tf.type}, not a pipe bend`, false);
    }
    // Parallel leg
    let Rtan = null;
    if (has("leg")) {
      const Lg = inner(cad, tags.leg), lf = Lg.f;
      if (lf.type === "cyl") {
        const tilt = Math.acos(Math.min(1, Math.abs(dot(lf.axis, X)))) * DEG, d = sub(lf.center, O), lat = lateral(d, X), yc = len(lat), zOff = dot(d, F.Z);
        info.yc = yc;
        chk("Leg parallel to the engine axis", `within ${tilt.toFixed(2)}°`, tilt < 1);
        if (Math.abs(zOff) > 1) chk("Leg height", `centreline ${zOff.toFixed(1)} mm off the plane of the pipes`, false, "The model assumes both legs lie in one plane through the axis.");
        if (pf && pf.type === "cyl" && Math.abs(lf.r - pf.r) > 0.3) chk("Leg vs pipe", `leg ID ${(2 * lf.r).toFixed(2)} vs pipe ID ${(2 * pf.r).toFixed(2)} mm`, false);
        if (wallUsed == null) wallUsed = Lg.wall;
        const rIn = pf && pf.type === "cyl" ? pf.r : lf.r;
        if (wallUsed != null) put("gap", 2 * (yc - rIn - wallUsed), "Leg", "between the legs' outside walls");
        // Bend radius from where the straights end: each sits R·tan(θ/2) from where the centrelines cross.
        if (th != null && sEnd != null) {
          const tn = Math.tan(th / 2), dT = yc / Math.sin(th), xT = xs + yc / Math.tan(th), xl0 = xRange(lf, O, X)[0];
          const R1 = (dT - sEnd) / tn, R2 = (xl0 - xT) / tn;
          info.R1 = R1; info.R2 = R2;
          if (R1 > 0 && R2 > 0 && Math.abs(R1 - R2) < 0.03 * Math.max(R1, R2)) Rtan = (R1 + R2) / 2;
        }
      } else chk("Leg", `tagged face is a ${lf.type}, not a cylinder`, false);
    }
    // Bend radius: tangent points if they agree with the bend surface (they're exact), otherwise the bend surface.
    let R = null, Rsrc = "";
    if (Rtan && Rtor && Math.abs(Rtan - Rtor) < 0.05 * Rtor) { R = Rtan; Rsrc = "Bend + straights"; }
    else if (Rtor) { R = Rtor; Rsrc = "Bend"; }
    else if (Rtan) { R = Rtan; Rsrc = "Pipe + leg ends"; }
    if (R) {
      info.R = R;
      const rpU = pf && pf.type === "cyl" && wallUsed != null ? pf.r + wallUsed : null;
      if (rpU) put("rd", R / (2 * rpU), Rsrc, `centreline radius ${R.toFixed(1)} mm`);
      if (Rtan && Rtor && Math.abs(Rtan - Rtor) >= 0.05 * Rtor) chk("Bend radius", `bend surface ${Rtor.toFixed(1)} mm, straight ends imply ${Rtan.toFixed(1)} mm`, false, "Using the bend surface.");
    }
    // Neck
    if (has("neck")) {
      const N = inner(cad, tags.neck), nf = N.f;
      if (nf.type === "cone") { put("exitID", 2 * nf.rmin, "Neck"); put("neck", nf.halfAngle, "Neck"); info.neckWall = N.wall; }
      else if (nf.type === "cyl") { put("exitID", 2 * nf.r, "Neck", "a straight exit, no taper"); }
      else chk("Neck", `tagged face is a ${nf.type}, not a cone`, false);
    }
    // Wheel
    if (has("wheel")) {
      const w = CF.fitFace(cad, tags.wheel);
      if (w.type === "plane") {
        put("xw", dot(sub(w.point, O), X), "Wheel face");
        if (Math.abs(dot(w.normal, X)) < 0.999) chk("Wheel face", `tilted ${(Math.acos(Math.min(1, Math.abs(dot(w.normal, X)))) * DEG).toFixed(1)}° from square`, false);
      } else if (isRev(w)) put("xw", xRange(w, O, X)[0], "Wheel face", "front end of the tagged surface");
      else chk("Wheel face", `tagged face is a ${w.type}`, false);
    }
    // End cap (a check: the model places it just behind the windows)
    if (has("cap")) { const cp = CF.fitFace(cad, tags.cap); if (cp.type === "plane") info.capX = dot(sub(cp.point, O), X); }
    // Second pipe: symmetry
    if (has("pipe2") && pf && pf.type === "cyl") {
      const q = inner(cad, tags.pipe2).f;
      if (q.type === "cyl") {
        const th2 = Math.acos(Math.min(1, Math.abs(dot(q.axis, X)))), ll2 = CF.lineLine(O, X, q.center, q.axis), lat2 = unit(lateral(sub(q.center, ll2.P1), X));
        const mir = Math.acos(Math.max(-1, Math.min(1, -dot(lat2, F.Y)))) * DEG, dth = Math.abs(th2 - th) * DEG, dxs = Math.abs(ll2.s - xs), dID = Math.abs(2 * q.r - 2 * pf.r);
        chk("Second pipe matches the first", `angle ${dth.toFixed(1)}°, meets the axis ${dxs.toFixed(1)} mm apart, ID ${dID.toFixed(2)} mm, ${mir.toFixed(1)}° off opposite`,
          dth < 1 && dxs < 1 && dID < 0.3 && mir < 2, "The model assumes the two legs are mirror images.");
      }
    }
    return { vals, checks, info };
  }

  // Overall size of the CAD in the page frame (aft of the flange only, so an engine model in the export doesn't count).
  function envelope(cad, F) {
    let xmax = -Infinity, rmax = 0, ymax = 0, zmax = 0, n = 0;
    for (let i = 0; i < cad.pos.length; i += 3) {
      const q = F.toPage([cad.pos[i], cad.pos[i + 1], cad.pos[i + 2]]);
      if (q[0] < 0.5) continue;
      n++; xmax = Math.max(xmax, q[0]); rmax = Math.max(rmax, Math.hypot(q[1], q[2])); ymax = Math.max(ymax, Math.abs(q[1])); zmax = Math.max(zmax, Math.abs(q[2]));
    }
    return n ? { L: xmax, rmax, W: 2 * ymax, H: 2 * zmax } : null;
  }

  const api = { areas, inner, frameOf, autoDetect, measure, envelope };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.BigBenCAD = api;
})(typeof window !== "undefined" ? window : globalThis);
