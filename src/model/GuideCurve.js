/** User-drawn influence stroke: a smoothed polyline with distance and tangent queries. */
export class GuideCurve {
    /** @param {number[][]} points  [[x,y], ...] */
    constructor(points) {
        this.controlPoints = points.slice();
        this.points = GuideCurve.#smoothPolyline(points);
    }

    /** Build from a raw pointer stroke: simplify noise, then fit a smooth sampled curve. */
    static fromStroke(raw, tolerance) {
        return new GuideCurve(GuideCurve.#rdp(raw, tolerance));
    }

    get length() {
        let l = 0;
        for (let i = 1; i < this.points.length; i++) {
            l += Math.hypot(
                this.points[i][0] - this.points[i - 1][0],
                this.points[i][1] - this.points[i - 1][1],
            );
        }
        return l;
    }

    distanceTo(x, y) {
        return this.#closestSegment(x, y).dist;
    }

    /** Distance to the curve and locally averaged tangent angle. */
    tangentNear(x, y) {
        const c = this.#closestSegment(x, y);
        const lo = Math.max(0, c.seg - 2);
        const hi = Math.min(this.points.length - 2, c.seg + 2);
        let tx = 0, ty = 0;
        for (let i = lo; i <= hi; i++) {
            const [ax, ay] = this.points[i], [bx, by] = this.points[i + 1];
            const dx = bx - ax, dy = by - ay;
            const len = Math.hypot(dx, dy);
            if (len > 1e-9) {
                const w = 1 / (1 + Math.abs(i - c.seg));
                tx += w * dx / len;
                ty += w * dy / len;
            }
        }
        return { dist: c.dist, angle: Math.atan2(ty, tx) };
    }

    #closestSegment(x, y) {
        let dist = Infinity, seg = 0;
        for (let i = 0; i < this.points.length - 1; i++) {
            const [ax, ay] = this.points[i], [bx, by] = this.points[i + 1];
            const dx = bx - ax, dy = by - ay;
            const len2 = dx * dx + dy * dy || 1;
            const s = Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / len2));
            const d = Math.hypot(x - ax - s * dx, y - ay - s * dy);
            if (d < dist) {
                dist = d;
                seg = i;
            }
        }
        return { dist, seg };
    }

    static #smoothPolyline(pts) {
        if (pts.length < 3) return pts.slice();
        const out = [];
        const spacing = Math.max(2, GuideCurve.#length(pts) / Math.max(12, pts.length * 3));
        const samplesPerSegment = pts.map((p, i) => {
            if (i === pts.length - 1) return 1;
            const q = pts[i + 1];
            return Math.max(2, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / spacing));
        });
        for (let i = 0; i < pts.length - 1; i++) {
            const p0 = pts[Math.max(0, i - 1)];
            const p1 = pts[i];
            const p2 = pts[i + 1];
            const p3 = pts[Math.min(pts.length - 1, i + 2)];
            const steps = samplesPerSegment[i];
            for (let s = 0; s < steps; s++) {
                if (i > 0 || s > 0) out.push(GuideCurve.#catmull(p0, p1, p2, p3, s / steps));
                else out.push(p1);
            }
        }
        out.push(pts[pts.length - 1]);
        return GuideCurve.#chaikin(out, 2);
    }

    static #catmull(p0, p1, p2, p3, t) {
        const t2 = t * t, t3 = t2 * t;
        return [
            0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
            0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
        ];
    }

    static #chaikin(pts, iterations) {
        let out = pts;
        for (let it = 0; it < iterations; it++) {
            if (out.length < 3) return out;
            const next = [out[0]];
            for (let i = 0; i < out.length - 1; i++) {
                const [ax, ay] = out[i], [bx, by] = out[i + 1];
                next.push([0.75 * ax + 0.25 * bx, 0.75 * ay + 0.25 * by]);
                next.push([0.25 * ax + 0.75 * bx, 0.25 * ay + 0.75 * by]);
            }
            next.push(out[out.length - 1]);
            out = next;
        }
        return out;
    }

    static #length(pts) {
        let l = 0;
        for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
        return l;
    }

    static #rdp(pts, eps) {
        if (pts.length < 3) return pts.slice();
        const keep = new Uint8Array(pts.length);
        keep[0] = keep[pts.length - 1] = 1;
        const stack = [[0, pts.length - 1]];
        while (stack.length) {
            const [i0, i1] = stack.pop();
            const [ax, ay] = pts[i0], [bx, by] = pts[i1];
            const dx = bx - ax, dy = by - ay;
            const len = Math.hypot(dx, dy) || 1;
            let worst = -1, worstD = eps;
            for (let i = i0 + 1; i < i1; i++) {
                const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / len;
                if (d > worstD) {
                    worstD = d;
                    worst = i;
                }
            }
            if (worst > 0) {
                keep[worst] = 1;
                stack.push([i0, worst], [worst, i1]);
            }
        }
        return pts.filter((_, i) => keep[i]);
    }
}
