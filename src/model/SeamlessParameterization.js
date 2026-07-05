/**
 * MIQ-lite seamless parameterization. The mesh is cut along the combing seams
 * (vertices split into one DOF per wedge between seams), u and v are solved
 * together with soft grid-automorphism transition constraints across each seam
 * edge — p_B = R90^s p_A + T — and the per-seam-curve translations T are then
 * rounded to integers and re-imposed so integer grid lines continue coherently
 * across seams. Greedy per-curve rounding, not exact MIQ: the residual is
 * reported, not hidden.
 */
export class SeamlessParameterization {
    /**
     * @param {DomainMesh} mesh
     * @param {FieldTopology} topology  matchings/seams of the combed field
     */
    constructor(mesh, topology) {
        this.mesh = mesh;
        this.topology = topology;
        this.#buildCharts();
        this.#buildCut();
        this.#buildGrads();
        this.#buildBase();
        this.#buildConstraints();
        this.#buildCurves();
    }

    /**
     * @param {Float64Array} alpha  combed per-triangle angle
     * @param {number} spacing  target quad edge length
     * @returns {{uc: Float64Array, vc: Float64Array, chart: Int32Array,
     *            stats: {cutVerts: number, extraVerts: number, seamCurves: number, maxRoundErr: number}}}
     */
    solve(alpha, spacing) {
        const { tris, areas } = this.mesh;
        const n = this.nCut;
        const b = new Float64Array(2 * n);
        tris.forEach((t, ti) => {
            const A = areas[ti];
            const c = Math.cos(alpha[ti]) / spacing;
            const s = Math.sin(alpha[ti]) / spacing;
            const g = this.grads[ti];
            for (let e = 0; e < 3; e++) {
                const id = this.cut[ti * 3 + e];
                b[id] += A * (g[e][0] * c + g[e][1] * s);
                b[n + id] += A * (-g[e][0] * s + g[e][1] * c);
            }
        });

        // boundary alignment: along each boundary run, the grid coordinate
        // perpendicular to the field is held constant (and later pinned to an
        // integer), so the domain boundary becomes a grid iso-line and the last
        // row of quads ends flush against it instead of a fractional cell short
        const segments = this.#boundarySegments(alpha);
        const boundaryEq = [];
        for (const seg of segments) {
            for (const e of seg.edges) {
                boundaryEq.push({ coefs: [[e.iA, 1], [e.iB, -1]], rhs: 0 });
            }
        }

        // pass 1: seamless relaxation — rotations enforced, translations free
        const x1 = this.#cg(this.#assemble([...this.diffConstraints, ...boundaryEq]), b);

        // greedy rounding in dependency order: boundary lines first (they are
        // locked to the geometry), then seam translations from the re-solved
        // system — rounding both from pass 1 lets them pick conflicting integers
        // where a cut path meets the boundary
        let boundaryRoundErr = 0;
        const boundaryInt = [];
        for (const seg of segments) {
            const dofs = new Set();
            for (const e of seg.edges) {
                dofs.add(e.iA);
                dofs.add(e.iB);
            }
            let avg = 0;
            for (const i of dofs) avg += x1[i];
            avg /= dofs.size;
            const N = Math.round(avg);
            boundaryRoundErr = Math.max(boundaryRoundErr, Math.abs(avg - N));
            for (const i of dofs) boundaryInt.push({ coefs: [[i, 1]], rhs: N });
        }
        const x2 = boundaryInt.length
            ? this.#cg(this.#assemble([...this.diffConstraints, ...boundaryEq, ...boundaryInt]),
                this.#rhsWith(b, boundaryInt))
            : x1;

        const rounded = [...boundaryInt];
        const transitions = [];
        let maxRoundErr = 0;
        for (const curve of this.curves) {
            const T = this.#curveTranslation(curve, x2);
            const Tint = [Math.round(T[0]), Math.round(T[1])];
            maxRoundErr = Math.max(maxRoundErr, Math.abs(T[0] - Tint[0]), Math.abs(T[1] - Tint[1]));
            for (const m of curve) rounded.push(...this.#endpointConstraints(m, Tint));
            const { c, sn } = this.#oriented(curve[0]); // R is constant along a curve
            const verts = this.mesh.verts;
            transitions.push({
                c, sn, tx: Tint[0], ty: Tint[1],
                // world segments of the seam curve, so extraction can stitch locally
                segs: curve.map(m => {
                    const e = this.seamData[m.i].edge;
                    return [verts[e.a][0], verts[e.a][1], verts[e.b][0], verts[e.b][1]];
                }),
            });
        }

        // final pass: everything pinned
        const withInt = rounded.length
            ? this.#cg(this.#assemble([...this.diffConstraints, ...boundaryEq, ...rounded]), this.#rhsWith(b, rounded))
            : x1;
        // the pins are soft, leaving the boundary a hair off its integer line —
        // enough to push boundary grid points outside the map. Snap them exact.
        for (const con of boundaryInt) withInt[con.coefs[0][0]] = con.rhs;

        let residual = 0;
        for (const curve of this.curves) {
            const T = this.#curveTranslation(curve, withInt);
            residual = Math.max(residual, Math.abs(T[0] - Math.round(T[0])), Math.abs(T[1] - Math.round(T[1])));
        }
        const nt = tris.length;
        const uc = new Float64Array(nt * 3);
        const vc = new Float64Array(nt * 3);
        for (let k = 0; k < nt * 3; k++) {
            uc[k] = withInt[this.cut[k]];
            vc[k] = withInt[n + this.cut[k]];
        }
        return {
            uc, vc, chart: this.chart, transitions,
            stats: {
                cutVerts: n,
                extraVerts: n - this.mesh.verts.length,
                seamCurves: this.curves.length,
                maxRoundErr: residual,
                boundarySegments: segments.length,
                boundaryRoundErr,
            },
        };
    }

    /** Charts: connected components of the dual graph with seam edges removed. */
    #buildCharts() {
        const { tris, triNb } = this.mesh;
        const seamSet = new Set(this.topology.seams.map(e => e.ta + '_' + e.tb));
        const isSeam = (t1, t2) => seamSet.has(t1 < t2 ? t1 + '_' + t2 : t2 + '_' + t1);
        this.isSeam = isSeam;
        const nt = tris.length;
        this.chart = new Int32Array(nt).fill(-1);
        let charts = 0;
        for (let seed = 0; seed < nt; seed++) {
            if (this.chart[seed] >= 0) continue;
            this.chart[seed] = charts;
            const queue = [seed];
            for (let head = 0; head < queue.length; head++) {
                const t = queue[head];
                for (const nb of triNb[t]) {
                    if (nb < 0 || this.chart[nb] >= 0 || isSeam(t, nb)) continue;
                    this.chart[nb] = charts;
                    queue.push(nb);
                }
            }
            charts++;
        }
        this.chartCount = charts;
    }

