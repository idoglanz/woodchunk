# Frame designer (weldments): research and plan

Status: **F0–F4 built** (kernel, data, 3D viewer, direct editing, angles through plan/shop sheet/exports). Next: F5 AI. Research done 2026-10-24.

## 1. What and why

Draw a frame in 3D (a table, bench, welding cart, shelf unit, gate), give each line a profile from
the catalog (44×100 pine, 40×40×2 square tube, 30×30×3 angle…), choose how corners meet, and get
the exact cut list: lengths and saw settings. That cut list *is* the assembly's parts, so it flows
straight into the existing optimizer, shopping list and shop sheet.

The gap is real. SolidWorks and Onshape do this well but are pro tools. Fusion has no native
weldments (the add-in's cut lengths "can't be trusted" per users). FreeCAD FrameForge has no cut
list. SketchUp cut-list plugins measure bounding boxes and miss miter angles. The research found
**no simple web frame designer with a cut list** for hobbyists.

Woodchunk's edge over all of them: the cut list goes on to an optimal buying and cutting plan.

## 2. What the pros do, and what we take

| SolidWorks / Onshape feature | Take for v1? |
|---|---|
| Layout sketch of lines, members follow the lines | **Yes**, as a 3D node/edge graph |
| Profile library per member or group | **Yes**: the catalog is the library |
| Profile placement: rotation, mirror, pierce point (where the line sits on the profile) | **Yes**: 0/90/180/270° roll plus a 9-point anchor |
| Corner treatments: miter, butt 1 / butt 2, trim order | **Yes**: miter, butt (choose who runs through) |
| Trim/extend to a face (T-joints) | **Yes**: automatic when a line ends on another member |
| Cut list grouping identical bodies, LENGTH / ANGLE1 / ANGLE2 | **Yes**, in shop language (below) |
| Gussets, end caps, foot plates | v2, as sheet parts for the sheet packer |
| Coping round tube (fish-mouth), holes | v2 (non-planar; needs CSG) |
| Weld beads, FEA, history tree, assemblies/mates, STEP import | **No** |

Onshape's lesson: one frame-wide default corner type with per-corner overrides is enough, and
reporting a compound miter as one CAD angle confuses people. We report **saw settings**.

## 3. Cut-list conventions (decided)

- **Length is long point to long point (LP–LP)**, the de facto shop default. Also shown: short point.
- **Angles are saw settings**, 0° = square: per end, **miter** (table rotation) and **bevel**
  (blade tilt), plus **which face is up** and **which face is against the fence**.
  - The app picks the face-up/fence face so a cut needs only a miter when that's possible.
  - Cut angles beyond the saw's range (setting, e.g. miter ≤ 50°, bevel ≤ 45°) get a warning.
- **Grouping:** identical = same profile, LP length (0.5 mm), both end cuts, and handedness
  (left/right mirror versions are different pieces).
- **Kerf:** pieces occupy their LP length on the bar. Angle-aware: an angled cut removes
  kerf / cos(θ) along the bar. Nesting alternating miters so one cut makes two ends saves material:
  industrial optimizers do it, hobby tools don't. **v2 differentiator** for our CP-SAT optimizer.
- Shop language example: `4 × 812 mm LP–LP · 45° / 45° · same face up`.

## 4. Product shape

### Where it lives

An **assembly can be drawn**. On the Build tab, an assembly card gets "Design in 3D". The assembly's
parts then come from the frame: shown as read-only rows (with a "from 3D" mark and "Edit in 3D"),
grouped by identical cut. Hardware and extras stay hand-entered. A project can mix drawn and
typed assemblies. (Alternative: a standalone "Frames" area. Rejected: it would duplicate projects.)

### Editor layout (desktop)

```
┌ ← Build · Table frame ·  undo redo ·  Front Top Side Iso · Ortho/Persp ───────── ₪412 ┐
│ Tools │                                                         │ Inspector          │
│ ↖ Sel │                     3D viewport                         │ (selection or      │
│ ╱ Line│              grid floor, view cube, axes                │  frame settings)   │
│ ▭ Rect│                                                         │                    │
│ ✥ Move│                                                         │ Cut list (live)    │
│ ⌖ Tape│                                                         │ A1 4× 760 □ □      │
└───────┴──────────────────────────────── [ length: 760 ↵ ] ──────┴────────────────────┘
```

- **Inspector**:
  - Nothing selected: frame parameters (W, D, H), the default corner type, and whether lines are
    outside dimensions or centerlines.
  - One member: profile (the existing material picker with section glyphs), orientation (rotate
    button, a 3×3 anchor grid, the top face highlighted in 3D), length (typing moves the far node).
  - A node: coordinates, plus the **joint chip** that cycles miter → A through → B through, with a
    live preview.
- **Cut list** lives beside the model, with a two-way highlight (hover a row and its members
  light up; click a member and its row shows), like the Build tab already does for sheets.
- **Phones:** view only in v1. Orbit, tap a member for its cut, read the cut list.

### Making it easy for non-CAD users

1. **Start from a template, not a blank canvas.** Table, bench, workbench, shelf unit (n shelves),
   box frame, welding cart, gate (with brace). Each has W/D/H plus a few options (leg inset,
   stretcher height, shelf count) and a profile per role (legs, rails). Every value stays editable,
   and changing one moves what's attached.
2. **SketchUp-style drawing.** Click a start point, move along a colored axis (X red, Y green, Z blue)
   or snap to nodes, midpoints and grid, then type the length and Enter (the "VCB" box).
   Shift locks the axis.
3. **Outside dimensions by default.** W×D×H means the outside of the frame, and the template sets
   each member's anchor to make that true. This is the most common hobbyist mistake (centerline
   vs outside), so the default should be the intuitive one.
