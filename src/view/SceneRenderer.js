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

        if (show.drift && state.drift) {
            this.#drawDrift(ctx, mesh, state.drift);
        }

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

        if (show.quads && state.quadMesh?.quads.length) {
            ctx.strokeStyle = state.quadMesh.validation.isValid ? '#3c3c3c' : '#9b4d2f';
            ctx.lineWidth = viewport.px(0.8);
            ctx.beginPath();
            for (const q of state.quadMesh.quads) {
                const p0 = state.quadMesh.verts[q[0]];
                ctx.moveTo(p0[0], p0[1]);
                for (let i = 1; i < 4; i++) {
                    const p = state.quadMesh.verts[q[i]];
                    ctx.lineTo(p[0], p[1]);
                }
                ctx.closePath();
            }
            ctx.stroke();
        } else if (show.quads && state.isoU) {
            ctx.strokeStyle = '#8a8a8a';
            ctx.lineWidth = viewport.px(0.65);
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

        if (show.skipped && state.quadMesh?.stats.skippedCells.length) {
            ctx.save();
            ctx.lineWidth = viewport.px(1.1);
            for (const cell of state.quadMesh.stats.skippedCells) {
                this.#skippedStyle(ctx, cell.reason);
                this.#drawSkippedCell(ctx, viewport, cell);
            }
            ctx.restore();
        }

        if (show.valence && state.quadMesh?.validation.irregularVertices.length) {
            ctx.save();
            this.#drawValences(ctx, viewport, state.quadMesh.validation.irregularVertices);
            if (state.topologyMatch) this.#drawTopologyMatch(ctx, viewport, state.topologyMatch);
            ctx.restore();
        }

        if (show.seams && state.topology?.seams.length) {
            ctx.strokeStyle = '#8e24aa';
            ctx.lineWidth = viewport.px(1.6);
            ctx.beginPath();
            for (const e of state.topology.seams) {
                ctx.moveTo(mesh.verts[e.a][0], mesh.verts[e.a][1]);
                ctx.lineTo(mesh.verts[e.b][0], mesh.verts[e.b][1]);
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
        if (show.sings && state.boundSings) {
            ctx.lineWidth = viewport.px(1.6);
            for (const s of state.boundSings) {
                ctx.strokeStyle = s.index > 0 ? '#d24545' : '#3b6fd4';
                ctx.beginPath();
                ctx.arc(s.x, s.y, viewport.px(3.4), 0, Math.PI * 2);
                ctx.stroke();
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

    /** Heatmap of parameterization drift: quiet triangles stay invisible, hotspots glow red. */
    #drawDrift(ctx, mesh, drift) {
        for (let ti = 0; ti < mesh.tris.length; ti++) {
            const a = Math.min(0.65, Math.max(0, drift[ti] - 0.12) * 0.5);
            if (a < 0.02) continue;
            const t = mesh.tris[ti];
            ctx.fillStyle = `rgba(211, 47, 47, ${a.toFixed(3)})`;
            ctx.beginPath();
            ctx.moveTo(mesh.verts[t[0]][0], mesh.verts[t[0]][1]);
            ctx.lineTo(mesh.verts[t[1]][0], mesh.verts[t[1]][1]);
            ctx.lineTo(mesh.verts[t[2]][0], mesh.verts[t[2]][1]);
            ctx.closePath();
            ctx.fill();
        }
    }

    #ringPath(ctx, ring) {
        ctx.beginPath();
        ring.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
    }

    #drawSkippedCell(ctx, viewport, cell) {
        const p = cell.points;
        if (p.length >= 3) {
            ctx.beginPath();
            p.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            return;
        }
        if (p.length === 2) {
            ctx.beginPath();
            ctx.moveTo(p[0][0], p[0][1]);
            ctx.lineTo(p[1][0], p[1][1]);
            ctx.stroke();
            return;
        }
        if (p.length === 1) {
            ctx.beginPath();
            ctx.arc(p[0][0], p[0][1], viewport.px(2.5), 0, Math.PI * 2);
            ctx.fill();
        }
    }

    #skippedStyle(ctx, reason) {
        const colors = {
            missingCorners: ['rgba(255, 167, 38, 0.18)', '#c77700'],
            missingCenter: ['rgba(251, 140, 0, 0.20)', '#b45f00'],
            folded: ['rgba(211, 47, 47, 0.20)', '#b3261e'],
            degenerate: ['rgba(142, 36, 170, 0.18)', '#7b1fa2'],
            ambiguous: ['rgba(0, 137, 123, 0.18)', '#00695c'],
            inconsistent: ['rgba(84, 110, 122, 0.18)', '#455a64'],
        };
        const [fill, stroke] = colors[reason] || colors.missingCorners;
        ctx.fillStyle = fill;
        ctx.strokeStyle = stroke;
    }

    #drawValences(ctx, viewport, vertices) {
        for (const v of vertices) {
            ctx.fillStyle = this.#valenceColor(v.valence);
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = viewport.px(0.8);
            ctx.beginPath();
            ctx.arc(v.x, v.y, viewport.px(v.valence === 3 || v.valence === 5 ? 3.2 : 4), 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        }
    }

    #drawTopologyMatch(ctx, viewport, match) {
        ctx.lineWidth = viewport.px(1.2);
        for (const m of match.matches) {
            ctx.strokeStyle = '#2e7d32';
            ctx.beginPath();
            ctx.arc(m.vertex.x, m.vertex.y, viewport.px(5.5), 0, Math.PI * 2);
            ctx.stroke();
        }
        for (const m of match.missing) {
            const s = m.singularity;
            const r = viewport.px(5);
            ctx.strokeStyle = '#d32f2f';
            ctx.beginPath();
            ctx.moveTo(s.x - r, s.y - r);
            ctx.lineTo(s.x + r, s.y + r);
            ctx.moveTo(s.x + r, s.y - r);
            ctx.lineTo(s.x - r, s.y + r);
            ctx.stroke();
        }
        for (const v of match.extra) {
            ctx.strokeStyle = '#f57c00';
            ctx.beginPath();
            ctx.arc(v.x, v.y, viewport.px(6.5), 0, Math.PI * 2);
            ctx.stroke();
        }
    }

    #valenceColor(valence) {
        if (valence === 3) return '#d24545';
        if (valence === 5) return '#3b6fd4';
        return '#f57c00';
    }
}
