/** Extracts and validates a concrete quad mesh from a scalar integer-grid map. */
export class QuadMesh {
    /**
     * Build a quad mesh by inverting integer UV grid vertices through the piecewise
     * linear parameterization. This is intentionally conservative: cells whose
     * corners/center cannot be located, whose lookups are positionally ambiguous,
     * or whose world-space quad is degenerate, are skipped and reported in stats.
     *
     * @param {DomainMesh} mesh
     * @param {Float64Array} u  per-vertex scalar, or per-corner (length 3*tris) with opts.corner
     * @param {Float64Array} v
     * @param {{corner?: boolean, chart?: Int32Array, transitions?: object[]}} [opts]
     *   per-corner UVs and per-triangle chart ids of a cut (seamless)
     *   parameterization; grid lookups never cross chart boundaries directly, but
     *   `transitions` (integer grid maps p' = R p + T per seam curve) let cells
     *   straddling a seam resolve their far-side corners and stitch the mesh.
     * @returns {{verts:number[][], uvs:number[][], quads:number[][], stats:object, validation:object}}
     */
    static extract(mesh, u, v, opts = {}) {
        const stats = {
            gridVerts: 0,
            ambiguousGridVerts: 0,
            candidateCells: 0,
            emittedCells: 0,
            missingCorners: 0,
            missingCenter: 0,
            ambiguousCells: 0,
            inconsistentCells: 0,
            duplicateCells: 0,
            stitchedCells: 0,
            degenerateCells: 0,
            foldedCells: 0,
            coverage: 0,
            skippedCells: [],
        };
        const nt = mesh.tris.length;
        const cu = opts.corner ? (ti, e) => u[ti * 3 + e] : (ti, e) => u[mesh.tris[ti][e]];
        const cv = opts.corner ? (ti, e) => v[ti * 3 + e] : (ti, e) => v[mesh.tris[ti][e]];
        const chart = opts.chart || new Int32Array(nt);
        const chartTris = new Map();
        for (let ti = 0; ti < nt; ti++) {
            if (!chartTris.has(chart[ti])) chartTris.set(chart[ti], []);
            chartTris.get(chart[ti]).push(ti);
        }

        const transitions = opts.transitions || [];
        const verts = [];
        const uvs = [];
        const gridToVert = new Map(); // 'ch:iu_iv' -> vertex indices, one per world-position branch
        const chartIds = [...chartTris.keys()];
        const posTol = 0.1 * mesh.h;

        // pass 1: locate every integer grid vertex, per chart. Near seams the UV
        // map is multivalued — the same label can name several distinct physical
        // grid points — so each position cluster becomes its own vertex.
        for (const [ch, triList] of chartTris) {
            const range = QuadMesh.#range(cu, cv, triList);
            const minU = Math.ceil(range.minU - 1e-9);
            const maxU = Math.floor(range.maxU + 1e-9);
            const minV = Math.ceil(range.minV - 1e-9);
            const maxV = Math.floor(range.maxV + 1e-9);
            for (let iu = minU; iu <= maxU; iu++) {
                for (let iv = minV; iv <= maxV; iv++) {
                    const clusters = QuadMesh.#locateClusters(mesh, cu, cv, iu, iv, triList, posTol);
                    if (!clusters.length) continue;
                    const ids = clusters.map(c => {
                        verts.push([c.x, c.y]);
                        uvs.push([iu, iv]);
                        return verts.length - 1;
                    });
                    gridToVert.set(QuadMesh.#key(ch, iu, iv), ids);
                    stats.gridVerts += ids.length;
                    if (ids.length > 1) stats.ambiguousGridVerts++;
                }
            }
        }

        // a missing grid label may exist under a nearby seam transition (integer grid map)
        const applyTr = (tr, U, V) => [
            [tr.c * U - tr.sn * V + tr.tx, tr.sn * U + tr.c * V + tr.ty], // forward R p + T
            [tr.c * (U - tr.tx) + tr.sn * (V - tr.ty), -tr.sn * (U - tr.tx) + tr.c * (V - tr.ty)], // inverse
        ];
        const nearbyTransitions = (hint, radius) => transitions.filter(tr =>
            tr.segs?.some(([ax, ay, bx, by]) => QuadMesh.#segDist(hint, ax, ay, bx, by) < radius));
        const nearest = (ids, cx, cy) => {
            let best, bestD = Infinity;
            for (const i of ids) {
                const d = (verts[i][0] - cx) ** 2 + (verts[i][1] - cy) ** 2;
                if (d < bestD) {
                    bestD = d;
                    best = i;
                }
            }
            return best;
        };
        const resolveAcross = (near, ju, jv, cx, cy) => {
            let best, bestD = Infinity;
            for (const tr of near) {
                for (const [au, av] of applyTr(tr, ju, jv)) {
                    for (const c2 of chartIds) {
                        for (const i of gridToVert.get(QuadMesh.#key(c2, au, av)) || []) {
                            const d = (verts[i][0] - cx) ** 2 + (verts[i][1] - cy) ** 2;
                            if (d < bestD) {
                                bestD = d;
                                best = i;
                            }
                        }
                    }
                }
            }
            return best;
        };

        // pass 2: assemble cells, per chart, anchored at each physical center —
        // a multivalued label's cell exists once per center branch
        const quadsRaw = [];
        const seenCells = new Set();
        for (const [ch, triList] of chartTris) {
            const range = QuadMesh.#range(cu, cv, triList);
            const minU = Math.ceil(range.minU - 1e-9);
            const maxU = Math.floor(range.maxU + 1e-9);
            const minV = Math.ceil(range.minV - 1e-9);
            const maxV = Math.floor(range.maxV + 1e-9);
            for (let iu = minU; iu < maxU; iu++) {
                for (let iv = minV; iv < maxV; iv++) {
                    const labels = [[iu, iv], [iu + 1, iv], [iu + 1, iv + 1], [iu, iv + 1]];
                    const centers = QuadMesh.#locateClusters(mesh, cu, cv, iu + 0.5, iv + 0.5, triList, posTol);
                    if (!centers.length) {
                        stats.candidateCells++;
                        stats.missingCenter++;
                        QuadMesh.#skip(stats, 'missingCenter', iu, iv, verts, []);
                        continue;
                    }
                    for (const center of centers) {
                        stats.candidateCells++;
                        // per corner, the candidate branch nearest this physical center
                        const q = labels.map(([ju, jv]) =>
                            nearest(gridToVert.get(QuadMesh.#key(ch, ju, jv)) || [], center.x, center.y));
                        const multiBranch = labels.some(([ju, jv]) =>
                            (gridToVert.get(QuadMesh.#key(ch, ju, jv)) || []).length > 1) || centers.length > 1;
                        let stitched = false;
                        if (q.some(x => x === undefined)) {
                            const near = transitions.length
                                ? nearbyTransitions([center.x, center.y], 3 * mesh.h)
                                : [];
                            for (let k = 0; k < 4; k++) {
                                if (q[k] === undefined && near.length) {
                                    q[k] = resolveAcross(near, labels[k][0], labels[k][1], center.x, center.y);
                                }
                            }
                            stitched = true;
                            if (q.some(x => x === undefined)) {
                                stats.missingCorners++;
                                QuadMesh.#skip(stats, 'missingCorners', iu, iv, verts, q);
                                continue;
                            }
                        }
                        if ((stitched || multiBranch) && !QuadMesh.#plausibleCell(verts, q)) {
                            stats.inconsistentCells++;
                            QuadMesh.#skip(stats, 'inconsistent', iu, iv, verts, q);
                            continue;
                        }
                        if (QuadMesh.#isFolded(verts, q)) {
                            stats.foldedCells++;
                            QuadMesh.#skip(stats, 'folded', iu, iv, verts, q);
                            continue;
                        }
                        const area = QuadMesh.#signedArea(verts, q);
                        if (Math.abs(area) < 1e-8) {
                            stats.degenerateCells++;
                            QuadMesh.#skip(stats, 'degenerate', iu, iv, verts, q);
                            continue;
                        }
                        // the same physical cell is visible from both sides of a seam — emit once
                        const cellKey = q.slice().sort((a, b) => a - b).join('_');
                        if (seenCells.has(cellKey)) {
                            stats.duplicateCells++;
                            continue;
                        }
                        seenCells.add(cellKey);
                        quadsRaw.push({
                            q: area > 0 ? q : [q[0], q[3], q[2], q[1]],
                            stitched,
                            risky: stitched || multiBranch,
                            iu, iv,
                        });
                    }
                }
            }
        }

        // single-branch cells tile disjointly; stitched/multi-branch cells are
        // admitted only while every edge stays manifold and consistently oriented
        const edgeDirs = new Map();
        const admissible = cell => cell.q.every((a, e) => {
            const b = cell.q[(e + 1) % 4];
            const dirs = edgeDirs.get(a < b ? `${a}_${b}` : `${b}_${a}`);
            return !dirs || (dirs.length === 1 && dirs[0] !== (a < b ? 1 : -1));
        });
        const admit = cell => {
            cell.q.forEach((a, e) => {
                const b = cell.q[(e + 1) % 4];
                const key = a < b ? `${a}_${b}` : `${b}_${a}`;
                if (!edgeDirs.has(key)) edgeDirs.set(key, []);
                edgeDirs.get(key).push(a < b ? 1 : -1);
            });
        };
        const quads = [];
        for (const cell of quadsRaw.filter(c => !c.risky)) {
            admit(cell);
            quads.push(cell.q);
        }
        for (const cell of quadsRaw.filter(c => c.risky)) {
            if (!admissible(cell)) {
                stats.inconsistentCells++;
                QuadMesh.#skip(stats, 'inconsistent', cell.iu, cell.iv, verts, cell.q);
                continue;
            }
            admit(cell);
            if (cell.stitched) stats.stitchedCells++;
            quads.push(cell.q);
        }

        const compact = QuadMesh.#compact(verts, uvs, quads);
        stats.emittedCells = compact.quads.length;
        return QuadMesh.#finish(compact.verts, compact.uvs, compact.quads, mesh, stats);
    }

    static validate(quadMesh) {
        const issues = [];
        const { verts, quads } = quadMesh;
        let badFaces = 0;
        let foldedFaces = 0;
        const edgeUse = new Map();
        const vertexUse = new Uint32Array(verts.length);
        for (let i = 0; i < verts.length; i++) {
            const [x, y] = verts[i];
            if (!Number.isFinite(x) || !Number.isFinite(y)) issues.push(`non-finite vertex ${i}`);
        }
        for (let qi = 0; qi < quads.length; qi++) {
            const q = quads[qi];
            const unique = new Set(q);
            if (q.length !== 4 || unique.size !== 4) badFaces++;
            if (q.some(i => i < 0 || i >= verts.length)) badFaces++;
            if (QuadMesh.#isFolded(verts, q)) foldedFaces++;
            if (Math.abs(QuadMesh.#signedArea(verts, q)) < 1e-8) badFaces++;
            for (const vi of q) vertexUse[vi]++;
            for (let e = 0; e < 4; e++) {
                const a = q[e], b = q[(e + 1) % 4];
                const key = a < b ? `${a}_${b}` : `${b}_${a}`;
                if (!edgeUse.has(key)) edgeUse.set(key, []);
                edgeUse.get(key).push({ face: qi, dir: a < b ? 1 : -1 });
            }
        }
        let boundaryEdges = 0;
        let nonManifoldEdges = 0;
        let sameDirectionSharedEdges = 0;
        for (const uses of edgeUse.values()) {
            if (uses.length === 1) boundaryEdges++;
            else if (uses.length > 2) nonManifoldEdges++;
            else if (uses[0].dir === uses[1].dir) sameDirectionSharedEdges++;
        }
        let isolatedVerts = 0;
        for (const count of vertexUse) if (!count) isolatedVerts++;
        const components = QuadMesh.#components(quads, edgeUse);
        if (!quads.length) issues.push('empty quad mesh');
        if (badFaces) issues.push(`${badFaces} bad face${badFaces === 1 ? '' : 's'}`);
        if (foldedFaces) issues.push(`${foldedFaces} folded face${foldedFaces === 1 ? '' : 's'}`);
        if (nonManifoldEdges) issues.push(`${nonManifoldEdges} non-manifold edge${nonManifoldEdges === 1 ? '' : 's'}`);
        if (sameDirectionSharedEdges) issues.push(`${sameDirectionSharedEdges} inconsistently oriented shared edge${sameDirectionSharedEdges === 1 ? '' : 's'}`);
        if (isolatedVerts) issues.push(`${isolatedVerts} isolated ${isolatedVerts === 1 ? 'vertex' : 'vertices'}`);
        const valence = QuadMesh.#valenceStats(verts.length, edgeUse, verts);
        return {
            isValid: issues.length === 0,
            issues,
            badFaces,
            foldedFaces,
            boundaryEdges,
            nonManifoldEdges,
            sameDirectionSharedEdges,
            isolatedVerts,
            components,
            valence: valence.hist,
            vertices: valence.vertices,
            irregularVertices: valence.irregularVertices,
        };
    }

    static compareSingularities(quadMesh, singularities, maxDistance) {
        const irregulars = quadMesh.validation.irregularVertices;
        const matchedIrregular = new Uint8Array(irregulars.length);
        const matches = [];
        const missing = [];
        for (const s of singularities) {
            const expectedValence = 4 - s.index;
            let best = -1, bestD = maxDistance;
            for (let i = 0; i < irregulars.length; i++) {
                if (matchedIrregular[i]) continue;
                const qv = irregulars[i];
                if (qv.valence !== expectedValence) continue;
                const d = Math.hypot(qv.x - s.x, qv.y - s.y);
                if (d < bestD) {
                    bestD = d;
                    best = i;
                }
            }
            if (best >= 0) {
                matchedIrregular[best] = 1;
                matches.push({ singularity: s, vertex: irregulars[best], distance: bestD });
            } else {
                missing.push({ singularity: s, expectedValence });
            }
        }
        const extra = irregulars.filter((_, i) => !matchedIrregular[i]);
        return { matches, missing, extra, maxDistance };
    }

    static #finish(verts, uvs, quads, mesh, stats) {
        const quadMesh = { verts, uvs, quads, stats, validation: null };
        stats.coverage = QuadMesh.#coverage(mesh, verts, quads);
        quadMesh.validation = QuadMesh.validate(quadMesh);
        return quadMesh;
    }

    static #skip(stats, reason, iu, iv, verts, q) {
        stats.skippedCells.push({
            reason,
            uv: [iu, iv],
            points: q
                .filter(i => i !== undefined)
                .map(i => verts[i])
                .filter(Boolean)
                .map(([x, y]) => [x, y]),
        });
    }

    static #range(cu, cv, triList) {
        let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
        for (const ti of triList) {
            for (let e = 0; e < 3; e++) {
                const uu = cu(ti, e), vv = cv(ti, e);
                if (uu < minU) minU = uu;
                if (uu > maxU) maxU = uu;
                if (vv < minV) minV = vv;
                if (vv > maxV) maxV = vv;
            }
        }
        return { minU, maxU, minV, maxV };
    }

    /**
     * All physical points mapping to UV (U, V) within the chart, clustered by
     * world position (a multivalued map near seams yields one entry per branch).
     * Each cluster keeps its best-contained (highest min-barycentric) hit.
     */
    static #locateClusters(mesh, cu, cv, U, V, triList, posTol) {
        const hits = [];
        const eps = 1e-9;
        for (const ti of triList) {
            const t = mesh.tris[ti];
            const u0 = cu(ti, 0), v0 = cv(ti, 0);
            const u1 = cu(ti, 1), v1 = cv(ti, 1);
            const u2 = cu(ti, 2), v2 = cv(ti, 2);
            const den = (u1 - u0) * (v2 - v0) - (v1 - v0) * (u2 - u0);
            if (Math.abs(den) < 1e-12) continue;
            const b1 = ((U - u0) * (v2 - v0) - (V - v0) * (u2 - u0)) / den;
            const b2 = ((u1 - u0) * (V - v0) - (v1 - v0) * (U - u0)) / den;
            const b0 = 1 - b1 - b2;
            if (b0 < -eps || b1 < -eps || b2 < -eps || b0 > 1 + eps || b1 > 1 + eps || b2 > 1 + eps) continue;
            const c0 = Math.min(1, Math.max(0, b0));
            const c1 = Math.min(1, Math.max(0, b1));
            const c2 = Math.min(1, Math.max(0, b2));
            const p0 = mesh.verts[t[0]], p1 = mesh.verts[t[1]], p2 = mesh.verts[t[2]];
            hits.push({
                x: c0 * p0[0] + c1 * p1[0] + c2 * p2[0],
                y: c0 * p0[1] + c1 * p1[1] + c2 * p2[1],
                tri: ti,
                score: Math.min(b0, b1, b2),
            });
        }
        hits.sort((a, b) => b.score - a.score);
        const clusters = [];
        for (const h of hits) {
            if (!clusters.some(c => Math.hypot(h.x - c.x, h.y - c.y) < posTol)) clusters.push(h);
        }
        return clusters;
    }

    static #compact(verts, uvs, quadsRaw) {
        const remap = new Map();
        const compactVerts = [];
        const compactUvs = [];
        const quads = quadsRaw.map(q => q.map(i => {
            if (!remap.has(i)) {
                remap.set(i, compactVerts.length);
                compactVerts.push(verts[i]);
                compactUvs.push(uvs[i]);
            }
            return remap.get(i);
        }));
        return { verts: compactVerts, uvs: compactUvs, quads };
    }

    static #segDist([px, py], ax, ay, bx, by) {
        const dx = bx - ax, dy = by - ay;
        const len2 = dx * dx + dy * dy || 1;
        const s = Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / len2));
        return Math.hypot(px - ax - s * dx, py - ay - s * dy);
    }

    /** Stitched cells must look like one grid step: reject wildly uneven edges (wrong-transition grabs). */
    static #plausibleCell(verts, q) {
        const p = q.map(i => verts[i]);
        let min = Infinity, max = 0;
        for (let i = 0; i < 4; i++) {
            const l = Math.hypot(p[i][0] - p[(i + 1) % 4][0], p[i][1] - p[(i + 1) % 4][1]);
            if (l < min) min = l;
            if (l > max) max = l;
        }
        return min > 1e-9 && max / min < 4;
    }

    static #signedArea(verts, q) {
        let a = 0;
        for (let i = 0; i < q.length; i++) {
            const p = verts[q[i]], r = verts[q[(i + 1) % q.length]];
            a += p[0] * r[1] - r[0] * p[1];
        }
        return a / 2;
    }

    static #isFolded(verts, q) {
        const p = q.map(i => verts[i]);
        return QuadMesh.#segmentsCross(p[0], p[1], p[2], p[3])
            || QuadMesh.#segmentsCross(p[1], p[2], p[3], p[0]);
    }

    static #segmentsCross(a, b, c, d) {
        const o1 = QuadMesh.#orient(a, b, c);
        const o2 = QuadMesh.#orient(a, b, d);
        const o3 = QuadMesh.#orient(c, d, a);
        const o4 = QuadMesh.#orient(c, d, b);
        return o1 * o2 < -1e-12 && o3 * o4 < -1e-12;
    }

    static #orient(a, b, c) {
        return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    }

