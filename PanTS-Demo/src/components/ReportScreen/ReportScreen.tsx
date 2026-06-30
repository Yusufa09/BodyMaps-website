import React, { useEffect, useState, useRef, useCallback } from 'react';
import { APP_CONSTANTS } from '../../helpers/constants';
import FindingsTimeline from './FindingsTimeline';

type Props = {
  id: string;
  onClose: () => void;
  onViewChange: (view: 'axial' | 'sagittal' | 'coronal' | '3d') => void;
  onOrganHighlight?: (organName: string, centroidMm?: [number, number, number]) => void;
}

interface ReportData {
  case_id: string;
  patient: { age: number; sex: string };
  imaging: { study_type: string; contrast: string; spacing: number[]; shape: number[] };
  organ_volumes: { [key: string]: { volume: number; mean_hu: number; status?: 'normal' | 'check'; centroid_mm?: [number, number, number] } };
  lesions: { [key: string]: { voxels: number; volume: number } };
  comments: string;
  impression: string[];
}

interface PanelPos { x: number; y: number; }

const cache: { [key: string]: ReportData } = {};

const KEYWORD_TO_ORGAN: Record<string, string> = {
  'pancreas': 'pancreas', 'pancreatic': 'pancreas',
  'liver': 'liver', 'hepatic': 'liver',
  'spleen': 'spleen', 'splenic': 'spleen',
  'kidney': 'kidney_left', 'renal': 'kidney_left',
  'gallbladder': 'gall_bladder', 'bile': 'common_bile_duct',
  'aorta': 'aorta', 'aortic': 'aorta',
  'stomach': 'stomach', 'bowel': 'intestine', 'colon': 'colon',
  'duodenum': 'duodenum', 'adrenal': 'adrenal_gland_left',
  'bladder': 'bladder', 'lesion': 'pancreatic_lesion',
  'lung': 'lung_left', 'femur': 'femur_left',
};

const KEYWORD_COLORS: Record<string, string> = {
  lesion: '#ff5555', mass: '#ff5555', tumor: '#ff5555', malignant: '#ff5555', nodule: '#ff7777',
  normal: '#6dcaa5', unremarkable: '#6dcaa5', benign: '#6dcaa5',
  pancreas: '#f9a8d4', pancreatic: '#f9a8d4',
  liver: '#60a5fa', hepatic: '#60a5fa',
  kidney: '#34d399', renal: '#34d399',
  spleen: '#fb923c', splenic: '#fb923c',
  aorta: '#f472b6', aortic: '#f472b6',
  stomach: '#a78bfa', colon: '#86efac',
  adrenal: '#fbbf24', bladder: '#67e8f9',
  lung: '#93c5fd', enlarged: '#fbbf24',
  hypodensity: '#ff9966', hyperdensity: '#ff6688',
  dilated: '#fbbf24', dilation: '#fbbf24',
};

const ORGAN_KEYWORDS = Object.keys(KEYWORD_COLORS).concat([
  'atrophy', 'calcification', 'infiltration', 'obstructed',
]);

const DEFINABLE_TERMS = new Set([
  'dilation', 'dilated', 'distension', 'attenuation', 'hypodensity', 'hyperdensity',
  'stricture', 'obstruction', 'obstructed', 'mass', 'lesion', 'nodule', 'atrophy',
  'infiltration', 'calcification', 'hydronephrosis', 'malignant', 'benign',
  'unremarkable', 'cyst', 'ischemic', 'perfusion', 'enhancement', 'effusion',
  'edema', 'necrosis',
]);

const SIDED_ORGANS: Record<string, { left: string; right: string }> = {
  adrenal: { left: 'adrenal_gland_left', right: 'adrenal_gland_right' },
  kidney: { left: 'kidney_left', right: 'kidney_right' },
  renal: { left: 'kidney_left', right: 'kidney_right' },
  lung: { left: 'lung_left', right: 'lung_right' },
};

function resolveSidedOrgan(lower: string, parts: string[], idx: number): string {
  const base = SIDED_ORGANS[lower];
  if (!base) return KEYWORD_TO_ORGAN[lower] || lower;

  const windowText = parts.slice(Math.max(0, idx - 2), idx + 3).join(' ').toLowerCase();
  if (/\bright\b/.test(windowText) && !/\bleft\b/.test(windowText)) return base.right;
  if (/\bleft\b/.test(windowText) && !/\bright\b/.test(windowText)) return base.left;
  return KEYWORD_TO_ORGAN[lower] || lower;
}

function highlightKeywords(
  text: string,
  onKeywordClick: (word: string, organName: string, el: HTMLElement) => void,
  onTermClick?: (term: string) => void,
): React.ReactNode[] {
  const pattern = new RegExp(`\\b(${ORGAN_KEYWORDS.join('|')})\\b`, 'gi');
  const parts = text.split(pattern);
  return parts.map((part, i) => {
    const lower = part.toLowerCase();
    if (!ORGAN_KEYWORDS.map(k => k.toLowerCase()).includes(lower)) return part;

    const isOrganName = lower in KEYWORD_TO_ORGAN;
    if (isOrganName) {
      const color = KEYWORD_COLORS[lower] || '#a78bfa';
      const organName = resolveSidedOrgan(lower, parts, i);
      return <KeywordChip key={i} word={part} color={color} onClick={(e) => onKeywordClick(part, organName, e.currentTarget)} />;
    }
    if (DEFINABLE_TERMS.has(lower) && onTermClick) {
      return <DefinableTerm key={i} word={part} onClick={() => onTermClick(lower)} />;
    }
    // Anything else (e.g. "enlarged") that isn't a real organ name and isn't
    // in the definition dictionary just renders as plain text — no chip,
    // no color, no click. Only actual organ names stay clickable.
    return part;
  });
}

