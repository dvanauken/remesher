import assert from 'node:assert/strict';
import { Shapes } from '../src/model/Shapes.js';
import { DomainMesh } from '../src/model/DomainMesh.js';
import { CrossField } from '../src/model/CrossField.js';
import { Parameterization } from '../src/model/Parameterization.js';
import { IsoContours } from '../src/model/IsoContours.js';
import { QuadMesh } from '../src/model/QuadMesh.js';
import { GuideCurve } from '../src/model/GuideCurve.js';
import { FieldTopology } from '../src/model/FieldTopology.js';
import { FieldDiagnostics } from '../src/model/FieldDiagnostics.js';
import { SeamlessParameterization } from '../src/model/SeamlessParameterization.js';

const wrap4 = x => Math.atan2(Math.sin(4 * x), Math.cos(4 * x)) / 4; // distance in the 4-RoSy quotient
const skippedTotal = q => q.stats.missingCorners + q.stats.missingCenter + q.stats.foldedCells
    + q.stats.degenerateCells + q.stats.ambiguousCells + q.stats.inconsistentCells;
const assertSkipAccounting = q => {
    assert.equal(q.stats.candidateCells, q.stats.emittedCells + skippedTotal(q) + q.stats.duplicateCells,
        'quad extraction candidate accounting');
    assert.equal(q.stats.skippedCells.length, skippedTotal(q), 'skipped cell records match skipped counts');
    for (const cell of q.stats.skippedCells) {
        assert.ok(['missingCorners', 'missingCenter', 'folded', 'degenerate', 'ambiguous', 'inconsistent'].includes(cell.reason), `known skip reason ${cell.reason}`);
        assert.equal(cell.uv.length, 2, 'skipped cell has integer uv origin');
        assert.ok(cell.points.length <= 4, 'skipped cell has at most four world points');
        for (const p of cell.points) assert.ok(p.every(Number.isFinite), 'finite skipped-cell point');
    }
};
const assertValenceDetails = q => {
    const histTotal = Object.values(q.validation.valence).reduce((s, n) => s + n, 0);
    assert.equal(histTotal, q.verts.length, 'valence histogram covers all quad vertices');
    assert.equal(q.validation.vertices.length, q.verts.length, 'per-vertex valence records emitted');
    for (const v of q.validation.irregularVertices) {
        assert.notEqual(v.valence, 4, 'irregular valence record is not valence 4');
        assert.ok(Number.isFinite(v.x) && Number.isFinite(v.y), 'finite irregular vertex position');
    }
};
const assertTopologyInvariants = (mesh, field, theta, alpha, label) => {
    const topo = new FieldTopology(mesh, theta, alpha);
    // singularities from matching cycles must equal singularities from angle sums
    const sings = field.singularities(theta);
    assert.equal(topo.singularities.length, sings.length, `${label}: matching-based singularity count`);
    for (const s of sings) {
        const m = topo.singularities.find(t => t.x === s.x && t.y === s.y);
        assert.ok(m, `${label}: matching-based singularity at (${s.x.toFixed(1)}, ${s.y.toFixed(1)})`);
        assert.equal(m.index, s.index, `${label}: matching-based index agrees`);
    }
    // raw matchings and combed seams differ exactly by the combing branch offsets
    const HALF_PI = Math.PI / 2;
    for (const e of topo.edges) {
        const ka = Math.round((alpha[e.ta] - theta[e.ta]) / HALF_PI);
        const kb = Math.round((alpha[e.tb] - theta[e.tb]) / HALF_PI);
        assert.equal(e.seam - e.match, ka - kb, `${label}: seam/match consistent across combing`);
    }
    // seams terminate at singular vertices or the boundary — never dead-end
    const seamTouch = new Map();
    for (const e of topo.seams) {
        seamTouch.set(e.a, (seamTouch.get(e.a) || 0) + 1);
        seamTouch.set(e.b, (seamTouch.get(e.b) || 0) + 1);
    }
    const singVerts = new Set(topo.singularities.map(s => s.vertex));
    for (const [v, n] of seamTouch) {
        if (n === 1 && !mesh.boundaryVert[v]) {
            assert.ok(singVerts.has(v), `${label}: seam dead-ends only at singular vertices (vertex ${v})`);
        }
    }
    for (const s of topo.singularities) {
        assert.ok(topo.seamsAt(s.vertex).length >= 1, `${label}: every singularity emits a seam`);
    }
    return topo;
};

const maxGuideTurn = guide => {
    let worst = 0;
    for (let i = 1; i < guide.points.length - 1; i++) {
        const a = Math.atan2(guide.points[i][1] - guide.points[i - 1][1], guide.points[i][0] - guide.points[i - 1][0]);
        const b = Math.atan2(guide.points[i + 1][1] - guide.points[i][1], guide.points[i + 1][0] - guide.points[i][0]);
        worst = Math.max(worst, Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a))));
    }
    return worst;
};

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

