/**
 * Smooth 4-RoSy (cross) direction field over a DomainMesh, one angle per triangle.
 * Boundary edges and user guide curves act as alignment constraints; smoothing
 * propagates their influence — the mechanism behind guide curves in ZRemesher-style
 * quad remeshers.
 */
export class CrossField {
    constructor(mesh) {
        this.mesh = mesh;
    }

    /**
     * @param {GuideCurve[]} guides
     * @param {number} influence  guide influence radius in world units
     * @param {number} iterations  Gauss-Seidel smoothing iterations
     * @returns {Float64Array} per-triangle angle in (-PI/4, PI/4]
     */
    solve(guides, influence, iterations = 350) {
        const { triNb, boundaryEdges, centroids } = this.mesh;
        const nt = this.mesh.tris.length;
        // accumulated soft constraints in 4θ representation space
        const cw = new Float64Array(nt);
        const cx = new Float64Array(nt);
        const cy = new Float64Array(nt);
        for (const be of boundaryEdges) {
            const w = 10;
            cw[be.tri] += w;
            cx[be.tri] += w * Math.cos(4 * be.angle);
            cy[be.tri] += w * Math.sin(4 * be.angle);
        }
        for (let t = 0; t < nt; t++) {
            const [gx, gy] = centroids[t];
            for (const g of guides) {
                const near = g.tangentNear(gx, gy);
                if (near.dist > influence) continue;
                const s = 1 - near.dist / influence;
                const w = 60 * s * s; // guides outweigh the boundary where they pass close
                cw[t] += w;
                cx[t] += w * Math.cos(4 * near.angle);
                cy[t] += w * Math.sin(4 * near.angle);
            }
        }
        const zx = new Float64Array(nt);
        const zy = new Float64Array(nt);
        for (let t = 0; t < nt; t++) {
            const l = Math.hypot(cx[t], cy[t]);
            if (l > 1e-12) {
                zx[t] = cx[t] / l;
                zy[t] = cy[t] / l;
            } else {
                zx[t] = 1;
            }
        }
        for (let it = 0; it < iterations; it++) {
            for (let t = 0; t < nt; t++) {
                let sx = cx[t], sy = cy[t];
                for (const nb of triNb[t]) {
                    if (nb >= 0) {
                        sx += zx[nb];
                        sy += zy[nb];
                    }
                }
                const l = Math.hypot(sx, sy);
                if (l > 1e-12) {
                    zx[t] = sx / l;
                    zy[t] = sy / l;
                }
            }
        }
        const theta = new Float64Array(nt);
        for (let t = 0; t < nt; t++) theta[t] = Math.atan2(zy[t], zx[t]) / 4;
        return theta;
    }

    /**
     * Pick a globally consistent branch of the 4-fold field via BFS (combing).
     * With `cuts` (a set of primal edge keys from cutGraph), the BFS never
     * crosses a cut edge, so all residual branch jumps — the seams — land on
     * the cut graph instead of wherever the traversal happened to leave them.
     * @param {Float64Array} theta
     * @param {Set<string>|null} cuts
     */
    comb(theta, cuts = null) {
        const { tris, triNb } = this.mesh;
        const nt = theta.length;
        const HALF_PI = Math.PI / 2;
        const alpha = new Float64Array(nt);
        const seen = new Uint8Array(nt);
        for (let seed = 0; seed < nt; seed++) {
            if (seen[seed]) continue;
            seen[seed] = 1;
            alpha[seed] = theta[seed];
            const queue = [seed];
            for (let head = 0; head < queue.length; head++) {
                const t = queue[head];
                for (let e = 0; e < 3; e++) {
                    const nb = triNb[t][e];
                    if (nb < 0 || seen[nb]) continue;
                    if (cuts) {
                        const a = tris[t][(e + 1) % 3], b = tris[t][(e + 2) % 3];
                        if (cuts.has(a < b ? a + '_' + b : b + '_' + a)) continue;
                    }
                    const k = Math.round((alpha[t] - theta[nb]) / HALF_PI);
                    alpha[nb] = theta[nb] + k * HALF_PI;
                    seen[nb] = 1;
                    queue.push(nb);
                }
            }
        }
        return alpha;
    }

