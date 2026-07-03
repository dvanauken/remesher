import { Shapes } from '../model/Shapes.js';
import { DomainMesh } from '../model/DomainMesh.js';
import { CrossField } from '../model/CrossField.js';
import { Parameterization } from '../model/Parameterization.js';
import { IsoContours } from '../model/IsoContours.js';
import { Viewport } from './Viewport.js';
import { SceneRenderer } from './SceneRenderer.js';
import { DrawGuideTool } from './DrawGuideTool.js';

const MESH_EDGE = 10;
const DOMAIN_RADIUS = 200;

/** Composition root: owns the pipeline state, UI bindings, and the render loop. */
export class App {
    constructor(root) {
        this.canvas = root.querySelector('canvas');
        this.ctx = this.canvas.getContext('2d');
        this.viewport = new Viewport();
        this.renderer = new SceneRenderer();
        this.tool = new DrawGuideTool(this);
        this.size = { w: 0, h: 0, dpr: 1 };
        this.state = {
            shape: 'blob',
            spacing: 18,
            influence: 55,
            guides: [],
            show: { quads: true, field: false, tris: false, sings: true, guides: true },
            mesh: null, theta: null, alpha: null, sings: null, isoU: null, isoV: null,
        };
        this.timings = { mesh: 0, field: 0, param: 0 };
        this.dirty = true;
        this.fitted = false;
        this.pan = null;
        this.spaceHeld = false;
        this.#bindUi(root);
        this.#bindPointer();
        this.#observeResize();
        this.#recompute('mesh');
        const loop = () => {
            if (this.dirty) {
                this.dirty = false;
                this.renderer.draw(this.ctx, this.size, this.viewport, this.state, this.tool);
            }
            requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
    }

    invalidate() {
        this.dirty = true;
    }

    addGuide(guide) {
        this.state.guides.push(guide);
        this.#recompute('field');
    }

    removeGuideNear([x, y], tol) {
        let best = -1, bestD = tol;
        this.state.guides.forEach((g, i) => {
            const d = g.distanceTo(x, y);
            if (d < bestD) {
                bestD = d;
                best = i;
            }
        });
        if (best >= 0) {
            this.state.guides.splice(best, 1);
            this.#recompute('field');
        }
    }

    /** Rerun the pipeline from the given stage down: mesh > field > param. */
    #recompute(level) {
        const s = this.state;
        if (level === 'mesh') {
            const t0 = performance.now();
            const shape = Shapes.catalog().find(c => c.id === s.shape);
            s.mesh = new DomainMesh(shape.build(0, 0, DOMAIN_RADIUS), MESH_EDGE);
            this.field = new CrossField(s.mesh);
            this.param = new Parameterization(s.mesh);
            this.timings.mesh = performance.now() - t0;
        }
        if (level === 'mesh' || level === 'field') {
            const t0 = performance.now();
            s.theta = this.field.solve(s.guides, s.influence);
            s.alpha = this.field.comb(s.theta);
            s.sings = this.field.singularities(s.theta);
            this.timings.field = performance.now() - t0;
        }
        const t0 = performance.now();
        const { u, v } = this.param.solve(s.alpha, s.spacing);
        s.isoU = IsoContours.extract(s.mesh, u);
        s.isoV = IsoContours.extract(s.mesh, v);
        this.timings.param = performance.now() - t0;
        this.#status();
        this.invalidate();
    }