// --- diagnostics: a constant field is exactly integrable ------------------
const zeroTheta = new Float64Array(mesh.tris.length);
const flatCurl = FieldDiagnostics.summarize(mesh, FieldDiagnostics.curl(mesh, zeroTheta));
const flatDrift = FieldDiagnostics.summarize(mesh, FieldDiagnostics.drift(mesh, param.grads, zeroTheta, 10, flat.u, flat.v));
assert.equal(flatCurl.max, 0, 'constant field has zero curl residual');
assert.ok(flatDrift.max < 1e-6, `constant field has ~zero drift (max ${flatDrift.max.toExponential(2)})`);
console.log('diagnostics baseline ok');

// --- guide smoothing ------------------------------------------------------
const kinked = new GuideCurve([[-40, 0], [0, 60], [40, 0]]);
assert.ok(kinked.points.length > 3, 'guide curve is resampled for smooth tangents');
assert.deepEqual(kinked.points[0], [-40, 0], 'guide smoothing preserves start point');
assert.deepEqual(kinked.points[kinked.points.length - 1], [40, 0], 'guide smoothing preserves end point');
assert.ok(maxGuideTurn(kinked) < Math.PI / 2, 'guide smoothing reduces sharp tangent jumps');
assert.ok(kinked.length > 80, 'smoothed guide keeps meaningful length');

// --- quad mesh extraction: constant map yields real valid quads -----------
const flatQuad = QuadMesh.extract(mesh, flat.u, flat.v);
console.log(`quad extraction (constant field): ${flatQuad.quads.length} quads, ${(flatQuad.stats.coverage * 100).toFixed(1)}% cover`);
assert.ok(flatQuad.quads.length > 500, 'quad mesh faces produced');
assert.ok(flatQuad.validation.isValid, `constant-field quad mesh valid: ${flatQuad.validation.issues.join('; ')}`);
assert.ok(flatQuad.stats.coverage > 0.75 && flatQuad.stats.coverage < 1.05, 'quad mesh covers most of the domain without large overlap');
assertSkipAccounting(flatQuad);
assertValenceDetails(flatQuad);

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
assert.equal(field.boundarySingularities(theta0).length, 0, 'smooth disc boundary carries no charge');

// --- Poincare-Hopf across shapes: interior + boundary indices always total -4
for (const [name, ring, guides] of [
    ['plate', Shapes.plate(0, 0, 150), []],
    ['disc r=200', Shapes.disc(0, 0, 200), []],
    ['blob r=200 guided', Shapes.blob(0, 0, 200), [new GuideCurve([[-160, -20], [-40, -140], [140, -110], [190, 40]])]],
]) {
    const m = new DomainMesh(ring, 10);
    assert.ok(m.tris.length < m.verts.length * 3, `${name}: triangulation stays sane (${m.tris.length} tris, ${m.verts.length} verts)`);
    const f = new CrossField(m);
    const th = f.solve(guides, 50);
    const inner = f.singularities(th).reduce((s, x) => s + x.index, 0);
    const bound = f.boundarySingularities(th).reduce((s, x) => s + x.index, 0);
    assert.equal(inner + bound, indexSum, `${name}: interior ${inner} + boundary ${bound} matches the disc total`);
}
console.log('Poincare-Hopf accounting ok (interior + boundary)');

// --- field topology: matchings, seams, singularity indices -----------------
const topo0 = assertTopologyInvariants(mesh, field, theta0, alpha0, 'disc');
assert.ok(topo0.seams.length > 0, 'a field with singularities has seam edges');
console.log(`field topology ok (${topo0.edges.length} interior edges, ${topo0.seams.length} seams)`);

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
const quadG = QuadMesh.extract(mesh, u, v);
console.log(`full param + contours: ${(performance.now() - t0).toFixed(0)} ms, ${isoU.length} u-segs, ${isoV.length} v-segs, ${quadG.quads.length} quads`);
assert.ok(isoU.length > 100 && isoV.length > 100, 'contours produced');
for (const s of [...isoU, ...isoV]) {
    assert.ok(s.every(Number.isFinite), 'finite contour coordinates');
}
assert.ok(quadG.stats.coverage > 0.75, `guided extraction keeps most of the domain (${(quadG.stats.coverage * 100).toFixed(1)}% cover)`);
assert.ok(Array.isArray(quadG.validation.issues), 'quad extraction reports topology issues');
assertTopologyInvariants(mesh, field, thetaG, alphaG, 'guided disc');
const driftG = FieldDiagnostics.summarize(mesh, FieldDiagnostics.drift(mesh, param.grads, alphaG, 18, u, v));
assert.ok(Number.isFinite(driftG.mean) && driftG.mean < 1.5, `guided disc drift stays moderate (mean ${driftG.mean.toFixed(2)})`);
assertSkipAccounting(quadG);
assertValenceDetails(quadG);
const topoG = QuadMesh.compareSingularities(quadG, sings, 18 * 1.5);
assert.equal(topoG.matches.length + topoG.missing.length, sings.length, 'field singularities are classified as matched or missing');
assert.ok(topoG.extra.every(v => v.valence !== 4), 'extra topology records are irregular mesh vertices');

