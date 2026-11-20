"use strict";
/* Builds examples/big-ben-example.step: a surface model of the "Ben's layout" preset from
 * aft-turbine-v3-model.js, for trying the Big Ben CAD page without a real NX export.
 * Run with: node tools/make-example-step.js
 * For testing the page on other shapes and orientations: node tools/make-example-step.js <preset> <out.step> [rot]
 * (preset is a VERSIONS key; rot tilts the whole model to an arbitrary orientation).
 * The model is placed with the engine axis along CAD +Z and the pipes along ±X, offset from the
 * origin, so the page has to find the axis and the flange itself.
 */
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
eval(fs.readFileSync(path.join(ROOT, "aft-turbine-v3-model.js"), "utf8") + "; global.__m = { layout, VERSIONS };");
const { layout, VERSIONS } = global.__m;

const [, , PRESET = "drawn", OUT = path.join(ROOT, "examples", "big-ben-example.step"), ROT] = process.argv;
const v = { ...VERSIONS[PRESET], junction: "side", shroud: "lip" }, L = layout(v);
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s], len = a => Math.hypot(...a), unit = a => mul(a, 1 / len(a));
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
// Page frame (x aft, y toward the +y pipe, z up) → CAD frame.
// With "rot", an arbitrary tilt (37° about a skew axis) and the engine axis running toward CAD −Z.
const RM = (() => { const k = unit([1, 2, 3]), a = 37 * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), K = [[0, -k[2], k[1]], [k[2], 0, -k[0]], [-k[1], k[0], 0]];
  return [0, 1, 2].map(i => [0, 1, 2].map(j => (i === j ? c : 0) + s * K[i][j] + (1 - c) * k[i] * k[j])); })();
const base = d => ROT ? [d[1], -d[2], -d[0]] : [d[1], d[2], d[0]], rot = d => ROT ? RM.map(r => r[0] * d[0] + r[1] * d[1] + r[2] * d[2]) : d;
const O = [12, -7, 40], dirCad = d => rot(base(d)), toCad = p => add(O, dirCad(p));
const f = x => { const s = (+x).toFixed(6); return s.includes(".") ? s : s + "."; };

