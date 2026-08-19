import { useGLTF } from "@react-three/drei";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { segmentation_category_colors } from '../../helpers/constants';
import type { OrganMeshInfo } from "../../types";
type OrganMeshProps = {
  organ: OrganMeshInfo;
  visible: boolean;
  opacity?: number;
  // Capture-only. The GLBs come from marching cubes over a binary mask, so every
  // voxel step is a hard facet — fine in a small viewport pane, obvious when the
  // mesh fills a 4K frame. Recomputing vertex normals shades those steps smoothly
  // without touching the geometry. Off by default so the viewer is unchanged.
  smooth?: boolean;
};

export const rgbToHex = (r: number, g: number, b: number, _a: number) => 
  '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');

export function OrganMesh({ organ, visible, opacity = 1, smooth = false }: OrganMeshProps) {
  const gltf = useGLTF(organ.url);
  const object = useMemo(() => {
    return gltf.scene.clone(true);
  }, [gltf.scene]);

  useEffect(() => {
    object.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;

      if (smooth && child.geometry) {
        child.geometry.deleteAttribute("normal");
        child.geometry.computeVertexNormals();
      }

      const rgba = segmentation_category_colors[organ.id];
      if (!rgba) {
        console.warn("OrganMesh: no colour for id", organ.id, organ.key ?? organ.name);
      }

      child.material = new THREE.MeshStandardMaterial({
        color: new THREE.Color(rgba ? rgbToHex(...rgba) : "#ffffff"),
        roughness: smooth ? 0.5 : 0.75,
        metalness: 0.0,
        transparent: opacity < 1,
        opacity,
        side: THREE.DoubleSide,
        flatShading: false,
      });

      child.frustumCulled = true;
    });
  }, [object, organ.id, opacity, smooth]);

  return <primitive object={object} visible={visible} />;
}