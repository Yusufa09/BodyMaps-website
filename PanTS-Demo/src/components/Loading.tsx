import { Center, OrbitControls, useGLTF } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import React, { useEffect, useRef, useState } from "react";
import type { Object3D } from "three";

type Props = {
	organ: string;
};

const Model = ({ organ }: Props) => {
	const ref = useRef<Object3D>(null);
	const { scene } = useGLTF(`/3d-${organ}.glb`);
	// useFrame(() => {
	//   if (ref.current) {
	//     ref.current.rotation.y += 0.0025;
	//   }
	// })
	// const box = new THREE.Box3().setFromObject(scene);
	// const center = box.getCenter(new THREE.Vector3());
	// scene.position.sub(center);
	return (
		<Center>
			<primitive ref={ref} object={scene} scale={10} />
		</Center>
	);
};

const RotatingModelLoader: React.FC = () => {
	const ref = React.useRef<HTMLCanvasElement>(null);
	const containerRef = React.useRef<HTMLDivElement>(null);
	const [organ, setOrgan] = useState<number>(Math.round(Math.random() * 4));
	const organ_arr = ["pancreas", "kidney", "liver", "colon"];

	useEffect(() => {
		const onResize = () => {
			if (ref.current && containerRef.current) {
				ref.current.width = containerRef.current.offsetWidth;
				ref.current.height = containerRef.current.offsetHeight;
			}
		};

		onResize();
		window.addEventListener("resize", onResize);
		return () => {
			window.removeEventListener("resize", onResize);
		};
	}, []);

	return (
		<div className="absolute top-60 left-0 flex p-20 w-screen h-screen" ref={containerRef}>
			{organ_arr[organ] ? (
				<>
					{/* 3D Canvas */}
					<Canvas camera={{ position: [0, 0, 5] }} ref={ref} className="z-1">
						<ambientLight intensity={1} />
						<directionalLight position={[5, 5, 5]} intensity={1} />
						<Model organ={organ_arr[organ]} />

						{/* <mesh>
            <meshBasicMaterial/>
            <boxGeometry/>
            </mesh> */}
						<OrbitControls enableZoom={false} />
					</Canvas>

					{/* Overlay */}
					<div className="absolute inset-0 flex items-center justify-center h-screen w-screen text-white">
						<div className="flex flex-col items-center justify-center gap-2 mt-64">
							{/* <div className="z-99">
								<SnakeGame />
							</div> */}
							<h2 className="text-2xl font-semibold text-center z-2">
								Preparing data...
							</h2>
							<div className="flex gap-2 z-2 items-center justify-between w-full opacity-50">
								<IconChevronLeft
									className="cursor-poiner z-2"
									onClick={() => setOrgan(organ === 0 ? 3 : organ - 1)}
								/>
								<h2 className="text-2xl font-semibold text-center z-2">
									{organ_arr[organ]}
								</h2>
								<IconChevronRight
									className="cursor-poiner z-2"
									onClick={() => setOrgan(organ === 3 ? 0 : organ + 1)}
								/>
							</div>
						</div>
					</div>
				</>
			) : null}
		</div>
	);
};

export default RotatingModelLoader;
