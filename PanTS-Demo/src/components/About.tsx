type Props = {
	aboutRef: React.RefObject<HTMLDivElement | null>;
};

export default function About({ aboutRef }: Props) {
	return (
		<section
			ref={aboutRef}
			className="mx-auto max-w-6xl px-6 py-14"
		>
			<div
				className="bm-glass rounded-2xl p-8 max-w-2xl mx-auto"
				style={{
					boxShadow: "0 0 40px rgba(45,212,191,0.03)",
				}}
			>
				{/* Section label */}
				<div className="flex items-center gap-2 mb-5">
					<div
						className="w-0.5 h-4 rounded-full"
						style={{ background: "rgba(45,212,191,0.7)" }}
					/>
					<span
						className="font-semibold"
						style={{
							fontSize: "11px",
							letterSpacing: "0.14em",
							color: "rgba(45,212,191,0.7)",
						}}
					>
						ABOUT PanTS
					</span>
				</div>

				<p
					className="leading-relaxed mb-4"
					style={{ fontSize: "14px", color: "rgba(255,255,255,0.55)" }}
				>
					The Pancreatic Tumor Segmentation Dataset (PanTS) is a
					multi-institutional dataset created by JHU containing{" "}
					<span className="text-white font-semibold">36,390</span>{" "}
					three-dimensional CT volumes in{" "}
					<span className="text-white font-semibold">145</span> medical centers,
					with expert voxel annotations of over{" "}
					<span className="text-white font-semibold">993,000</span> anatomical
					structures. This platform lets you visualize and explore the dataset.
				</p>

				<button
					className="rounded-lg font-medium transition-all duration-200"
					style={{
						fontSize: "12px",
						padding: "8px 18px",
						border: "1px solid rgba(45,212,191,0.2)",
						color: "rgba(45,212,191,0.8)",
						background: "rgba(45,212,191,0.05)",
					}}
					onMouseEnter={(e) => {
						(e.currentTarget as HTMLElement).style.background = "rgba(45,212,191,0.1)";
						(e.currentTarget as HTMLElement).style.color = "rgb(45,212,191)";
					}}
					onMouseLeave={(e) => {
						(e.currentTarget as HTMLElement).style.background = "rgba(45,212,191,0.05)";
						(e.currentTarget as HTMLElement).style.color = "rgba(45,212,191,0.8)";
					}}
					onClick={() =>
						(window.location.href =
							"https://www.cs.jhu.edu/~zongwei/publication/li2025pants.pdf")
					}
				>
					Read the Paper →
				</button>
			</div>
		</section>
	);
}
