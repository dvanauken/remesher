# Guided Quad Remeshing Upgrade Report

Implementation-focused synthesis for upgrading `remesher-I` from a 2D field-guided quad layout visualizer into a small but real quad-remeshing pipeline.

Generated from the cached Claude deep-research workflow at:

`C:\Users\Buddy\.claude\projects\c--dbva-code-remesher-I\4613692c-6dc2-4468-9520-6f212838980d\subagents\workflows\wf_46b3b0f4-bb9`

The workflow reached 50 verification votes before stopping: 47 supported, 3 refuted. The refutations matter: greedy mixed-integer rounding is a practical approximation, but it does not make exact MIP/ILP solvers unnecessary and does not guarantee valid, fold-over-free quad output.

## Executive Summary

The current code already has the right educational spine:

- `DomainMesh`: a triangular substrate for solving.
- `CrossField`: a smooth 4-RoSy field with boundary and guide-curve constraints.
- `comb`: branch selection for a representative direction.
- `Parameterization`: least-squares Poisson integration of `u` and `v`.
- `IsoContours`: integer iso-line visualization.

The missing production pieces are not cosmetic. They are topology, integer consistency, and extraction:

- Explicit singularity control: represent singularities as first-class topology objects with index/valence, budget, pairing, and validity checks.
- Curl/integrability control: make the field more integrable before parameterization, or measure and correct the drift introduced by Poisson projection.
- Seamless integer-grid parameterization: store per-corner UVs and grid automorphism transitions across seams, not one globally shared scalar per vertex.
- Robust quad extraction: trace and assemble actual quad faces with vertices/connectivity, using exact 2D orientation predicates after QEx-style sanitization.
- Sizing and anisotropy: promote `spacing` from one global slider to a scalar/vector field used by both field design and parameterization.

The best incremental path for this JavaScript codebase is not a full QuadWild or IGM port. It is:

1. Add diagnostics and real quad extraction for the current disk-like case.
2. Add explicit singularity/valence objects and Poincare-Hopf checks.
3. Replace raw combing with edge matchings and a seam graph.
4. Add MIQ-lite integer seam jumps with CoMISo-style greedy rounding.
5. Add QEx-lite robust extraction from per-corner integer-grid maps.
6. Add variable sizing and curl-correction overlays.
7. Optionally add a patch-layout simplification layer if the goal becomes coarse production topology rather than smooth visual remeshing.

## Current Pipeline Quality

The repo is a good 2D cross-field demo. It is not yet a remesher in the strict mesh-data sense.

`IsoContours.extract()` returns independent line segments. A finished quad remesher needs:

- vertices: grid intersections and boundary intersections;
- faces: each quad as four vertex indices;
- connectivity: neighboring faces share exactly the same edge vertices;
- boundary conformity: no cracks, duplicate corners, slivers, or loose contour fragments;
- validation: finite coordinates, positive area, no T-junctions unless intentionally represented.

The current Poisson solve fits gradients in least-squares form:

```text
min_u sum_T area(T) * ||grad u - target_u(T)||^2
min_v sum_T area(T) * ||grad v - target_v(T)||^2
```

That is fine for visualization. It is the wrong final representation for a robust quad mesh because non-integrable fields force the solve to distribute error. This is the root of spacing drift, guide conflict artifacts, and local alignment loss.

## Failure Modes To Fix

### 1. Uncontrolled Singularity Placement

The current `CrossField.solve()` lets singularities emerge from guide/boundary smoothing. That is useful for immediate feedback, but conflicting guides can spawn chains of valence-3/5 irregularities with no user-facing topological model.

For a quad mesh, singularities are not just decorations. A simple cross-field singularity of index `+1/4` corresponds to a valence-3 extraordinary vertex; index `-1/4` corresponds to valence 5. In general:

```text
quad valence = 4 * (1 - index)
```

You need explicit topology state:

