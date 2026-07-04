import Header from "../components/Header";

type Member = { name: string; role: string; photo?: string };

const MEMBERS: Member[] = [
	{ name: "Zongwei Zhou, PhD", role: "Principal Investigator", photo: "/headshots/zongwei-zhou.png" },
	{ name: "Alan L. Yuille, PhD", role: "Scientific Advisor", photo: "/headshots/alan-yuille.jpg" },
	{ name: "Wenxuan Li", role: "PhD Student", photo: "/headshots/wenxuan-li.jpeg" },
	{ name: "Pedro RAS Bassi", role: "PhD Student", photo: "/headshots/pedro-bassi.jpg" },
	{ name: "Jaeden Pangaribuan", role: "Core Contributor" },
	{ name: "Lucy Wu", role: "Core Contributor", photo: "/headshots/lucy-wu.jpg" },
];

function Avatar({ photo, name }: { photo?: string; name: string }) {
	return (
		<div
			style={{
				width: 120,
				height: 120,
				borderRadius: "50%",
				border: "2.5px solid #002D72",
				padding: 4,
				boxSizing: "border-box",
				flexShrink: 0,
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
					<svg width="68%" height="68%" viewBox="0 0 24 24" fill="#b3b3b3" aria-hidden="true">
						<circle cx="12" cy="9" r="4.2" />
						<path d="M4.5 21c0-3.7 3.4-6.2 7.5-6.2s7.5 2.5 7.5 6.2z" />
					</svg>
				)}
			</div>
		</div>
	);
}

function MemberCard({ member }: { member: Member }) {
	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				textAlign: "center",
				gap: 12,
			}}
		>
			<Avatar photo={member.photo} name={member.name} />
			<div>
				<div
					style={{
						fontSize: 13,
						fontWeight: 700,
						letterSpacing: "0.04em",
						textTransform: "uppercase",
						color: "#1f2533",
						marginBottom: 4,
					}}
				>
					{member.name}
				</div>
				<div
					style={{
						fontSize: 11,
						fontWeight: 500,
						letterSpacing: "0.06em",
						textTransform: "uppercase",
						color: "#8a8f99",
					}}
				>
					{member.role}
				</div>
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
					maxWidth: "1100px",
					margin: "0 auto",
					padding: "64px 24px 100px",
					fontFamily: "'Space Grotesk', sans-serif",
				}}
			>
				<h1
					style={{
						textAlign: "center",
						fontSize: "40px",
						fontWeight: 400,
						color: "#1f2533",
						margin: "0 0 72px",
					}}
				>
					Meet the <span style={{ fontWeight: 700 }}>team.</span>
				</h1>

				<div
					style={{
						display: "grid",
						gridTemplateColumns: "repeat(3, 1fr)",
						gap: "56px 32px",
						justifyItems: "center",
					}}
				>
					{MEMBERS.map((m) => (
						<MemberCard key={m.name} member={m} />
					))}
				</div>
			</main>
		</div>
	);
}
