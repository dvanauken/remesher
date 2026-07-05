/**
 * Explicit topology of a combed cross field: integer quarter-turn matchings on
 * interior dual edges, singularity indices computed from matching cycles, and
 * the seam graph left behind by combing. This is the data model MIQ-style
 * seamless parameterization needs — matchings and seams as first-class objects
 * rather than facts implicit in combed angles.
 */
export class FieldTopology {
    /**
     * @param {DomainMesh} mesh
     * @param {Float64Array} theta  raw per-triangle field angle in (-PI/4, PI/4]
     * @param {Float64Array} alpha  combed per-triangle angle (theta + k * PI/2)
     */
    constructor(mesh, theta, alpha) {
        this.mesh = mesh;
        const HALF_PI = Math.PI / 2;
        const { tris, triNb } = mesh;
        /**
         * Interior dual edges. `match` is the quarter-turn branch matching
         * ta -> tb of the raw field; `seam` is the residual matching of the
         * combed field — nonzero means combing could not cancel the jump here.
         * (a, b) are the shared primal edge's vertex indices.
         */
        this.edges = [];
        this.matchByPair = new Map(); // 'ta_tb' (ta < tb) -> match
        for (let ti = 0; ti < tris.length; ti++) {
            for (let e = 0; e < 3; e++) {
                const nb = triNb[ti][e];
                if (nb <= ti) continue; // interior edges once, ta < tb
                const edge = {
                    ta: ti,
                    tb: nb,
                    a: tris[ti][(e + 1) % 3],
                    b: tris[ti][(e + 2) % 3],
                    match: Math.round((theta[ti] - theta[nb]) / HALF_PI),
                    seam: Math.round((alpha[ti] - alpha[nb]) / HALF_PI),
                };
                this.edges.push(edge);
                this.matchByPair.set(ti + '_' + nb, edge.match);
            }
        }
        this.seams = this.edges.filter(e => e.seam !== 0);
        this.singularities = this.#singularitiesFromMatchings();
    }

    /**
     * Quarter-turn index of the field at an interior vertex: the signed sum of
     * matchings around its ordered triangle fan. 0 for regular vertices;
     * +1 -> valence-3 and -1 -> valence-5 extraordinary quad vertices.
     * Returns 0 for boundary vertices and open fans (no cycle to sum).
     */
    indexAt(v) {
        const fan = this.#orderedFan(v);
        if (!fan) return 0;
        let sum = 0;
        for (let i = 0; i < fan.length; i++) {
            sum += this.#matching(fan[i], fan[(i + 1) % fan.length]);
        }
        return sum;
    }

    /**
     * Seam edges whose shared primal edge touches vertex v. Seams must
     * terminate at singular vertices or the boundary — a regular interior
     * vertex with exactly one incident seam edge is a topology bug.
     */
    seamsAt(v) {
        return this.seams.filter(e => e.a === v || e.b === v);
    }

    #singularitiesFromMatchings() {
        const { verts, boundaryVert } = this.mesh;
        const out = [];
        for (let v = 0; v < verts.length; v++) {
            if (boundaryVert[v]) continue;
            const index = this.indexAt(v);
            if (index !== 0) out.push({ x: verts[v][0], y: verts[v][1], vertex: v, index });
        }
        return out;
    }

    /** Signed matching across the dual edge from triangle ta to tb. */
    #matching(ta, tb) {
        const m = this.matchByPair.get(ta < tb ? ta + '_' + tb : tb + '_' + ta);
        return ta < tb ? m : -m;
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
            const next = triNb[t][(l + 2) % 3];
            if (next < 0 || fan.length > 64) return null;
            t = next;
            l = tris[t].indexOf(v);
            if (l < 0) return null;
        } while (t !== start);
        return fan;
    }
}
