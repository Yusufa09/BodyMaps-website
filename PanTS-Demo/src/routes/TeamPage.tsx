import Header from "../components/Header";

type Member = { name: string; title?: string; photo?: string };
type Section = { heading: string; members: Member[] };

const SECTIONS: Section[] = [
	{
		heading: "Principal Investigator",
		members: [{ name: "Zongwei Zhou, PhD", photo: "/headshots/zongwei-zhou.png" }],
	},
	{
		heading: "Scientific Advisory Board",
		members: [{ name: "Alan L. Yuille, PhD", photo: "/headshots/alan-yuille.jpg" }],
	},
	{
		heading: "Core Contributors",
		members: [
			{ name: "Wenxuan Li", photo: "/headshots/wenxuan-li.jpeg" },
			{ name: "Pedro RAS Bassi", photo: "/headshots/pedro-bassi.jpg" },
			{ name: "Jaeden Pangaribuan" },
			{ name: "Lucy Wu" },
		],
	},
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
			<div
				style={{
					fontSize: 14,
					fontWeight: 700,
					letterSpacing: "0.04em",
					textTransform: "uppercase",
					color: "#1f2533",
				}}
			>
				{member.name}
			</div>
			{member.title && (
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
					{member.title}
				</div>
			)}
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
						margin: "0 0 64px",
					}}
				>
					Meet the <span style={{ fontWeight: 700 }}>team.</span>
				</h1>

				{SECTIONS.map((section) => (
					<section key={section.heading} style={{ marginBottom: 64 }}>
						<h2
							style={{
								fontSize: 12,
								fontWeight: 700,
								letterSpacing: "0.1em",
								textTransform: "uppercase",
								color: "#002D72",
								margin: "0 0 32px",
								borderBottom: "1px solid #e5e7eb",
								paddingBottom: 10,
							}}
						>
							{section.heading}
						</h2>
						<div
							style={{
								display: "flex",
								flexWrap: "wrap",
								gap: "48px 32px",
							}}
						>
							{section.members.map((m) => (
								<MemberCard key={m.name} member={m} />
							))}
						</div>
					</section>
				))}
			</main>
		</div>
	);
}
