import Header from "../components/Header";

type Member = { name: string; role: string; photo?: string };

// ── Placeholder data ──────────────────────────────────────────────────────────
// Replace these with real members (two rows of five at wide widths). Add
// `photo: "https://…"` (or a file in /public) to show a picture; without it a
// silhouette is shown.
const TEAM: Member[] = [
	{ name: "Team Member", role: "Principal Investigator" },
	{ name: "Team Member", role: "Researcher" },
	{ name: "Team Member", role: "PhD Student" },
	{ name: "Team Member", role: "PhD Student" },
	{ name: "Team Member", role: "Graduate Student" },
	{ name: "Team Member", role: "Graduate Student" },
	{ name: "Team Member", role: "Undergraduate Student" },
	{ name: "Team Member", role: "Undergraduate Student" },
	{ name: "Team Member", role: "Undergraduate Student" },
	{ name: "Team Member", role: "Undergraduate Student" },
];

function Avatar({ photo, name }: { photo?: string; name: string }) {
	return (
		<div
			style={{
				width: 116,
				height: 116,
				borderRadius: "50%",
				border: "2px solid #002D72",
				padding: 4,
				boxSizing: "border-box",
			}}
		>
			<div
				style={{
					width: "100%",
					height: "100%",
					borderRadius: "50%",
					overflow: "hidden",
					background: "#e6e6e6",
					display: "flex",
					alignItems: "flex-end",
					justifyContent: "center",
				}}
			>
				{photo ? (
					<img src={photo} alt={name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
				) : (
					// Gray silhouette for members without a photo yet.
					<svg width="68%" height="68%" viewBox="0 0 24 24" fill="#b3b3b3" aria-hidden="true">
						<circle cx="12" cy="9" r="4.2" />
						<path d="M4.5 21c0-3.7 3.4-6.2 7.5-6.2s7.5 2.5 7.5 6.2z" />
					</svg>
				)}
			</div>
		</div>
	);
}

export default function TeamPage() {
	return (
		<div style={{ minHeight: "100vh", background: "#ffffff" }}>
			<Header />
			<main
				style={{
					maxWidth: "1180px",
					margin: "0 auto",
					padding: "48px 24px 80px",
					fontFamily: "'Space Grotesk', sans-serif",
				}}
			>
				<h1
					style={{
						textAlign: "center",
						fontSize: "40px",
						fontWeight: 400,
						color: "#1f2533",
						margin: "0 0 56px",
					}}
				>
					Meet the <span style={{ fontWeight: 700 }}>team.</span>
				</h1>

				<div
					style={{
						display: "grid",
						gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
						gap: "48px 16px",
					}}
				>
					{TEAM.map((m, i) => (
						<div
							key={i}
							style={{
								display: "flex",
								flexDirection: "column",
								alignItems: "center",
								textAlign: "center",
								gap: 12,
							}}
						>
							<Avatar photo={m.photo} name={m.name} />
							<div
								style={{
									fontSize: 14,
									fontWeight: 700,
									letterSpacing: "0.04em",
									textTransform: "uppercase",
									color: "#1f2533",
								}}
							>
								{m.name}
							</div>
							<div
								style={{
									fontSize: 11,
									fontWeight: 600,
									letterSpacing: "0.05em",
									textTransform: "uppercase",
									color: "#8a8f99",
									maxWidth: 150,
								}}
							>
								{m.role}
							</div>
						</div>
					))}
				</div>
			</main>
		</div>
	);
}
