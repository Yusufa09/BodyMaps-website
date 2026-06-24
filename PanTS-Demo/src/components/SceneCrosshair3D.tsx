import { useMemo } from "react";
import * as THREE from "three";

type Vec3 = [number, number, number];

type SceneBounds = {
    min: Vec3;
    max: Vec3;
};

type SceneCrosshair3DProps = {
    position: Vec3;
    bounds: SceneBounds;
    padding?: number;
};

function makeLineGeometry(a: Vec3, b: Vec3) {
    const geometry = new THREE.BufferGeometry();

    geometry.setFromPoints([
        new THREE.Vector3(a[0], a[1], a[2]),
        new THREE.Vector3(b[0], b[1], b[2]),
    ]);

    return geometry;
}

function makeLine(
  a: Vec3,
  b: Vec3,
  material: THREE.LineBasicMaterial
) {
  const geometry = makeLineGeometry(a, b);
  const line = new THREE.Line(geometry, material);

  line.renderOrder = 999;
  line.frustumCulled = false;

  return line;
}

export function SceneCrosshair3D({
    position,
    bounds,
    padding = 50,
}: SceneCrosshair3DProps) {
    const [x, y, z] = position;

    const minX = bounds.min[0] - padding;
    const minY = bounds.min[1] - padding;
    const minZ = bounds.min[2] - padding;

    const maxX = bounds.max[0] + padding;
    const maxY = bounds.max[1] + padding;
    const maxZ = bounds.max[2] + padding;

    /**
     * X line:
     *   x varies
     *   y,z fixed at crosshair position
     *
     * Y line:
     *   y varies
     *   x,z fixed
     *
     * Z line:
     *   z varies
     *   x,y fixed
     */
    const material = useMemo(() => {
    return new THREE.LineBasicMaterial({
      color: "white",
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 1,
    });
  }, []);

    const xLine = useMemo(() => {
    return makeLine([minX, y, z], [maxX, y, z], material);
    }, [minX, maxX, y, z, material]);

    const yLine = useMemo(() => {
        return makeLine([x, minY, z], [x, maxY, z], material);
    }, [x, minY, maxY, z, material]);

    const zLine = useMemo(() => {
        return makeLine([x, y, minZ], [x, y, maxZ], material);
    }, [x, y, minZ, maxZ, material]);

    return (
        <group renderOrder={999}>
        <primitive object={xLine} />
        <primitive object={yLine} />
        <primitive object={zLine} />
        </group>
    );
}