import { Bounds, OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useState } from "react";
import { OrganMesh, rgbToHex } from "../components/OrganMesh";
import { APP_CONSTANTS, segmentation_category_colors } from "../helpers/constants";
import type { MeshManifest } from "../types";

type SegmentationMeshViewerProps = {
  caseId: string;
};

export async function fetchMeshManifest(caseId: string): Promise<MeshManifest> {
  const res = await fetch(`${APP_CONSTANTS.API_ORIGIN}/api/cases/${caseId}/mesh-manifest`);

  if (!res.ok) {
    throw new Error(`Failed to fetch mesh manifest: ${res.status}`);
  }

  return res.json();
}

export default function SegmentationMeshViewer({ caseId }: SegmentationMeshViewerProps) {
  const [manifest, setManifest] = useState<MeshManifest | null>(null);
  const [visible, setVisible] = useState<Record<number, boolean>>({});
  const [loaded, setLoaded] = useState<Record<number, boolean>>({});
  const [opacity, setOpacity] = useState(1);

  useEffect(() => {
    let alive = true;

    fetchMeshManifest(caseId)
      .then((data) => {
        if (!alive) return;

        setManifest(data);

        const initialVisible: Record<number, boolean> = {};
        const initialLoaded: Record<number, boolean> = {};

        for (const organ of data.organs) {
          // Option A: start with all organs visible.
          initialVisible[organ.id] = true;
          initialLoaded[organ.id] = true;

          // Option B: start hidden and lazy-load on first toggle.
          // initialVisible[organ.id] = false;
          // initialLoaded[organ.id] = false;
        }

        setVisible(initialVisible);
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

  function toggleOrgan(id: number) {
    setVisible((prev) => {
      const nextValue = !prev[id];

      if (nextValue) {
        setLoaded((old) => ({
          ...old,
          [id]: true,
        }));
      }

      return {
        ...prev,
        [id]: nextValue,
      };
    });
  }

  function showAll() {
    const nextVisible: Record<number, boolean> = {};
    const nextLoaded: Record<number, boolean> = {};

    for (const organ of organs) {
      nextVisible[organ.id] = true;
      nextLoaded[organ.id] = true;
    }

    setVisible(nextVisible);
    setLoaded(nextLoaded);
  }

  function hideAll() {
    const nextVisible: Record<number, boolean> = {};

    for (const organ of organs) {
      nextVisible[organ.id] = false;
    }

    setVisible(nextVisible);
  }

  if (!manifest) {
    return <div>Loading 3D segmentation...</div>;
  }

  return (
    <div style={{ display: "flex", width: "100%", height: "100%" }}>
      <aside
        style={{
          width: 280,
          padding: 12,
          overflowY: "auto",
          borderRight: "1px solid #333",
        }}
      >
        <h3 style={{ color: "white" }}>Organs</h3>

        <div style={{ display: "flex", gap: 8, marginBottom: 12, color:"white"}}>
          <button onClick={showAll}>Show all</button>
          <button onClick={hideAll}>Hide all</button>
        </div>

        <label style={{ display: "block", marginBottom: 12, color:"white" }}>
          Opacity: {opacity.toFixed(2)}
          <input
            type="range"
            min={0.1}
            max={1}
            step={0.05}
            value={opacity}
            onChange={(e) => setOpacity(Number(e.target.value))}
            style={{ width: "100%" }}
          />
        </label>

        {organs.map((organ) => (
          <label
            key={organ.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 8,
              cursor: "pointer",
              color:"white"
            }}
          >
            <input
              type="checkbox"
              checked={!!visible[organ.id]}
              onChange={() => toggleOrgan(organ.id)}
            />

            <span
              style={{
                width: 14,
                height: 14,
                background: `${rgbToHex(...segmentation_category_colors[organ.id])}`,
                display: "inline-block",
                borderRadius: 3,
              }}
            />

            <span>{organ.name}</span>
          </label>
        ))}
      </aside>

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
                      visible={!!visible[organ.id]}
                      opacity={opacity}
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