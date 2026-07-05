# Topology Diagnostics Milestone Plan

## Summary
Build the next milestone around making topology failures visible and measurable. Save this plan at `docs/plan.md` when implementation begins. The implementation will not change the solver yet; it will expose why the current conservative `QuadMesh` extraction succeeds, skips cells, or produces irregular topology.

## Key Changes
- Add a compact topology diagnostics panel using existing `state.quadMesh.stats` and `state.quadMesh.validation`.
- Show: emitted quads, candidate cells, skipped cells, skipped reason counts, coverage %, component count, boundary edge count, validation issues, and valence histogram.
- Add one new canvas overlay toggle: **Skipped cells**.
- Extend `QuadMesh.extract()` to return enough debug geometry for skipped cells:
  - grid cell UV bounds;
  - approximate world-space corners when available;
  - skip reason: `missingCorners`, `missingCenter`, `folded`, or `degenerate`.
- Render skipped cells as a warning overlay, visually distinct from emitted quads.
- Keep current quad rendering as the primary display; old iso-contour fallback remains only when no quads are emitted.

## Interfaces And Data Flow
- Extend `quadMesh.stats` with `skippedCells = []`.
- Each skipped cell record should be:
  ```js
  {
    reason: 'missingCorners' | 'missingCenter' | 'folded' | 'degenerate',
    uv: [iu, iv],
    points: [[x, y], ...] // 0-4 available world points
  }
  ```
- Extend app state:
  ```js
  show: {
    quads: true,
    field: false,
    tris: false,
    sings: true,
    guides: true,
    skipped: false
  }
  ```
- Add a checkbox labeled `Skipped` beside existing layer toggles.
- Add a compact diagnostics element in the footer or just above it; prefer footer expansion to avoid covering the canvas.

## Test Plan
- Update `pipeline.test.js` to assert skipped-cell accounting:
  - `candidateCells === emittedCells + missingCorners + missingCenter + foldedCells + degenerateCells`.
  - `stats.skippedCells.length` equals total skipped count.
  - Constant-field disk extraction remains valid and has coverage above `0.75`.
  - Degenerate zero map reports `empty quad mesh` and emits no quads.
- Add a guided/blob scenario assertion that extraction reports finite coverage and non-empty skipped diagnostics.
- Run `npm test`.

## Assumptions
- Store the plan at `docs/plan.md`.
- Focus only on topology diagnostics and skipped-cell overlay for this milestone.
- Do not implement manual singularity placement, MIQ-lite seam constraints, or QEx-lite extraction yet.
- Keep the UI compact and workmanlike; diagnostics are for understanding failures, not for redesigning the app.
