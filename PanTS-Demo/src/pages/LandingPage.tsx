import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { segmentation_categories } from "../helpers/constants";
import styles from "./LandingPage.module.css";

/* ── counter targets ── */
// organClasses is derived from the viewer's actual label set (not hardcoded) so the
// landing page can't drift out of sync with what the platform actually segments.
const TARGETS = { ctVol: 36390, medCenters: 145, structures: 993000, organClasses: segmentation_categories.length };

function formatStructures(v: number): string {
  if (v >= 993000) return "993K+";
  if (v >= 1000) return `${Math.floor(v / 1000)}K+`;
  return String(v);
}

export default function LandingPage() {
  const navigate = useNavigate();

  /* ── animated counters ── */
  const [ctVol, setCtVol] = useState(0);
  const [medCenters, setMedCenters] = useState(0);
  const [structures, setStructures] = useState(0);
  const [organClasses, setOrganClasses] = useState(0);

  /* ── active tab ── */
  const [activeTab, setActiveTab] = useState<"overview" | "dataset" | "upload">("overview");

  /* ── tab navigation handler ── */
  const handleTabClick = (tab: "overview" | "dataset" | "upload") => {
    setActiveTab(tab);
    if (tab === "dataset") {
      navigate("/dashboard");
    } else if (tab === "upload") {
      navigate("/upload");
    }
    // "overview" stays on the landing page — no navigation needed
  };

  /* ── counter animation ── */
  useEffect(() => {
    const dur = 2200;
    const t0 = performance.now();
    const ease = (t: number) => 1 - Math.pow(1 - t, 3);
    let raf: number;
    const tick = () => {
      const p = ease(Math.min((performance.now() - t0) / dur, 1));
      setCtVol(Math.round(p * TARGETS.ctVol));
      setMedCenters(Math.round(p * TARGETS.medCenters));
      setStructures(Math.round(p * TARGETS.structures));
      setOrganClasses(Math.round(p * TARGETS.organClasses));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const stats = [
    { value: ctVol.toLocaleString(), label: "CT Volumes" },
    { value: String(medCenters), label: "Medical Centers" },
    { value: formatStructures(structures), label: "Annotated Structures" },
    { value: String(organClasses), label: "Organ Classes" },
  ];

  /* ── tab helper ── */
  const tabClass = (name: string) =>
    `${styles.tabPill} ${activeTab === name ? styles.tabPillActive : ""}`;

  return (
    <div className={styles.root}>
      {/* ═══════ TOP NAV BAR ═══════ */}
      <nav className={styles.nav}>
        {/* Logo */}
        <div className={styles.logoPill} onClick={() => handleTabClick("overview")}>
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
          <button className={tabClass("overview")} onClick={() => handleTabClick("overview")}>
            OVERVIEW
          </button>
          <button className={tabClass("dataset")} onClick={() => handleTabClick("dataset")}>
            DATASET
          </button>
          <button className={tabClass("upload")} onClick={() => handleTabClick("upload")}>
            UPLOAD
          </button>
        </div>

        {/* Spacer for balance */}
        <div className={styles.navSpacer} />
      </nav>

      {/* ═══════ CENTERED HERO ═══════ */}
      <main className={styles.hero}>
        <h1 className={styles.heroTitle}>BodyMaps</h1>
        <p className={styles.heroSubtitle}>The open library of labeled body CT scans</p>

        <div className={styles.heroStats}>
          {stats.map((s, i) => (
            <div key={s.label} className={styles.statGroup}>
              <div className={styles.heroStatItem}>
                <div className={styles.heroStatValue}>{s.value}</div>
                <div className={styles.heroStatLabel}>{s.label}</div>
              </div>
              {i < stats.length - 1 && <div className={styles.heroStatDivider} />}
            </div>
          ))}
        </div>

        <div className={styles.heroActions}>
          <button className={styles.btnPrimary} onClick={() => handleTabClick("dataset")}>
            Browse Dataset
          </button>
          <button className={styles.btnSecondary} onClick={() => handleTabClick("upload")}>
            Upload CT
          </button>
        </div>
      </main>
    </div>
  );
}
