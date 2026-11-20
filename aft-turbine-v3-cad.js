"use strict";
/* Aft Turbine V3 "Big Ben" - CAD · page script.
 * Reads a STEP or IGES export in a web worker (the file is never uploaded), lets you tag the Big Ben
 * features on the model, measures them (aft-turbine-v3-cad-measure.js) and runs the V3 cycle model
 * (aft-turbine-v3-model.js) on the measured geometry.
 */
(function () {
  const $ = id => document.getElementById(id);
  const fx = (v, d = 0) => Number.isFinite(v) ? v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }) : "–";
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const LBF = 4.4482, IN = 25.4, DEF = VERSIONS.drawn, DEG = 180 / Math.PI, CF = CADFit, BB = BigBenCAD;
  const READ = { linearUnit: "millimeter", linearDeflectionType: "bounding_box_ratio", linearDeflection: 0.001, angularDeflection: 0.2 };
  const STEEL = [0.72, 0.73, 0.75], INSP = [0.98, 0.78, 0.16];
  const css = c => `rgb(${c.map(v => Math.round(v * 255)).join(",")})`;

  // Features to tag. "want" lists the face shapes that make sense for each.
  const TAGS = [
    { k: "bore", l: "Tube bore", s: "Inside of the tube the wheel slides in. Sets the engine axis.", want: ["cyl", "cone"], c: [0.16, 0.47, 0.84] },
    { k: "flange", l: "Flange face", s: "Flat face that bolts to the nozzle. Sets x = 0 and which way is aft.", want: ["plane"], c: [0.50, 0.36, 0.22] },
    { k: "pipe", l: "Pipe leaving the tube", s: "One straight pipe run at the windows: angle, ID, wall and window position.", want: ["cyl"], c: [0.92, 0.41, 0.20] },
    { k: "bend", l: "Pipe bend", s: "The curved part of the same pipe: bend radius.", want: ["torus"], c: [0.58, 0.38, 0.80] },
    { k: "leg", l: "Parallel leg", s: "Straight run after the bend: gap between the legs.", want: ["cyl"], c: [0.11, 0.66, 0.46] },
    { k: "neck", l: "Neck cone", s: "Taper at the exit: exit ID and cone angle.", want: ["cone", "cyl"], c: [0.86, 0.22, 0.47] },
    { k: "wheel", l: "Wheel leading edge", s: "Front face of the wheel, or a plane at its leading edge.", want: ["plane"], c: [0.20, 0.20, 0.24] },
    { k: "cap", l: "End cap", s: "Flat end of the tube behind the windows. Only checked against the model.", want: ["plane"], c: [0.55, 0.62, 0.18] },
    { k: "pipe2", l: "Other pipe", s: "The second leg's straight run, to check the two legs match.", want: ["cyl"], c: [0.96, 0.66, 0.16] }
  ];
  const TAG = Object.fromEntries(TAGS.map(t => [t.k, t]));
  const FRAME_TAGS = ["bore", "flange", "pipe", "leg"];
  // Model inputs the CAD supplies. min/max are the range the V3 page was set up for.
  const MEAS = [
    { k: "tubeID", l: "Tube ID", u: "mm", dp: 2, min: 58.5, max: 70, step: 0.05 },
    { k: "cone", l: "Cone half-angle", u: "°", dp: 1, min: 2, max: 14, step: 0.5, show: v => v.shroud === "cone" },
    { k: "xw", l: "Wheel leading edge", u: "mm aft of flange", dp: 1, min: 0, max: 80, step: 0.5 },
    { k: "xWin", l: "Window centre", u: "mm aft of flange", dp: 1, min: 20, max: 140, step: 0.5, show: v => v.junction === "side" },
    { k: "tubeLen", l: "Tube length", u: "mm", dp: 1, min: 10, max: 80, step: 0.5, show: v => v.junction !== "side" },
    { k: "theta1", l: "Angle the pipes leave at", u: "° from the axis", dp: 1, min: 15, max: 90, step: 0.5 },
    { k: "rd", l: "Bend radius", u: "× pipe OD", dp: 3, min: 1, max: 3, step: 0.01 },
    { k: "gap", l: "Gap between the legs", u: "mm", dp: 1, min: 30, max: 120, step: 0.5 },
    { k: "pipeID", l: "Pipe ID", u: "mm", dp: 2, min: 30, max: 55, step: 0.05 },
    { k: "pipeWall", l: "Pipe wall", u: "mm", dp: 2, min: 0.5, max: 3, step: 0.05 },
    { k: "exitID", l: "Exit ID after necking", u: "mm", dp: 2, min: 20, max: 55, step: 0.1 },
    { k: "neck", l: "Neck cone half-angle", u: "°", dp: 1, min: 5, max: 45, step: 0.5 }
  ];
  const GROUPS = [
    ["Not in the CAD", "o", [
      { k: "junction", l: "Where the pipes join the tube", type: "seg", opts: [["auto", "From CAD"], ["side", "Side windows"], ["end", "End of tube"], ["boot", "Faired boot"]] },
      { k: "fair", l: "Flared window edges", type: "chk", dim: v => v.junction !== "side" },
      { k: "nose", l: "End cap or bearing support", type: "seg", opts: [["flat", "Flat"], ["round", "Cone splitter / rounded"]] },
      { k: "hub", l: "Hub between engine and wheel", type: "seg", opts: [["none", "Open"], ["struts", "Cone on struts"], ["spinner", "Spinner"]], dim: v => v.gv },
      { k: "nStruts", l: "Number of struts", s: "", min: 2, max: 4, step: 1, dim: v => v.gv || v.hub !== "struts" },
      { k: "gv", l: "Guide vanes ahead of the wheel", type: "chk" },
      { k: "alpha", l: "Vane exit angle α₁", s: "deg of pre-swirl with the rotation", min: 0, max: 40, step: 1, dim: v => !v.gv },
      { k: "nVanes", l: "Number of vanes", s: "odd counts avoid the split's orders", min: 5, max: 21, step: 1, dim: v => !v.gv },
      { k: "R", l: "Load resistance", s: "Ω, constant-resistance mode", min: 0.5, max: 30, step: 0.05 }
    ]],
    ["Generator and targets", "s", [
      { k: "Kv_rpm", l: "Motor Kv", s: "rpm/V as wired", min: 600, max: 2000, step: 1 },
      { k: "etaGen", l: "Generator + rectifier efficiency", s: "", min: 0.6, max: 0.98, step: 0.01 },
      { k: "unloadMax", l: "Disconnect the load at full throttle", type: "chk" },
      { k: "egtT", l: "EGT target for exit sizing", s: "K change at 90% vs stock", min: -50, max: 150, step: 1 }
    ], true],
    ["Wheel and loss assumptions", "s", [
      { k: "beta2", l: "Blade exit angle β₂", s: "deg (effective, after deviation)", min: 35, max: 60, step: 0.1 },
      { k: "beta1m", l: "Blade inlet angle β₁", s: "deg, metal; measure on the spare wheel", min: 0, max: 70, step: 0.5 },
      { k: "zeta", l: "Blade passage loss ζ", s: "× exit relative dynamic head", min: 0, max: 0.4, step: 0.005 },
      { k: "zinc", l: "Incidence loss factor", s: "× normal inflow head (×4 if positive)", min: 0, max: 0.4, step: 0.005 },
      { k: "cdw", l: "Window discharge coefficient", s: "sharp edges; flared ×1.15", min: 0.4, max: 1, step: 0.01 },
      { k: "Kvane", l: "Guide vane loss", s: "× vane-exit dynamic head", min: 0, max: 0.3, step: 0.01 },
      { k: "kd", l: "Uneven-loading loss factor", s: "share of work lost = k·swing²", min: 0, max: 0.6, step: 0.01 },
      { k: "fb", l: "Blade first mode", s: "kHz; ping-test the spare wheel", min: 3, max: 60, step: 0.5 }
    ], true],
    ["Stock engine baseline", "s", [
      { k: "F90", l: "Thrust at 90%", s: "N", min: 50, max: 90, step: 0.1 },
      { k: "T590", l: "Exhaust total temp at 90%", s: "K", min: 800, max: 1100, step: 5 },
      { k: "Fmax", l: "Thrust at full throttle", s: "N", min: 80, max: 120, step: 0.5 },
      { k: "mdMax", l: "Mass flow at full throttle", s: "kg/s incl. fuel", min: 0.18, max: 0.32, step: 0.001 },
      { k: "T5max", l: "Exhaust total temp, full throttle", s: "K", min: 850, max: 1150, step: 5 }
    ], true]
  ];

  // ------------------------------------------------------------------ state
  const OPT0 = { junction: "auto", fair: DEF.fair, nose: DEF.nose, hub: DEF.hub, nStruts: DEF.nStruts, gv: DEF.gv, alpha: DEF.alpha, nVanes: DEF.nVanes, R: DEF.R };
  const fresh = () => ({ opt: { ...OPT0 }, s: { ...SHARED }, over: {}, show: "cad", env: "cad", file: null, tags: {}, auto: {}, flip: false });
  const KEY = "p100-aft-v3-cad";
  let st = fresh();
  try {
    const sv = JSON.parse(localStorage.getItem(KEY) || "{}");
    for (const f in OPT0) if (sv.opt && typeof sv.opt[f] === typeof OPT0[f]) st.opt[f] = sv.opt[f];
    for (const f in SHARED) if (sv.s && typeof sv.s[f] === typeof SHARED[f]) st.s[f] = sv.s[f];
    if (sv.over) for (const m of MEAS) if (Number.isFinite(sv.over[m.k])) st.over[m.k] = sv.over[m.k];
    for (const k of ["show", "env"]) if (typeof sv[k] === "string") st[k] = sv[k];
    if (sv.file && sv.tags) { st.file = sv.file; st.tags = sv.tags; st.auto = sv.auto || {}; st.flip = !!sv.flip; }
  } catch (e) {}
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {} };

  let cad = null, frame = null, meas = null, env = null, active = null, inspected = null, busy = false, fileName = "";
  let cadPartsCache = null;

  // The design the model runs: measured values, then your overrides, then Ben's-layout defaults for anything missing.
  function source(k) {
    if (Number.isFinite(st.over[k])) return { v: st.over[k], how: "manual" };
    const m = meas && meas.vals[k];
    if (m && Number.isFinite(m.v)) return { v: m.v, how: "cad", src: m.src, note: m.note };
    return { v: DEF[k], how: "default" };
  }
  function design() {
    const v = { ...DEF, ...st.opt };
    const mj = meas && meas.vals.junction ? meas.vals.junction.v : "side";
    v.junction = st.opt.junction === "auto" ? mj : st.opt.junction;
    v.shroud = meas && meas.vals.shroud ? meas.vals.shroud.v : DEF.shroud;
    for (const m of MEAS) v[m.k] = source(m.k).v;
    return v;
  }

  // ------------------------------------------------------------------ reading files
  let worker = null;
  function readCad(buf, name) {
    const ext = name.split(".").pop().toLowerCase(), format = ext === "igs" || ext === "iges" ? "iges" : ext === "brep" ? "brep" : "step";
    worker = worker || new Worker("aft-turbine-v3-cad-worker.js");
    return new Promise((res, rej) => {
      worker.onmessage = e => e.data.ok ? res(e.data.r) : rej(new Error(e.data.err));
      worker.onerror = e => { e.preventDefault(); worker.terminate(); worker = null; rej(new Error(e.message || "the reader failed to start")); };
      worker.postMessage({ format, buffer: new Uint8Array(buf), params: READ });
    });
  }
  const status = (html, bad) => { $("status").innerHTML = html; $("status").classList.toggle("bad", !!bad); };
  const tick = () => new Promise(r => setTimeout(r, 0));
  async function loadBuffer(buf, name) {
    if (busy) return; busy = true; document.body.classList.add("busy");
    try {
      status(`Reading <b>${esc(name)}</b> (${fx(buf.byteLength / 1e6, 1)} MB)…`);
      const t0 = performance.now(), r = await readCad(buf, name);
      const c = CF.buildCad(r);
      if (!c.faces.length || !c.tri.length) throw new Error("the file has no surfaces in it (only curves or points?)");
      cad = c; fileName = name; inspected = null; active = null; frame = null; meas = null; env = null; cadPartsCache = null;
      status(`Measuring ${fx(cad.faces.length)} faces…`); await tick();
      let tc = performance.now();
      for (let i = 0; i < cad.faces.length; i++) {
        CF.fitFace(cad, i);
        if (performance.now() - tc > 50) { status(`Measuring faces… ${fx(i)} of ${fx(cad.faces.length)}`); await tick(); tc = performance.now(); }
      }
      const key = { name, faces: cad.faces.length, tris: cad.tri.length / 3 };
      const same = st.file && st.file.name === key.name && st.file.faces === key.faces && st.file.tris === key.tris;
      if (!same || !Object.keys(st.tags).length || !Object.values(st.tags).every(f => f < cad.faces.length)) autoTag(false);
      st.file = key;
      refreshFrame(); update();
      const n = Object.keys(st.tags).length;
      status(`<b>${esc(name)}</b>: ${fx(cad.faces.length)} faces, ${fx(key.tris)} triangles, read in ${fx((performance.now() - t0) / 1000, 1)} s. ` +
        (same ? `Restored your ${n} tagged features.` : n ? `Auto-detect found ${n} of ${TAGS.length} features; check them on the model.` : "Auto-detect found nothing it recognised; tag the features by hand."));
    } catch (e) {
      status(`Couldn't read <b>${esc(name)}</b>: ${esc(e.message)}. Export it from NX as STEP (AP214 or AP242) with solid bodies included.`, true);
    } finally { busy = false; document.body.classList.remove("busy"); }
  }

  // ------------------------------------------------------------------ tagging, frame and measuring
  function autoTag(doUpdate = true) {
    if (!cad) return;
    st.tags = BB.autoDetect(cad); st.auto = Object.fromEntries(Object.keys(st.tags).map(k => [k, true])); st.flip = false;
    if (doUpdate) { refreshFrame(); update(); }
  }
  function assign(k, fid) {
    if (fid == null) { delete st.tags[k]; delete st.auto[k]; }
    else { st.tags[k] = fid; st.auto[k] = false; }
    if (FRAME_TAGS.includes(k)) refreshFrame(); else cadPartsCache = null;
    update();
  }
  function refreshFrame() {
    frame = cad ? BB.frameOf(cad, st.tags, st.flip) : null;
    env = frame ? BB.envelope(cad, frame) : null;
    cadPartsCache = null; if (view) view.refit();
  }
  function update() {
    meas = cad ? BB.measure(cad, st.tags, frame, { wall: Number.isFinite(st.over.pipeWall) ? st.over.pipeWall : undefined }) : null;
    persist(); renderTags(); renderInspector(); syncInputs(); schedule();
  }

  // Short description of what a face is.
  function describe(fid) {
    const f = CF.fitFace(cad, fid), A = BB.areas(cad)[fid], ang = a => frame ? `${fx(Math.acos(Math.min(1, Math.abs(CF.vec.dot(a, frame.X)))) * DEG, 1)}° from the engine axis` : "";
    const wp = () => { const w = CF.wallPair(cad, f); return w ? `, wall ${fx(w.wall, 2)} mm (inside Ø${fx(2 * w.rIn, 2)})` : ""; };
    if (f.type === "plane") return `Flat face, ${fx(A)} mm²${frame ? `, normal ${ang(f.normal)}, at x = ${fx(frame.toPage(f.point)[0], 1)} mm` : ""}`;
    if (f.type === "cyl") return `Cylinder Ø${fx(2 * f.r, 2)} mm, ${fx(f.tmax - f.tmin, 1)} mm long${wp()}${frame ? `, axis ${ang(f.axis)}` : ""}`;
    if (f.type === "cone") return `Cone Ø${fx(2 * f.rmin, 2)} to Ø${fx(2 * f.rmax, 2)} mm, half-angle ${fx(f.halfAngle, 1)}°${wp()}${frame ? `, axis ${ang(f.axis)}` : ""}`;
    if (f.type === "torus") return `Pipe bend: tube Ø${fx(2 * f.r, 2)} mm, centreline radius ${fx(f.R, 1)} mm, ${fx(f.bend)}° of turn${wp()}`;
    return `Not a plane, cylinder, cone or pipe bend (${fx(A)} mm², ${fx(cad.faces[fid].t1 - cad.faces[fid].t0)} triangles)`;
  }
  const shapeName = { plane: "flat face", cyl: "cylinder", cone: "cone", torus: "pipe bend", other: "free-form face" };

  function renderTags() {
    $("tags").innerHTML = TAGS.map(t => {
      const fid = st.tags[t.k], f = cad && fid != null ? CF.fitFace(cad, fid) : null, bad = f && !t.want.includes(f.type);
      const line = !cad ? "" : fid == null ? `<span class="tv none">not tagged</span>`
        : `<span class="tv${bad ? " badt" : ""}">face #${fid} · ${shapeName[f.type]}${bad ? ` (expected ${t.want.map(w => shapeName[w]).join(" or ")})` : ""}${st.auto[t.k] ? " · auto" : ""}</span>`;
      return `<div class="tagrow${active === t.k ? " picking" : ""}" data-k="${t.k}"><i class="sw" style="background:${css(t.c)}"></i>
        <div class="tl"><b>${t.l}</b><small>${t.s}</small>${line}</div>
        <div class="tb"><button type="button" data-act="pick" ${cad ? "" : "disabled"}>${active === t.k ? "Cancel" : "Pick"}</button>${fid != null ? `<button type="button" class="x" data-act="clear" title="Clear ${t.l}" aria-label="Clear ${t.l}">×</button>` : ""}</div></div>`;
    }).join("");
    $("flip").disabled = $("autoTag").disabled = $("clearTags").disabled = !cad;
    $("frameNote").textContent = !cad ? "" : !frame ? "Tag the tube bore to set the engine axis." :
      `Engine axis from the tube bore; aft direction from the ${frame.how === "flange" ? "flange" : frame.how === "pipe" ? "way the pipe leaves" : frame.how === "leg" ? "legs" : "file's axis (a guess)"}${frame.flipped ? ", flipped" : ""}; x = 0 at the ${st.tags.flange != null ? "flange" : "front of the bore"}.`;
  }
  function renderInspector() {
    const el = $("insp");
    if (!cad) { el.innerHTML = ""; return; }
    if (active) { el.innerHTML = `Click the <b>${TAG[active].l.toLowerCase()}</b> on the model. <button type="button" id="cancelPick">Cancel</button>`; $("cancelPick").onclick = () => { active = null; renderTags(); renderInspector(); }; return; }
    if (inspected == null) { el.innerHTML = `<span class="muted">Click any face to see its size and shape, or to tag it.</span>`; return; }
    const cur = TAGS.filter(t => st.tags[t.k] === inspected).map(t => t.l);
    el.innerHTML = `<b>Face #${inspected}</b> · ${esc(describe(inspected))}${cur.length ? ` · tagged as ${cur.join(", ")}` : ""}
      <span class="assign"><select id="asSel" class="dd-select" aria-label="Tag this face as">${TAGS.map(t => `<option value="${t.k}">${t.l}</option>`).join("")}</select><button type="button" id="asBtn">Tag this face</button></span>`;
    const f = CF.fitFace(cad, inspected), guess = TAGS.find(t => t.want[0] === f.type && st.tags[t.k] == null) || TAGS.find(t => t.want.includes(f.type));
    if (guess) $("asSel").value = guess.k;
    $("asBtn").onclick = () => { assign($("asSel").value, inspected); };
  }

  // ------------------------------------------------------------------ 3D view
  let view = null, remap = null;
  function subMesh(fids, P, N) {
    if (!remap || remap.length !== P.length / 3) remap = new Int32Array(P.length / 3).fill(-1);
    let nt = 0; for (const id of fids) nt += cad.faces[id].t1 - cad.faces[id].t0;
    const idx = new Uint32Array(nt * 3), used = []; let k = 0;
    for (const id of fids) { const f = cad.faces[id]; for (let t = f.t0 * 3; t < f.t1 * 3; t++) { const v = cad.tri[t]; if (remap[v] < 0) { remap[v] = used.length; used.push(v); } idx[k++] = remap[v]; } }
    const pos = new Float32Array(used.length * 3), nrm = new Float32Array(used.length * 3);
    used.forEach((v, i) => { for (let q = 0; q < 3; q++) { pos[i * 3 + q] = P[v * 3 + q]; nrm[i * 3 + q] = N[v * 3 + q]; } remap[v] = -1; });
    return { pos, nrm, idx: used.length < 65536 ? Uint16Array.from(idx) : idx, lines: new Float32Array(0) };
  }
  function cadParts() {
    if (cadPartsCache) return cadPartsCache;
    const n = cad.pos.length / 3, P = new Float32Array(n * 3), N = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const p = [cad.pos[i * 3], cad.pos[i * 3 + 1], cad.pos[i * 3 + 2]], d = [cad.nrm[i * 3], cad.nrm[i * 3 + 1], cad.nrm[i * 3 + 2]];
      const q = frame ? frame.toPage(p) : p, m = frame ? frame.dirToPage(d) : d;
      P.set(q, i * 3); N.set(m, i * 3);
    }
    const owner = new Map(); for (const t of TAGS) if (st.tags[t.k] != null) owner.set(st.tags[t.k], t.k);
    const groups = new Map();
    for (const f of cad.faces) { const g = f.id === inspected ? "insp" : owner.get(f.id) || "base"; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(f.id); }
    return (cadPartsCache = [...groups].map(([g, fids]) => ({ g: subMesh(fids, P, N), k: g, c: g === "base" ? STEEL : g === "insp" ? INSP : TAG[g].c, cut: true, ex: [0, 0, 0] })));
  }
  function drawView(v, L) {
    if (!view) return;
    const show = frame ? st.show : "cad";
    let parts = [];
    if (cad && show !== "model") parts = parts.concat(cadParts());
    // Before a file is loaded the viewer shows the model of the preset, so it isn't empty.
    if (!cad || (frame && show !== "cad")) {
      const mp = BigBen3D.build(v, L);
      if (cad && show === "both") for (const p of mp) if (!p.ref) p.a = 0.32;
      parts = parts.concat(mp);
    }
    view.set(parts);
  }
  function onPick(ray) {
    if (!cad || busy || (frame && st.show === "model")) return;
    const o = frame ? frame.toCad(ray.o) : ray.o, d = frame ? frame.dirToCad(ray.d) : ray.d;
    const keep = view.section ? (h => (frame ? frame.toPage(h)[2] : h[2]) <= 0.05) : null;
    const hit = CF.pick(cad, null, o, d, keep);
    if (active) { if (hit) { const k = active; active = null; assign(k, hit.fid); } return; }
    inspected = hit ? hit.fid : null; cadPartsCache = null;
    renderInspector(); schedule();
  }

  // ------------------------------------------------------------------ inputs
  const scopeObj = sc => sc === "o" ? st.opt : st.s;
  function buildInputs() {
    const form = $("inputs"); form.innerHTML = "";
    for (const [name, sc, fields, closed] of GROUPS) {
      const box = document.createElement(closed ? "details" : "fieldset");
      box.insertAdjacentHTML("beforeend", closed ? `<summary>${name}</summary>` : `<legend>${name}</legend>`);
      for (const f of fields) {
        const d = document.createElement("div"); d.dataset.k = f.k;
        if (f.type === "seg") {
          d.className = "fseg";
          d.innerHTML = `<span class="fl">${f.l}</span><div class="seg" role="group" aria-label="${f.l}">${f.opts.map(([val, t]) => `<button type="button" data-val="${val}">${t}</button>`).join("")}</div>`;
          d.querySelector(".seg").addEventListener("click", e => { const b = e.target.closest("button"); if (b) { scopeObj(sc)[f.k] = b.dataset.val; persist(); syncInputs(); schedule(); } });
        } else if (f.type === "chk") {
          d.className = "toggle";
          d.innerHTML = `<input type="checkbox" id="c-${f.k}"><label for="c-${f.k}">${f.l}</label>`;
          d.querySelector("input").addEventListener("change", e => { scopeObj(sc)[f.k] = e.target.checked; persist(); syncInputs(); schedule(); });
        } else {
          d.className = "field";
          d.innerHTML = `<label for="n-${f.k}">${f.l}${f.s ? `<small>${f.s}</small>` : ""}</label><input type="number" id="n-${f.k}" min="${f.min}" max="${f.max}" step="${f.step}"><input type="range" id="r-${f.k}" min="${f.min}" max="${f.max}" step="${f.step}" aria-label="${f.l}">`;
          const set = val => { if (!Number.isFinite(val)) return; scopeObj(sc)[f.k] = Math.min(f.max, Math.max(f.min, val)); persist(); syncInputs(); schedule(); };
          d.querySelector("[type=number]").addEventListener("change", e => set(parseFloat(e.target.value)));
          d.querySelector("[type=range]").addEventListener("input", e => set(parseFloat(e.target.value)));
        }
        box.append(d);
      }
      form.append(box);
    }
  }
  function syncInputs() {
    const v = design();
    for (const [, sc, fields] of GROUPS) for (const f of fields) {
      const o = scopeObj(sc), el = document.querySelector(`#inputs [data-k="${f.k}"]`);
      if (f.type === "seg") el.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", b.dataset.val === o[f.k]));
      else if (f.type === "chk") el.querySelector("input").checked = !!o[f.k];
      else { const dp = (String(f.step).split(".")[1] || "").length; $("n-" + f.k).value = (+o[f.k]).toFixed(dp); $("r-" + f.k).value = o[f.k]; }
      el.classList.toggle("dimmed", !!(f.dim && f.dim(v)));
    }
    document.querySelectorAll("#showSeg button").forEach(b => { b.setAttribute("aria-pressed", (frame ? st.show : "cad") === b.dataset.show); b.disabled = !frame && b.dataset.show !== "cad"; });
    document.querySelectorAll("#envSeg button").forEach(b => { b.setAttribute("aria-pressed", st.env === b.dataset.env); b.disabled = !env && b.dataset.env === "cad"; });
  }

  // ------------------------------------------------------------------ results
  let raf = 0;
  const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); };
  const dot = c => `<span class="dot" style="background:var(--${c})"></span>`;
  const badge = h => h === "cad" ? `<span class="pill have">CAD</span>` : h === "manual" ? `<span class="pill partial">manual</span>` : `<span class="pill need">default</span>`;

  function render() {
    const v = design(), S = solve(v, st.s), { L, r90, rmax, rfree, b } = S;
    const useCad = st.env === "cad" && env, envOut = useCad ? Math.max(0, env.rmax - CASE_R) : L.out, envLall = useCad ? STOCK_LEN + env.L : L.Lall, envW = useCad ? env.W : L.W;
    const l90 = r90.F / LBF, lmx = rmax.F / LBF, din = envOut / IN, lin = envLall / IN;
    const total = score.power(r90.Pel) + score.f90(l90) + score.fmax(lmx) + score.radial(din) + score.length(lin);
    // KPIs
    $("k-P").innerHTML = `${fx(r90.Pel)}<span>W</span>`;
    $("k-Pc").innerHTML = (r90.Pel >= 999.5 ? dot("good") + "Meets 1000 W" : dot("warn") + `${fx(1000 - r90.Pel)} W short`) + ` · ${fx(r90.V)} V, ${fx(r90.I, 1)} A`;
    $("k-F").innerHTML = `${fx(r90.F, 1)}<span>N</span>`;
    $("k-Fc").innerHTML = `${fx(l90, 1)} lbf · ${fx((r90.F / b.p90.F - 1) * 100)}% vs stock · EGT ${r90.dEGT >= 0 ? "+" : ""}${fx(r90.dEGT)} K`;
    $("k-N").innerHTML = `${fx(r90.N / 1000, 1)}<span>k rpm</span>`;
    $("k-Nc").innerHTML = r90.N > N_OVER ? dot("bad") + "Above the 140k limit" : r90.N > N_RATED ? dot("warn") + "Above the 110.5k rating" : dot("good") + "Within the 110.5k rating";
    $("k-R").innerHTML = `${fx(rfree.N / 1000, 1)}<span>k rpm</span>`;
    $("k-Rc").innerHTML = rfree.N > N_OVER ? dot("bad") + "Loss of load would overspeed" : rfree.N > N_RATED ? dot("warn") + "Over rating, under 140k" : dot("good") + "Under the rating with no load";
    $("k-W").innerHTML = `${fx(r90.frac * 100)}<span>% of gas</span>`;
    $("k-Wc").innerHTML = `through the blades · ${fx(r90.shWin * 100)}% window bypass · ±${fx(r90.swT * 100)}% load swing`;
    $("k-G").innerHTML = `${fx(envW)}<span>mm wide</span>`;
    $("k-Gc").innerHTML = `${useCad ? "From the CAD" : "From the model"} · ${fx(envOut, 1)} mm outside the case · ${fx(lin, 1)} in long`;
    $("srcNote").textContent = !cad ? "No CAD loaded yet: every number below uses the Ben's-layout preset from the V3 page." :
      !frame ? "The tube bore isn't tagged, so nothing could be measured yet: the results use the Ben's-layout preset." : "";
    // Warnings
    const w = [];
    const missing = MEAS.filter(m => (!m.show || m.show(v)) && source(m.k).how === "default").map(m => m.l.toLowerCase());
    if (cad && frame && missing.length) w.push(`Not measured, so using the Ben's-layout preset: ${missing.join(", ")}. Tag the matching features or type the values in section 2.`);
    if (meas) for (const c of meas.checks) if (!c.ok) w.push(`${c.l}: ${c.v}.${c.note ? " " + c.note : ""}`);
    if (v.tubeID < WHEEL + 0.5) w.push(`The tube ID (${fx(v.tubeID, 2)} mm) leaves less than 0.25 mm of tip gap around the 58 mm wheel.`);
    if (meas && meas.info.capX != null && L.side && Math.abs(meas.info.capX - L.xte) > 3)
      w.push(`The CAD's end cap is at x = ${fx(meas.info.capX, 1)} mm; the model puts it just behind the windows at ${fx(L.xte, 1)} mm. The cap position only matters for whether the wheel can reach it.`);
    if (L.hitPipes) w.push(`The wheel's trailing edge is ${fx(L.over, 1)} mm past the end of the tube, where the pipes are smaller than the wheel.`);
    if (L.hitCap) w.push("The wheel reaches the end cap.");
    if (L.pastWin) w.push("The blade mid-chord is past the windows, so nearly all the gas bypasses the blades.");
    if (L.side && !L.inWin && !L.pastWin) w.push(`The wheel is ${fx(L.settle, 1)} mm ahead of the windows, so only the tip gap bypasses.`);
    if (L.vaneHit) w.push("The wheel is within 2 mm of the guide vanes.");
    if (rfree.N > N_OVER) w.push(`With no load at full throttle the wheel reaches ${fx(rfree.N / 1000, 1)}k rpm, past the motor's 140k limit.`);
    if (r90.N > N_RATED) w.push("Loaded speed at 90% is above the motor's 110.5k rpm rating.");
    if (r90.Pel > 0.92 * r90.Pceil) w.push(`The wheel is near its power ceiling here (${fx(r90.Pceil)} W ideal).`);
    if (r90.dEGT > 60) w.push(`Estimated 90% EGT rise is +${fx(r90.dEGT)} K. Open the exits or cut duct loss.`);
    if (v.exitID > v.pipeID) w.push("Exit ID is bigger than the pipe; the model uses the pipe ID.");
    if (L.side && meas && meas.info.yc && L.yc > meas.info.yc + 1) w.push(`The legs in the CAD are closer to the axis than the model can bend them from the windows (the first straight has to clear the tube); the model runs them ${fx(2 * (L.yc - L.rp), 1)} mm apart.`);
    $("warn").innerHTML = w.join("<br>");
    // 3D
    drawView(v, L);
    // Measured table
    $("measTable").innerHTML = `<tr><th>Model input</th><th>From the CAD</th><th>Used</th><th></th></tr>` + MEAS.filter(m => !m.show || m.show(v)).map(m => {
      const s = source(m.k), mv = meas && meas.vals[m.k], out = s.v < m.min || s.v > m.max;
      return `<tr><td>${m.l}<small class="u">${m.u}</small></td>
        <td class="mtd">${mv ? `<span class="mono">${fx(mv.v, m.dp)}</span> <small>${esc(mv.src)}${mv.note ? " · " + esc(mv.note) : ""}</small>` : `<small class="muted">${cad ? "not tagged" : "no CAD"}</small>`}</td>
        <td><input type="number" class="ov" data-k="${m.k}" step="${m.step}" value="${(+s.v).toFixed(m.dp)}" aria-label="${m.l} used"${out ? ` title="Outside the ${m.min}–${m.max} range the model was set up for"` : ""}>${out ? ` <span class="pill partial" title="Outside the ${m.min}–${m.max} range the model was set up for">range</span>` : ""}</td>
        <td>${badge(s.how)}${s.how === "manual" ? ` <button type="button" class="x" data-rev="${m.k}" title="Back to the ${mv ? "CAD" : "default"} value" aria-label="Revert ${m.l}">↺</button>` : ""}</td></tr>`;
    }).join("") + `<tr><td>Shroud<small class="u">from the bore shape</small></td><td colspan="3">${v.shroud === "cone" ? "cone" : "straight tube"} · pipes join ${v.junction === "side" ? "through side windows" : v.junction === "boot" ? "in a faired boot" : "at the end of the tube"}${st.opt.junction === "auto" ? "" : " (set by hand)"}</td></tr>`;
    // Checks
    const ck = meas ? meas.checks.slice() : [];
    if (meas && meas.info.capX != null) ck.push({ l: "End cap position", v: `x = ${fx(meas.info.capX, 1)} mm in the CAD, ${fx(L.xte, 1)} mm in the model`, ok: !L.side || Math.abs(meas.info.capX - L.xte) <= 3 });
    if (env) ck.push({ l: "Overall size aft of the flange", v: `${fx(env.L)} mm long, ${fx(env.W)} × ${fx(env.H)} mm across (model: ${fx(L.Lmod)} long, ${fx(L.W)} wide)`, ok: true, note: "Includes whatever is in the export: motor box, brackets, the motor if it's modelled." });
    $("checkTable").innerHTML = ck.length ? `<tr><th>Check</th><th>Result</th><th></th></tr>` + ck.map(c => `<tr><td>${c.l}</td><td>${esc(c.v)}${c.note ? `<small class="cn">${esc(c.note)}</small>` : ""}</td><td class="${c.ok ? "st-ok" : "st-no"}">${c.ok ? "OK" : "Check"}</td></tr>`).join("")
      : `<tr><td class="muted">Load a CAD file and tag the tube bore to see the checks.</td></tr>`;
    // Operating points
    const op = (l, f, u = "") => `<tr><td>${l}</td><td></td><td class="num">${f(r90)}${u}</td><td class="num">${f(rmax)}${u}</td></tr>`;
    $("opTable").innerHTML = `<tr><th>Quantity</th><th></th><th>90% speed, loaded</th><th>Full throttle${st.s.unloadMax ? ", no load" : ", loaded"}</th></tr>` +
      op("Electrical power", r => fx(r.Pel), " W") + op("Wheel speed", r => fx(r.N / 1000, 1), "k rpm") +
      op("DC voltage / current", r => `${fx(r.V)} V / ${fx(r.I, 1)}`, " A") +
      op("Thrust", r => `${fx(r.F, 1)} N / ${fx(r.F / LBF, 1)}`, " lbf") +
      `<tr><td>Stock thrust</td><td></td><td class="num">${fx(b.p90.F, 1)} N</td><td class="num">${fx(b.max.F, 1)} N</td></tr>` +
      op("Estimated EGT change", r => `${r.dEGT >= 0 ? "+" : ""}${fx(r.dEGT)}`, " K") +
      op("Gas through blades / tip gap / window", r => `${fx(r.frac * 100)} / ${fx(r.shGap * 100)} / ${fx(r.shWin * 100)}`, "%") +
      op("Relative inflow incidence on the blades", r => fx(r.inc), "°") +
      op("Blade-row efficiency, even / uneven loading", r => `${fx(r.etaRow, 2)} / ${fx(r.eta, 2)}`) +
      op("Axial velocity at the wheel", r => fx(r.Vx), " m/s") +
      op("Mach behind the wheel / in pipes / at exits", r => `${fx(r.Mj, 2)} / ${fx(r.Ml, 2)} / ${fx(r.Me, 2)}`) +
      op("2/rev blade-load swing", r => `±${fx(r.swT * 100)}`, "%") +
      op("No-load speed at this point", r => fx(r.Nfree / 1000, 1), "k rpm");
    // Loss breakdown
    const ducts = r90.loss.filter(l => !l.work && !l.info), tot = ducts.reduce((a, l) => a + l.dP, 0), mx = Math.max(...ducts.map(l => l.dP));
    $("lossTable").innerHTML = `<tr><th>Element</th><th></th><th>K</th><th>Total-pressure drop</th><th style="width:34%">Share of duct loss</th></tr>` +
      r90.loss.map(l => l.work || l.info ? `<tr class="sel"><td>${l.name}</td><td></td><td class="num">–</td><td class="num">${fx(l.dP / 1000, 2)} kPa</td><td class="fn" style="margin:0">${l.work ? "Work extraction, not counted as duct loss" : "In parallel with the turbine-path rows above: same total drop, not added"}</td></tr>`
        : `<tr><td>${l.name}</td><td></td><td class="num">${l.K == null ? "–" : fx(l.K, 2)}</td><td class="num">${fx(l.dP / 1000, 2)} kPa</td><td><div class="bar"><i style="width:${(l.dP / mx * 100).toFixed(1)}%"></i><span>${fx(l.dP / tot * 100)}%</span></div></td></tr>`).join("") +
      `<tr><td><b>Duct losses</b></td><td></td><td></td><td class="num"><b>${fx(tot / 1000, 2)} kPa</b></td><td></td></tr>`;
    // Wheel-position sweeps
    const P = [], N = [], NF = [], FB = [], FW = [], FG = [], xmax = L.side ? Math.max(20, L.xte - WHEEL_W - 1) : Math.max(L.xte + 12, v.xw + 6, 40);
    for (let x = 0; x <= xmax + 1e-9; x += xmax / 40) { const Sx = solve({ ...v, xw: x }, st.s); P.push([x, Sx.r90.Pel]); N.push([x, Sx.r90.N / 1000]); NF.push([x, Sx.rfree.N / 1000]); FB.push([x, Sx.r90.frac * 100]); FW.push([x, Sx.r90.shWin * 100]); FG.push([x, Sx.r90.shGap * 100]); }
    const vl = L.side ? [{ v: L.xw0 - WHEEL_W / 2, c: "muted", t: "mid-chord at windows" }] : [{ v: L.xte - WHEEL_W, c: "muted", t: "trailing edge at tube end" }];
    chart($("chP"), { x0: 0, x1: xmax, y0: 0, y1: Math.max(1500, Math.ceil(Math.max(...P.map(p => p[1])) / 500) * 500), xl: "Wheel position, mm aft of flange", yl: "W",
      series: [{ c: "s1", pts: P, cur: [v.xw, r90.Pel] }], hl: [{ v: 1000, c: "good", t: "1000 W" }], vl, aria: "Electrical power at 90% against wheel position" });
    chart($("chN"), { x0: 0, x1: xmax, y0: 40, y1: 180, xl: "Wheel position, mm aft of flange", yl: "k rpm",
      series: [{ c: "s2", pts: NF, dash: true, cur: [v.xw, rfree.N / 1000] }, { c: "s1", pts: N, cur: [v.xw, r90.N / 1000] }],
      hl: [{ v: 110.5, c: "warn", t: "110.5k rating" }, { v: 140, c: "bad", t: "140k limit" }], vl, aria: "Wheel speed against wheel position" });
    chart($("chF"), { x0: 0, x1: xmax, y0: 0, y1: 100, xl: "Wheel position, mm aft of flange", yl: "% of gas",
      series: [{ c: "s1", pts: FB, cur: [v.xw, r90.frac * 100] }, { c: "s2", pts: FW, dash: true }, { c: "muted", pts: FG }], vl, aria: "Share of gas through the blades, the window ahead of the wheel and the tip gap, against wheel position" });
    // Score
    const sc = [["Power generation", `${fx(r90.Pel)} W`, score.power(r90.Pel), 100], ["Thrust at 90%", `${fx(l90, 1)} lbf`, score.f90(l90), 20],
      ["Maximum thrust", `${fx(lmx, 1)} lbf`, score.fmax(lmx), 10], ["Radial distance", `${fx(din, 2)} in ${useCad ? "(CAD)" : "(model)"}`, score.radial(din), 15], ["Overall length", `${fx(lin, 1)} in ${useCad ? "(CAD)" : "(model)"}`, score.length(lin), 15]];
    $("scTable").innerHTML = `<tr><th>Item</th><th>Value</th><th>Points</th><th>Of</th></tr>` + sc.map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td><td class="num">${fx(r[2], 1)}</td><td class="num">${r[3]}</td></tr>`).join("") +
      `<tr><td><b>Subtotal</b></td><td></td><td class="num"><b>${fx(total, 1)}</b></td><td class="num">160</td></tr>`;
  }

  function chart(el, o) {
    const W = 520, H = 250, Lm = 48, Rm = 12, T = 12, B = 36, X = v => Lm + (v - o.x0) / (o.x1 - o.x0) * (W - Lm - Rm), Y = v => H - B - (v - o.y0) / (o.y1 - o.y0) * (H - T - B);
    let s = "";
    for (let i = 0; i <= 4; i++) { const yv = o.y0 + (o.y1 - o.y0) * i / 4; s += `<line x1="${Lm}" x2="${W - Rm}" y1="${Y(yv)}" y2="${Y(yv)}" stroke="var(--grid)"/><text x="${Lm - 6}" y="${Y(yv) + 4}" font-size="11" text-anchor="end" fill="var(--muted)">${fx(yv)}</text>`; }
    const step = o.x1 - o.x0 > 60 ? 20 : 10;
    for (let xv = o.x0; xv <= o.x1 + 1e-9; xv += step) s += `<text x="${X(xv)}" y="${H - B + 16}" font-size="11" text-anchor="middle" fill="var(--muted)">${fx(xv)}</text>`;
    for (const l of o.hl || []) if (l.v < o.y1) s += `<line x1="${Lm}" x2="${W - Rm}" y1="${Y(l.v)}" y2="${Y(l.v)}" stroke="var(--${l.c})" stroke-dasharray="3 3"/><text x="${W - Rm - 2}" y="${Y(l.v) - 4}" font-size="11" text-anchor="end" fill="var(--${l.c})">${l.t}</text>`;
    for (const l of o.vl || []) if (l.v > o.x0 && l.v < o.x1) s += `<line x1="${X(l.v)}" x2="${X(l.v)}" y1="${T}" y2="${H - B}" stroke="var(--${l.c})" stroke-dasharray="3 3"/><text x="${X(l.v) + 4}" y="${T + 10}" font-size="11" fill="var(--${l.c})">${l.t}</text>`;
    for (const se of o.series) {
      s += `<polyline fill="none" stroke="var(--${se.c})" stroke-width="2" ${se.dash ? 'stroke-dasharray="6 4"' : ""} points="${se.pts.map(p => X(p[0]) + "," + Y(Math.max(o.y0, Math.min(o.y1, p[1])))).join(" ")}"/>`;
      if (se.cur) s += `<circle cx="${X(Math.max(o.x0, Math.min(o.x1, se.cur[0])))}" cy="${Y(Math.max(o.y0, Math.min(o.y1, se.cur[1])))}" r="5" fill="var(--surface)" stroke="var(--pt)" stroke-width="2"/>`;
    }
    s += `<text x="${(Lm + W - Rm) / 2}" y="${H - 4}" font-size="12" text-anchor="middle" fill="var(--text-2)">${o.xl}</text><text x="4" y="-6" font-size="12" fill="var(--text-2)">${o.yl}</text>`;
    el.innerHTML = `<svg viewBox="0 -20 ${W} ${H + 20}" width="100%" role="img" aria-label="${o.aria}">${s}</svg>`;
  }

  // ------------------------------------------------------------------ wiring
  $("file").addEventListener("change", async e => { const f = e.target.files[0]; if (!f) return; const buf = await f.arrayBuffer(); e.target.value = ""; loadBuffer(buf, f.name); });
  $("example").addEventListener("click", async () => {
    try { const r = await fetch("examples/big-ben-example.step"); if (!r.ok) throw new Error(r.status); loadBuffer(await r.arrayBuffer(), "big-ben-example.step"); }
    catch (e) { status(`Couldn't fetch the example model (${esc(e.message)}).`, true); }
  });
  // Drag and drop onto the viewer.
  const drop = $("view-cad");
  drop.addEventListener("dragover", e => { e.preventDefault(); drop.classList.add("drag"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("drag"));
  drop.addEventListener("drop", async e => { e.preventDefault(); drop.classList.remove("drag"); const f = e.dataTransfer.files[0]; if (f) loadBuffer(await f.arrayBuffer(), f.name); });
  $("tags").addEventListener("click", e => {
    const b = e.target.closest("button"), row = e.target.closest(".tagrow"); if (!b || !row) return;
    const k = row.dataset.k;
    if (b.dataset.act === "clear") { if (active === k) active = null; assign(k, null); }
    else if (b.dataset.act === "pick") { active = active === k ? null : k; if (active && st.show === "model") { st.show = "cad"; syncInputs(); schedule(); } renderTags(); renderInspector(); }
  });
  $("autoTag").addEventListener("click", () => { active = null; autoTag(); });
  $("flip").addEventListener("click", () => { st.flip = !st.flip; refreshFrame(); update(); });
  $("clearTags").addEventListener("click", () => { st.tags = {}; st.auto = {}; active = null; refreshFrame(); update(); });
  $("showSeg").addEventListener("click", e => { const b = e.target.closest("button"); if (b && !b.disabled) { st.show = b.dataset.show; if (st.show === "model") active = null; view.refit(); persist(); syncInputs(); renderTags(); renderInspector(); schedule(); } });
  $("envSeg").addEventListener("click", e => { const b = e.target.closest("button"); if (b && !b.disabled) { st.env = b.dataset.env; persist(); syncInputs(); schedule(); } });
  $("measTable").addEventListener("change", e => {
    const i = e.target.closest("input.ov"); if (!i) return;
    const val = parseFloat(i.value), k = i.dataset.k; if (!Number.isFinite(val)) return;
    st.over[k] = val; if (k === "pipeWall") update(); else { persist(); syncInputs(); schedule(); }
  });
  $("measTable").addEventListener("click", e => { const b = e.target.closest("[data-rev]"); if (!b) return; const k = b.dataset.rev; delete st.over[k]; if (k === "pipeWall") update(); else { persist(); schedule(); } });
  $("auto").addEventListener("click", () => { const a = loadFor(design(), st.s, 1000); st.opt.R = Math.min(30, Math.max(0.5, Math.round(a.R * 20) / 20)); persist(); syncInputs(); render(); if (!a.ok) $("warn").insertAdjacentHTML("afterbegin", `This geometry peaks near ${fx(a.P)} W; the load is set to that peak.<br>`); });
  $("sizeExit").addEventListener("click", () => { const a = exitFor(design(), st.s, st.s.egtT); st.over.exitID = Math.round(a.exitID * 10) / 10; persist(); render(); if (!a.ok) $("warn").insertAdjacentHTML("afterbegin", `Even full-size exits can't get the EGT change down to ${fx(st.s.egtT)} K; cut duct loss first.<br>`); });
  $("resetOv").addEventListener("click", () => { st.over = {}; update(); });
  $("resetAll").addEventListener("click", () => { const keep = { file: st.file, tags: st.tags, auto: st.auto, flip: st.flip }; st = { ...fresh(), ...keep }; refreshFrame(); update(); });

  buildInputs();
  view = new V3D.View($("view-cad"), "3D view of the loaded CAD model, or the Big Ben model before one is loaded");
  view.fitMinX = -Infinity; view.clampX = -Infinity; view.onPick = onPick;
  const hint = $("view-cad").querySelector(".bo-hint"); if (hint) hint.textContent = "Drag to rotate · click a face to measure or tag it · Ctrl + scroll to zoom · drop a STEP file here";
  $("tagSw").innerHTML = TAGS.map(t => `<span><i style="background:${css(t.c)}"></i>${t.l}</span>`).join("") + `<span><i style="background:${css(INSP)}"></i>Clicked face</span><span><i style="background:${css(STEEL)}"></i>Untagged</span>`;
  update();
  status(`No file loaded. Open a STEP or IGES export, drop one on the viewer, or load the example (Ben's layout built as surfaces).`);
  // Expose a little for testing from the console.
  window.BigBenCADPage = { get cad() { return cad; }, get frame() { return frame; }, get meas() { return meas; }, get state() { return st; }, design, loadBuffer, assign, view: () => view };
})();
