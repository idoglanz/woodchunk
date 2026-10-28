/** A 2D sketch: points (mm, y up), shapes built on them, and the constraints that pin them. */

export type SketchPoint = { id: string; x: number; y: number };

export type Line = { id: string; kind: "line"; a: string; b: string };
export type Circle = { id: string; kind: "circle"; c: string; r: number };
/** Centre, start and end, counter-clockwise from start to end. Its radius is |start − centre|. */
export type Arc = { id: string; kind: "arc"; c: string; a: string; b: string };
export type Shape = Line | Circle | Arc;

export type ConstraintKind =
  | "coincident" // two points are one place
  | "horizontal" | "vertical" // a line
  | "parallel" | "perpendicular" // two lines
  | "equal" // two lines (length) or two circles/arcs (radius)
  | "tangent" // a line and a circle/arc, or two circles/arcs
  | "on_line" | "on_circle" // a point on a line (extended) / circle or arc
  | "midpoint" // a point in the middle of a line
  | "fix" // a point stays where it is
  // dimensions (`value`):
  | "distance" // two points, or one line's length (mm)
  | "point_line_distance" // a point and a line (mm)
  | "angle" // from line 1 to line 2, counter-clockwise (degrees, may be negative)
  | "radius" | "diameter"; // a circle or arc (mm)

export type Constraint = {
  id: string;
  kind: ConstraintKind;
  refs: string[];
  value?: number | null;
  /** false: a reference dimension that shows the measured value and constrains nothing. */
  driving?: boolean;
  /** Which way round, where the geometry allows two (tangent sides): +1 or −1, taken from the drawing. */
  side?: number;
};

export type Sketch = {
  id: string;
  name: string;
  points: SketchPoint[];
  shapes: Shape[];
  constraints: Constraint[];
};

export const DIMENSIONS: ConstraintKind[] = ["distance", "point_line_distance", "angle", "radius", "diameter"];
