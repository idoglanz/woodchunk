"use client";

import { CameraControls, CameraControlsImpl, GizmoHelper, GizmoViewport, Grid, OrthographicCamera, PerspectiveCamera } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { memo, useEffect, useMemo, useRef, type RefObject } from "react";
import { Box3, DoubleSide, EdgesGeometry, Sphere, Vector3 } from "three";
import { DrawLayer, LabelProjector, NodeHandle, toThree, type DimAnchor } from "@/components/frame/edit-layers";
import type { Endpoint } from "@/lib/frame/edit";
import type { MemberResult, Vec } from "@/lib/frame/kernel";
import { memberGeometry } from "@/lib/frame/mesh";
import type { Frame } from "@/lib/frame/types";
import { flatPlane, useCssVars, useFrameUI, type DrawStart, type View } from "@/lib/frame/ui";
import { nodePositions } from "@/lib/frame/edit";

/** Frames are Z-up in millimetres; three.js is Y-up. Everything is drawn inside a group turned -90° about X. */
export type EditHandlers = {
  /** Move a joint; `join`: it was dropped on that joint, so the two become one. */
  onMove: (node: string, at: Vec, join?: string) => void;
  onAdd: (from: DrawStart, to: Endpoint) => { node: string; at: Vec } | null;
  onParam: (name: string, mm: number) => void;
  onLabel: (key: string, mm: number) => void;
};

const COLORS = ["--wood-3d", "--steel-3d", "--edge-3d", "--view-3d", "--accent", "--grid-3d"] as const;

export type JointMarker = { id: string; at: Vec; size: number };

/**
 * A small 3D look at the frame for the corner of a flat view (click to go back to 3D). Static:
 * it renders only when the frame changes.
 */
export function MiniView({ members, steel }: { members: MemberResult[]; steel: Set<string> }) {
  const c = useCssVars(COLORS);
  const look = useFrameUI((s) => s.look);
  const cam = useMemo(() => {
    const b = new Box3();
    for (const m of members) { b.expandByPoint(new Vector3(...toThree(m.a))); b.expandByPoint(new Vector3(...toThree(m.b))); }
    if (b.isEmpty()) return null;
    const sphere = b.getBoundingSphere(new Sphere());
    const dir = new Vector3(...toThree([0.9, -1.3, 0.85])).normalize();
    const eye = sphere.center.clone().add(dir.multiplyScalar((sphere.radius * 1.15) / Math.sin((30 * Math.PI) / 360)));
    return { eye: eye.toArray() as [number, number, number], target: sphere.center.toArray() as [number, number, number] };
  }, [members]);
  if (!cam) return null;
  return (
    <button type="button" onClick={() => look("iso")} aria-label="Back to the 3D view" title="Back to 3D"
      className="absolute bottom-3 end-3 z-10 h-36 w-48 overflow-hidden rounded-[14px] border border-line shadow-[var(--shadow-pop)] sm:h-44 sm:w-60">
      <Canvas frameloop="demand" dpr={[1, 1.5]} style={{ background: c["--view-3d"], pointerEvents: "none" }}
        camera={{ fov: 30, near: 10, far: 200000, position: cam.eye }} onCreated={({ camera }) => camera.lookAt(...cam.target)}>
        <hemisphereLight args={["#ffffff", "#8a8a8a", 1.6]} />
        <directionalLight position={[2000, 4000, 3000]} intensity={1.4} />
        <LookAt target={cam.target} eye={cam.eye} />
        <group rotation={[-Math.PI / 2, 0, 0]}>
          {members.map((m) => (
            <Member key={m.id} m={m} color={steel.has(m.item_id ?? "") ? c["--steel-3d"] : c["--wood-3d"]} edge={c["--edge-3d"]} accent={c["--accent"]} />
          ))}
        </group>
      </Canvas>
      <span className="absolute start-2 top-2 rounded-full bg-surface/90 px-2 py-0.5 text-[11px] font-semibold text-ink-2">3D</span>
    </button>
  );
}