```js
{
  id,
  x,
  y,
  indexQuarterTurns, // +1, -1, +2, ... in units of 1/4
  valence,           // 3, 5, 2, 6, ...
  locked,            // user-prescribed vs optimizer movable
  source             // user, boundary, guide-conflict, automatic
}
```

For disk-like 2D domains, add a topological budget check before solving. In the current test suite, the disc field expects total quarter-turn index magnitude 4, which is consistent with the existing `field.singularities()` test. Preserve that idea, but make it an explicit validation layer rather than an emergent assertion after the solve.

### 2. Comb-Seam Herringbone Artifacts

Combing picks a branch of the 4-fold field, but it does not create a seamless integer-grid map. When the representative angle jumps by a 90 degree branch across an implicit seam, raw `u`/`v` iso-contours do not know how to reconnect. That is the herringbone/seam mismatch class of artifact.

The standard fix is not "draw contours better." It is to represent transition functions across seams:

```text
g_ij(p) = R_90^r_ij * p + t_ij

r_ij in {0,1,2,3}
t_ij in Z^2
```

The rotation part says how chart axes turn. The integer translation says how grid lines continue across the seam. QuadCover and MIQ both revolve around making these transitions grid automorphisms so integer lines meet coherently.

### 3. No Sizing Or Density Control

The current `spacing` is one global number. A real guided remesher needs a sizing field:

```text
h(x, y) = target edge length
rho(x, y) = 1 / h(x, y)
```

The target gradients become:

```text
target_u = rho * e1
target_v = rho * e2
```

where `e1`, `e2` are the two local cross directions. This gives isotropic density control. For anisotropy, promote the cross to a frame:

```text
frame = [a b]  // two non-unit, possibly non-orthogonal vectors
```

Then either solve directly in the frame metric, or follow the libigl/frame-field approach: interpolate a frame field, warp the domain so the frame becomes orthogonal/unit, run isotropic remeshing there, and lift coordinates back.

### 4. Curl And Spacing Drift

If `target_u` and `target_v` are not gradients of scalar functions, Poisson integration must compromise. Increasing guide weight just moves error elsewhere. Add a diagnostic:

```text
curl_u(T) = discrete curl of rho * e1
curl_v(T) = discrete curl of rho * e2
drift(T) = ||grad u - rho e1|| + ||grad v - rho e2||
```

Display curl/drift as overlays. Use them to decide whether a guide layout is impossible, needs more singularities, or needs a smoother sizing field.

## Algorithm Families Worth Borrowing From

### Trivial Connections: Explicit Singularity Control

Crane, Desbrun, and Schroeder's Trivial Connections method computes direction fields that are smooth except at prescribed singularities. The project page describes fields with singularities precisely where desired and a solve based on one sparse linear system, with a simpler Poisson form for simply connected surfaces. That is the best conceptual match for this demo's weakness: uncontrolled topology.

Implementation idea for `remesher-I`:

- Keep the current guide-constrained field solve for sketching.
- Add a `TopologyField` mode where the user places singularities with quarter-index labels.
- Validate the index sum.
- Solve a smooth connection/angle correction subject to those singularities and soft guide constraints.
- Use the resulting edge matchings as the combing data, not just post-hoc BFS angle branches.