// --- degenerate parameterization reports invalid topology ------------------
const zero = new Float64Array(mesh.verts.length);
const badQuad = QuadMesh.extract(mesh, zero, zero);
assert.ok(!badQuad.validation.isValid, 'degenerate map is not accepted as valid topology');
assert.ok(badQuad.validation.issues.includes('empty quad mesh'), 'degenerate map reports empty output');
assert.equal(badQuad.quads.length, 0, 'degenerate map emits no quads');
assertSkipAccounting(badQuad);
assertValenceDetails(badQuad);

// --- guided blob produces skipped-cell diagnostics -------------------------
const blob = new DomainMesh(Shapes.blob(0, 0, 150), 10);
const blobField = new CrossField(blob);
const blobGuide = new GuideCurve([[-70, -10], [-15, -65], [65, -50], [120, 20]]);
const blobParam = new Parameterization(blob);
const blobTheta = blobField.solve([blobGuide], 55);
const blobSings = blobField.singularities(blobTheta);
const blobCuts = blobField.cutGraph(blobSings);
const blobAlpha = blobField.comb(blobTheta, blobCuts);
const blobSol = blobParam.solve(blobAlpha, 18);
const blobQuad = QuadMesh.extract(blob, blobSol.u, blobSol.v);
assert.ok(blobQuad.stats.coverage > 0.7, `guided blob extraction keeps most of the domain (${(blobQuad.stats.coverage * 100).toFixed(1)}% cover)`);
assert.ok(blobQuad.stats.skippedCells.length > 0, 'guided blob reports skipped-cell diagnostics');
assertTopologyInvariants(blob, blobField, blobTheta, blobAlpha, 'guided blob');

// conflicting guide raises measured non-integrability vs the unguided field
const blobTheta0 = blobField.solve([], 55);
const blobAlpha0 = blobField.comb(blobTheta0);
const blobSol0 = blobParam.solve(blobAlpha0, 18);
const blobDriftG = FieldDiagnostics.summarize(blob, FieldDiagnostics.drift(blob, blobParam.grads, blobAlpha, 18, blobSol.u, blobSol.v));
const blobDrift0 = FieldDiagnostics.summarize(blob, FieldDiagnostics.drift(blob, blobParam.grads, blobAlpha0, 18, blobSol0.u, blobSol0.v));
const blobCurlG = FieldDiagnostics.summarize(blob, FieldDiagnostics.curl(blob, blobTheta));
const blobCurl0 = FieldDiagnostics.summarize(blob, FieldDiagnostics.curl(blob, blobTheta0));
console.log(`blob drift mean guided ${blobDriftG.mean.toFixed(3)} vs unguided ${blobDrift0.mean.toFixed(3)}; curl ${blobCurlG.mean.toFixed(3)} vs ${blobCurl0.mean.toFixed(3)}`);
assert.ok(blobDriftG.mean > blobDrift0.mean, 'guide conflict shows up as higher drift');
assert.ok(blobCurlG.mean > blobCurl0.mean, 'guide conflict shows up as higher curl');

// --- MIQ-lite seamless parameterization ------------------------------------
t0 = performance.now();
const blobTopo = new FieldTopology(blob, blobTheta, blobAlpha);
for (const e of blobTopo.seams) {
    const key = e.a < e.b ? e.a + '_' + e.b : e.b + '_' + e.a;
    assert.ok(blobCuts.has(key), 'combing against the cut graph confines seams to it');
}
const seamless = new SeamlessParameterization(blob, blobTopo);
const seamSol = seamless.solve(blobAlpha, 18);
console.log(`seamless solve: ${(performance.now() - t0).toFixed(0)} ms, +${seamSol.stats.extraVerts} cut verts, `
    + `${seamSol.stats.seamCurves} curves, round err ${seamSol.stats.maxRoundErr.toExponential(1)}`);
