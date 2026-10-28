# Sketch pad: plan

A 2D scratch pad per project (several per project): draw roughly, pin the dimensions and angles you
know, and the rest is worked out. Decisions (2026-10-28): lines, circles and arcs; a Sketches section in
Build, each sketch opening full-screen; phones view and change numbers (drawing on bigger screens); no
link to parts yet.

## How it behaves

1. **Draw roughly.** Line (chains), rectangle, circle, arc. Lines within a few degrees of level or
   upright snap to it (and get that constraint); ends snap to existing points (they share the point).
2. **Pin what you know.** Dimensions (length, distance, angle, radius/diameter) and relations
   (horizontal, vertical, parallel, perpendicular, equal, tangent, point on line/circle, midpoint,
   fixed). The drawing moves to satisfy them, staying as close as it can to what you drew.
3. **Everything else is measured.** Select anything to see its length / angle / radius as a grey,
   calculated dimension; "show all measurements" labels every line.
4. **Status.** Blue = can still move, black = fully determined, red = conflicting (with which
   constraints). A footer says "Fully defined", "3 more dimensions to fix it" or what conflicts.

## Data (saved in the project)

`ProjectContent.sketches: Sketch[]` — saved, merged, synced and shared like the rest of the project
(lists are keyed by id, so two people editing different sketches, or different parts of one, merge).

```
Sketch     { id, name, points: Point[], shapes: Shape[], constraints: Constraint[] }
Point      { id, x, y }                                   // mm, y up
Shape      line { id, a, b } | circle { id, c, r } | arc { id, c, a, b }   // arc: centre, start, end (counter-clockwise)
Constraint { id, kind, refs: string[], value?, driving: bool, side? }   // side: which way round a tangent is
```

Kinds: `coincident`, `horizontal`, `vertical`, `parallel`, `perpendicular`, `equal`, `tangent`,
`on_line`, `on_circle`, `midpoint`, `fix`, and dimensions `distance` (point–point or a line's length),
`point_line_distance`, `angle` (signed, from line 1 to line 2), `radius`, `diameter`. A dimension with
`driving: false` is a reference: it shows the measured value and constrains nothing.

The geometry stored is the solved geometry, so opening a sketch shows it as it was; the server only
validates shape and bounds (no solving on the server).

## Solver (`lib/sketch/`, TypeScript, like the frame kernel)

- Variables: point x, y and circle radii. Each constraint is one or more residuals that are zero when
  it holds (e.g. length: |b − a| − L; angle: a rotation-invariant mix of cross and dot of the two
  directions; tangent line–circle: signed distance from the centre to the line − r, the side taken
  from the drawing).
- Damped Gauss–Newton with the **minimum-norm step** (Δ = Jᵀ(JJᵀ + λI)⁻¹(−F)): an under-constrained
  sketch moves as little as possible from where it is, so dragging and adding a dimension feel
  natural. Converged when every residual < 1e-9 mm; at most a few dozen iterations.
- **Degrees of freedom:** the null space of J at the solution (a small SVD). A variable is determined
  when no null-space direction moves it; a shape is black when all its variables are. Free DOF =
  variables − rank.
- **Conflicts:** residuals that won't go to zero; the constraints whose rows don't add rank and
  disagree are reported. Redundant but consistent ones (all three angles of a triangle) are allowed.
- Tests: classic problems with known answers (triangle from two sides and the included angle,
  rectangle fully defined by H/V + two dimensions, tangent line to a circle, equal radii, conflicting
  dimensions, a dragged under-constrained point staying put).

## Screens

- **Build → Sketches card:** each sketch with a small preview, its name and status; New sketch.
- **Sketch screen** (`/projects/{id}/sketch/{sketchId}`, full-screen like the 3D editor): SVG
  canvas with pan/zoom and a mm grid; toolbar (Select, Line, Rectangle, Circle, Arc, Dimension);
  constraint buttons for the selection; dimension labels you click to type a value; constraint
  glyphs (H, V, ∥, ⟂, =, ○) you can select and delete; status footer; undo/redo (the project's).
- **Phones:** view, pan/zoom, tap a dimension to change it.

## Phases

S0–S3 and most of S4 shipped together (2026-10-28). Left for later: arrows nudging points, a typed
length while drawing, label positions you can drag, and linking sketch lengths to parts.

- **S0 solver:** model types, residuals, solver, DOF and conflicts, measurements; tests.
- **S1 data and viewing:** backend model, the Build card, the sketch screen with pan/zoom,
  measurements, editing dimension values (works on phones).
- **S2 drawing:** line chains, rectangle, circle, arc; snapping with automatic constraints; select,
  drag (live solve), delete.
- **S3 dimensions and relations:** dimension tool (length, distance, angle, radius), relation
  buttons, glyphs, colours and status, conflicts.
- **S4 polish:** reference dimensions, show all measurements, previews, shortcuts, e2e.

## Sketches to parts, even spacing, grid (2026-10-28)

- **Lines as parts:** select lines (a whole rectangle counts as one piece, cut to its long side)
  → Make parts: material, assembly (or a new one), names, how many of each. `Part.sketch =
  {sketch_id, shape_id}`; every sketch edit re-syncs those parts' lengths in the same undo step
  (`lib/sketch/parts.ts`). Build shows the length as a link to the sketch; deleting the line or
  sketch keeps the part at its last length, unlinked. Lines cut as parts wear their label (B3).
- **Repeat with even gaps** (`lib/sketch/repeat.ts`): count, X or Y, and between two lines square
  to it, in a length, or with a set gap; ends equal to the gaps, flush, or set. Copies carry the
  group's relations; their sizes become "equal" to the original's (one number to change); each is
  pinned by its gap from the one before (or from the boundary). Placed once: changing the span
  later doesn't re-spread them (repeat again).
- **Grid:** snapping on by default (G toggles, Alt places freely); size Auto (follows the zoom)
  or 1–100 mm, kept per browser. Points and axes win over the grid.