interface TaggedSentence { text: string; organs: string[]; idx: number; }
function tagSentencesByOrgan(text: string): TaggedSentence[] {
  const rawSentences = text.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0);
  return rawSentences.map((s, idx) => {
    const lower = s.toLowerCase();
    const organs = Object.keys(KEYWORD_TO_ORGAN).filter((kw) => new RegExp(`\\b${kw}\\b`).test(lower));
    // Resolve sided organs (adrenal/kidney/lung) using this sentence's own
    // left/right wording, instead of always defaulting to the unsided
    // KEYWORD_TO_ORGAN mapping — otherwise every "adrenal" mention gets
    // tagged as adrenal_gland_left even when the sentence says "right".
    const mappedOrgans = Array.from(new Set(organs.map((kw) => {
      const sided = SIDED_ORGANS[kw];
      if (!sided) return KEYWORD_TO_ORGAN[kw];
      const hasRight = /\bright\b/.test(lower);
      const hasLeft = /\bleft\b/.test(lower);
      const hasBilateral = /\bbilateral\b/.test(lower);
      if (hasBilateral || (hasRight && hasLeft)) return KEYWORD_TO_ORGAN[kw];
      if (hasRight) return sided.right;
      if (hasLeft) return sided.left;
      return KEYWORD_TO_ORGAN[kw];
    })));
    return { text: s, organs: mappedOrgans, idx };
  });
}

// Returns a genuine, descriptive clinical detail about a given organ from
// the radiologist's actual comments text — used to populate the Selected
// Organ header with real substance, not a generic "finding detected"
// label. Uses the full matched sentence rather than clipping to a single
// clause: a one-clause fragment reads as too sparse to actually inform
// someone, while clinical terms within it remain click-to-define if
// unfamiliar. Caps only as a safety net for unusually long sentences.
// Returns null if the organ isn't discussed in the text.
function getOrganDetailLine(organName: string, comments: string): string | null {
  const sentences = tagSentencesByOrgan(comments);

  // Exact match first (e.g. "kidney_left" tagged directly).
  let match = sentences.find((s) => s.organs.includes(organName));

  // Fallback A: many organ keys in this dataset are sub-regions of a more
  // general organ the text actually names — e.g. "pancreas_body" and
  // "pancreas_tail" both come from a sentence that just says "pancreas".
  // Strip the _body/_tail/_left/_right suffix and try matching that base
  // name instead, so sub-region organs can still surface real detail
  // instead of always falling back to "no specific finding".
  if (!match) {
    const baseName = organName.replace(/_(body|tail|head|left|right)$/, '');
    if (baseName !== organName) {
      match = sentences.find((s) => s.organs.includes(baseName));
    }
  }

  // Fallback B: the reverse direction — clicking the bare base organ
  // itself (e.g. "pancreas", with no exact sentence tag for that literal
  // key) should still find a sentence tagged with one of its sub-regions
  // (e.g. "pancreas_body"), since that's the same real organ being
  // discussed under a more specific key.
  if (!match) {
    match = sentences.find((s) =>
      s.organs.some((o) => o !== organName && o.replace(/_(body|tail|head|left|right)$/, '') === organName)
    );
  }

  if (!match) return null;

  let detail = match.text.trim();

  // The sentence-splitter correctly isolates grammatically complete
  // sentences, but some legitimately start with a transition word like
  // "However," or "Notably," that only makes sense following the prior
  // sentence — shown standalone, it reads as cut off mid-thought. Strip a
  // leading transition word/phrase and re-capitalize what follows.
  const leadingTransition = /^(however|notably|additionally|furthermore|moreover|in addition),?\s+/i;
  detail = detail.replace(leadingTransition, (_m, _w, offset) => '');
  if (detail.length > 0) {
    detail = detail[0].toUpperCase() + detail.slice(1);
  }

  // Safety cap for unusually long sentences only — most real Impression
  // sentences land well under this.
  if (detail.length > 280) {
    const cut = detail.slice(0, 270);
    const lastSpace = cut.lastIndexOf(' ');
    detail = (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim() + '...';
  }
  return detail.endsWith('.') || detail.endsWith('...') ? detail : detail + '.';
}

function KeywordChip({ word, color, onClick }: { word: string; color: string; onClick: (e: React.MouseEvent<HTMLSpanElement>) => void }) {
  const [active, setActive] = useState(false);
  const handleClick = (e: React.MouseEvent<HTMLSpanElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (active) return;
    setActive(true);
    onClick(e);
    setTimeout(() => setActive(false), 700);
  };
  return (
    <span
      onClick={handleClick}
      className="no-drag"
      style={{
        color,
        background: active ? `${color}28` : `${color}12`,
        border: `0.5px solid ${active ? color + 'bb' : color + '33'}`,
        borderRadius: 4, padding: '0px 5px', cursor: 'pointer',
        fontSize: 'inherit', fontWeight: 500, display: 'inline-block',
        transition: 'all 0.18s ease',
        boxShadow: active ? `0 0 12px ${color}55` : 'none',
        transform: active ? 'scale(1.06)' : 'scale(1)',
      }}
    >
      {word}
    </span>
  );
}

function DefinableTerm({ word, onClick }: { word: string; onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <span
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onClick(); }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="no-drag"
      style={{
        textDecoration: hovered ? 'underline solid rgba(160,200,255,0.9)' : 'underline dotted rgba(160,200,255,0.45)',
        textDecorationThickness: '1px',
        textUnderlineOffset: '2.5px',
        color: hovered ? 'rgba(180,210,255,0.95)' : 'inherit',
        cursor: 'help',
        transition: 'color 0.15s ease',
      }}
    >
      {word}
    </span>
  );
}