Reference: [Trivial Connections on Discrete Surfaces](https://www.cs.cmu.edu/~kmcrane/Projects/TrivialConnections/).

### QuadCover: Branched Covering And Period Rounding

QuadCover turns a cross field into a branched covering where a scalar parameterization can be made globally coherent by controlling periods. Its key lesson for this project:

- A raw Poisson fit is the continuous part.
- Integer periods decide whether parameter lines are globally continuous.
- Branch points/singularities must land on grid-compatible positions.
- Greedy/simultaneous rounding is a useful heuristic, but not an optimality guarantee.

For a small JS implementation, borrow the representation and a simplified rounding pass. Do not try to port the whole paper literally at first.

Reference: [QuadCover PDF](https://page.mi.fu-berlin.de/polthier/articles/quadCover/KNP07-QuadCover.pdf).

### MIQ And CoMISo: Greedy Mixed-Integer Seam Jumps

MIQ is the canonical version of the pipeline the demo is approximating:

1. Compute a smooth cross field.
2. Cut the mesh to a disk with singularities on the cut.
3. Solve for `u`, `v` whose gradients follow the field.
4. Add integer constraints so iso-lines match across cuts.
5. Extract the quad mesh.

CoMISo's practical contribution is the rounding strategy:

- solve relaxed continuous system;
- choose an integer variable that is closest to an integer;
- fix it;
- update the continuous solution locally;
- fall back to CG or sparse factorization if local updates fail.

Use this as a JS-feasible MIQ-lite strategy. But keep the caveat from the verifier: greedy rounding is an approximation. It does not remove the value of full ILP/MIQP solvers, and later pipelines still use exact or commercial solvers for hard quantization problems.

References:

- [Mixed-Integer Quadrangulation](https://www-sop.inria.fr/members/David.Bommes/publications/miq.pdf)
- [Practical Mixed-Integer Optimization for Geometry Processing](http://www-sop.inria.fr/members/David.Bommes/publications/comiso.pdf)

### QEx And libQEx: Robust Quad Extraction

This is the most important extraction lesson. QEx exists because quad extraction from parameterization is not a trivial marching-contours pass. Floating-point maps have special cases, ambiguous vertex hits, fold-overs, and solver imprecision.

For this project, a QEx-lite extractor should:

- store UVs per face corner, not only per shared vertex;
- store transition functions across cut/seam edges;
- sanitize near-integer values before tracing;
- snap singularities to transition fixed points;
- use robust `orient2d` predicates for all UV-side tests;
- trace integer grid lines through triangle charts;
- merge identical output vertices by topological identity, not by loose coordinate epsilon;
- output `{ verts, quads, edges, boundaryLoops, valence }`.

This is the step that turns "graph paper lines" into an actual mesh.

References:

- [QEx paper PDF](https://www.graphics.rwth-aachen.de/media/papers/ebck2013_1.pdf)
- [libQEx repository](https://github.com/hcebke/libQEx)

### Integer-Grid Maps: Reliability Requires More Than MIQ-Lite

Integer-Grid Maps directly target maps that imply a quad mesh, but the full formulation is mixed-integer quadratic programming and is not a small JS feature. The practical lesson is architectural:

- define the map class you need;
- enforce grid automorphism transitions;
- separate singularities enough that extraction is well-defined;
- reduce the integer problem before solving.

For this repo, treat IGM as the north star, not the next implementation milestone.

Reference: [Integer-Grid Maps for Reliable Quad Meshing](https://www.graphics.rwth-aachen.de/publication/03197/).

### Integrable PolyVector Fields: Fix Curl Before Parameterization

Integrable PolyVector Fields attack the exact problem caused by fitting scalar functions to a non-curl-free field. They optimize a field so it is curl-free and therefore exactly corresponds to a parameterization, while still respecting user constraints. This is a better mental model than "make the Poisson solve stronger."

For a lightweight version:

- measure discrete curl first;
- add a continuous curl penalty or conformal scaling solve;
- only then run parameterization;
- expose curl residuals visually.

Reference: [Integrable PolyVector Fields](https://igl.ethz.ch/projects/integrable/).

### Instant Meshes And QuadriFlow: Position Fields As A Lightweight Alternative

Instant Meshes avoids global MIQ-style parameterization by solving an orientation field and then a position field. It is interactive and guide-friendly, but it tends to generate more singularities than global approaches. QuadriFlow builds on this family and uses global network flow / SAT-style constraints to reduce singularities.

For this repo:

- useful idea: position fields can be simpler than full integer-grid maps;
- risky part: direct extraction still requires robust topology handling;
- not ideal if the main goal is explicit hand-designed topology.

References:

- [Instant Meshes repository](https://github.com/wjakob/instant-meshes)
- [QuadriFlow repository](https://github.com/hjwdzh/QuadriFlow)

### QuadWild: Production Patch Layouts, Heavy Solvers

QuadWild is a production-quality architectural alternative: compute/trace a field into a patch decomposition, then solve patch quantization so the final tessellation is a consistent all-quad mesh. It exposes parameters such as regularity versus isometry, and it is designed around feature-line preservation.

But it depends on heavy optimization machinery such as Gurobi. For this repo, copy the architecture only:

- patch graph;
- singularity merge/cancel decisions;
- feature/guide curves as hard patch boundaries;
- integer side-length consistency checks.

Do not try to clone QuadWild inside a dependency-free browser demo.

Reference: [QuadWild repository](https://github.com/nicopietroni/quadwild).

### Gmsh Quasi-Structured Meshing: Robustness Over Perfect Global Structure

Gmsh's quasi-structured approach is useful because it avoids betting everything on one global parameterization. It uses locally integrable cross fields, size maps, frontal insertion, all-quad conversion, and repair passes. This is closer to engineering robustness than elegant MIQ.

For this repo, borrow:

- local sizing fields;
- curl correction by conformal scaling;
- repair-after-generation as an explicit stage;
- element-quality guards that reject bad operations.

Reference: [Quasi-structured quadrilateral meshing in Gmsh](https://arxiv.org/abs/2103.04652).

## Recommended Data Structures

### Half-Edge Or Face-Corner Mesh

The current triangle arrays are enough for solves, but extraction needs corner identity:

```js
TriMesh {
  verts: [[x, y], ...],
  tris: [[v0, v1, v2], ...],
  halfEdges: [{
    tri,
    local,
    from,
    to,
    twin,
    next,
    prev,
    isBoundary
  }]
}
```

If a full half-edge is too much at first, add a face-corner layer:

```js
Corner {
  tri,
  local,
  vertex,
  uv: [u, v],
  chartId
}
```

### Field Topology

```js
FieldTopology {
  match: Int8Array(numInteriorEdges), // quarter-turn edge matching
  singularities: [{
    vertexOrPoint,
    indexQuarterTurns,
    valence,
    locked
  }],
  seams: Set(edgeId),
  guideConstraints: [...]
}
```

Do not infer all singularity meaning from combed angles. Store the integer matchings that created them.

### Integer-Grid Parameterization

```js
IntegerGridMap {
  cornerUV: Float64Array(numCorners * 2),
  transition: Map(edgeId, {
    r: 0 | 1 | 2 | 3,
    t: [int, int]
  }),
  singularityUV: Map(singularityId, [number, number]),
  cutEdges: Set(edgeId)
}
```

Per-corner UVs are essential. Shared per-vertex `u`, `v` cannot represent seams.

### Extracted Quad Mesh

```js
QuadMesh {
  verts: [[x, y], ...],
  quads: [[q0, q1, q2, q3], ...],
  source: [{
    // optional provenance for debugging
    chartCells,
    uvCell,
    clippedBoundary
  }]
}
```

Add validators:

- every quad has four distinct vertices;
- signed area is positive above tolerance;
- each interior edge is used exactly twice;
- each boundary edge is used once;
- valence distribution matches expected singularities;
- no output vertex has NaN/Infinity.

## Solver Formulations To Implement

### Variable-Spacing Poisson

Keep the existing FEM stiffness matrix, but let spacing vary per triangle:

```js
rhoT = 1 / spacingAt(centroidT)
e1 = [cos(alphaT), sin(alphaT)]
e2 = [-sin(alphaT), cos(alphaT)]

targetU = rhoT * e1
targetV = rhoT * e2
```

This is the smallest useful density-control upgrade. It will not solve integer consistency, but it gives the UI a real "squeeze" control.

### Curl Residual

For each oriented primal edge or dual edge, estimate circulation of the target field around a triangle or vertex ring:

```text
curl(T) ~= sum_edges dot(target(edgeMid), tangent(edge)) * edgeLength
```

Show `abs(curl_u) + abs(curl_v)`. High values predict spacing drift and alignment error.

### Seamless Constraints

Once cuts exist, duplicate vertices along cuts and impose transition constraints:

```text
[u_j, v_j] = R_90^r [u_i, v_i] + [m, n]
```

where `m`, `n` are integer variables. The continuous relaxation treats them as real values. Greedy rounding fixes them to integers.

### Greedy Rounding Loop

Minimal CoMISo-style version:

```text
solve relaxed K x = b
while integer variables remain:
  choose variable k with smallest abs(x_k - round(x_k))
  add equality x_k = round(x_k)
  eliminate x_k or apply a strong pin
  re-solve locally if possible, CG globally if needed
```

Do not claim optimality. Track residual and expose "integer jump error" in the UI.

### QEx-Lite Extraction

Start with the simple disk case before seams:

1. For each triangle, compute which integer `u` and `v` lines cross it.
2. Compute intersections in UV space.
3. Use robust `orient2d` to order intersection events.
4. Build graph nodes at U/V crossings and boundary hits.
5. Walk cells bounded by alternating U and V edges.
6. Emit quads.

Then generalize to seams:

1. Use per-corner UVs.
2. Transform across triangle edges with `g_ij`.
3. Merge topological vertex identities through transitions.
4. Snap near-integer singularity positions.

For exact predicates, a tiny pure JS `orient2d` implementation is enough for 2D extraction.

## Incremental Upgrade Path

### Milestone 1: Make Quality Measurable

Add tests and overlays before changing algorithms:

- triangle quality already looks good; keep that.
- field singularity index sum per shape;
- curl residual heatmap;
- parameterization drift heatmap;
- iso-line crossing orthogonality;
- guide-to-field angular error near guides;
- extracted mesh validity once extraction begins.

Suggested files:

- `src/model/FieldDiagnostics.js`
- `src/model/QuadMesh.js`
- `test/quality.test.js`

### Milestone 2: Extract A Real Quad Mesh From The Current Disk Parameterization

Do this before MIQ. It turns the demo into a real output pipeline even if quality is imperfect.

Deliverable:

```js
const quadMesh = QuadExtractor.extractDisk(mesh, u, v)
```

Add renderer mode for actual quad faces and a JSON export.

Expected limitations:

- no seams;
- artifacts near singularities;
- possible boundary slivers;
- no guarantee against T-junctions.

That is acceptable for the first real mesh milestone.

### Milestone 3: Explicit Singularity UI And Validation

Add a "topology edit" layer:

- click to add `+1/4` or `-1/4`;
- pair insertion: add valence-3/5 pair together;
- drag singularities;
- lock/unlock;
- show index sum status;
- reject invalid configurations unless user explicitly marks experimental.

Use this to stop guide conflicts from silently generating singularity chains.

### Milestone 4: Edge Matchings And Seam Graph

Replace combing-as-only-branch-choice with edge matchings:

```js
matching(edge i->j) = round((theta_i - theta_j) / (PI / 2))
```

Store matchings, compute singularity index from the cycle sum around vertices, and generate a cut graph connecting singularities to the boundary. This prepares the data model for MIQ-style transitions.

### Milestone 5: MIQ-Lite Seamless Parameterization

Introduce duplicated seam vertices and transition constraints. Start with:

- disk-like domain;
- boundary cuts only;
- integer translations relaxed then rounded;
- no full branch-and-bound.

The goal is to remove herringbone seams, not to match MIQ paper quality.

### Milestone 6: QEx-Lite Robust Extraction

Move from `IsoContours` segments to actual cells:

- per-corner UVs;
- exact orientation predicate;
- integer-line tracing;
- quad face assembly;
- topology validation.

Keep `IsoContours` as a debug layer, but stop treating it as the output.

### Milestone 7: Sizing Fields And Curl Correction

Add:

- brush-painted spacing scalar;
- smoothing of spacing field;
- anisotropic frame constraints later;
- curl residual overlay;
- optional conformal scaling solve for local integrability.

Start isotropic. Anisotropy needs more UI and more validation.

### Milestone 8: Patch Layout Simplification

Only do this if the target becomes cleaner animation/CAD topology:

- trace separatrices from singularities;
- build a patch graph;
- cancel tiny valence-3/5 pairs;
- merge short arcs;
- quantize patch side lengths.

This is where QuadWild-style ideas belong. It is also where full ILP solvers become hard to avoid if you want production-grade results.

## Practical Pitfalls

- Guide curves are soft constraints, not topology. Let guides influence orientation, but require explicit singularities for topology edits.
- Stronger weights do not fix incompatible fields. They move curl error.
- Avoid shared vertex UVs once cuts exist. Use per-corner UVs.
- Do not merge extracted vertices by world-coordinate epsilon alone. Use chart/grid identity first.
- Boundary handling is a full feature. Boundary grid intersections, clipped quads, and corner singularities need tests.
- Greedy rounding can look good and still be globally wrong. Report residuals.
- QEx/libQEx is GPL. Borrow concepts, not code, unless the project license is compatible.
- Full QuadWild/IGM-style reliability is outside a dependency-free browser demo unless you add serious optimization dependencies.

## Source Notes

Primary sources consulted or recovered from the workflow:

- [Mixed-Integer Quadrangulation](https://www-sop.inria.fr/members/David.Bommes/publications/miq.pdf): MIQ field and seamless parameterization pipeline; adaptive greedy solver; local stiffening caveat.
- [Practical Mixed-Integer Optimization for Geometry Processing](http://www-sop.inria.fr/members/David.Bommes/publications/comiso.pdf): CoMISo greedy rounding, constraint elimination, local update strategy.
- [QuadCover](https://page.mi.fu-berlin.de/polthier/articles/quadCover/KNP07-QuadCover.pdf): branched coverings, grid automorphism transitions, period rounding.
- [QEx paper](https://www.graphics.rwth-aachen.de/media/papers/ebck2013_1.pdf): robust extraction, sanitization, exact `ORIENT2D`, fold-over tolerance.
- [libQEx](https://github.com/hcebke/libQEx): reference implementation and C API/data-contract clues.
- [Integer-Grid Maps](https://www.graphics.rwth-aachen.de/publication/03197/): reliable integer-grid-map target and MIQP complexity warning.
- [Trivial Connections](https://www.cs.cmu.edu/~kmcrane/Projects/TrivialConnections/): prescribed singularities with sparse linear solves.
- [Integrable PolyVector Fields](https://igl.ethz.ch/projects/integrable/): curl-free field design before parameterization.
- [Frame Fields](https://igl.ethz.ch/projects/frame-fields/): anisotropic and non-orthogonal frame-field remeshing.
- [libigl tutorial](https://libigl.github.io/tutorial/): practical MIQ, Poisson parameterization, libQEx handoff, anisotropic remeshing overview.
- [Instant Meshes](https://github.com/wjakob/instant-meshes): interactive orientation/position field alternative.
- [QuadriFlow](https://github.com/hjwdzh/QuadriFlow): scalable Instant-Meshes-family remesher with singularity reduction.
- [QuadWild](https://github.com/nicopietroni/quadwild): production patch-layout/feature-line pipeline and solver-dependency signal.
- [High-valence singularity quad layouts](https://arxiv.org/abs/2103.02939): prescribed high-valence singularities and layout repair.
- [Gmsh quasi-structured quad meshing](https://arxiv.org/abs/2103.04652): robust CAD-oriented alternative with size maps and repair passes.
- [Coarse quad layout simplification](https://arxiv.org/abs/1905.09097): separatrix partition simplification and limit-cycle repair.

## Bottom Line

The next high-value upgrade is not "better contours." It is a `QuadExtractor` that emits real quads, plus a topology layer that stores singularities, matchings, seams, and integer transitions. After that, sizing and curl correction become meaningful because the pipeline has something concrete to validate: an actual quad mesh.
