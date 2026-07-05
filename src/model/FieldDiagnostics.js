/**
 * Integrability diagnostics for the field-guided pipeline. Both measures are
 * dimensionless (relative to the target gradient magnitude 1/spacing):
 *
 * - curl: pre-solve predictor. A face-constant target field is integrable only
 *   if its tangential component is continuous across edges; the branch-matched
 *   jump concentrated on interior edges estimates how much the Poisson fit
 *   will be forced to compromise.
 * - drift: post-solve measurement. ||grad u - target_u|| + ||grad v - target_v||
 *   per triangle — where the fitted parameterization actually deviates.
 *
 * High values predict/explain spacing drift, guide conflicts, and quad
 * extraction losses.
 */
export class FieldDiagnostics {
    /**
     * Per-triangle curl residual of the cross field's target gradients.
     * Uses the raw angles with per-edge branch matching, so seams introduced
     * by combing do not read as curl.
     * @param {DomainMesh} mesh
     * @param {Float64Array} theta  raw per-triangle angle in (-PI/4, PI/4]
     * @returns {Float64Array} per-triangle residual, 0 = locally integrable
     */
    static curl(mesh, theta) {
        const HALF_PI = Math.PI / 2;
        const { tris, triNb, verts, areas } = mesh;
        const nt = tris.length;
        const out = new Float64Array(nt);
        for (let ti = 0; ti < nt; ti++) {
            for (let e = 0; e < 3; e++) {
                const nb = triNb[ti][e];
                if (nb <= ti) continue; // each interior edge once
                // branch of nb's cross closest to ti's representative
                const k = Math.round((theta[ti] - theta[nb]) / HALF_PI);
                const bAngle = theta[nb] + k * HALF_PI;
                // jump of the (unit) u-target across the edge
                const jx = Math.cos(theta[ti]) - Math.cos(bAngle);
                const jy = Math.sin(theta[ti]) - Math.sin(bAngle);
                const a = tris[ti][(e + 1) % 3], b = tris[ti][(e + 2) % 3];
                const ex = verts[b][0] - verts[a][0];
                const ey = verts[b][1] - verts[a][1];
                const len = Math.hypot(ex, ey) || 1;
                // |tangential| + |normal| jump covers both u and v targets
                // (the v-jump is the u-jump rotated 90 degrees)
                const jump = (Math.abs(jx * ex + jy * ey) + Math.abs(jx * ey - jy * ex)) / len;
                const w = jump * len;
                out[ti] += w / (2 * areas[ti]);
                out[nb] += w / (2 * areas[nb]);
            }
        }
        // scale by local edge length so the number is per-quad-step, not per-unit
        for (let ti = 0; ti < nt; ti++) out[ti] *= mesh.h;
        return out;
    }

    /**
     * Per-triangle deviation of the fitted parameterization from its target
     * gradients, in units of the target magnitude (0 = exact, 1 = off by a
     * whole grid step per step).
     * @param {DomainMesh} mesh
     * @param {number[][][]} grads  per-triangle hat-function gradients (Parameterization.grads)
     * @param {Float64Array} alpha  combed per-triangle angle
     * @param {number} spacing  target quad edge length
     * @param {Float64Array} u  per-vertex, or per-corner (length 3*tris) with corner=true
     * @param {Float64Array} v
     * @param {boolean} [corner]
     * @returns {Float64Array}
     */
    static drift(mesh, grads, alpha, spacing, u, v, corner = false) {
        const nt = mesh.tris.length;
        const out = new Float64Array(nt);
        for (let ti = 0; ti < nt; ti++) {
            const t = mesh.tris[ti], g = grads[ti];
            let gux = 0, guy = 0, gvx = 0, gvy = 0;
            for (let e = 0; e < 3; e++) {
                const ue = corner ? u[ti * 3 + e] : u[t[e]];
                const ve = corner ? v[ti * 3 + e] : v[t[e]];
                gux += ue * g[e][0];
                guy += ue * g[e][1];
                gvx += ve * g[e][0];
                gvy += ve * g[e][1];
            }
            const c = Math.cos(alpha[ti]) / spacing;
            const s = Math.sin(alpha[ti]) / spacing;
            out[ti] = (Math.hypot(gux - c, guy - s) + Math.hypot(gvx + s, gvy - c)) * spacing;
        }
        return out;
    }

    /** Summary stats for a per-triangle diagnostic, area-weighted mean. */
    static summarize(mesh, values) {
        let max = 0, sum = 0, areaSum = 0;
        for (let ti = 0; ti < values.length; ti++) {
            if (values[ti] > max) max = values[ti];
            sum += values[ti] * mesh.areas[ti];
            areaSum += mesh.areas[ti];
        }
        return { max, mean: areaSum ? sum / areaSum : 0 };
    }
}