function RadarPing() {
  return (
    <div style={{ position: 'relative', width: 24, height: 24, flexShrink: 0 }}>
      <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '1.5px solid rgba(255,100,100,0.7)', animation: 'radarPing 2s ease-out infinite' }} />
      <div style={{ position: 'absolute', inset: 4, borderRadius: '50%', border: '1px solid rgba(255,100,100,0.4)', animation: 'radarPing 2s ease-out infinite 0.7s' }} />
      <div style={{ position: 'absolute', inset: '50%', width: 6, height: 6, transform: 'translate(-50%, -50%)', borderRadius: '50%', background: '#ff6b6b', boxShadow: '0 0 8px rgba(255,100,100,0.9)' }} />
    </div>
  );
}

function HUMiniChart({ color }: { color: string }) {
  const bars = Array.from({ length: 10 }, (_, i) => {
    const offset = (i - 4.5) * 22;
    return Math.max(0.08, Math.exp(-(offset * offset) / 1600));
  });
  const max = Math.max(...bars);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 20, flexShrink: 0 }}>
      {bars.map((v, i) => (
        <div key={i} style={{ width: 3, borderRadius: '1px 1px 0 0', height: `${(v / max) * 100}%`, background: color, opacity: 0.35 + (v / max) * 0.55 }} />
      ))}
    </div>
  );
}

function DraggablePanel({
  children, initialPos, style, entranceDelay = 0, id, expanded, onToggleExpand,
}: {
  children: React.ReactNode;
  initialPos: PanelPos;
  style?: React.CSSProperties;
  entranceDelay?: number;
  id: string;
  expanded?: boolean;
  onToggleExpand?: (id: string) => void;
}) {
  const [pos, setPos] = useState(initialPos);
  const [visible, setVisible] = useState(false);
  const dragging = useRef(false);
  const offset = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), entranceDelay);
    return () => clearTimeout(t);
  }, [entranceDelay]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.no-drag')) return;
    dragging.current = true;
    offset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    e.preventDefault();
  }, [pos]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      setPos({ x: e.clientX - offset.current.x, y: e.clientY - offset.current.y });
    };
    const onUp = () => { dragging.current = false; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []);

  return (
    <div
      onMouseDown={onMouseDown}
      style={{
        position: 'fixed',
        left: pos.x, top: pos.y,
        cursor: 'grab', userSelect: 'none', zIndex: expanded ? 10010 : 10000,
        background: 'rgba(11, 13, 19, 0.58)',
        backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)',
        border: '1px solid rgba(255,255,255,0.10)',
        borderTop: '1px solid rgba(255,255,255,0.24)',
        borderRadius: 16,
        boxShadow: '0 8px 40px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.08)',
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0px)' : 'translateY(14px)',
        transition: 'opacity 0.4s ease, transform 0.4s ease, width 0.3s ease, height 0.3s ease, max-height 0.3s ease',
        overflow: 'hidden',
        ...style,
      }}
    >
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 1, background: 'linear-gradient(135deg, rgba(255,255,255,0.025) 0%, transparent 55%)' }} />
      <div style={{ position: 'relative', zIndex: 2, height: '100%' }}>{children}</div>
      {onToggleExpand && (
        <button
          className="no-drag"
          onClick={(e) => { e.stopPropagation(); onToggleExpand(id); }}
          style={{
            position: 'absolute', top: 10, right: 10, zIndex: 5,
            background: 'rgba(255,255,255,0.06)', border: '0.5px solid rgba(255,255,255,0.12)',
            color: 'rgba(255,255,255,0.5)', borderRadius: 5, padding: '2px 7px',
            fontSize: 9, cursor: 'pointer',
          }}
        >
          {expanded ? '↙ collapse' : '↗ expand'}
        </button>
      )}
    </div>
  );
}