    /**
     * Cut vertices: split each vertex into one DOF per wedge — a maximal run of
     * its triangle fan not interrupted by a seam edge. cut[ti*3 + corner] maps a
     * face corner to its DOF.
     */
    #buildCut() {
        const { verts, tris, triNb, vertTris } = this.mesh;
        this.cut = new Int32Array(tris.length * 3).fill(-1);
        let n = 0;
        for (let v = 0; v < verts.length; v++) {
            const fan = this.#orderedFan(v);
            if (!fan) {
                // fan walk failed (should not happen on a valid mesh): one shared DOF
                const id = n++;
                for (const [ti, l] of vertTris[v]) this.cut[ti * 3 + l] = id;
                continue;
            }
            const { list, closed } = fan;
            let start = 0;
            if (closed) {
                // rotate so the walk begins just after a seam crossing (if any)
                for (let i = 0; i < list.length; i++) {
                    const [t] = list[i], [tn] = list[(i + 1) % list.length];
                    if (this.isSeam(t, tn)) {
                        start = (i + 1) % list.length;
                        break;
                    }
                }
            }
            let id = n++;
            for (let k = 0; k < list.length; k++) {
                const i = (start + k) % list.length;
                if (k > 0) {
                    const [prev] = list[(i - 1 + list.length) % list.length];
                    if (this.isSeam(prev, list[i][0])) id = n++;
                }
                const [ti, l] = list[i];
                this.cut[ti * 3 + l] = id;
            }
        }
        this.nCut = n;
    }

    /** Fan of (tri, local) around v in orientation order; open fans start at the boundary. */
    #orderedFan(v) {
        const { tris, triNb, vertTris } = this.mesh;
        if (!vertTris[v].length) return null;
        let [t, l] = vertTris[v][0];
        // for boundary vertices, rewind to the corner whose backward edge is open;
        // interior fans come back around and can start anywhere
        for (let guard = 0; guard < vertTris[v].length; guard++) {
            const back = triNb[t][(l + 1) % 3];
            if (back < 0) break;
            t = back;
            l = tris[t].indexOf(v);
            if (l < 0) return null;
        }
        const start = t;
        const list = [];
        let closed = false;
        do {
            list.push([t, l]);
            if (list.length > vertTris[v].length) return null;
            const next = triNb[t][(l + 2) % 3];
            if (next < 0) break;
            if (next === start) {
                closed = true;
                break;
            }
            t = next;
            l = tris[t].indexOf(v);
            if (l < 0) return null;
        } while (true);
        if (list.length !== vertTris[v].length) return null;
        return { list, closed };
    }

    #buildGrads() {
        const { verts, tris, areas } = this.mesh;
        this.grads = [];
        tris.forEach((t, ti) => {
            const A = areas[ti];
            const g = [];
            for (let e = 0; e < 3; e++) {
                const [jx, jy] = verts[t[(e + 1) % 3]];
                const [kx, ky] = verts[t[(e + 2) % 3]];
                g.push([-(ky - jy) / (2 * A), (kx - jx) / (2 * A)]);
            }
            this.grads.push(g);
        });
    }

    /** FEM stiffness over cut DOFs (identical block for u and v). */
    #buildBase() {
        const { tris, areas } = this.mesh;
        const rows = Array.from({ length: this.nCut }, () => new Map());
        tris.forEach((t, ti) => {
            const A = areas[ti];
            const g = this.grads[ti];
            for (let a = 0; a < 3; a++) {
                for (let bb = 0; bb < 3; bb++) {
                    const val = A * (g[a][0] * g[bb][0] + g[a][1] * g[bb][1]);
                    const row = rows[this.cut[ti * 3 + a]];
                    const col = this.cut[ti * 3 + bb];
                    row.set(col, (row.get(col) || 0) + val);
                }
            }
        });
        this.baseRows = rows;
        let dsum = 0;
        for (let i = 0; i < this.nCut; i++) dsum += rows[i].get(i) || 0;
        this.meanDiag = dsum / this.nCut || 1;
        this.wc = 100 * this.meanDiag; // soft-constraint weight
    }

    /**
     * Per seam edge, the DOFs of both endpoints on both sides and the rotation
     * R90^s = [[c, -sn], [sn, c]] mapping the ta chart into the tb chart, plus
     * the translation-free difference constraints for pass 1.
     */
    #buildConstraints() {
        const { tris } = this.mesh;
        const n = this.nCut;
        this.seamData = [];
        this.diffConstraints = [];
        for (const e of this.topology.seams) {
            const laA = tris[e.ta].indexOf(e.a), lbA = tris[e.ta].indexOf(e.b);
            const laB = tris[e.tb].indexOf(e.a), lbB = tris[e.tb].indexOf(e.b);
            if (laA < 0 || lbA < 0 || laB < 0 || lbB < 0) continue;
            const d = {
                edge: e,
                aA: this.cut[e.ta * 3 + laA],
                bA: this.cut[e.ta * 3 + lbA],
                aB: this.cut[e.tb * 3 + laB],
                bB: this.cut[e.tb * 3 + lbB],
                c: Math.round(Math.cos(e.seam * Math.PI / 2)),
                sn: Math.round(Math.sin(e.seam * Math.PI / 2)),
            };
            this.seamData.push(d);
            const { aA, bA, aB, bB, c, sn } = d;
            // (p_bB - p_aB) = R (p_bA - p_aA)
            this.diffConstraints.push(
                { coefs: [[bB, 1], [aB, -1], [bA, -c], [aA, c], [n + bA, sn], [n + aA, -sn]], rhs: 0 },
                { coefs: [[n + bB, 1], [n + aB, -1], [bA, -sn], [aA, sn], [n + bA, -c], [n + aA, c]], rhs: 0 },
            );
        }
    }

    /**
     * Seam curves: chains of seam edges through regular seam vertices (exactly
     * two incident seam edges). Each member is oriented so side A is continuous
     * along the curve — one shared translation per curve.
     */
    #buildCurves() {
        const byVert = new Map();
        this.seamData.forEach((d, i) => {
            for (const v of [d.edge.a, d.edge.b]) {
                if (!byVert.has(v)) byVert.set(v, []);
                byVert.get(v).push(i);
            }
        });
        const used = new Uint8Array(this.seamData.length);
        this.curves = [];
        const isJunction = v => (byVert.get(v) || []).length !== 2;
        // wedge DOF of vertex v on the A side (or B side) of oriented member m
        const sideDof = (m, v, side) => {
            const d = this.seamData[m.i];
            const A = m.flip ? { a: d.aB, b: d.bB } : { a: d.aA, b: d.bA };
            const B = m.flip ? { a: d.aA, b: d.bA } : { a: d.aB, b: d.bB };
            const w = side === 'A' ? A : B;
            return v === d.edge.a ? w.a : w.b;
        };
        const grow = (i, flip, from) => {
            // walk one direction from seam edge i, keeping side A continuous
            const chain = [];
            let cur = { i, flip };
            let v = from;
            while (true) {
                chain.push(cur);
                used[cur.i] = 1;
                const d = this.seamData[cur.i];
                v = d.edge.a === v ? d.edge.b : d.edge.a; // advance to the far vertex
                if (isJunction(v)) break;
                const nextI = (byVert.get(v) || []).find(j => !used[j]);
                if (nextI === undefined) break; // closed loop or exhausted
                const nd = this.seamData[nextI];
                const prevA = sideDof(cur, v, 'A');
                let flipNext;
                if ((nd.edge.a === v ? nd.aA : nd.bA) === prevA) flipNext = false;
                else if ((nd.edge.a === v ? nd.aB : nd.bB) === prevA) flipNext = true;
                else break; // sides don't join up — treat as separate curves
                cur = { i: nextI, flip: flipNext };
            }
            return chain;
        };
        for (let i = 0; i < this.seamData.length; i++) {
            if (used[i]) continue;
            const e = this.seamData[i].edge;
            // grow both ways from an unused edge; start orientation as stored
            const forward = grow(i, false, e.a);
            used[i] = 0; // allow the backward pass to re-anchor at the same edge
            const backward = grow(i, false, e.b).slice(1);
            this.curves.push([...backward.reverse(), ...forward]);
        }
        this.sideDof = sideDof;
    }

    /**
     * Boundary runs for integer alignment. Along each boundary edge the field
     * is (softly) aligned, so one grid coordinate is constant across it: v if
     * the edge runs along the u-axis, u otherwise. Edges chain into segments
     * through shared wedge DOFs — cut-path endpoints and corner charges split
     * the wedges, so segments break exactly where the constant coordinate
     * changes. Each segment later gets pinned to a single integer, mapping the
     * domain boundary onto grid iso-lines (the disk becomes a rectilinear UV
     * polygon whose corners are the cut endpoints and boundary charges).
     */
    #boundarySegments(alpha) {
        const { tris, boundaryEdges } = this.mesh;
        const n = this.nCut;
        const HALF_PI = Math.PI / 2;
        const items = [];
        for (const be of boundaryEdges) {
            const la = tris[be.tri].indexOf(be.a), lb = tris[be.tri].indexOf(be.b);
            if (la < 0 || lb < 0) continue;
            const phi = be.angle - alpha[be.tri];
            const k = Math.round(phi / HALF_PI);
            if (Math.abs(phi - k * HALF_PI) > 0.6) continue; // field not aligned here — don't force it
            const pinV = ((k % 2) + 2) % 2 === 0; // edge along the u-axis -> v is constant
            const dofA = this.cut[be.tri * 3 + la];
            const dofB = this.cut[be.tri * 3 + lb];
            items.push({ iA: pinV ? n + dofA : dofA, iB: pinV ? n + dofB : dofB });
        }
        const parent = new Map();
        const find = i => {
            while (parent.get(i) !== i) {
                parent.set(i, parent.get(parent.get(i)));
                i = parent.get(i);
            }
            return i;
        };
        for (const it of items) {
            for (const i of [it.iA, it.iB]) if (!parent.has(i)) parent.set(i, i);
            parent.set(find(it.iA), find(it.iB));
        }
        const byRoot = new Map();
        for (const it of items) {
            const r = find(it.iA);
            if (!byRoot.has(r)) byRoot.set(r, { edges: [] });
            byRoot.get(r).edges.push(it);
        }
        return [...byRoot.values()];
    }

    /** Oriented rotation and DOFs of a curve member. */
    #oriented(m) {
        const d = this.seamData[m.i];
        if (!m.flip) return { d, c: d.c, sn: d.sn, aA: d.aA, bA: d.bA, aB: d.aB, bB: d.bB };
        // reversed side: transition is the inverse rotation, wedge roles swap
        return { d, c: d.c, sn: -d.sn, aA: d.aB, bA: d.bB, aB: d.aA, bB: d.bA };
    }

    /** Average translation T = p_B - R p_A over all endpoint pairs of a curve. */
    #curveTranslation(curve, x) {
        const n = this.nCut;
        let tx = 0, ty = 0, count = 0;
        for (const m of curve) {
            const { c, sn, aA, bA, aB, bB } = this.#oriented(m);
            for (const [iA, iB] of [[aA, aB], [bA, bB]]) {
                tx += x[iB] - (c * x[iA] - sn * x[n + iA]);
                ty += x[n + iB] - (sn * x[iA] + c * x[n + iA]);
                count++;
            }
        }
        return [tx / count, ty / count];
    }

    /** Constraints pinning both endpoint pairs of a curve member to integer T. */
    #endpointConstraints(m, T) {
        const n = this.nCut;
        const { c, sn, aA, bA, aB, bB } = this.#oriented(m);
        const rows = [];
        for (const [iA, iB] of [[aA, aB], [bA, bB]]) {
            rows.push(
                { coefs: [[iB, 1], [iA, -c], [n + iA, sn]], rhs: T[0] },
                { coefs: [[n + iB, 1], [iA, -sn], [n + iA, -c]], rhs: T[1] },
            );
        }
        return rows;
    }

    /** Combined 2n system: stiffness blocks + weighted soft constraints. */
    #assemble(constraints) {
        const n = this.nCut;
        const N = 2 * n;
        const rows = Array.from({ length: N }, () => new Map());
        for (let i = 0; i < n; i++) {
            for (const [j, val] of this.baseRows[i]) {
                rows[i].set(j, val);
                rows[n + i].set(n + j, val);
            }
        }
        for (const con of constraints) {
            for (const [i, ci] of con.coefs) {
                const row = rows[i];
                for (const [j, cj] of con.coefs) {
                    row.set(j, (row.get(j) || 0) + this.wc * ci * cj);
                }
            }
        }
        const eps = 1e-8 * this.meanDiag; // gentle handle on the translation null space
        const cols = [], vals = [], diag = new Float64Array(N);
        for (let i = 0; i < N; i++) {
            rows[i].set(i, (rows[i].get(i) || 0) + eps);
            cols.push([...rows[i].keys()]);
            vals.push([...rows[i].values()]);
            diag[i] = rows[i].get(i) || 1;
        }
        return { cols, vals, diag, constraints };
    }

    /** RHS including the weighted constraint targets. */
    #rhsWith(b, constraints) {
        const out = Float64Array.from(b);
        for (const con of constraints) {
            if (!con.rhs) continue;
            for (const [i, ci] of con.coefs) out[i] += this.wc * ci * con.rhs;
        }
        return out;
    }

    /** Jacobi-preconditioned conjugate gradient. */
    #cg(sys, b) {
        const { cols, vals, diag } = sys;
        const N = b.length;
        const x = new Float64Array(N);
        const r = Float64Array.from(b);
        const z = new Float64Array(N);
        const p = new Float64Array(N);
        const Ap = new Float64Array(N);
        const dot = (a, c) => {
            let s = 0;
            for (let i = 0; i < N; i++) s += a[i] * c[i];
            return s;
        };
        for (let i = 0; i < N; i++) p[i] = z[i] = r[i] / diag[i];
        let rz = dot(r, z);
        const b2 = dot(b, b) || 1;
        for (let it = 0; it < 4000; it++) {
            for (let i = 0; i < N; i++) {
                const ci = cols[i], vi = vals[i];
                let s = 0;
                for (let k = 0; k < ci.length; k++) s += vi[k] * p[ci[k]];
                Ap[i] = s;
            }
            const a = rz / (dot(p, Ap) || 1e-300);
            for (let i = 0; i < N; i++) {
                x[i] += a * p[i];
                r[i] -= a * Ap[i];
            }
            if (dot(r, r) < 1e-16 * b2) break;
            for (let i = 0; i < N; i++) z[i] = r[i] / diag[i];
            const rz2 = dot(r, z);
            const beta = rz2 / rz;
            rz = rz2;
            for (let i = 0; i < N; i++) p[i] = z[i] + beta * p[i];
        }
        return x;
    }
}