    static #components(quads, edgeUse) {
        if (!quads.length) return 0;
        const adj = Array.from({ length: quads.length }, () => []);
        for (const uses of edgeUse.values()) {
            if (uses.length === 2) {
                adj[uses[0].face].push(uses[1].face);
                adj[uses[1].face].push(uses[0].face);
            }
        }
        const seen = new Uint8Array(quads.length);
        let components = 0;
        for (let seed = 0; seed < quads.length; seed++) {
            if (seen[seed]) continue;
            components++;
            seen[seed] = 1;
            const queue = [seed];
            for (let head = 0; head < queue.length; head++) {
                for (const nb of adj[queue[head]]) {
                    if (seen[nb]) continue;
                    seen[nb] = 1;
                    queue.push(nb);
                }
            }
        }
        return components;
    }

    static #valenceStats(nv, edgeUse, verts) {
        const valence = new Uint16Array(nv);
        for (const key of edgeUse.keys()) {
            const [a, b] = key.split('_').map(Number);
            valence[a]++;
            valence[b]++;
        }
        const hist = {};
        const vertices = [];
        const irregularVertices = [];
        for (let i = 0; i < valence.length; i++) {
            const v = valence[i];
            hist[v] = (hist[v] || 0) + 1;
            const out = { index: i, x: verts[i][0], y: verts[i][1], valence: v };
            vertices.push(out);
            if (v !== 4) irregularVertices.push(out);
        }
        return { hist, vertices, irregularVertices };
    }

    static #coverage(mesh, verts, quads) {
        const domainArea = mesh.areas.reduce((s, a) => s + a, 0) || 1;
        const quadArea = quads.reduce((s, q) => s + Math.abs(QuadMesh.#signedArea(verts, q)), 0);
        return quadArea / domainArea;
    }

    static #key(chart, iu, iv) {
        return `${chart}:${iu}_${iv}`;
    }
}
