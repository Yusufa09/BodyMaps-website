import { IconBrandGithub } from "@tabler/icons-react";
import { useLocation, useNavigate } from "react-router-dom";
import styles from "../pages/LandingPage.module.css";

const TABS = [
	{ id: "overview", label: "Overview", path: "/" },
	{ id: "dataset", label: "Dataset", path: "/dashboard" },
	{ id: "upload", label: "Upload", path: "/upload" },
] as const;

export default function Header() {
	const navigate = useNavigate();
	const location = useLocation();

	const activeTab = TABS.find((t) => t.path === location.pathname)?.id ?? "overview";

	const tabClass = (name: string) =>
		`${styles.tabPill} ${activeTab === name ? styles.tabPillActive : ""}`;

	return (
		<nav
			className={styles.nav}
			style={{
				position: "sticky",
				top: 0,
				zIndex: 50,
				fontFamily: "'Space Grotesk', sans-serif",
			}}
		>
			{/* Logo */}
			<div className={styles.logoPill} onClick={() => navigate("/dashboard")}>
				<div className={styles.logoIcon}>
					<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#111111" strokeWidth="2">
						<circle cx="12" cy="12" r="10" />
						<circle cx="12" cy="12" r="4" />
						<line x1="12" y1="2" x2="12" y2="4" />
						<line x1="12" y1="20" x2="12" y2="22" />
						<line x1="2" y1="12" x2="4" y2="12" />
						<line x1="20" y1="12" x2="22" y2="12" />
					</svg>
				</div>
				<div>
					<div className={styles.logoTitle}>BodyMaps</div>
					<div className={styles.logoSubtitle}>CT Segmentation Platform</div>
				</div>
			</div>

			{/* Center Tabs */}
			<div className={styles.tabBar}>
				{TABS.map((tab) => (
					<button
						key={tab.id}
						type="button"
						className={tabClass(tab.id)}
						onClick={() => navigate(tab.path)}
					>
						{tab.label.toUpperCase()}
					</button>
				))}
			</div>

			{/* Right Side (Github Link) */}
			<div style={{ width: "235px", display: "flex", justifyContent: "flex-end" }}>
				<a
					href="https://github.com/BodyMaps/BodyMaps-website"
					target="_blank"
					rel="noreferrer"
					className="flex items-center gap-1.5 rounded-md px-3 py-2 transition-colors"
					style={{ fontSize: "12px", color: "#6a6a6a" }}
					onMouseEnter={(e) => {
						(e.currentTarget as HTMLElement).style.color = "#111111";
						(e.currentTarget as HTMLElement).style.background = "rgba(0,0,0,.05)";
					}}
					onMouseLeave={(e) => {
						(e.currentTarget as HTMLElement).style.color = "#6a6a6a";
						(e.currentTarget as HTMLElement).style.background = "transparent";
					}}
				>
					<IconBrandGithub size={18} />
					GitHub
				</a>
			</div>
		</nav>
	);
}
