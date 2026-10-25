"use client";

import { CameraControls, GizmoHelper, GizmoViewport, Grid, OrthographicCamera, PerspectiveCamera } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { Box3, DoubleSide, EdgesGeometry, Sphere, Vector3 } from "three";
import type { MemberResult, Vec } from "@/lib/frame/kernel";
import { memberGeometry } from "@/lib/frame/mesh";
import { useCssVars, useFrameUI, type View } from "@/lib/frame/ui";

/** Frames are Z-up in millimetres; three.js is Y-up. Everything is drawn inside a group turned -90° about X. */
const toThree = ([x, y, z]: Vec): [number, number, number] => [x, z, -y];
const COLORS = ["--wood-3d", "--steel-3d", "--edge-3d", "--view-3d", "--accent", "--line-strong"] as const;

export type JointMarker = { id: string; at: Vec; size: number };

export function Viewport({ members, joints, steel, readOnly }: {
  members: MemberResult[]; joints: JointMarker[]; steel: Set<string>; readOnly?: boolean;
}) {
  const c = useCssVars(COLORS);
  const ortho = useFrameUI((s) => s.ortho);
  const select = useFrameUI((s) => s.select);
  return (
    <Canvas frameloop="demand" dpr={[1, 2]} onPointerMissed={() => select(null)} style={{ background: c["--view-3d"] }}
      gl={{ antialias: true }}>
      {ortho ? <OrthographicCamera makeDefault position={[3000, 2500, 3000]} near={-100000} far={100000} zoom={0.3} />
        : <PerspectiveCamera makeDefault position={[3000, 2500, 3000]} fov={35} near={10} far={200000} />}
      <Controls key={ortho ? "o" : "p"} members={members} />
      <hemisphereLight args={["#ffffff", "#8a8a8a", 1.6]} />
      <directionalLight position={[2000, 4000, 3000]} intensity={1.4} />
      <directionalLight position={[-3000, 1500, -2000]} intensity={0.5} />
      <Grid args={[20000, 20000]} cellSize={100} sectionSize={1000} cellThickness={0.6} sectionThickness={1}
        cellColor={c["--line-strong"]} sectionColor={c["--edge-3d"]} fadeDistance={14000} fadeStrength={1.5} infiniteGrid
        position={[0, -0.5, 0]} />
      <group rotation={[-Math.PI / 2, 0, 0]}>
        {members.map((m) => (
          <Member key={m.id} m={m} color={steel.has(m.item_id ?? "") ? c["--steel-3d"] : c["--wood-3d"]} edge={c["--edge-3d"]} accent={c["--accent"]} />
        ))}
        {!readOnly ? joints.map((j) => <Joint key={j.id} j={j} accent={c["--accent"]} edge={c["--edge-3d"]} />) : null}
      </group>
      {/* A passive axis hint (views are the toolbar's job). Three's +Z is the frame's -Y, so that arm is labelled -Y. */}
      <GizmoHelper alignment="bottom-left" margin={[56, 56]}>
        <GizmoViewport disabled axisColors={["#e5484d", "#3b82f6", "#30a46c"]} labels={["X", "Z", "-Y"]} labelColor="#ffffff" axisHeadScale={0.8} hideNegativeAxes />
      </GizmoHelper>
    </Canvas>
  );
}

function Member({ m, color, edge, accent }: { m: MemberResult; color: string; edge: string; accent: string }) {
  const geometry = useMemo(() => memberGeometry(m), [m]);
  const edges = useMemo(() => new EdgesGeometry(geometry, 25), [geometry]);
  useEffect(() => () => { geometry.dispose(); edges.dispose(); }, [geometry, edges]);
  const selected = useFrameUI((s) => s.selected?.kind === "member" && s.selected.id === m.id);
  const lit = useFrameUI((s) => s.hovered.includes(m.id));
  const select = useFrameUI((s) => s.select);
  const hover = useFrameUI((s) => s.hover);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => { invalidate(); }, [selected, lit, invalidate]);
  return (
    <group>
      <mesh geometry={geometry}
        onClick={(e) => { e.stopPropagation(); select({ kind: "member", id: m.id }); }}
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
    <mesh position={j.at} onClick={(e) => { e.stopPropagation(); select({ kind: "node", id: j.id }); }}
      onPointerOver={() => { document.body.style.cursor = "pointer"; }} onPointerOut={() => { document.body.style.cursor = ""; }}
      renderOrder={2}>
      <sphereGeometry args={[j.size, 16, 12]} />
      <meshBasicMaterial color={selected ? accent : edge} transparent opacity={selected ? 0.95 : 0.35} depthTest={false} />
    </mesh>
  );
}

/** Camera controls plus the standard views and "fit" requested through the UI store. */
function Controls({ members }: { members: MemberResult[] }) {
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
    const dir = new Vector3(...dirs[view.name === "fit" ? "iso" : view.name]).normalize().multiplyScalar(size * 1.6);
    const eye = center.clone().add(dir);
    const animate = view.n > 0;
    // camera-controls settles on rendered frames, and this canvas renders on demand: ask for one.
    const run = () => {
      void cc.setLookAt(eye.x, eye.y, eye.z, center.x, center.y, center.z, animate);
      // fitToBox snaps to the nearest axis; a sphere keeps the view direction we just set.
      void cc.fitToSphere(box.getBoundingSphere(new Sphere()), animate);
      invalidate();
    };
    // The first fit waits a frame so the camera has the canvas's final aspect.
    if (animate) run();
    else { const raf = requestAnimationFrame(() => requestAnimationFrame(run)); return () => cancelAnimationFrame(raf); }
    // Re-run on explicit requests, when the frame first appears, on resize and camera swaps; not on every edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, hasMembers, width, height, camera]);

  return <CameraControls ref={ref} makeDefault minDistance={100} maxDistance={60000} dollyToCursor smoothTime={0.2} />;
}
