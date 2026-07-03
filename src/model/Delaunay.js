/** Bowyer-Watson incremental Delaunay triangulation. */
export class Delaunay {
    /**
     * @param {number[][]} points  [[x,y], ...]
     * @returns {number[][]} triangles as CCW index triples into points
     */
    static triangulate(points) {
        const n = points.length;
        if (n < 3) return [];
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const [x, y] of points) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }
        const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
        const d = Math.max(maxX - minX, maxY - minY, 1) * 64;
        const verts = points.concat([[cx - d, cy - d * 0.6], [cx + d, cy - d * 0.6], [cx, cy + d]]);
        let tris = [Delaunay.#ccw(verts, [n, n + 1, n + 2])];
        for (let p = 0; p < n; p++) {
            const keep = [];
            const bad = [];
            for (const t of tris) (Delaunay.#inCircum(verts, t, p) ? bad : keep).push(t);
            const edges = new Map(); // undirected key -> directed edge, null once shared
            for (const t of bad) {
                for (let e = 0; e < 3; e++) {
                    const a = t[e], b = t[(e + 1) % 3];
                    const key = a < b ? a + '_' + b : b + '_' + a;
                    edges.set(key, edges.has(key) ? null : [a, b]);
                }
            }
            for (const dir of edges.values()) {
                if (dir) keep.push(Delaunay.#ccw(verts, [dir[0], dir[1], p]));
            }
            tris = keep;
        }
        return tris.filter(t => t[0] < n && t[1] < n && t[2] < n);
    }

    static #ccw(verts, t) {
        const [ax, ay] = verts[t[0]], [bx, by] = verts[t[1]], [cx, cy] = verts[t[2]];
        return (bx - ax) * (cy - ay) - (cx - ax) * (by - ay) >= 0 ? t : [t[0], t[2], t[1]];
    }

    static #inCircum(verts, t, p) {
        const [px, py] = verts[p];
        const ax = verts[t[0]][0] - px, ay = verts[t[0]][1] - py;
        const bx = verts[t[1]][0] - px, by = verts[t[1]][1] - py;
        const cx = verts[t[2]][0] - px, cy = verts[t[2]][1] - py;
        const a2 = ax * ax + ay * ay, b2 = bx * bx + by * by, c2 = cx * cx + cy * cy;
        return ax * (by * c2 - b2 * cy) - ay * (bx * c2 - b2 * cx) + a2 * (bx * cy - by * cx) > 0;
    }
}