4. **Joints are automatic.** A corner of two members gets the default miter or butt. A line ending
   on another member is a T and is trimmed to its face. Crossings: one runs through. Override with the chip.
5. **Orientation is visual.** One click rotates the profile, and its "top" face is tinted, so
   flat vs on-edge is never ambiguous.
6. **AI** (fits the existing proposal flow): "a welding cart 60×90, 80 high, 40×40 tube, bottom shelf"
   → a template with parameters, shown as a proposal to apply.

## 5. Technical design

### Stack (versions checked 2026-10-24)

- **three 0.186 + @react-three/fiber 9.8 + @react-three/drei 10.7** (React 19 / Next 16 OK, client-only).
  drei: `CameraControls` (touch, animated standard views, ortho), `GizmoHelper` + `GizmoViewcube`,
  `Grid`, `Bvh` picking, `Text`/`Html` labels. Not R3F 10 / drei 11 (alpha).
- The editor loads with `next/dynamic(..., { ssr: false })` from a client wrapper, so the 3D bundle
  (~300 KB gzip) only loads on the frame route.
- **No CAD kernel in v1.** Straight members with planar end cuts are exact with our own geometry:
  a profile polygon (outer and inner loops) swept along the axis, with each longitudinal edge
  intersected with the end planes. Caps are the profile triangulation projected onto the planes.
  The same math produces the cut list.
  - v2 holes/copes: `manifold-3d` (WASM, ~160 KB brotli; same kernel in Python as `manifold3d`).
  - STEP export, if ever: `build123d` on the server. Never OCCT in the browser (~5 MB).
- **No constraint solver.** Node coordinates are numbers or simple expressions of named parameters
  (`W`, `H - 40`, `D/2`).
- **CAD look:** flat shading, `EdgesGeometry` outlines with polygon offset, hemisphere light plus
  a camera-following light; no shadows or postprocessing (mobile).
- **State:** the frame is part of the project content, so the existing editor store gives
  autosave, undo/redo and version conflicts for free. Drags commit once on pointer-up.

### Data model (in `ProjectContent`, on `Assembly.frame`)

```
Frame
  version: 1
  params:  [{ name: "W", mm: 1200 }, …]
  defaults: { corner: "miter" | "butt", lines: "outside" | "centerline" }
  nodes:   [{ id, x, y, z }]          # each a number or an expression string ("W", "H-40")
  members: [{ id, a, b, item_id, roll_deg, anchor: "c"|"tl"|"t"|…|"br", name? }]
  joints:  [{ node, kind: "miter"|"butt", through?: member_id }]   # overrides only
  template?: { id, options }          # to re-run a template when its parameters change
```

Catalog: linear items get an optional **profile**:

```
profile: { shape: "rect" | "rect_tube" | "round_tube" | "round_bar" | "angle" | "channel" | "flat_bar",
           w, h, t?, r? }             # rect = solid (lumber); defaults from thickness×width
kg_per_m?                             # weight for metal
```

Lumber keeps working as is. Metal bars are linear stock too (same optimizer, a metal saw kerf).
The UI label for the kind becomes "Lumber & bars". Seed: common steel square/rect tube, angle, flat bar, round tube.