function LookAt({ eye, target }: { eye: [number, number, number]; target: [number, number, number] }) {
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => { camera.position.set(...eye); camera.lookAt(...target); invalidate(); }, [camera, eye, target, invalidate]);
  return null;
}

export function Viewport({ frame, members, joints, steel, readOnly, edit, anchors, labels }: {
  frame: Frame; members: MemberResult[]; joints: JointMarker[]; steel: Set<string>; readOnly?: boolean; edit: EditHandlers;
  anchors: DimAnchor[]; labels: RefObject<Map<string, HTMLElement>>;
}) {
  const c = useCssVars(COLORS);
  const mode = useFrameUI((s) => s.mode);
  const depth = useFrameUI((s) => (s.mode === "3d" ? null : s.depth[s.mode]));
  const flat = mode !== "3d";
  // The grid flat views draw on, at the drawing depth (three.js coordinates: Y up, -Z = frame Y).
  const sheet = useMemo(() => {
    if (mode === "3d") return null;
    const at = flatPlane(mode, depth, nodePositions(frame).values()).at;
    return mode === "top" ? { position: [0, at, 0] as const, rotation: [0, 0, 0] as const }
      : mode === "front" ? { position: [0, 0, -at] as const, rotation: [Math.PI / 2, 0, 0] as const }
      : { position: [at, 0, 0] as const, rotation: [0, 0, Math.PI / 2] as const };
  }, [mode, depth, frame]);
  // Flat views are always orthographic (true lengths, no perspective).
  const ortho = useFrameUI((s) => s.ortho) || flat;
  const select = useFrameUI((s) => s.select);
  return (
    <Canvas frameloop="demand" dpr={[1, 2]} onPointerMissed={() => { if (useFrameUI.getState().tool === "select") select(null); }} style={{ background: c["--view-3d"] }}
      gl={{ antialias: true }}>
      {ortho ? <OrthographicCamera makeDefault position={[3000, 2500, 3000]} near={-100000} far={100000} zoom={0.3} />
        : <PerspectiveCamera makeDefault position={[3000, 2500, 3000]} fov={35} near={10} far={200000} />}
      <Controls key={ortho ? "o" : "p"} members={members} flat={flat} ortho={ortho} />
      <hemisphereLight args={["#ffffff", "#8a8a8a", 1.6]} />
      <directionalLight position={[2000, 4000, 3000]} intensity={1.4} />
      <directionalLight position={[-3000, 1500, -2000]} intensity={0.5} />
      {sheet ? (
        // Not "infinite": drei's infinite grid assumes a horizontal floor.
        <Grid args={[40000, 40000]} cellSize={100} sectionSize={1000} cellThickness={0.6} sectionThickness={1}
          cellColor={c["--grid-3d"]} sectionColor={c["--edge-3d"]} fadeDistance={100000} fadeStrength={0}
          position={[sheet.position[0], sheet.position[1], sheet.position[2]]} rotation={[sheet.rotation[0], sheet.rotation[1], sheet.rotation[2]]} />
      ) : (
        <Grid args={[20000, 20000]} cellSize={100} sectionSize={1000} cellThickness={0.6} sectionThickness={1}
          cellColor={c["--grid-3d"]} sectionColor={c["--edge-3d"]} fadeDistance={14000} fadeStrength={1.5} infiniteGrid
          position={[0, -0.5, 0]} />
      )}
      <group rotation={[-Math.PI / 2, 0, 0]}>
        {members.map((m) => (
          <Member key={m.id} m={m} color={steel.has(m.item_id ?? "") ? c["--steel-3d"] : c["--wood-3d"]} edge={c["--edge-3d"]} accent={c["--accent"]} />
        ))}
        {!readOnly ? <>
          {joints.map((j) => <Joint key={j.id} j={j} accent={c["--accent"]} edge={c["--edge-3d"]} />)}
          <NodeHandle frame={frame} onMove={edit.onMove} />
          <DrawLayer frame={frame} members={members} onAdd={edit.onAdd} />
        </> : null}
      </group>
      <LabelProjector anchors={anchors} labels={labels} />
      {/* A passive axis hint (views are the toolbar's job). Three's +Z is the frame's -Y, so that arm is labelled -Y. */}
      <GizmoHelper alignment="bottom-left" margin={[56, 56]}>
        <GizmoViewport disabled axisColors={["#e5484d", "#3b82f6", "#30a46c"]} labels={["X", "Z", "-Y"]} labelColor="#ffffff" axisHeadScale={0.8} hideNegativeAxes />
      </GizmoHelper>
    </Canvas>
  );
}

