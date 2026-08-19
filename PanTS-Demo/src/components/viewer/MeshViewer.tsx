import { Bounds, OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { registerMeshRoot } from "../../helpers/viewer/meshCapture";
import { Suspense, useEffect, useMemo, useState } from "react";
import { APP_CONSTANTS } from "../../helpers/constants";
import { cornerstoneLpsMmToThree, type Vec3 } from "../../helpers/utils";
import type { MeshManifest } from "../../types";
import { OrganMesh } from "./OrganMesh";
import { SceneCrosshair3D } from "./SceneCrosshair3D";
import type { Color } from "@cornerstonejs/core/types";
import { LiveSegmentMesh } from "./LiveSegmentMesh";
import type { CheckBoxData } from "../../types";
import { getEditedSegments, subscribeToSegmentationEdits } from "../../helpers/CornerstoneNifti2";

type SegmentationMeshViewerProps = {
  caseId: string;
  loading: boolean
  checkState: boolean[];
  opacity: number;
  crosshairMm: Vec3 | null
  customOrgans?: CheckBoxData[];
  labelColorMap?: { [key: number]: Color };
  // Uploaded scans have no pre-baked meshes; fetch from the session route, which
  // builds them on demand from the session's combined_labels.
  isSession?: boolean;
  // ── Capture-only options (demo/cinematic-capture) ──────────────────────────
  // All default off, so the viewer's normal render path is byte-for-byte unchanged.
  // Used by /cinematic to shoot hero footage: hands-free rotation and a rim light
  // that reads as a product shot rather than a viewport.
  autoRotate?: boolean;
  autoRotateSpeed?: number;
  cinematic?: boolean;
  // Supply a manifest instead of fetching one. /cinematic passes a manifest read
  // from public/meshes (see scripts/download-meshes.mjs) whose organ urls already
  // point at local GLBs, so the cold open shoots with no backend reachable.
  manifestOverride?: MeshManifest | null;
  // Bounds fit margin. Larger pulls the camera back; below ~1 the near plane
  // starts cutting through the geometry and the frame goes empty.
  boundsMargin?: number;
};

/**
 * The server bakes fully-qualified GLB urls into manifest.json
 * ("https://bodymaps.wse.jhu.edu/api/cases/.../liver.glb"). Those bypass
 * API_BASE and the dev proxy, so three.js fetches the public host directly no
 * matter where the app is running — which breaks the 3D pane whenever that
 * hostname is unreachable but the API is (dev proxy, SSH tunnel, staging).
 *
 * Keeping only the path makes each url same-origin, so it follows whatever
 * route the rest of the app already uses. In production this is a no-op: the
 * app and the API share an origin there.
 */
function toSameOriginPath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url; // already relative
  }
}

export async function fetchMeshManifest(caseId: string, isSession = false): Promise<MeshManifest> {
  const base = isSession
    ? `${APP_CONSTANTS.API_ORIGIN}/api/sessions/${caseId}/mesh-manifest`
    : `${APP_CONSTANTS.API_ORIGIN}/api/cases/${caseId}/mesh-manifest`;
  const res = await fetch(base);
  if (!res.ok) throw new Error(`Failed to fetch mesh manifest: ${res.status}`);
  const manifest: MeshManifest = await res.json();
  return {
    ...manifest,
    organs: (manifest.organs ?? []).map((o) => ({ ...o, url: toSameOriginPath(o.url) })),
  };
}

