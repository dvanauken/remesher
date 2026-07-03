/**
 * Field-aligned parameterization: two least-squares Poisson solves fit scalar
 * functions u, v whose gradients follow the combed cross field. Integer
 * iso-contours of u and v trace the quad layout (spacing = quad edge length).
 */
export class Parameterization {
    constructor(mesh) {
        this.mesh = mesh;
        const { verts, tris, areas } = mesh;
        const nv = verts.length;
        this.grads = []; // per triangle: hat-function gradients [[gx,gy] x3]
        const rows = Array.from({ length: nv }, () => new Map());
        tris.forEach((t, ti) => {
            const A = areas[ti];
            const g = [];
            for (let e = 0; e < 3; e++) {
                const [jx, jy] = verts[t[(e + 1) % 3]];
                const [kx, ky] = verts[t[(e + 2) % 3]];
                g.push([-(ky - jy) / (2 * A), (kx - jx) / (2 * A)]);
            }
            this.grads.push(g);
            for (let a = 0; a < 3; a++) {
                for (let b = 0; b < 3; b++) {
                    const val = A * (g[a][0] * g[b][0] + g[a][1] * g[b][1]);
                    const row = rows[t[a]];
                    row.set(t[b], (row.get(t[b]) || 0) + val);
                }
            }
        });
        // pin vertex 0 to kill the constant null space (symmetric diagonal shift)
        rows[0].set(0, (rows[0].get(0) || 1) * 1e6);
        this.cols = [];
        this.vals = [];
        this.diag = new Float64Array(nv);
        for (let i = 0; i < nv; i++) {
            this.cols.push([...rows[i].keys()]);
            this.vals.push([...rows[i].values()]);
            this.diag[i] = rows[i].get(i) || 1;
        }
    }

    /**
     * @param {Float64Array} alpha  combed per-triangle field angle
     * @param {number} spacing  target quad edge length
     * @returns {{u: Float64Array, v: Float64Array}}
     */
    solve(alpha, spacing) {
        const { tris, areas } = this.mesh;
        const nv = this.mesh.verts.length;
        const bu = new Float64Array(nv);
        const bv = new Float64Array(nv);
        tris.forEach((t, ti) => {
            const A = areas[ti];
            const c = Math.cos(alpha[ti]) / spacing;
            const s = Math.sin(alpha[ti]) / spacing;
            const g = this.grads[ti];
            for (let e = 0; e < 3; e++) {
                bu[t[e]] += A * (g[e][0] * c + g[e][1] * s);
                bv[t[e]] += A * (-g[e][0] * s + g[e][1] * c);
            }
        });
        return { u: this.#cg(bu), v: this.#cg(bv) };
    }

    /** Jacobi-preconditioned conjugate gradient on the prebuilt stiffness matrix. */
    #cg(b) {
        const n = b.length;
        const { cols, vals, diag } = this;
        const x = new Float64Array(n);
        const r = Float64Array.from(b);
        const z = new Float64Array(n);
        const p = new Float64Array(n);
        const Ap = new Float64Array(n);
        const dot = (a, c) => {
            let s = 0;
            for (let i = 0; i < n; i++) s += a[i] * c[i];
            return s;
        };
        for (let i = 0; i < n; i++) p[i] = z[i] = r[i] / diag[i];
        let rz = dot(r, z);
        const b2 = dot(b, b) || 1;
        for (let it = 0; it < 1000; it++) {
            for (let i = 0; i < n; i++) {
                const ci = cols[i], vi = vals[i];
                let s = 0;
                for (let k = 0; k < ci.length; k++) s += vi[k] * p[ci[k]];
                Ap[i] = s;
            }
            const a = rz / (dot(p, Ap) || 1e-300);
            for (let i = 0; i < n; i++) {
                x[i] += a * p[i];
                r[i] -= a * Ap[i];
            }
            if (dot(r, r) < 1e-16 * b2) break;
            for (let i = 0; i < n; i++) z[i] = r[i] / diag[i];
            const rz2 = dot(r, z);
            const beta = rz2 / rz;
            rz = rz2;
            for (let i = 0; i < n; i++) p[i] = z[i] + beta * p[i];
        }
        return x;
    }
}