function OrganMarker({ x, y, color, label, onDone }: { x: number; y: number; color: string; label: string; onDone: () => void }) {
  const [phase, setPhase] = useState<'in' | 'hold' | 'out'>('in');

  useEffect(() => {
    const t1 = setTimeout(() => setPhase('hold'), 350);
    const t2 = setTimeout(() => setPhase('out'), 2600);
    const t3 = setTimeout(() => onDone(), 3000);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [onDone]);

  return (
    <div style={{
      position: 'fixed', left: x, top: y, zIndex: 10005, pointerEvents: 'none',
      transform: 'translate(-50%, -50%)',
      opacity: phase === 'out' ? 0 : 1,
      transition: 'opacity 0.4s ease',
    }}>
      <div style={{
        position: 'absolute', left: '50%', top: '50%',
        width: 50, height: 50, marginLeft: -25, marginTop: -25,
        borderRadius: '50%', border: `1.5px solid ${color}`,
        animation: phase !== 'out' ? 'markerRing 1.8s ease-out infinite' : 'none',
        opacity: 0.7,
      }} />
      <div style={{
        position: 'absolute', left: '50%', top: '50%',
        width: 50, height: 50, marginLeft: -25, marginTop: -25,
        borderRadius: '50%', border: `1px solid ${color}`,
        animation: phase !== 'out' ? 'markerRing 1.8s ease-out infinite 0.6s' : 'none',
        opacity: 0.5,
      }} />
      <div style={{
        position: 'absolute', left: '50%', top: '50%',
        width: 10, height: 10, marginLeft: -5, marginTop: -5,
        borderRadius: '50%', background: color,
        boxShadow: `0 0 14px ${color}, 0 0 4px ${color}`,
      }} />
      <div style={{ position: 'absolute', left: '50%', top: '50%', width: 24, height: 1, marginLeft: -12, background: `${color}88` }} />
      <div style={{ position: 'absolute', left: '50%', top: '50%', width: 1, height: 24, marginTop: -12, background: `${color}88` }} />
      <div style={{
        position: 'absolute', left: '50%', top: -32, transform: 'translateX(-50%)',
        background: 'rgba(10,12,18,0.85)', border: `0.5px solid ${color}66`,
        borderRadius: 6, padding: '3px 9px', whiteSpace: 'nowrap',
        color, fontSize: 10, fontWeight: 600, letterSpacing: '0.3px',
        boxShadow: `0 2px 12px ${color}33`,
      }}>
        {label.replace(/_/g, ' ')}
      </div>
    </div>
  );
}

const STYLES = `
  @keyframes rspin { from { transform:rotate(0) } to { transform:rotate(360deg) } }
  @keyframes radarPing { 0% { transform:scale(0.4); opacity:1; } 100% { transform:scale(2.4); opacity:0; } }
  @keyframes severityPulse { 0%,100% { opacity:0.55; } 50% { opacity:0.85; } }
  @keyframes markerRing { 0% { transform:scale(0.5); opacity:0.9; } 100% { transform:scale(1.6); opacity:0; } }
  @keyframes loadingFadeIn { from { opacity:0; } to { opacity:1; } }
  @keyframes loadingTextPulse { 0%,100% { opacity:0.45; } 50% { opacity:0.75; } }
  @keyframes healthCardIn { from { opacity:0; transform: translateY(-4px); } to { opacity:1; transform: translateY(0); } }
`;

const ReportScreen = ({ id, onClose, onViewChange, onOrganHighlight }: Props) => {
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeView, setActiveView] = useState<'axial' | 'sagittal' | 'coronal' | '3d'>('3d');
  const [elapsed, setElapsed] = useState(0);
  const [expandedPanel, setExpandedPanel] = useState<string | null>(null);
  const [focusedOrgan, setFocusedOrgan] = useState<string | null>(null);
  const [showAllNormal, setShowAllNormal] = useState(false);
  const startTime = useRef(Date.now());
  const findingsScrollRef = useRef<HTMLDivElement>(null);
  const sentenceRefs = useRef<{ [idx: number]: HTMLSpanElement | null }>({});

  useEffect(() => {
    if (cache[id]) { setData(cache[id]); setLoading(false); return; }
    fetch(`${APP_CONSTANTS.API_ORIGIN}/api/get-report-data/${id}`)
      .then(r => r.json())
      .then(json => { cache[id] = json; setData(json); setLoading(false); startTime.current = Date.now(); })
      .catch(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (!data) return;
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - startTime.current) / 1000)), 1000);
    return () => clearInterval(t);
  }, [data]);

  // Plain-language version of whichever organ is currently selected.
  // Fetched fresh on each organ click via the backend's translator (same
  // endpoint the "Explain in plain language" Impression button uses) —
  // a static trim/substitution wasn't enough to make dense radiology
  // phrasing ("marked attenuation, suggesting possible ischemia or
  // infarction") genuinely patient-readable.
  const [organDetailPlain, setOrganDetailPlain] = useState<{ organ: string; text: string; loading: boolean } | null>(null);

  const fetchOrganDetailPlain = useCallback(async (organName: string, clinicalLine: string | null) => {
    if (!clinicalLine) { setOrganDetailPlain(null); return; }
    setOrganDetailPlain({ organ: organName, text: '', loading: true });
    try {
      const res = await fetch(`${APP_CONSTANTS.API_ORIGIN}/api/explain-impressions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ impression: [clinicalLine] }),
      });
      const json = await res.json();
      const text = Array.isArray(json.plain_language) && json.plain_language[0]
        ? json.plain_language[0]
        : 'Plain-language summary unavailable.';
      setOrganDetailPlain({ organ: organName, text, loading: false });
    } catch {
      setOrganDetailPlain({ organ: organName, text: 'Plain-language summary unavailable right now.', loading: false });
    }
  }, []);

  const handleKeywordClick = useCallback((word: string, organName: string, _el: HTMLElement) => {
    // NOTE: the old screen-jitter OrganMarker flash (fake position, just
    // for visual feedback) has been removed — the real centroid jump via
    // onOrganHighlight below already shows exactly where the organ is on
    // the actual CT/3D model, so the decorative marker was redundant and
    // confusing (it showed a label at a fake location, not the real one).
    const centroid = data?.organ_volumes?.[organName]?.centroid_mm;
    if (onOrganHighlight) onOrganHighlight(organName, centroid);

    // Also drives the Selected Organ header in Panel 1, so clicking an
    // organ anywhere (Impression, Findings, Findings Explorer, Timeline)
    // updates what's shown there with the real clinical detail line.
    setFocusedOrgan(organName);

    // Fetch the plain-language version of this organ's clinical sentence,
    // so Selected Organ shows genuinely patient-readable text instead of
    // dense radiology phrasing.
    const clinicalLine = data ? getOrganDetailLine(organName, data.comments) : null;
    fetchOrganDetailPlain(organName, clinicalLine);
  }, [onOrganHighlight, data, fetchOrganDetailPlain]);

  const [definition, setDefinition] = useState<{ term: string; text: string; loading: boolean } | null>(null);
  const handleTermClick = useCallback(async (term: string) => {
    setDefinition({ term, text: '', loading: true });
    try {
      const res = await fetch(`${APP_CONSTANTS.API_ORIGIN}/api/define-term?term=${encodeURIComponent(term.toLowerCase())}`);
      const json = await res.json();
      setDefinition({ term, text: json.definition || 'Definition unavailable.', loading: false });
    } catch {
      setDefinition({ term, text: 'Definition unavailable right now — try asking your doctor what this term means.', loading: false });
    }
  }, []);

  const [plainLanguage, setPlainLanguage] = useState<{ items: string[]; loading: boolean } | null>(null);
  const handleExplainImpressions = useCallback(async () => {
    if (!data) return;
    setPlainLanguage({ items: [], loading: true });
    try {
      const res = await fetch(`${APP_CONSTANTS.API_ORIGIN}/api/explain-impressions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ impression: data.impression }),
      });
      const json = await res.json();
      setPlainLanguage({ items: json.plain_language || ['Plain-language summary unavailable.'], loading: false });
    } catch {
      setPlainLanguage({ items: ['Plain-language summary unavailable right now — please ask your doctor to walk through these findings with you.'], loading: false });
    }
  }, [data]);

  const taggedSentences = data ? tagSentencesByOrgan(data.comments) : [];

  const handleTimelineFocus = useCallback((organ: string) => {
    setFocusedOrgan(organ);
    setExpandedPanel('findings');
    setTimeout(() => {
      const matchIdx = taggedSentences.findIndex((s) => s.organs.includes(organ));
      if (matchIdx === -1) return;
      const el = sentenceRefs.current[matchIdx];
      if (el && findingsScrollRef.current) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 80);
  }, [taggedSentences]);

  const hasLesions = data ? Object.keys(data.lesions).length > 0 : false;
  const topOrgans = data ? Object.entries(data.organ_volumes).filter(([_, v]) => v.volume > 5).sort((a, b) => b[1].volume - a[1].volume).slice(0, 6) : [];

  const glassBase: React.CSSProperties = { padding: '16px 18px' };
  const label: React.CSSProperties = { fontSize: 9, letterSpacing: '1.2px', color: 'rgba(255,255,255,0.25)', fontWeight: 600, marginBottom: 10, textTransform: 'uppercase' };
  const elapsedStr = elapsed < 60 ? `${elapsed}s ago` : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s ago`;
  const vignetteColor = hasLesions ? 'rgba(220, 38, 38, 0.07)' : 'rgba(16, 185, 129, 0.05)';

  const isFindingsExpanded = expandedPanel === 'findings';

  // Real clinical detail for whichever organ is currently selected, pulled
  // from the actual radiologist comments text — not a generic status.
  const selectedOrganDetail = data && focusedOrgan ? getOrganDetailLine(focusedOrgan, data.comments) : null;
  const selectedOrganStatus = data && focusedOrgan ? data.organ_volumes?.[focusedOrgan]?.status : undefined;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9998, pointerEvents: 'none' }}>
      <style>{STYLES}</style>

      <div style={{
        position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 9999,
        background: `radial-gradient(ellipse at center, transparent 55%, ${vignetteColor} 100%)`,
        animation: hasLesions ? 'severityPulse 3s ease-in-out infinite' : 'none',
      }} />

      <div style={{
        position: 'fixed', top: 14, left: '50%', transform: 'translateX(-50%)',
        zIndex: 10001, pointerEvents: 'auto',
        background: 'rgba(10,12,18,0.65)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
        border: '1px solid rgba(255,255,255,0.09)', borderTop: '1px solid rgba(255,255,255,0.2)',
        borderRadius: 10, padding: '6px 16px', display: 'flex', alignItems: 'center', gap: 14,
        boxShadow: '0 4px 24px rgba(0,0,0,0.35)',
      }}>
        <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 10, letterSpacing: '1px', fontWeight: 600 }}>BODYMAPS</span>
        <span style={{ color: 'rgba(255,255,255,0.12)' }}>·</span>
        <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: 10 }}>Case {id}{data ? ` · ${data.patient.sex} · ${data.patient.age}y` : ''}</span>
        {data && <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: 9, fontStyle: 'italic' }}>Generated {elapsedStr}</span>}
        {hasLesions && (
          <div style={{ background: 'rgba(255,60,60,0.15)', border: '0.5px solid rgba(255,60,60,0.3)', borderRadius: 6, padding: '2px 8px', display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#ff5555', boxShadow: '0 0 6px rgba(255,80,80,0.8)', animation: 'severityPulse 1.5s ease-in-out infinite' }} />
            <span style={{ color: '#ffaaaa', fontSize: 9 }}>{data ? Object.keys(data.lesions).length : '?'} lesion detected</span>
          </div>
        )}
        <button onClick={onClose} className="no-drag" style={{ background: 'rgba(255,255,255,0.06)', border: '0.5px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.4)', borderRadius: 6, padding: '3px 10px', cursor: 'pointer', fontSize: 10, pointerEvents: 'auto' }}>close</button>
      </div>

      {loading ? (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 10001, pointerEvents: 'auto',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(5,6,9,0.45)',
          animation: 'loadingFadeIn 0.4s ease',
        }}>
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18,
          }}>
            <div style={{ position: 'relative', width: 52, height: 52 }}>
              <div style={{
                position: 'absolute', inset: 0, borderRadius: '50%',
                border: '2px solid rgba(255,255,255,0.06)',
              }} />
              <div style={{
                position: 'absolute', inset: 0, borderRadius: '50%',
                border: '2px solid transparent', borderTop: '2px solid rgba(120,170,255,0.85)',
                animation: 'rspin 1.1s linear infinite',
              }} />
              <div style={{
                position: 'absolute', inset: 8, borderRadius: '50%',
                border: '1px solid transparent', borderTop: '1px solid rgba(120,170,255,0.35)',
                animation: 'rspin 1.8s linear infinite reverse',
              }} />
            </div>
            <span style={{
              color: 'rgba(255,255,255,0.45)', fontSize: 12, letterSpacing: '0.4px',
              animation: 'loadingTextPulse 2s ease-in-out infinite',
            }}>
              Preparing your report…
            </span>
          </div>
        </div>
      ) : data ? (
        <>
          {/* ── PANEL 1 — Findings (expandable) ── */}
          <DraggablePanel
            id="findings"
            initialPos={{ x: 16, y: 60 }}
            style={{
              width: isFindingsExpanded ? Math.min(680, window.innerWidth - 60) : 370,
              maxHeight: isFindingsExpanded ? window.innerHeight - 140 : 420,
              pointerEvents: 'auto',
            }}
            entranceDelay={0}
            expanded={isFindingsExpanded}
            onToggleExpand={(pid) => setExpandedPanel(prev => prev === pid ? null : pid)}
          >
            <div ref={findingsScrollRef} style={{ ...glassBase, overflowY: 'auto', maxHeight: isFindingsExpanded ? window.innerHeight - 172 : 388 }}>
              {/* Header: shows the currently Selected Organ (real clinical
                  detail line) when one is selected, otherwise falls back
                  to the original lesion-status header. */}
              {focusedOrgan ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12, paddingRight: 60 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                    <div style={{
                      width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                      background: selectedOrganStatus === 'check' ? '#fbbf24' : '#1d9e75',
                      boxShadow: selectedOrganStatus === 'check' ? '0 0 8px rgba(251,191,36,0.6)' : '0 0 8px rgba(29,158,117,0.6)',
                    }} />
                    <span style={{ fontSize: 9, letterSpacing: '1px', color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase' }}>Selected organ</span>
                  </div>
                  <span style={{ color: '#fff', fontSize: 16, fontWeight: 600, textTransform: 'capitalize' }}>
                    {focusedOrgan.replace(/_/g, ' ')}
                  </span>
                  <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 10.5, lineHeight: 1.6 }}>
                    {organDetailPlain?.organ === focusedOrgan
                      ? (organDetailPlain.loading ? 'Translating finding…' : (organDetailPlain.text || selectedOrganDetail || 'No specific finding recorded for this structure in the report text.'))
                      : (selectedOrganDetail || 'No specific finding recorded for this structure in the report text.')
                    }
                  </span>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12, paddingRight: 60 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'rgba(255,255,255,0.15)', flexShrink: 0 }} />
                    <span style={{ fontSize: 9, letterSpacing: '1px', color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase' }}>Selected organ</span>
                  </div>
                  <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 16, fontWeight: 600 }}>N/A</span>
                  <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10.5, lineHeight: 1.6, fontStyle: 'italic' }}>
                    Click an organ name to see its details here.
                  </span>
                </div>
              )}

              {hasLesions && (
                <div style={{ borderTop: '0.5px solid rgba(255,255,255,0.06)', paddingTop: 12 }}>
                  <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.2)', letterSpacing: '1px', marginBottom: 8 }}>DETECTED LESIONS · click to mark location</div>
                  {Object.entries(data.lesions).map(([organ, info]) => (
                    <div key={organ} className="no-drag" onClick={(e) => handleKeywordClick(organ, organ, e.currentTarget)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 7, padding: '7px 10px', background: 'rgba(255,60,60,0.07)', borderRadius: 8, border: '0.5px solid rgba(255,60,60,0.14)', cursor: 'pointer' }}>
                      <span style={{ color: '#ffaaaa', fontSize: 10, fontWeight: 500 }}>{organ.replace(/_/g, ' ')}</span>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <span style={{ color: 'rgba(255,160,160,0.45)', fontSize: 9 }}>{info.voxels.toLocaleString()} vx</span>
                        <span style={{ background: 'rgba(255,60,60,0.14)', border: '0.5px solid rgba(255,60,60,0.22)', borderRadius: 5, padding: '2px 8px', color: 'rgba(255,160,160,0.9)', fontSize: 9, fontWeight: 600 }}>{info.volume.toFixed(1)} cc</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </DraggablePanel>

          {/* ── PANEL 2 — Impression ── */}
          <DraggablePanel id="impression" initialPos={{ x: window.innerWidth - 370, y: 60 }} style={{ width: 340, pointerEvents: 'auto' }} entranceDelay={120}>
            <div style={glassBase}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, gap: 8 }}>
                <div style={label}>Impression</div>
                <button
                  className="no-drag"
                  onClick={handleExplainImpressions}
                  style={{
                    background: 'rgba(120,170,255,0.1)', border: '0.5px solid rgba(120,170,255,0.25)',
                    color: 'rgba(180,210,255,0.85)', borderRadius: 6, padding: '3px 9px',
                    fontSize: 8.5, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
                  }}
                >
                  Explain in plain language
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                {data.impression.slice(0, 5).map((item, i) => (
                  <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 10px', background: 'rgba(255,255,255,0.025)', borderRadius: 9, border: '0.5px solid rgba(255,255,255,0.05)' }}>
                    <div style={{ width: 18, height: 18, borderRadius: '50%', background: 'rgba(55,138,221,0.18)', border: '0.5px solid rgba(55,138,221,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <span style={{ color: 'rgba(100,160,255,0.9)', fontSize: 9, fontWeight: 700 }}>{i + 1}</span>
                    </div>
                    <span style={{ color: 'rgba(255,255,255,0.58)', fontSize: 10.5, lineHeight: 1.7 }}>{highlightKeywords(item.replace(/^\d+\.\s*/, ''), handleKeywordClick, handleTermClick)}</span>
                  </div>
                ))}
              </div>

              {definition && (
                <div
                  className="no-drag"
                  style={{
                    marginTop: 10, padding: '9px 11px', borderRadius: 9,
                    background: 'rgba(120,170,255,0.07)', border: '0.5px solid rgba(120,170,255,0.18)',
                    animation: 'healthCardIn 0.2s ease', position: 'relative',
                  }}
                >
                  <button
                    onClick={() => setDefinition(null)}
                    style={{
                      position: 'absolute', top: 6, right: 8, background: 'none', border: 'none',
                      color: 'rgba(255,255,255,0.3)', fontSize: 13, cursor: 'pointer', padding: 2,
                    }}
                    aria-label="Close definition"
                  >×</button>
                  <div style={{ fontSize: 9.5, color: 'rgba(180,210,255,0.85)', fontWeight: 600, textTransform: 'capitalize', marginBottom: 4 }}>
                    {definition.term}
                  </div>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.62)', lineHeight: 1.6 }}>
                    {definition.loading ? 'Looking up definition…' : definition.text}
                  </div>
                </div>
              )}
            </div>
          </DraggablePanel>

          {/* ── Plain Language Summary ── */}
          {plainLanguage && (
            <DraggablePanel id="plain-language" initialPos={{ x: window.innerWidth - 370, y: 320 }} style={{ width: 340, pointerEvents: 'auto' }} entranceDelay={0}>
              <div style={glassBase}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div style={label}>Plain language summary</div>
                  <button
                    className="no-drag"
                    onClick={() => setPlainLanguage(null)}
                    style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)', fontSize: 14, cursor: 'pointer', padding: 2 }}
                    aria-label="Close plain language summary"
                  >×</button>
                </div>
                {plainLanguage.loading ? (
                  <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10.5, fontStyle: 'italic' }}>Translating findings…</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                    {plainLanguage.items.map((item, i) => (
                      <div key={i} style={{ padding: '8px 10px', background: 'rgba(120,170,255,0.06)', borderRadius: 9, border: '0.5px solid rgba(120,170,255,0.14)' }}>
                        <span style={{ color: 'rgba(255,255,255,0.62)', fontSize: 10.5, lineHeight: 1.7 }}>{item}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </DraggablePanel>
          )}

          {/* ── PANEL 3 — Findings Explorer: abnormal organs first, normal
              organs collapsed below. Clicking any organ selects it (same
              handleKeywordClick path as Impression/Findings text), which
              populates the Selected Organ header in Panel 1. ── */}
          <DraggablePanel id="findings-explorer" initialPos={{ x: 16, y: window.innerHeight - 420 }} style={{ width: 300, pointerEvents: 'auto' }} entranceDelay={240}>
            <div style={glassBase}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={label}>Findings explorer</div>
              </div>
              {(() => {
                const allOrgans = Object.entries(data.organ_volumes).filter(([_, v]) => v.volume > 5);
                const abnormal = allOrgans.filter(([_, v]) => v.status === 'check');
                const normal = allOrgans.filter(([_, v]) => v.status !== 'check');
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                    {abnormal.length > 0 && (
                      <div>
                        <div style={{ fontSize: 8.5, color: 'rgba(251,191,36,0.6)', letterSpacing: '0.8px', marginBottom: 6, textTransform: 'uppercase' }}>Abnormal</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                          {abnormal.map(([organ]) => (
                            <div
                              key={organ}
                              className="no-drag"
                              onClick={() => handleKeywordClick(organ, organ, document.body as unknown as HTMLElement)}
                              style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                padding: '7px 10px', borderRadius: 8, cursor: 'pointer',
                                background: focusedOrgan === organ ? 'rgba(251,191,36,0.14)' : 'rgba(251,191,36,0.06)',
                                border: `0.5px solid ${focusedOrgan === organ ? 'rgba(251,191,36,0.4)' : 'rgba(251,191,36,0.16)'}`,
                              }}
                            >
                              <span style={{ color: 'rgba(255,255,255,0.75)', fontSize: 10.5, textTransform: 'capitalize' }}>{organ.replace(/_/g, ' ')}</span>
                              <span style={{ color: '#fbbf24', fontSize: 8.5 }}>review</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {normal.length > 0 && (
                      <div>
                        <div style={{ fontSize: 8.5, color: 'rgba(109,202,165,0.55)', letterSpacing: '0.8px', marginBottom: 6, marginTop: abnormal.length > 0 ? 4 : 0, textTransform: 'uppercase' }}>Normal</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                          {(showAllNormal ? normal : normal.slice(0, 4)).map(([organ]) => (
                            <div
                              key={organ}
                              className="no-drag"
                              onClick={() => handleKeywordClick(organ, organ, document.body as unknown as HTMLElement)}
                              style={{
                                display: 'flex', alignItems: 'center',
                                padding: '6px 10px', borderRadius: 8, cursor: 'pointer',
                                background: focusedOrgan === organ ? 'rgba(109,202,165,0.1)' : 'transparent',
                                border: `0.5px solid ${focusedOrgan === organ ? 'rgba(109,202,165,0.3)' : 'transparent'}`,
                              }}
                            >
                              <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 10, textTransform: 'capitalize' }}>{organ.replace(/_/g, ' ')}</span>
                            </div>
                          ))}
                          {normal.length > 4 && (
                            <button
                              className="no-drag"
                              onClick={() => setShowAllNormal((v) => !v)}
                              style={{
                                background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)',
                                fontSize: 9.5, cursor: 'pointer', padding: '4px 10px', textAlign: 'left',
                              }}
                            >
                              {showAllNormal ? 'Show less' : `+ ${normal.length - 4} more`}
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          </DraggablePanel>

          {/* ── PANEL 4 — Imaging detail ── */}
          <DraggablePanel id="imaging" initialPos={{ x: window.innerWidth - 320, y: window.innerHeight - 290 }} style={{ width: 295, pointerEvents: 'auto' }} entranceDelay={360}>
            <div style={glassBase}>
              <div style={label}>Imaging detail</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[
                  ['Study', data.imaging.study_type || 'CT'],
                  ['Contrast', data.imaging.contrast || 'N/A'],
                  ['Spacing', data.imaging.spacing.map(s => s.toFixed(2)).join(' × ') + ' mm'],
                  ['Dimensions', data.imaging.shape.join(' × ')],
                  ['Patient', `${data.patient.sex} · ${data.patient.age}y`],
                ].map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 7, borderBottom: '0.5px solid rgba(255,255,255,0.04)' }}>
                    <span style={{ color: 'rgba(255,255,255,0.26)', fontSize: 9.5 }}>{k}</span>
                    <span style={{ color: 'rgba(255,255,255,0.65)', fontSize: 9.5, textAlign: 'right', maxWidth: 160, fontWeight: 500 }}>{v}</span>
                  </div>
                ))}
              </div>
            </div>
          </DraggablePanel>

          {/* ── Findings Timeline ── */}
          <FindingsTimeline
            organStatuses={Object.entries(data.organ_volumes)
              .filter(([_, v]) => v.volume > 5)
              .filter(([organ]) => taggedSentences.some((s) => s.organs.includes(organ)))
              .map(([organ, vals]) => ({
                organ,
                status: (vals.status as 'normal' | 'check') ?? 'normal',
              }))}
            comments={data.comments}
            focusedOrgan={focusedOrgan}
            onNodeTap={handleTimelineFocus}
          />

          {/* ── View switcher ── */}
          <div style={{ position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', zIndex: 10001, pointerEvents: 'auto', display: 'flex', gap: 6, background: 'rgba(10,12,18,0.65)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.09)', borderTop: '1px solid rgba(255,255,255,0.18)', borderRadius: 12, padding: '6px 8px', boxShadow: '0 4px 24px rgba(0,0,0,0.35)' }}>
            {(['axial', 'sagittal', 'coronal', '3d'] as const).map(view => (
              <button key={view} onClick={() => { setActiveView(view); onViewChange(view); }} className="no-drag" style={{
                background: activeView === view ? 'rgba(55,138,221,0.22)' : 'transparent',
                border: activeView === view ? '0.5px solid rgba(55,138,221,0.45)' : '0.5px solid transparent',
                color: activeView === view ? 'rgba(133,183,235,0.95)' : 'rgba(255,255,255,0.28)',
                borderRadius: 8, padding: '5px 16px', cursor: 'pointer', fontSize: 10,
                fontWeight: activeView === view ? 500 : 400, letterSpacing: '0.5px',
                transition: 'all 0.15s ease', pointerEvents: 'auto',
              }}>
                {view === '3d' ? '3D' : view.charAt(0).toUpperCase() + view.slice(1)}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
};

export default ReportScreen;