export function SegmentationMeshViewer({ caseId, checkState, loading, opacity, crosshairMm, customOrgans = [], labelColorMap = {}, isSession = false, autoRotate = false, autoRotateSpeed = 0.6, cinematic = false, manifestOverride = null, boundsMargin = 1.2}: SegmentationMeshViewerProps) {
  const [manifest, setManifest] = useState<MeshManifest | null>(null);
  const [loaded, setLoaded] = useState<Record<number, boolean>>({});
  // Bumped on every mask edit so editedSegments below is recomputed — the 3D pane
  // needs to know the instant a static organ's mask changes, not just at mount.
  const [editVersion, setEditVersion] = useState(0);

  useEffect(() => {
    const unsubscribe = subscribeToSegmentationEdits(() => setEditVersion((v) => v + 1));
    return unsubscribe;
  }, []);

  // Drop the renderer handle when this pane goes away, so a capture can never
  // reach into a disposed WebGL context.
  useEffect(() => () => registerMeshRoot(null), []);

  // Segment indices touched since the case loaded — includes edits to the STATIC
  // 32-organ catalog, not just brand-new custom classes.
  const editedSegments = useMemo(() => getEditedSegments(), [editVersion]);

  const crosshairPosition = useMemo(() => {
    if (!manifest || !crosshairMm) return null;
    return cornerstoneLpsMmToThree(crosshairMm, manifest.center);
  }, [manifest, crosshairMm]);

  useEffect(() => {
    let alive = true;

    const apply = (data: MeshManifest) => {
      if (!alive) return;
      setManifest(data);
      const initialLoaded: Record<number, boolean> = {};
      for (const organ of data.organs) initialLoaded[organ.id] = true;
      setLoaded(initialLoaded);
    };

    // A supplied manifest short-circuits the fetch entirely — nothing hits the API.
    if (manifestOverride) {
      apply(manifestOverride);
      return () => { alive = false; };
    }

    fetchMeshManifest(caseId, isSession)
      .then(apply)
      .catch((err) => console.error(err));
    return () => { alive = false; };
  }, [caseId, isSession, manifestOverride]);

  const organs = useMemo(() => manifest?.organs ?? [], [manifest]);

  if (!manifest || loading || !checkState || checkState.length === 0) {
    return <div>Loading 3D segmentation...</div>;
  }
  return (
    <div style={{ display: "flex", width: "100%", height: "100%" }}>
      <main style={{ flex: 1, minWidth: 0 }}>
        {/*
          preserveDrawingBuffer is REQUIRED for the AI assistant's snapshots.
          WebGL clears the drawing buffer as soon as the frame is composited, so
          without it canvas.toDataURL() reads an already-cleared buffer and the
          captured "3D view" is a black rectangle. data-bodymaps-3d marks the
          canvas so the capture helper picks this one and never an unrelated
          canvas that happens to sit in the same pane.

          /cinematic's PNG-sequence capture needs the same readable buffer, and
          additionally renders at 2x DPR for the high-res frames. It used to
          switch preserveDrawingBuffer on only for capture (it costs a little
          performance in normal viewing), but the assistant needs it always on,
          so the flag is now unconditional and only dpr keys off `cinematic`.
        */}
        <Canvas
          camera={{ position: [0, 250, 650], fov: 45, near: 0.1, far: 5000 }}
          gl={{ preserveDrawingBuffer: true, antialias: true }}
          dpr={cinematic ? 2 : undefined}
          frameloop="always"
          onCreated={(state) => {
            registerMeshRoot(state);
            state.gl.domElement.setAttribute("data-bodymaps-3d", "1");
          }}
        >
          <color attach="background" args={["#050505"]} />
          {/* Cinematic drops the fill so the rim light below actually reads. */}
          <ambientLight intensity={cinematic ? 0.35 : 0.7} />
          <directionalLight position={[300, 500, 300]} intensity={1.2} />
          {cinematic && (
            <directionalLight position={[-400, 200, -500]} intensity={1.8} color="#8ab6ff" />
          )}
          <Suspense fallback={null}>
            <Bounds fit clip observe margin={boundsMargin}>
              <group>
                {organs.map((organ) => {
                  if (!loaded[organ.id]) return null;
                  // Edited static organ: the server-baked GLB is stale — extract a
                  // fresh live mesh from the in-memory labelmap instead, same path
                  // custom classes already use.
                  if (editedSegments.has(organ.id)) {
                    return (
                      <LiveSegmentMesh
                        key={`live-${organ.id}`}
                        segmentIndex={organ.id}
                        color={labelColorMap[organ.id] ?? [255, 255, 255, 255]}
                        visible={!!checkState[organ.id]}
                        opacity={opacity / 100}
                        manifestCenter={manifest.center as [number, number, number]}
                      />
                    );
                  }
                  return (
                    <OrganMesh
                      key={organ.id}
                      organ={organ}
                      visible={!!checkState[organ.id]}
                      opacity={opacity/100}
                      smooth={cinematic}
                    />
                  );
                })}
                {customOrgans.map((organ) => (
                  <LiveSegmentMesh
                    key={organ.id}
                    segmentIndex={organ.id}
                    color={labelColorMap[organ.id] ?? [255, 255, 255, 255]}
                    visible={!!checkState[organ.id]}
                    opacity={opacity / 100}
                    manifestCenter={manifest.center as [number, number, number]}
                  />
                ))}
              </group>
            </Bounds>
            {crosshairPosition && manifest.bounds && (
              <SceneCrosshair3D position={crosshairPosition} bounds={manifest.bounds} />
            )}
          </Suspense>
          <OrbitControls makeDefault autoRotate={autoRotate} autoRotateSpeed={autoRotateSpeed} />
        </Canvas>
      </main>
    </div>
  );
}