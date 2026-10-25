/** A drawn frame, as stored on an assembly. Mirrors backend/app/models/frame.py. */

export type Anchor = "auto" | "c" | "t" | "b" | "l" | "r" | "tl" | "tr" | "bl" | "br";

export type FrameParam = { name: string; mm: number; label?: string };
export type FrameNode = { id: string; x: number | string; y: number | string; z: number | string };
export type FrameMember = {
  id: string; a: string; b: string; item_id?: string | null; roll_deg?: number; anchor?: Anchor; name?: string;
};
export type FrameJoint = { node: string; kind: "miter" | "butt"; through?: string | null };
export type FrameDefaults = { corner: "miter" | "butt"; lines: "outside" | "centerline" };

export type Frame = {
  version?: number;
  params?: FrameParam[];
  defaults?: Partial<FrameDefaults>;
  nodes: FrameNode[];
  members: FrameMember[];
  joints?: FrameJoint[];
};

export type ProfileShape = "rect" | "flat_bar" | "rect_tube" | "round_tube" | "round_bar" | "angle" | "channel";
export type ProfileSpec = { shape: ProfileShape; w: number; h: number; t?: number };
