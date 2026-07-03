import { Delaunay } from './Delaunay.js';

/** Triangulated 2D domain bounded by a polygon ring — the substrate for field solves. */
export class DomainMesh {
    /**
     * @param {number[][]} ring  simple boundary polygon [[x,y], ...] (unclosed)
     * @param {number} h  target triangle edge length
     */
    constructor(ring, h) {
        this.h = h;
        this.ring = ring;
        const boundary = DomainMesh.#resample(ring, h);
        const pts = boundary.slice();
        DomainMesh.#seedInterior(ring, boundary, pts, h);
        const kept = Delaunay.triangulate(pts).filter(t => {
            const gx = (pts[t[0]][0] + pts[t[1]][0] + pts[t[2]][0]) / 3;
            const gy = (pts[t[0]][1] + pts[t[1]][1] + pts[t[2]][1]) / 3;
            return DomainMesh.#area(pts, t) > 1e-9 && DomainMesh.#inside(ring, gx, gy);
        });
        // compact vertex indices to the used set
        const remap = new Map();
        this.verts = [];
        this.tris = kept.map(t => t.map(i => {
            if (!remap.has(i)) {
                remap.set(i, this.verts.length);
                this.verts.push(pts[i]);
            }
            return remap.get(i);
        }));
        this.#buildAdjacency();
        this.#buildTriData();
        this.bbox = DomainMesh.#bboxOf(ring);
    }

    /** Adjacency convention: triNb[t][e] shares the edge opposite local vertex e. */
    #buildAdjacency() {
        const nt = this.tris.length;
        this.triNb = this.tris.map(() => [-1, -1, -1]);
        this.edges = [];
        const open = new Map(); // edge key -> [tri, localOppositeVertex]
        for (let ti = 0; ti < nt; ti++) {
            const t = this.tris[ti];
            for (let e = 0; e < 3; e++) {
                const a = t[(e + 1) % 3], b = t[(e + 2) % 3];
                const key = a < b ? a + '_' + b : b + '_' + a;
                const prev = open.get(key);
                if (prev) {
                    this.triNb[ti][e] = prev[0];
                    this.triNb[prev[0]][prev[1]] = ti;
                    open.delete(key);
                } else {
                    open.set(key, [ti, e]);
                    this.edges.push([a, b]);
                }
            }
        }
        this.boundaryEdges = [];
        this.boundaryVert = new Uint8Array(this.verts.length);
        this.vertTris = this.verts.map(() => []);
        for (let ti = 0; ti < nt; ti++) {
            const t = this.tris[ti];
            for (let e = 0; e < 3; e++) {
                this.vertTris[t[e]].push([ti, e]);
                if (this.triNb[ti][e] < 0) {
                    const a = t[(e + 1) % 3], b = t[(e + 2) % 3];
                    this.boundaryVert[a] = this.boundaryVert[b] = 1;
                    const [ax, ay] = this.verts[a], [bx, by] = this.verts[b];
                    this.boundaryEdges.push({ tri: ti, a, b, angle: Math.atan2(by - ay, bx - ax) });
                }
            }
        }
    }

    #buildTriData() {
        const nt = this.tris.length;
        this.areas = new Float64Array(nt);
        this.centroids = [];
        for (let ti = 0; ti < nt; ti++) {
            const t = this.tris[ti];
            this.areas[ti] = DomainMesh.#area(this.verts, t);
            this.centroids.push([
                (this.verts[t[0]][0] + this.verts[t[1]][0] + this.verts[t[2]][0]) / 3,
                (this.verts[t[0]][1] + this.verts[t[1]][1] + this.verts[t[2]][1]) / 3,
            ]);
        }
    }

    /** Sparse rings (few vertices) subdivide per edge to preserve corners; dense rings walk arc length. */
    static #resample(ring, h) {
        const out = [];
        if (ring.length <= 24) {
            for (let i = 0; i < ring.length; i++) {
                const [ax, ay] = ring[i], [bx, by] = ring[(i + 1) % ring.length];
                const len = Math.hypot(bx - ax, by - ay);
                const k = Math.max(1, Math.round(len / h));
                for (let s = 0; s < k; s++) {
                    out.push([ax + (bx - ax) * s / k, ay + (by - ay) * s / k]);
                }
            }
            return out;
        }
        let perimeter = 0;
        for (let i = 0; i < ring.length; i++) {
            const [ax, ay] = ring[i], [bx, by] = ring[(i + 1) % ring.length];
            perimeter += Math.hypot(bx - ax, by - ay);
        }
        const m = Math.max(12, Math.round(perimeter / h));
        const step = perimeter / m;
        let acc = 0, next = 0;
        for (let i = 0; i < ring.length && out.length < m; i++) {
            const [ax, ay] = ring[i], [bx, by] = ring[(i + 1) % ring.length];
            const len = Math.hypot(bx - ax, by - ay);
            while (next <= acc + len && out.length < m) {
                const s = (next - acc) / len;
                out.push([ax + (bx - ax) * s, ay + (by - ay) * s]);
                next += step;
            }
            acc += len;
        }
        return out;
    }

    static #seedInterior(ring, boundary, pts, h) {
        const box = DomainMesh.#bboxOf(ring);
        const rowH = h * 0.866;
        let row = 0;
        for (let y = box.minY + rowH * 0.7; y < box.maxY; y += rowH, row++) {
            const x0 = box.minX + (row % 2 ? h * 0.5 : 0);
            let col = 0;
            for (let x = x0; x < box.maxX; x += h, col++) {
                const px = x + (DomainMesh.#hash(row * 3 + 1, col) - 0.5) * 0.24 * h;
                const py = y + (DomainMesh.#hash(row, col * 7 + 3) - 0.5) * 0.24 * h;
                if (!DomainMesh.#inside(ring, px, py)) continue;
                if (DomainMesh.#distToRing(boundary, px, py) < 0.72 * h) continue;
                pts.push([px, py]);
            }
        }
    }

    static #hash(i, j) {
        const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
        return s - Math.floor(s);
    }

    static #inside(ring, x, y) {
        let c = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const [xi, yi] = ring[i], [xj, yj] = ring[j];
            if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
        }
        return c;
    }

    static #distToRing(boundary, x, y) {
        let best = Infinity;
        for (let i = 0; i < boundary.length; i++) {
            const [ax, ay] = boundary[i], [bx, by] = boundary[(i + 1) % boundary.length];
            const dx = bx - ax, dy = by - ay;
            const len2 = dx * dx + dy * dy || 1;
            const s = Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / len2));
            const d = Math.hypot(x - ax - s * dx, y - ay - s * dy);
            if (d < best) best = d;
        }
        return best;
    }

    static #area(verts, t) {
        const [ax, ay] = verts[t[0]], [bx, by] = verts[t[1]], [cx, cy] = verts[t[2]];
        return ((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) / 2;
    }

    static #bboxOf(ring) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const [x, y] of ring) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }
        return { minX, minY, maxX, maxY };
    }
}
