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
3. **Combing** — BFS picks a consistent branch of the 4-fold field. Interior
   vertices where the branch matchings don't cancel are the field's
   singularities: the extraordinary (non-valence-4) vertices of the final quad
   mesh, shown as dots.
4. **Parameterization** — two least-squares Poisson solves (FEM stiffness
   matrix + Jacobi-preconditioned CG) fit scalars `u`, `v` whose gradients
   follow the field, scaled so one integer step = one quad edge.
5. **IsoContours** — integer iso-lines of `u` and `v` are the quad layout.

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
layer toggles (quads, field glyphs, triangulation, irregular vertices, guides).

## Code map

```
src/model/   pure math, no DOM
  Delaunay.js           Bowyer-Watson triangulation
  DomainMesh.js         boundary resampling, interior seeding, adjacency
  CrossField.js         4-RoSy solve, combing, singularity detection
  Parameterization.js   FEM Poisson solves (CG)
  IsoContours.js        marching triangles at integer levels
  GuideCurve.js         stroke simplification, distance/tangent queries
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
- The parameterization is a plain least-squares fit; production quality is
  Mixed-Integer Quadrangulation (seam cuts + integer jumps at singularities).
  Here contours fan/compress near singularities instead of terminating cleanly.
- Contours visualize the quad layout; extracting a watertight quad `Mesh`
  data structure (integer grid vertices + connectivity) is the next step.

References: Jakob et al., *Instant Field-Aligned Meshes* (2015); Bommes et al.,
*Mixed-Integer Quadrangulation* (2009); Vaxman et al., *Directional Field
Synthesis* survey (2016).
