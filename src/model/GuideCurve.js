/** User-drawn influence stroke: a simplified polyline with distance and tangent queries. */
export class GuideCurve {
    /** @param {number[][]} points  [[x,y], ...] */
    constructor(points) {
        this.points = points;
    }

    /** Build from a raw pointer stroke: Ramer-Douglas-Peucker simplification. */
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

    /** Distance to the curve and tangent angle of its closest segment. */
    tangentNear(x, y) {
        const c = this.#closestSegment(x, y);
        const [ax, ay] = this.points[c.seg];
        const [bx, by] = this.points[c.seg + 1];
        return { dist: c.dist, angle: Math.atan2(by - ay, bx - ax) };
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