/** What a bar's solid depends on: when this is unchanged its geometry is reused. */
function shapeKey(m: MemberResult): string {
  const p = m.profile;
  return JSON.stringify([m.a, m.b, m.u, m.v, m.anchor_uv, m.planes, p.shape, p.w, p.h, p.t]);
}

type MemberProps = { m: MemberResult; color: string; edge: string; accent: string };

// Re-render (and re-mesh) a bar only when its own shape or colours change, not on every edit.
const Member = memo(MemberImpl, (a: MemberProps, b: MemberProps) =>
  a.color === b.color && a.edge === b.edge && a.accent === b.accent && a.m.id === b.m.id && shapeKey(a.m) === shapeKey(b.m));

function MemberImpl({ m, color, edge, accent }: MemberProps) {
  const geometry = useMemo(() => memberGeometry(m), [m]);
  const edges = useMemo(() => new EdgesGeometry(geometry, 25), [geometry]);
  useEffect(() => () => { geometry.dispose(); edges.dispose(); }, [geometry, edges]);
  useEffect(() => () => { document.body.style.cursor = ""; }, []); // deleted while hovered
  const selected = useFrameUI((s) => s.selected?.kind === "member" && s.selected.id === m.id);
  const lit = useFrameUI((s) => s.hovered.includes(m.id));
  const select = useFrameUI((s) => s.select);
  const hover = useFrameUI((s) => s.hover);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => { invalidate(); }, [selected, lit, invalidate]);
  return (
    <group>
      <mesh geometry={geometry}
        onClick={(e) => { if (useFrameUI.getState().tool !== "select") return; e.stopPropagation(); select({ kind: "member", id: m.id }); }}
        onPointerOver={(e) => { e.stopPropagation(); hover([m.id]); document.body.style.cursor = "pointer"; }}
        onPointerOut={() => { hover([]); document.body.style.cursor = ""; }}>
        <meshStandardMaterial color={selected ? accent : color} emissive={lit && !selected ? accent : "#000000"}
          emissiveIntensity={lit && !selected ? 0.35 : 0} roughness={0.75} metalness={0.05} side={DoubleSide} flatShading
          polygonOffset polygonOffsetFactor={1} polygonOffsetUnits={1} />
      </mesh>
      <lineSegments geometry={edges}>
        <lineBasicMaterial color={edge} transparent opacity={0.55} />
      </lineSegments>
    </group>
  );
}

function Joint({ j, accent, edge }: { j: JointMarker; accent: string; edge: string }) {
  const selected = useFrameUI((s) => s.selected?.kind === "node" && s.selected.id === j.id);
  const select = useFrameUI((s) => s.select);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => { invalidate(); }, [selected, invalidate]);
  return (
    <mesh position={j.at} onClick={(e) => { if (useFrameUI.getState().tool !== "select") return; e.stopPropagation(); select({ kind: "node", id: j.id }); }}
      onPointerOver={() => { document.body.style.cursor = "pointer"; }} onPointerOut={() => { document.body.style.cursor = ""; }}
      renderOrder={2}>
      <sphereGeometry args={[j.size, 16, 12]} />
      <meshBasicMaterial color={selected ? accent : edge} transparent opacity={selected ? 0.95 : 0.35} depthTest={false} />
    </mesh>
  );
}

