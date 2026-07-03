/** Boundary polygon factories for the demo domains. */
export class Shapes {
    static blob(cx, cy, r) {
        const ring = [];
        const n = 220;
        for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2;
            const k = 1
                + 0.16 * Math.cos(2 * a + 0.8)
                + 0.10 * Math.cos(3 * a + 2.2)
                + 0.05 * Math.cos(5 * a + 4.1);
            ring.push([cx + r * k * Math.cos(a), cy + r * k * Math.sin(a)]);
        }
        return ring;
    }

    static disc(cx, cy, r) {
        const ring = [];
        const n = 180;
        for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2;
            ring.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
        }
        return ring;
    }

    static plate(cx, cy, r) {
        const s = r * 1.6;
        return [
            [cx - s / 2, cy - s / 2],
            [cx + s / 2, cy - s / 2],
            [cx + s / 2, cy],
            [cx, cy],
            [cx, cy + s / 2],
            [cx - s / 2, cy + s / 2],
        ];
    }

    /** @returns {{id: string, label: string, build: (cx, cy, r) => number[][]}[]} */
    static catalog() {
        return [
            { id: 'blob', label: 'Blob', build: Shapes.blob },
            { id: 'disc', label: 'Disc', build: Shapes.disc },
            { id: 'plate', label: 'L-plate', build: Shapes.plate },
        ];
    }
}
