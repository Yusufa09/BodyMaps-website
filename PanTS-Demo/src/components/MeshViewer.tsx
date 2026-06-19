import { Bounds, OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useState } from "react";
import { APP_CONSTANTS } from "../helpers/constants";
import type { MeshManifest } from "../types";
import { OrganMesh } from "./OrganMesh";

type SegmentationMeshViewerProps = {
  caseId: string;
  loading: boolean
  checkState: boolean[];
};


export async function fetchMeshManifest(caseId: string): Promise<MeshManifest> {
  const res = await fetch(`${APP_CONSTANTS.API_ORIGIN}/api/cases/${caseId}/mesh-manifest`);

  if (!res.ok) {
    throw new Error(`Failed to fetch mesh manifest: ${res.status}`);
  }

  return res.json();
}

export function SegmentationMeshViewer({ caseId, checkState, loading }: SegmentationMeshViewerProps) {
  const [manifest, setManifest] = useState<MeshManifest | null>(null);
  const [loaded, setLoaded] = useState<Record<number, boolean>>({});

  useEffect(() => {
    let alive = true;

    fetchMeshManifest(caseId)
      .then((data) => {
        if (!alive) return;

        setManifest(data);

        const initialLoaded: Record<number, boolean> = {};

        for (const organ of data.organs) {
          initialLoaded[organ.id] = true;
        }

        setLoaded(initialLoaded);
      })
      .catch((err) => {
        console.error(err);
      });

    return () => {
      alive = false;
    };
  }, [caseId]);

  const organs = useMemo(() => manifest?.organs ?? [], [manifest]);

  if (!manifest || loading || !checkState || checkState.length === 0) {
    return <div>Loading 3D segmentation...</div>;
  }
  return (
    <div style={{ display: "flex", width: "100%", height: "100%" }}>
      <main style={{ flex: 1, minWidth: 0 }}>
        <Canvas
          camera={{
            position: [0, 250, 650],
            fov: 45,
            near: 0.1,
            far: 5000,
          }}
        >
          <color attach="background" args={["#050505"]} />

          <ambientLight intensity={0.7} />
          <directionalLight position={[300, 500, 300]} intensity={1.2} />

          <Suspense fallback={null}>
            <Bounds fit clip observe margin={1.2}>
              <group>
                {organs.map((organ) => {
                  if (!loaded[organ.id]) return null;

                  return (
                    <OrganMesh
                      key={organ.id}
                      organ={organ}
                      visible={!!checkState[organ.id]}
                    />
                  );
                })}
              </group>
            </Bounds>
          </Suspense>

          <OrbitControls makeDefault />
        </Canvas>
      </main>
    </div>
  );
}