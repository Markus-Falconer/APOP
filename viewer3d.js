"use strict";
/* Shared 3D viewer for the analysis pages.
 * Mesh builders (grid, revolve, sweep, loft, plates) and a small dependency-free
 * WebGL View with orbit, preset views, cutaway, exploded view, and per-part
 * clipping by planes and finite cylinders. Exposed as window.V3D.
 * Units are mm; x runs aft from the nozzle flange, y is lateral, z is up.
 *
 * A part is { g: mesh, c: [r,g,b], cut: bool (removed above z = 0 in cutaway),
 *   env: bool (counts toward envelope), ex: [dx,dy,dz] (exploded offset),
 *   pl: [[nx,ny,nz,d], ...] keep where n.p + d >= 0 (up to 2),
 *   cy: [{ p, d, r, t0, t1 }, ...] discard inside a cylinder along unit axis d
 *       through p, between t0 and t1 along the axis (up to 2),
 *   ref: bool (reference lines only) }.
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
    engine: [0.66, 0.65, 0.62], ref: [0.55, 0.55, 0.55], box: [0.36, 0.66, 0.66], strut: [0.58, 0.40, 0.70]
  };
  const css = c => `rgb(${c.map(v => Math.round(v * 255)).join(",")})`;

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

  // ---------------------------------------------------------------- envelope
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
uniform vec4 uC0P; uniform vec4 uC0D; uniform vec2 uC0T; uniform vec4 uC1P; uniform vec4 uC1D; uniform vec2 uC1T;
bool cyl(vec4 P, vec4 D, vec2 T){ if (D.w < 0.5) return false; vec3 q = vM - P.xyz; float t = dot(q, D.xyz); if (t < T.x || t > T.y) return false; vec3 r = q - t * D.xyz; return dot(r, r) < P.w * P.w; }
void main(){
  if (cyl(uC0P, uC0D, uC0T) || cyl(uC1P, uC1D, uC1T)) discard;
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
    this.u = {}; for (const n of ["uVP", "uOff", "uCol", "uFlat", "uA", "uSec", "uPl0", "uPl1", "uEye", "uKey", "uC0P", "uC0D", "uC0T", "uC1P", "uC1D", "uC1T"]) this.u[n] = gl.getUniformLocation(pr, n);
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
      const cy = p.cy || [];
      [0, 1].forEach(k => { const c = cy[k]; gl.uniform4fv(u["uC" + k + "P"], c ? [...c.p, c.r] : [0, 0, 0, 0]); gl.uniform4fv(u["uC" + k + "D"], c ? [...c.d, 1] : [1, 0, 0, 0]); gl.uniform2fv(u["uC" + k + "T"], c ? [c.t0 ?? -1e5, c.t1 ?? 1e5] : [0, 0]); });
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

  window.V3D = { COL, css, grid, merge, ringPts, revolve, starRing, plate, loft, rhoOf, path, sweep, blades, dashes, empty, envelope, View, D2R };
})();
