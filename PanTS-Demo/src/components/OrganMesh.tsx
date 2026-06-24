import { useGLTF } from "@react-three/drei";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { segmentation_category_colors } from '../helpers/constants';
import type { OrganMeshInfo } from "../types";
type OrganMeshProps = {
  organ: OrganMeshInfo;
  visible: boolean;
  opacity?: number;
};

export const rgbToHex = (r: number, g: number, b: number, _a: number) => 
  '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');

export function OrganMesh({ organ, visible, opacity = 1 }: OrganMeshProps) {
  const gltf = useGLTF(organ.url);
  const object = useMemo(() => {
    return gltf.scene.clone(true);
  }, [gltf.scene]);

  useEffect(() => {
    object.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      
      child.material = new THREE.MeshStandardMaterial({
        color: new THREE.Color(rgbToHex(...segmentation_category_colors[organ.id])),
        roughness: 0.75,
        metalness: 0.0,
        transparent: opacity < 1,
        opacity,
        side: THREE.DoubleSide,
      });

      child.frustumCulled = true;
    });
  }, [object, organ.id, opacity]);

  return <primitive object={object} visible={visible} />;
}