    #status() {
        const s = this.state;
        const el = document.getElementById('status');
        el.value = `${s.mesh.verts.length} verts · ${s.mesh.tris.length} tris · `
            + `${s.guides.length} guide${s.guides.length === 1 ? '' : 's'} · `
            + `${s.sings.length} irregular · `
            + `field ${this.timings.field.toFixed(0)} ms · param ${this.timings.param.toFixed(0)} ms`;
    }

    #bindUi(root) {
        const shapeSel = root.querySelector('#shape');
        for (const c of Shapes.catalog()) {
            shapeSel.add(new Option(c.label, c.id));
        }
        shapeSel.addEventListener('change', () => {
            this.state.shape = shapeSel.value;
            this.state.guides = [];
            this.fitted = false;
            this.#recompute('mesh');
            this.#refit();
        });
        this.#bindRange(root, '#spacing', v => {
            this.state.spacing = v;
            this.#recompute('param');
        });
        this.#bindRange(root, '#influence', v => {
            this.state.influence = v;
            this.#recompute('field');
        });
        for (const key of Object.keys(this.state.show)) {
            const box = root.querySelector(`#show-${key}`);
            box.checked = this.state.show[key];
            box.addEventListener('change', () => {
                this.state.show[key] = box.checked;
                this.invalidate();
            });
        }
        root.querySelector('#clear-guides').addEventListener('click', () => {
            if (!this.state.guides.length) return;
            this.state.guides = [];
            this.#recompute('field');
        });
    }

    #bindRange(root, sel, apply) {
        const input = root.querySelector(sel);
        const out = input.parentElement.querySelector('output');
        let timer = 0;
        input.addEventListener('input', () => {
            out.value = input.value;
            clearTimeout(timer);
            timer = setTimeout(() => apply(Number(input.value)), 120);
        });
    }

    #bindPointer() {
        const c = this.canvas;
        c.addEventListener('contextmenu', ev => ev.preventDefault());
        c.addEventListener('pointerdown', ev => {
            c.setPointerCapture(ev.pointerId);
            if (ev.button === 1 || (ev.button === 0 && this.spaceHeld)) {
                this.pan = [ev.clientX, ev.clientY];
                return;
            }
            this.tool.onPointerDown(ev, this.#world(ev));
        });
        c.addEventListener('pointermove', ev => {
            if (this.pan) {
                this.viewport.panBy(ev.clientX - this.pan[0], ev.clientY - this.pan[1]);
                this.pan = [ev.clientX, ev.clientY];
                this.invalidate();
                return;
            }
            this.tool.onPointerMove(ev, this.#world(ev));
        });
        c.addEventListener('pointerup', ev => {
            if (this.pan) {
                this.pan = null;
                return;
            }
            this.tool.onPointerUp(ev, this.#world(ev));
        });
        c.addEventListener('pointercancel', () => {
            this.pan = null;
            this.tool.onCancel();
        });
        c.addEventListener('wheel', ev => {
            ev.preventDefault();
            const rect = c.getBoundingClientRect();
            this.viewport.zoomAt(ev.clientX - rect.left, ev.clientY - rect.top, ev.deltaY < 0 ? 1.15 : 1 / 1.15);
            this.invalidate();
        }, { passive: false });
        window.addEventListener('keydown', ev => {
            if (ev.key === ' ' && ev.target === document.body) {
                this.spaceHeld = true;
                ev.preventDefault();
            }
            if (ev.key === 'Escape') this.tool.onCancel();
        });
        window.addEventListener('keyup', ev => {
            if (ev.key === ' ') this.spaceHeld = false;
        });
    }

    #world(ev) {
        const rect = this.canvas.getBoundingClientRect();
        return this.viewport.toWorld(ev.clientX - rect.left, ev.clientY - rect.top);
    }

    #observeResize() {
        const main = this.canvas.parentElement;
        const ro = new ResizeObserver(() => {
            const dpr = window.devicePixelRatio || 1;
            this.size = { w: main.clientWidth, h: main.clientHeight, dpr };
            this.canvas.width = Math.max(1, Math.round(this.size.w * dpr));
            this.canvas.height = Math.max(1, Math.round(this.size.h * dpr));
            if (!this.fitted) this.#refit();
            this.invalidate();
        });
        ro.observe(main);
    }

    #refit() {
        if (!this.state.mesh || !this.size.w) return;
        this.viewport.fit(this.state.mesh.bbox, this.size.w, this.size.h);
        this.fitted = true;
        this.invalidate();
    }
}
