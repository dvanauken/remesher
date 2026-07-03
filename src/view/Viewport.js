/** World <-> screen affine transform with zoom/pan state and limits. */
export class Viewport {
    constructor() {
        this.scale = 1;
        this.tx = 0;
        this.ty = 0;
        this.minScale = 0.01;
        this.maxScale = 100;
    }

    fit(bbox, w, h, margin = 40) {
        const sx = (w - 2 * margin) / (bbox.maxX - bbox.minX);
        const sy = (h - 2 * margin) / (bbox.maxY - bbox.minY);
        this.scale = Math.min(sx, sy);
        this.minScale = this.scale * 0.2;
        this.maxScale = this.scale * 40;
        this.tx = w / 2 - (bbox.minX + bbox.maxX) / 2 * this.scale;
        this.ty = h / 2 - (bbox.minY + bbox.maxY) / 2 * this.scale;
    }

    toWorld(sx, sy) {
        return [(sx - this.tx) / this.scale, (sy - this.ty) / this.scale];
    }

    toScreen(x, y) {
        return [x * this.scale + this.tx, y * this.scale + this.ty];
    }

    zoomAt(sx, sy, factor) {
        const next = Math.min(this.maxScale, Math.max(this.minScale, this.scale * factor));
        const [wx, wy] = this.toWorld(sx, sy);
        this.scale = next;
        this.tx = sx - wx * next;
        this.ty = sy - wy * next;
    }

    panBy(dx, dy) {
        this.tx += dx;
        this.ty += dy;
    }

    /** Set the canvas transform so subsequent drawing happens in world units. */
    apply(ctx, dpr) {
        ctx.setTransform(dpr * this.scale, 0, 0, dpr * this.scale, dpr * this.tx, dpr * this.ty);
    }

    /** Line width in world units that renders as `px` CSS pixels. */
    px(px) {
        return px / this.scale;
    }
}
