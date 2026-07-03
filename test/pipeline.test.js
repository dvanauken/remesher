import assert from 'node:assert/strict';
import { Shapes } from '../src/model/Shapes.js';
import { DomainMesh } from '../src/model/DomainMesh.js';
import { CrossField } from '../src/model/CrossField.js';
import { Parameterization } from '../src/model/Parameterization.js';
import { IsoContours } from '../src/model/IsoContours.js';
import { GuideCurve } from '../src/model/GuideCurve.js';

const wrap4 = x => Math.atan2(Math.sin(4 * x), Math.cos(4 * x)) / 4; // distance in the 4-RoSy quotient

let t0 = performance.now();
const mesh = new DomainMesh(Shapes.disc(0, 0, 150), 10);
console.log(`mesh: ${mesh.verts.length} verts, ${mesh.tris.length} tris in ${(performance.now() - t0).toFixed(0)} ms`);

// --- mesh sanity ---------------------------------------------------------
assert.ok(mesh.tris.length > 400, 'enough triangles');
let areaSum = 0;
for (let i = 0; i < mesh.tris.length; i++) {
    assert.ok(mesh.areas[i] > 0, `tri ${i} CCW / non-degenerate`);
    areaSum += mesh.areas[i];
}
const discArea = Math.PI * 150 * 150;
assert.ok(Math.abs(areaSum - discArea) / discArea < 0.03, `area covered (${(areaSum / discArea * 100).toFixed(1)}%)`);
assert.ok(mesh.boundaryEdges.length > 50, 'boundary edges found');
console.log('mesh sanity ok');

// --- gradient operator: reproduce a linear function exactly --------------
const param = new Parameterization(mesh);
const lin = new Float64Array(mesh.verts.length);
for (let i = 0; i < mesh.verts.length; i++) lin[i] = 3 * mesh.verts[i][0] + 5 * mesh.verts[i][1];
for (let ti = 0; ti < mesh.tris.length; ti++) {
    const t = mesh.tris[ti], g = param.grads[ti];
    let gx = 0, gy = 0;
    for (let e = 0; e < 3; e++) {
        gx += lin[t[e]] * g[e][0];
        gy += lin[t[e]] * g[e][1];
    }
    assert.ok(Math.abs(gx - 3) < 1e-8 && Math.abs(gy - 5) < 1e-8, `hat gradients exact (tri ${ti}: ${gx}, ${gy})`);
}
console.log('gradient operator ok');

// --- Poisson solve with a constant target field --------------------------
t0 = performance.now();
const flat = param.solve(new Float64Array(mesh.tris.length), 10); // alpha = 0 -> u ~ x/10, v ~ y/10
console.log(`poisson (constant field): ${(performance.now() - t0).toFixed(0)} ms`);
let worst = 0;
for (let ti = 0; ti < mesh.tris.length; ti++) {
    const t = mesh.tris[ti], g = param.grads[ti];
    let gx = 0, gy = 0;
    for (let e = 0; e < 3; e++) {
        gx += flat.u[t[e]] * g[e][0];
        gy += flat.u[t[e]] * g[e][1];
    }
    worst = Math.max(worst, Math.abs(gx - 0.1), Math.abs(gy));
}
assert.ok(worst < 1e-3, `constant field integrated exactly (worst grad err ${worst.toExponential(2)})`);
console.log('poisson solve ok');

// --- cross field: boundary alignment --------------------------------------
const field = new CrossField(mesh);
t0 = performance.now();
const theta0 = field.solve([], 50);
console.log(`field solve: ${(performance.now() - t0).toFixed(0)} ms`);
let misaligned = 0;
for (const be of mesh.boundaryEdges) {
    if (Math.abs(wrap4(theta0[be.tri] - be.angle)) > 0.15) misaligned++;
}
assert.ok(misaligned / mesh.boundaryEdges.length < 0.05, `boundary aligned (${misaligned}/${mesh.boundaryEdges.length} off)`);
console.log('boundary alignment ok');

// --- combing + singularities ----------------------------------------------
const alpha0 = field.comb(theta0);
for (let t = 0; t < theta0.length; t++) {
    const k = Math.round((alpha0[t] - theta0[t]) / (Math.PI / 2));
    assert.ok(Math.abs(alpha0[t] - theta0[t] - k * Math.PI / 2) < 1e-9, 'comb stays in the 4-RoSy class');
}
const sings = field.singularities(theta0);
const indexSum = sings.reduce((s, x) => s + x.index, 0);
console.log(`singularities: ${sings.length}, index sum ${indexSum}`);
assert.ok(Math.abs(indexSum) === 4, 'Poincare-Hopf: net quarter-turn index of a boundary-aligned disc field is +/-4');

// --- guide influence -------------------------------------------------------
const guide = new GuideCurve([[-120, -20], [120, 100]]); // 26.6 degree slope
const thetaG = field.solve([guide], 50);
const guideAngle = Math.atan2(120, 240);
let nearTri = -1, nearD = Infinity;
for (let t = 0; t < mesh.tris.length; t++) {
    const d = guide.distanceTo(mesh.centroids[t][0], mesh.centroids[t][1]);
    if (d < nearD) {
        nearD = d;
        nearTri = t;
    }
}
const errG = Math.abs(wrap4(thetaG[nearTri] - guideAngle));
const errNoGuide = Math.abs(wrap4(theta0[nearTri] - guideAngle));
console.log(`at guide: field-to-guide error ${errG.toFixed(3)} rad (without guide: ${errNoGuide.toFixed(3)})`);
assert.ok(errG < 0.1, 'field follows the guide tangent');

// --- full pipeline ----------------------------------------------------------
t0 = performance.now();
const alphaG = field.comb(thetaG);
const { u, v } = param.solve(alphaG, 18);
const isoU = IsoContours.extract(mesh, u);
const isoV = IsoContours.extract(mesh, v);
console.log(`full param + contours: ${(performance.now() - t0).toFixed(0)} ms, ${isoU.length} u-segs, ${isoV.length} v-segs`);
assert.ok(isoU.length > 100 && isoV.length > 100, 'contours produced');
for (const s of [...isoU, ...isoV]) {
    assert.ok(s.every(Number.isFinite), 'finite contour coordinates');
}

// --- L-plate (sharp corners) doesn't blow up --------------------------------
const plate = new DomainMesh(Shapes.plate(0, 0, 150), 10);
const fieldP = new CrossField(plate);
const thetaP = fieldP.solve([], 50);
const paramP = new Parameterization(plate);
const solP = paramP.solve(fieldP.comb(thetaP), 18);
const isoP = IsoContours.extract(plate, solP.u);
assert.ok(isoP.length > 50 && isoP.every(s => s.every(Number.isFinite)), 'L-plate pipeline ok');
console.log('L-plate ok');

console.log('\nALL TESTS PASSED');
