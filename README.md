# remesher-I

A small, dependency-free demo of **guide-curve-driven quad remeshing** — the
mechanism behind guide curves in ZRemesher / 3ds Max Retopology / Maya, reduced
to 2D so every stage is visible and inspectable.

Draw a stroke across the domain and the quad grid reorganizes to flow along it.

## Run

Any static server from the repo root (ES modules don't load over `file://`):

```
npx http-server -p 8080 -c-1 .
# or VS Code Live Server
```

Open `index.html`. Tests: `npm test` (plain node, no deps).

## How it works

The pipeline is the standard field-guided remeshing stack:

1. **DomainMesh** — the region is triangulated (jittered hex seed points +
   Bowyer-Watson Delaunay) to create a substrate for the solves.
2. **CrossField** — a 4-RoSy direction field, one angle per triangle,
   represented as `e^{i4θ}` so the 90°-symmetric directions become ordinary
   vectors. Boundary edges and **guide curves** enter as soft alignment
   constraints; Gauss-Seidel smoothing propagates their influence across the
   domain. This is the guideline feature: a guide pins the field to its tangent
   nearby, and smoothing carries that orientation outward.
3. **Combing + cut graph + FieldTopology** — interior vertices where the
   branch matchings don't cancel are the field's singularities: the
   extraordinary (non-valence-4) vertices of the final quad mesh, shown as
   dots. A cut graph routes shortest paths from each singularity to the
   boundary, and BFS combing picks a consistent branch of the 4-fold field
   without crossing them — so all seams land on those short, deliberate paths
   (purple in the Seams layer) instead of wherever traversal order left them.
   `FieldTopology` stores the per-edge quarter-turn matchings and seam edges
   as explicit objects. Boundary vertices carry quarter-turn charges too —
   L-plate corners, or a singularity pushed onto the rim — shown as hollow
   dots; interior plus boundary indices always total the disk's -4.
4. **SeamlessParameterization (MIQ-lite)** — the mesh is cut along the seam
   graph (vertices split into one DOF per wedge), and `u`, `v` are fit together
   by a least-squares Poisson solve (FEM stiffness + Jacobi-preconditioned CG)
   under soft grid-automorphism transition constraints across each seam:
   `p_B = R90^s p_A + T`. Along each boundary run, the grid coordinate
   perpendicular to the field is held constant. Boundary lines and
   per-seam-curve translations `T` are then rounded to integers CoMISo-style
   (boundary first, then seams) and re-imposed — so integer grid lines
   continue coherently across seams and the domain boundary itself becomes a
   grid iso-line: the disk maps to a rectilinear UV polygon whose corners are
   the cut endpoints and boundary charges, and the mesh runs flush to the
   outline. Rounding residuals are measured and shown, not assumed away.
   (`Parameterization` keeps the plain single-chart solve for comparison.)
5. **IsoContours** — integer iso-lines of `u` and `v` remain available as a
   debug view of the layout.
6. **QuadMesh** — integer grid vertices are inverted through the piecewise
   linear parameterization (per corner, per chart). Near seams the map is
   multivalued — one integer label can name several physical grid points — so
   each world-position branch becomes its own vertex, and cells assemble
   around each physical cell center, picking the branch nearest it. Cells
   straddling a seam resolve far-side corners through the integer transitions,
   stitching the mesh across seams. Stitched and multi-branch cells are
   admitted only while every edge stays manifold and consistently oriented;
   everything skipped is counted and drawable.
7. **FieldDiagnostics** — per-triangle curl residual (pre-solve: is the target
   field locally integrable?) and parameterization drift (post-solve: where
   did the Poisson fit compromise?). Both surface as a heatmap overlay and in
   the status bar; high drift predicts exactly where extraction loses cells.

Full field + parameterization recompute is ~50 ms for ~3k triangles, so guides
apply interactively.

## Controls

| Input | Action |
| --- | --- |
| Left-drag | Draw a guide curve |
| Right-click | Delete nearest guide |
| Wheel | Zoom at cursor |
| Middle-drag / Space-drag | Pan |
| Esc | Cancel in-progress stroke |

Toolbar: shape (blob / disc / L-plate), quad size, guide influence radius, and
layer toggles (quads, field glyphs, triangulation, irregular vertices, guides,
skipped extraction cells, extracted mesh valences, combing seams, drift
heatmap).

## Code map

```
src/model/   pure math, no DOM
  Delaunay.js           Bowyer-Watson triangulation
  DomainMesh.js         boundary resampling, interior seeding, adjacency
  CrossField.js         4-RoSy solve, combing, singularity detection
  Parameterization.js   plain single-chart FEM Poisson solves (CG)
  SeamlessParameterization.js  MIQ-lite: seam cut, transition constraints, integer rounding
  IsoContours.js        marching triangles at integer levels
  QuadMesh.js           conservative quad extraction + validation
  FieldTopology.js      per-edge branch matchings, seam graph, matching-cycle indices
  FieldDiagnostics.js   curl residual + parameterization drift heatmaps
  GuideCurve.js         stroke simplification, smoothing, distance/tangent queries
  Shapes.js             demo boundary polygons
src/view/
  App.js                composition root, pipeline state, UI bindings
  Viewport.js           world <-> screen transform
  SceneRenderer.js      layered canvas drawing
  DrawGuideTool.js      guide stroke tool
test/
  pipeline.test.js      node tests: mesh, gradients, Poisson, field,
                        Poincare-Hopf index, guide influence, full pipeline
  verify.html           browser harness that injects preset guides
```

## Honest limitations (vs. a production remesher)

- 2D only. On a 3D surface the same pipeline works per-face with local frames;
  field smoothing then needs parallel transport between neighboring faces.
- The seam transitions use greedy per-curve rounding, not an exact
  mixed-integer solve; where several seam curves meet at a singularity the
  roundings can conflict, and the residual is reported rather than repaired.
  Singularity UV positions are not snapped to transition fixed points.
- Extraction is conservative cell inversion with branch disambiguation and
  transition stitching, not QEx-style integer-line tracing: cells that are
  geometrically implausible or would break manifoldness are skipped (and
  drawable via the Skipped layer). Coverage runs 97-100%; what remains are
  small notches right at singularity tips, whose UV positions are not yet
  snapped to transition fixed points.
- Boundary conformity relies on the field aligning with the boundary; where a
  strong guide overpowers that alignment, the affected boundary run is left
  unconstrained rather than forced.

References: Jakob et al., *Instant Field-Aligned Meshes* (2015); Bommes et al.,
*Mixed-Integer Quadrangulation* (2009); Vaxman et al., *Directional Field
Synthesis* survey (2016).