assert.ok(seamSol.stats.extraVerts > 0, 'seams cut the mesh into extra DOFs');
assert.ok(seamSol.stats.maxRoundErr < 0.05, `integer transitions land after rounding (err ${seamSol.stats.maxRoundErr.toExponential(1)})`);
for (const tr of seamSol.transitions) {
    assert.ok(Number.isInteger(tr.tx) && Number.isInteger(tr.ty), 'seam translations are integers');
    assert.ok(Number.isInteger(tr.c) && Number.isInteger(tr.sn) && Math.abs(tr.c) <= 1 && Math.abs(tr.sn) <= 1,
        'seam rotations are quarter turns');
}
const seamDrift = FieldDiagnostics.summarize(blob,
    FieldDiagnostics.drift(blob, seamless.grads, blobAlpha, 18, seamSol.uc, seamSol.vc, true));
console.log(`seamless drift ${seamDrift.mean.toFixed(3)}/${seamDrift.max.toFixed(2)} vs shared-vertex ${blobDriftG.mean.toFixed(3)}/${blobDriftG.max.toFixed(2)}`);
// boundary conformity costs some drift vs the unconstrained plain solve — it
// must stay bounded, and it buys near-total coverage below
assert.ok(seamDrift.mean < 0.6, `seamless guided drift stays bounded (${seamDrift.mean.toFixed(3)})`);
assert.ok(seamSol.stats.boundarySegments > 0, 'boundary is partitioned into alignment segments');
assert.ok(seamSol.stats.boundaryRoundErr < 0.5, 'boundary lines round to integers');
const seamQuad = QuadMesh.extract(blob, seamSol.uc, seamSol.vc,
    { corner: true, chart: seamSol.chart, transitions: seamSol.transitions });
console.log(`seamless extraction: ${seamQuad.quads.length} quads (shared-vertex: ${blobQuad.quads.length}), `
    + `${seamQuad.stats.stitchedCells} stitched, ${(seamQuad.stats.coverage * 100).toFixed(1)}% cover`);
assert.ok(seamQuad.validation.isValid, `seamless quad mesh valid: ${seamQuad.validation.issues.join('; ')}`);
assert.ok(seamQuad.quads.length > blobQuad.quads.length, 'boundary-conforming extraction beats the shared-vertex mesh');
assert.ok(seamQuad.stats.stitchedCells > 0, 'cells are stitched across seams');
assert.ok(seamQuad.stats.coverage > 0.9, `boundary-conforming coverage (${(seamQuad.stats.coverage * 100).toFixed(1)}%)`);
assertSkipAccounting(seamQuad);
assertValenceDetails(seamQuad);
assertSkipAccounting(blobQuad);
assertValenceDetails(blobQuad);
const blobMatch = QuadMesh.compareSingularities(blobQuad, blobSings, 18 * 1.5);
assert.ok(blobMatch.matches.length + blobMatch.missing.length >= 1, 'guided blob compares field singularities to mesh valences');

// --- L-plate (sharp corners) doesn't blow up --------------------------------
const plate = new DomainMesh(Shapes.plate(0, 0, 150), 10);
const fieldP = new CrossField(plate);
const thetaP = fieldP.solve([], 50);
const alphaP = fieldP.comb(thetaP);
const paramP = new Parameterization(plate);
const solP = paramP.solve(alphaP, 18);
const isoP = IsoContours.extract(plate, solP.u);
assert.ok(isoP.length > 50 && isoP.every(s => s.every(Number.isFinite)), 'L-plate pipeline ok');

// with no seams there are no cut DOFs, and boundary alignment maps the
// rectilinear plate onto grid lines almost perfectly
const plateTopo = new FieldTopology(plate, thetaP, alphaP);
if (plateTopo.seams.length === 0) {
    const seamlessP = new SeamlessParameterization(plate, plateTopo);
    const solSP = seamlessP.solve(alphaP, 18);
    assert.equal(solSP.stats.extraVerts, 0, 'no seams -> no cut vertices');
    assert.ok(solSP.stats.boundarySegments >= 4, 'plate boundary splits into per-side alignment segments');
    const dSeam = FieldDiagnostics.summarize(plate,
        FieldDiagnostics.drift(plate, seamlessP.grads, alphaP, 18, solSP.uc, solSP.vc, true));
    assert.ok(dSeam.mean < 0.3, `plate conformity cost stays small (drift ${dSeam.mean.toFixed(3)})`);
    const plateQuad = QuadMesh.extract(plate, solSP.uc, solSP.vc,
        { corner: true, chart: solSP.chart, transitions: solSP.transitions });
    assert.ok(plateQuad.validation.isValid, `plate quad mesh valid: ${plateQuad.validation.issues.join('; ')}`);
    assert.ok(plateQuad.stats.coverage > 0.95,
        `plate meshes to its boundary (${(plateQuad.stats.coverage * 100).toFixed(1)}%)`);
    assertSkipAccounting(plateQuad);
}
console.log('L-plate ok');

console.log('\nALL TESTS PASSED');