### Geometry kernel (shared TS and Python)

Pure functions, about 300 lines each:

1. **Member frame:** x = axis a→b. The "up" reference is world Z, or world X for vertical members.
   Roll rotates about x. The anchor offsets the profile so the line sits at its center, an edge or a corner.
2. **Joint resolution per node:**
   - 1 member: square end at the node.
   - 2 members: miter (bisector plane) or butt (the butting end goes to the near face of the
     through member; the through member extends to cover).
   - 3+ members: the "through" order decides who runs through; the rest butt.
   - A node lying on another member's span is a T: trim to the face.
3. **Body:** the profile prism between the two end planes.
4. **Cut list:** LP/SP length from the profile vertices; per-end miter/bevel from the end-plane
   normal in the member frame (`atan2` of its components), with face-up and fence face chosen to
   avoid compound cuts. Rounded to 0.1 mm / 0.1°, sorted deterministically.

The TS copy runs live in the editor. The **Python copy is the authority**: the planner derives parts
from `Assembly.frame` on the server, so plans, shopping and exports never trust client numbers.
**Golden fixtures** (JSON frames with expected cut lists) run in both vitest and pytest:
picture frame 45°/45°, table corner with butts, T-joint, angle iron flipped, splayed leg (compound).

### Integration

- `Part` gains optional `cut_a` / `cut_b` ({miter, bevel}), `lp_mm` and `from_frame`. The derived
  parts are regenerated whenever the frame changes. Lengths are not hand-editable on drawn assemblies.
- **Optimizer:** pieces occupy their LP length; angle-aware kerf. v2: pair alternating miters.
- **Plan / Buy / Shop sheet:** show angles on pieces (a small end-cut glyph), and saw settings per
  piece on the shop sheet. Lumber bars get end-cut shapes in the board diagrams.
- **Exports:** STL / glTF from three's exporters (v1). DXF / PDF per-member drawings from
  FastAPI (`ezdxf`) in v2.

## 6. Build phases

| Phase | Scope | Done when |
|---|---|---|
| F0 kernel spike | Geometry and cut-list math in TS + Python, golden fixtures, saw-setting convention | Fixtures pass in both; angles match hand calculations and a real saw |
| F1 data | `Frame` model, catalog `profile` + metal seed items, server derives parts from frames | API returns parts with cut angles for a fixture frame |
| F2 viewer | Lazy 3D route, CAD look, standard views, ortho/persp, selection, inspector (read), live cut list with two-way highlight | A seeded frame renders and matches its cut list |
| F3 editing | Templates + parameters, move nodes with typed coordinates, draw lines with snapping/axis lock/VCB, joint chips, profile and orientation, undo/redo/autosave | Build a table and a welding cart from scratch without touching numbers twice |
| F4 integration | Drawn assemblies on Build (read-only rows, "Design in 3D"), angles in plan/buy/shop sheet, angle-aware kerf, saw-range warnings, STL/glTF export, phone view mode | E2E: template → change W → cut list → plan → shop sheet |
| F5 AI | "Describe a frame" → template proposal | Hebrew and English prompts produce valid frames |

v2 (in rough order):
- Alternating-miter nesting in the optimizer.
- Half-lap, then mortise and tenon, for wood.
- Gussets, end caps and foot plates as sheet parts.
- Compound splayed legs from templates.
- Mirror and array tools.
- Round-tube coping with a printable wrap template.
- DXF/PDF drawings.
- Weld gap.
- Custom profiles.

## 7. Risks

- **Joint resolution edge cases** (3–4 members at one node, non-orthogonal T's). Mitigation:
  ship a small set of well-defined rules, show what was decided at each node, and let the user override.
- **Interaction quality** decides whether people like it. Mitigation: start F3 with the template path
  (no drawing needed), then add drawing. Test on a trackpad and a mouse early.
- **Two kernels drifting.** Mitigation: the golden fixtures are required in both test suites, and the
  server is the authority.
- **Scope creep toward CAD.** The "don't do" list in section 2 is part of the plan.

## 8. Decisions (2026-10-25)

1. **Inside assemblies.** A drawn assembly's parts come from its frame.
2. **Lines mean outside dimensions** by default (centerline is a per-frame setting).
3. **"Lumber & bars"**: linear stock gets a profile; metal bars use the same optimizer, shopping and inventory.
4. **Phones are view-only** in v1.
5. Metal stock is seeded with common sizes and no prices; real prices come from AI import of a supplier page.
