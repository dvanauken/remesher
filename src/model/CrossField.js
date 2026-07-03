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

    /** Pick a globally consistent branch of the 4-fold field via BFS (combing). */
    comb(theta) {
        const { triNb } = this.mesh;
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
                for (const nb of triNb[t]) {
                    if (nb < 0 || seen[nb]) continue;
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
     * Irregular vertices of the field: interior vertices where branch matchings
     * around the one-ring do not cancel. These become the extraordinary (non-valence-4)
     * vertices of the quad mesh.
     * @returns {{x:number, y:number, index:number}[]}
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
            if (sum !== 0) out.push({ x: verts[v][0], y: verts[v][1], index: sum });
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