/** Camera controls plus the standard views and "fit" requested through the UI store. */
function Controls({ members, flat, ortho }: { members: MemberResult[]; flat: boolean; ortho: boolean }) {
  const ref = useRef<CameraControls>(null);
  const view = useFrameUI((s) => s.view);
  const box = useMemo(() => {
    const b = new Box3();
    for (const m of members) { b.expandByPoint(new Vector3(...toThree(m.a))); b.expandByPoint(new Vector3(...toThree(m.b))); }
    if (b.isEmpty()) b.set(new Vector3(-500, 0, -500), new Vector3(500, 1000, 500));
    return b.expandByScalar(60);
  }, [members]);
  const hasMembers = members.length > 0;
  // The canvas starts at a default size; fit again once it has its real one (and on resize).
  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);
  const invalidate = useThree((s) => s.invalidate);
  // The default camera is swapped in after mount, which recreates the controls: fit those too.
  const camera = useThree((s) => s.camera);

  useEffect(() => {
    const cc = ref.current;
    if (!cc) return;
    const center = box.getCenter(new Vector3());
    const size = box.getSize(new Vector3()).length();
    const dirs: Record<View, [number, number, number]> = {
      iso: toThree([0.9, -1.3, 0.85]), front: toThree([0, -1, 0]), top: toThree([0, -0.0001, 1]), side: toThree([1, 0, 0]),
    };
    let target = center;
    let eye: Vector3;
    if (view.name === "along" && view.along) {
      // Sight down the bar from beyond its start, aimed at its middle.
      const a = new Vector3(...toThree(view.along.a)), b = new Vector3(...toThree(view.along.b));
      target = a.clone().add(b).multiplyScalar(0.5);
      eye = a.clone().sub(b.clone().sub(a).normalize().multiplyScalar(Math.max(800, size * 0.6)));
    } else {
      const dir = new Vector3(...dirs[view.name === "fit" || view.name === "along" ? "iso" : view.name]).normalize().multiplyScalar(size * 1.6);
      eye = center.clone().add(dir);
    }
    const animate = view.n > 0;
    // camera-controls settles on rendered frames, and this canvas renders on demand: ask for one.
    const run = () => {
      void cc.setLookAt(eye.x, eye.y, eye.z, target.x, target.y, target.z, animate);
      // fitToBox snaps to the nearest axis; a sphere keeps the view direction we just set.
      if (view.name !== "along") void cc.fitToSphere(box.getBoundingSphere(new Sphere()), animate);
      invalidate();
    };
    // The first fit waits a frame so the camera has the canvas's final aspect.
    if (animate) run();
    else { const raf = requestAnimationFrame(() => requestAnimationFrame(run)); return () => cancelAnimationFrame(raf); }
    // Re-run on explicit requests, when the frame first appears, on resize and camera swaps; not on every edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, hasMembers, width, height, camera]);

  // Flat views don't rotate: drag pans, the wheel zooms (fingers: one pans, two zoom).
  useEffect(() => {
    const cc = ref.current;
    if (!cc) return;
    const A = CameraControlsImpl.ACTION;
    cc.mouseButtons.left = flat ? A.TRUCK : A.ROTATE;
    cc.mouseButtons.right = A.TRUCK;
    cc.mouseButtons.wheel = ortho ? A.ZOOM : A.DOLLY;
    cc.touches.one = flat ? A.TOUCH_TRUCK : A.TOUCH_ROTATE;
    cc.touches.two = ortho ? A.TOUCH_ZOOM_TRUCK : A.TOUCH_DOLLY_TRUCK;
  }, [flat, ortho, camera]);

  return <CameraControls ref={ref} makeDefault minDistance={100} maxDistance={60000} dollyToCursor smoothTime={0.2} />;
}