    /**
     * Cut graph: shortest primal-edge paths from every singular vertex to the
     * boundary (multi-source BFS from the boundary). Combing against these cuts
     * concentrates all seams on short, deliberate paths.
     * @param {{vertex: number}[]} singularities
     * @returns {Set<string>} primal edge keys 'a_b' (a < b)
     */
    cutGraph(singularities) {
        const { verts, edges, boundaryVert } = this.mesh;
        const adj = verts.map(() => []);
        for (const [a, b] of edges) {
            adj[a].push(b);
            adj[b].push(a);
        }
        const parent = new Int32Array(verts.length).fill(-2);
        const queue = [];
        for (let v = 0; v < verts.length; v++) {
            if (boundaryVert[v]) {
                parent[v] = -1;
                queue.push(v);
            }
        }
        for (let head = 0; head < queue.length; head++) {
            for (const nb of adj[queue[head]]) {
                if (parent[nb] !== -2) continue;
                parent[nb] = queue[head];
                queue.push(nb);
            }
        }
        const cuts = new Set();
        for (const s of singularities) {
            let v = s.vertex;
            while (v >= 0 && parent[v] >= 0) {
                const p = parent[v];
                cuts.add(v < p ? v + '_' + p : p + '_' + v);
                v = p;
            }
        }
        return cuts;
    }

    /**
     * Irregular vertices of the field: interior vertices where branch matchings
     * around the one-ring do not cancel. These become the extraordinary (non-valence-4)
     * vertices of the quad mesh.
     * @returns {{x:number, y:number, vertex:number, index:number}[]}
     */
    singularities(theta) {
        const { verts, boundaryVert } = this.mesh;
        const HALF_PI = Math.PI / 2;
        const out = [];
        for (let v = 0; v < verts.length; v++) {
            if (boundaryVert[v]) continue;
            const fan = this.#orderedFan(v);
            if (!fan) continue;
            let sum = 0;
            for (let i = 0; i < fan.length; i++) {
                const a = theta[fan[i]];
                const b = theta[fan[(i + 1) % fan.length]];
                sum += Math.round((a - b) / HALF_PI);
            }
            if (sum !== 0) out.push({ x: verts[v][0], y: verts[v][1], vertex: v, index: sum });
        }
        return out;
    }

    /**
     * Boundary singularities: boundary vertices where the field's turn across
     * the open fan disagrees with the boundary tangent's turn by a quarter
     * multiple. Interior detection is blind to these — a singularity pushed
     * onto the boundary (or an L-plate corner charge) only shows up here.
     * The interior indices plus these must sum to the disk's total of -4.
     * @returns {{x:number, y:number, vertex:number, index:number}[]}
     */
    boundarySingularities(theta) {
        const { tris, triNb, verts, vertTris, boundaryVert } = this.mesh;
        const HALF_PI = Math.PI / 2;
        const out = [];
        for (let v = 0; v < verts.length; v++) {
            if (!boundaryVert[v]) continue;
            // start at the corner whose backward edge is the open boundary
            let start = null;
            for (const [ti, l] of vertTris[v]) {
                if (triNb[ti][(l + 1) % 3] < 0) {
                    start = [ti, l];
                    break;
                }
            }
            if (!start) continue;
            let [t, l] = start;
            const wStart = tris[t][(l + 2) % 3];
            const a0 = theta[t];
            let a = a0;
            let ok = true;
            for (let guard = 0; triNb[t][(l + 2) % 3] >= 0; guard++) {
                t = triNb[t][(l + 2) % 3];
                l = tris[t].indexOf(v);
                if (l < 0 || guard > 64) {
                    ok = false;
                    break;
                }
                a = theta[t] + Math.round((a - theta[t]) / HALF_PI) * HALF_PI;
            }
            if (!ok) continue;
            const wEnd = tris[t][(l + 1) % 3];
            const tin = Math.atan2(verts[v][1] - verts[wStart][1], verts[v][0] - verts[wStart][0]);
            const tout = Math.atan2(verts[wEnd][1] - verts[v][1], verts[wEnd][0] - verts[v][0]);
            const tau = Math.atan2(Math.sin(tout - tin), Math.cos(tout - tin));
            const index = Math.round(((a - a0) - tau) / HALF_PI);
            if (index !== 0) out.push({ x: verts[v][0], y: verts[v][1], vertex: v, index });
        }
        return out;
    }

    /** Triangles around an interior vertex, in orientation order; null if the walk fails. */
    #orderedFan(v) {
        const { tris, triNb, vertTris } = this.mesh;
        if (!vertTris[v].length) return null;
        const [start, startLocal] = vertTris[v][0];
        const fan = [];
        let t = start, l = startLocal;
        do {
            fan.push(t);
            const next = triNb[t][(l + 2) % 3]; // across edge (v, next vertex of t)
            if (next < 0 || fan.length > 64) return null;
            t = next;
            l = tris[t].indexOf(v);
            if (l < 0) return null;
        } while (t !== start);
        return fan;
    }
}