let id = 100; const lines = [], faces = [];
const E = s => { lines.push(`#${++id}=${s};`); return "#" + id; };
const pt = p => E(`CARTESIAN_POINT('',(${f(p[0])},${f(p[1])},${f(p[2])}))`);
const dir = d => { d = unit(d); return E(`DIRECTION('',(${f(d[0])},${f(d[1])},${f(d[2])}))`); };
const a2p = (p, z, x) => E(`AXIS2_PLACEMENT_3D('',${pt(p)},${dir(z)},${dir(x)})`);
const vtx = p => E(`VERTEX_POINT('',${pt(p)})`);
const oe = (e, s) => E(`ORIENTED_EDGE('',*,*,${e},${s ? ".T." : ".F."})`);
const loop = es => E(`EDGE_LOOP('',(${es.join(",")}))`);
const circleEdge = (c, z, x, r) => { const v0 = vtx(add(c, mul(x, r))); return { v: v0, e: E(`EDGE_CURVE('',${v0},${v0},${E(`CIRCLE('',${a2p(c, z, x)},${f(r)})`)},.T.)`) }; };
const lineEdge = (v1, p1, v2, p2) => { const d = sub(p2, p1); return E(`EDGE_CURVE('',${v1},${v2},${E(`LINE('',${pt(p1)},${E(`VECTOR('',${dir(d)},${f(len(d))})`)})`)},.T.)`); };
const face = (bounds, surf) => faces.push(E(`ADVANCED_FACE('',(${bounds.join(",")}),${surf},.T.)`));
const outer = lp => E(`FACE_OUTER_BOUND('',${lp},.T.)`);
// Cylinder or cone between two coaxial circles (page frame in, CAD frame out).
function rev(c0p, dp, r0, r1, Lg) {
  const c0 = toCad(c0p), d = unit(dirCad(dp)), x = unit(cross(d, Math.abs(d[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0])), c1 = add(c0, mul(d, Lg));
  const b = circleEdge(c0, d, x, r0), t = circleEdge(c1, d, x, r1), seam = lineEdge(b.v, add(c0, mul(x, r0)), t.v, add(c1, mul(x, r1)));
  const lp = loop([oe(b.e, true), oe(seam, true), oe(t.e, false), oe(seam, false)]), ang = Math.atan((r1 - r0) / Lg);
  const surf = Math.abs(r1 - r0) < 1e-9 ? E(`CYLINDRICAL_SURFACE('',${a2p(c0, d, x)},${f(r0)})`)
    : ang > 0 ? E(`CONICAL_SURFACE('',${a2p(c0, d, x)},${f(r0)},${f(ang)})`) : E(`CONICAL_SURFACE('',${a2p(c1, mul(d, -1), x)},${f(r1)},${f(-ang)})`);
  face([outer(lp)], surf);
}
function annulus(cp, np, rin, rout) {
  const c = toCad(cp), n = unit(dirCad(np)), x = unit(cross(n, Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0])), o = circleEdge(c, n, x, rout), b = [outer(loop([oe(o.e, true)]))];
  if (rin > 0) { const i = circleEdge(c, n, x, rin); b.push(E(`FACE_BOUND('',${loop([oe(i.e, false)])},.T.)`)); }
  face(b, E(`PLANE('',${a2p(c, n, x)})`));
}
function rect(ps) {
  const P = ps.map(toCad), V = P.map(vtx), es = P.map((p, i) => lineEdge(V[i], p, V[(i + 1) % 4], P[(i + 1) % 4]));
  face([outer(loop(es.map(e => oe(e, true))))], E(`PLANE('',${a2p(P[0], unit(cross(sub(P[1], P[0]), sub(P[3], P[0]))), unit(sub(P[1], P[0])))})`));
}
// Torus segment: a bend of radius R (centreline) and pipe radius r, centre Cp, in the plane with normal np,
// starting at radial direction e0p and sweeping by phi toward e1p.
function torus(Cp, np, e0p, phi, R, r) {
  const C = toCad(Cp), n = unit(dirCad(np)), e0 = unit(dirCad(e0p)), e90 = cross(n, e0);
  const e1 = add(mul(e0, Math.cos(phi)), mul(e90, Math.sin(phi)));
  const sec = e => { const cc = add(C, mul(e, R)), tng = unit(cross(n, e)); return circleEdge(cc, tng, e, r); };
  const s0 = sec(e0), s1 = sec(e1);
  const arc = E(`EDGE_CURVE('',${s0.v},${s1.v},${E(`CIRCLE('',${a2p(add(C, mul(n, 0)), n, e0)},${f(R + r)})`)},.T.)`);
  const lp = loop([oe(s0.e, true), oe(arc, true), oe(s1.e, false), oe(arc, false)]);
  face([outer(lp)], E(`TOROIDAL_SURFACE('',${a2p(C, n, e0)},${f(R)},${f(r)})`));
}

