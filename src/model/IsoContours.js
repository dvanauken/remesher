/** Integer-level iso-contours of a per-vertex scalar over the triangulation (marching triangles). */
export class IsoContours {
    /**
     * @param {DomainMesh} mesh
     * @param {Float64Array} f  per-vertex scalar
     * @returns {number[][]} segments [x1, y1, x2, y2]
     */
    static extract(mesh, f) {
        const { verts, tris } = mesh;
        const segs = [];
        for (const t of tris) {
            const fa = f[t[0]], fb = f[t[1]], fc = f[t[2]];
            const lo = Math.ceil(Math.min(fa, fb, fc));
            const hi = Math.floor(Math.max(fa, fb, fc));
            if (hi - lo > 200) continue; // degenerate solve guard
            for (let c = lo; c <= hi; c++) {
                const lvl = c + 1e-7; // nudge off exact vertex hits
                const hits = [];
                for (let e = 0; e < 3; e++) {
                    const i = t[e], j = t[(e + 1) % 3];
                    const fi = f[i] - lvl, fj = f[j] - lvl;
                    if ((fi > 0) !== (fj > 0)) {
                        const s = fi / (fi - fj);
                        hits.push([
                            verts[i][0] + s * (verts[j][0] - verts[i][0]),
                            verts[i][1] + s * (verts[j][1] - verts[i][1]),
                        ]);
                    }
                }
                if (hits.length === 2) segs.push([hits[0][0], hits[0][1], hits[1][0], hits[1][1]]);
            }
        }
        return segs;
    }
}
