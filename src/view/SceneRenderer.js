/** Draws domain, triangulation, cross field, quad contours, singularities, and guides. */
export class SceneRenderer {
    /**
     * @param {CanvasRenderingContext2D} ctx
     * @param {{w: number, h: number, dpr: number}} size
     * @param {Viewport} viewport
     * @param {object} state  app display state (mesh, contours, guides, show flags)
     * @param {DrawGuideTool} activeTool
     */
    draw(ctx, size, viewport, state, activeTool) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, size.w * size.dpr, size.h * size.dpr);
        viewport.apply(ctx, size.dpr);
        const { mesh, show } = state;
        if (!mesh) return;

        ctx.fillStyle = '#f6f6f6';
        this.#ringPath(ctx, mesh.ring);
        ctx.fill();

        if (show.tris) {
            ctx.strokeStyle = '#e2e2e2';
            ctx.lineWidth = viewport.px(0.6);
            ctx.beginPath();
            for (const [a, b] of mesh.edges) {
                ctx.moveTo(mesh.verts[a][0], mesh.verts[a][1]);
                ctx.lineTo(mesh.verts[b][0], mesh.verts[b][1]);
            }
            ctx.stroke();
        }

        if (show.field && state.theta) {
            ctx.strokeStyle = '#c4c4c4';
            ctx.lineWidth = viewport.px(0.8);
            const r = mesh.h * 0.32;
            ctx.beginPath();
            for (let t = 0; t < mesh.tris.length; t++) {
                const [cx, cy] = mesh.centroids[t];
                const a = state.theta[t];
                const dx = Math.cos(a) * r, dy = Math.sin(a) * r;
                ctx.moveTo(cx - dx, cy - dy);
                ctx.lineTo(cx + dx, cy + dy);
                ctx.moveTo(cx + dy, cy - dx);
                ctx.lineTo(cx - dy, cy + dx);
            }
            ctx.stroke();
        }

        if (show.quads && state.isoU) {
            ctx.strokeStyle = '#3c3c3c';
            ctx.lineWidth = viewport.px(0.8);
            ctx.beginPath();
            for (const s of state.isoU) {
                ctx.moveTo(s[0], s[1]);
                ctx.lineTo(s[2], s[3]);
            }
            for (const s of state.isoV) {
                ctx.moveTo(s[0], s[1]);
                ctx.lineTo(s[2], s[3]);
            }
            ctx.stroke();
        }

        ctx.strokeStyle = '#2a2a2a';
        ctx.lineWidth = viewport.px(1.25);
        this.#ringPath(ctx, mesh.ring);
        ctx.stroke();

        if (show.sings && state.sings) {
            for (const s of state.sings) {
                ctx.fillStyle = s.index > 0 ? '#d24545' : '#3b6fd4';
                ctx.beginPath();
                ctx.arc(s.x, s.y, viewport.px(3), 0, Math.PI * 2);
                ctx.fill();
            }
        }

        if (show.guides) {
            ctx.strokeStyle = '#0969da';
            ctx.lineWidth = viewport.px(2);
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            for (const g of state.guides) {
                ctx.beginPath();
                g.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
                ctx.stroke();
            }
            ctx.lineCap = 'butt';
        }

        if (activeTool) activeTool.preview(ctx, viewport);
    }

    #ringPath(ctx, ring) {
        ctx.beginPath();
        ring.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
    }
}