const wallT = 1.5, ri = L.ri, rp = L.rp, th = L.th;
// Inlet tube (bore and outside), flange, end cap.
rev([0, 0, 0], [1, 0, 0], L.Rt0, L.Rt0, L.xte); rev([0, 0, 0], [1, 0, 0], L.Rt0 + wallT, L.Rt0 + wallT, L.xte);
annulus([0, 0, 0], [-1, 0, 0], L.Rt0 + wallT, L.Rt0 + 14);
annulus([L.xte, 0, 0], [-1, 0, 0], 11.6, L.Rt0 + wallT);
// Turbine wheel: front face and hub.
annulus([v.xw, 0, 0], [-1, 0, 0], 18.75, 29); rev([v.xw, 0, 0], [1, 0, 0], 18.75, 18.75, 6.8);
// Pipes (both sides): straight from the tube wall, bend back to parallel, straight, neck to the exit.
for (const s of [1, -1]) {
  const d = [Math.cos(th), s * Math.sin(th), 0], p0 = [L.xs, 0, 0], t0 = L.Rw / Math.sin(th) - 6, t1 = L.Ls;
  for (const r of [ri, rp]) rev(add(p0, mul(d, t0)), d, r, r, t1 - t0);
  const pb = add(p0, mul(d, t1)), nrm = [0, 0, s > 0 ? -1 : 1], toC = [Math.sin(th), -s * Math.cos(th), 0], C = add(pb, mul(toC, L.R));
  for (const r of [ri, rp]) torus(C, nrm, mul(toC, -1), th, L.R, r);
  for (const [r0, r1] of [[ri, ri], [rp, rp]]) rev([L.xPar, s * L.yc, 0], [1, 0, 0], r0, r1, L.xn0 - L.xPar);
  rev([L.xn0, s * L.yc, 0], [1, 0, 0], ri, L.re, L.Lneck); rev([L.xn0, s * L.yc, 0], [1, 0, 0], rp, L.re + v.pipeWall, L.Lneck);
}
// Motor box.
const x0 = L.xBox, x1 = L.xBoxEnd, hw = L.bw, hh = L.bh / 2;
rect([[x0, hw, -hh], [x1, hw, -hh], [x1, hw, hh], [x0, hw, hh]]); rect([[x0, -hw, hh], [x1, -hw, hh], [x1, -hw, -hh], [x0, -hw, -hh]]);
rect([[x0, -hw, hh], [x0, hw, hh], [x1, hw, hh], [x1, -hw, hh]]); rect([[x0, hw, -hh], [x0, -hw, -hh], [x1, -hw, -hh], [x1, hw, -hh]]);

const shell = E(`OPEN_SHELL('',(${faces.join(",")}))`), sbsm = E(`SHELL_BASED_SURFACE_MODEL('',(${shell}))`);
const head = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('Big Ben aft turbine example, generated from the Ben layout preset'),'2;1');
FILE_NAME('big-ben-example.step','2026-11-20T00:00:00',('APOP'),(''),'make-example-step.js','','');
FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));
ENDSEC;
DATA;
#1=APPLICATION_CONTEXT('automotive design');
#2=APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,#1);
#3=PRODUCT_CONTEXT('',#1,'mechanical');
#4=PRODUCT('big_ben','Big Ben example','',(#3));
#5=PRODUCT_DEFINITION_FORMATION('','',#4);
#6=PRODUCT_DEFINITION_CONTEXT('part definition',#1,'design');
#7=PRODUCT_DEFINITION('design','',#5,#6);
#8=PRODUCT_DEFINITION_SHAPE('','',#7);
#9=SHAPE_DEFINITION_REPRESENTATION(#8,#20);
#10=( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.) );
#11=( NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.) );
#12=( NAMED_UNIT(*) SI_UNIT($,.STERADIAN.) SOLID_ANGLE_UNIT() );
#13=UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-07),#10,'distance_accuracy_value','');
#14=( GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#13)) GLOBAL_UNIT_ASSIGNED_CONTEXT((#10,#11,#12)) REPRESENTATION_CONTEXT('','') );
#15=PRODUCT_RELATED_PRODUCT_CATEGORY('part','',(#4));
#16=CARTESIAN_POINT('',(0.,0.,0.));
#17=DIRECTION('',(0.,0.,1.));
#18=DIRECTION('',(1.,0.,0.));
#19=AXIS2_PLACEMENT_3D('',#16,#17,#18);
#20=MANIFOLD_SURFACE_SHAPE_REPRESENTATION('',(#19,${sbsm}),#14);
`;
fs.mkdirSync(path.join(ROOT, "examples"), { recursive: true });
fs.writeFileSync(OUT, head + lines.join("\n") + "\nENDSEC;\nEND-ISO-10303-21;\n");
// Known values, for checking the page's measurements.
console.log(JSON.stringify({ faces: faces.length, tubeID: v.tubeID, pipeID: v.pipeID, pipeWall: v.pipeWall, theta1: v.theta1, xWin: v.xWin, gap: 2 * (L.yc - L.rp), yc: L.yc,
  rd: v.rd, R: L.R, exitID: 2 * L.re, neck: v.neck, xw: v.xw, cap: L.xte, Ls: L.Ls }, null, 0));
