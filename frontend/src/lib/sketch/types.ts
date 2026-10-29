/**
 * A 2D sketch: points (mm, y up), shapes built on them, and the constraints that pin them. The
 * shapes come from the API schema (backend/app/models/sketch.py), so a solved sketch saves as is.
 *
 * Constraint kinds and their refs:
 * - coincident (two points), horizontal / vertical (a line), parallel / perpendicular (two lines)
 * - equal: two lines (length) or two circles/arcs (radius)
 * - tangent: a line and a circle/arc, or two circles/arcs; `side` (+1 / −1) says which way round
 * - on_line / on_circle: a point on a line (extended) / circle or arc; midpoint: a point and a line
 * - fix: a point stays where it is
 * - horizontal / vertical with two points: level with each other / one above the other
 * - collinear: two lines on one straight line; symmetric: two points mirrored about a line
 * - dimensions, with `value`: distance (two points, or a line's length, mm), point_line_distance
 *   (mm), angle (line 1 to line 2, counter-clockwise, degrees, may be negative), radius / diameter
 *   (a circle or arc, mm). `driving: false` makes a reference dimension: it shows the measured
 *   value and constrains nothing.
 *
 * Where a relation or dimension takes a point, a line's midpoint will do: "mid:<line id>". It's
 * worked out from the line's ends, never stored. A shape marked `construction` is a helper (a
 * centre line, a diagonal): it positions the rest, but isn't a part and needs no size.
 */
import type { Schemas } from "@/lib/api/client";

export type SketchPoint = Schemas["SketchPoint"];
export type Line = Schemas["SketchLine-Output"];
export type Circle = Schemas["SketchCircle-Output"];
/** Centre, start and end, counter-clockwise from start to end. Its radius is |start − centre|. */
export type Arc = Schemas["SketchArc-Output"];
export type Shape = Line | Circle | Arc;
export type Constraint = Schemas["SketchConstraint-Output"];
export type ConstraintKind = Constraint["kind"];
export type Sketch = Schemas["Sketch-Output"];

export const DIMENSIONS: ConstraintKind[] = ["distance", "point_line_distance", "angle", "radius", "diameter"];

/**
 * Every sketch has an origin (a point fixed at 0, 0) and two axes through it. They aren't stored:
 * shapes and constraints refer to them by these ids, so a drawing attached to them stays put.
 */
export const ORIGIN = "origin";
export const X_AXIS = "x_axis";
export const Y_AXIS = "y_axis";
export const AXES = [X_AXIS, Y_AXIS];
export const isBuiltIn = (id: string) => id === ORIGIN || id === X_AXIS || id === Y_AXIS;

/** A line's midpoint, as a point for relations and dimensions. */
export const MID = "mid:";
export const midOf = (lineId: string) => MID + lineId;
export const isMid = (id: string) => id.startsWith(MID);
/** The line a midpoint belongs to, or the id itself. */
export const baseOf = (id: string) => (isMid(id) ? id.slice(MID.length) : id);
