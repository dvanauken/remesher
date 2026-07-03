import { GuideCurve } from '../model/GuideCurve.js';

/** Freehand guide-stroke tool: left-drag draws a guide, right-click deletes the nearest one. */
export class DrawGuideTool {
    constructor(app) {
        this.app = app;
        this.stroke = null;
    }

    onPointerDown(ev, world) {
        if (ev.button === 2) {
            this.app.removeGuideNear(world, this.app.viewport.px(8));
            return;
        }
        if (ev.button === 0) this.stroke = [world];
    }

    onPointerMove(ev, world) {
        if (!this.stroke) return;
        const [lx, ly] = this.stroke[this.stroke.length - 1];
        if (Math.hypot(world[0] - lx, world[1] - ly) > this.app.viewport.px(2)) {
            this.stroke.push(world);
            this.app.invalidate();
        }
    }

    onPointerUp() {
        if (!this.stroke) return;
        const guide = GuideCurve.fromStroke(this.stroke, this.app.viewport.px(2));
        this.stroke = null;
        if (guide.length > this.app.mesh.h * 2) this.app.addGuide(guide);
        else this.app.invalidate();
    }

    onCancel() {
        this.stroke = null;
        this.app.invalidate();
    }

    preview(ctx, viewport) {
        if (!this.stroke || this.stroke.length < 2) return;
        ctx.strokeStyle = '#0969da';
        ctx.lineWidth = viewport.px(1.5);
        ctx.setLineDash([viewport.px(5), viewport.px(4)]);
        ctx.beginPath();
        this.stroke.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.stroke();
        ctx.setLineDash([]);
    }
}
