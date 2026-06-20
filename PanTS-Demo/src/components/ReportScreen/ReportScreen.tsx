import { useEffect, useState } from 'react';
import { APP_CONSTANTS } from '../../helpers/constants';

type Props = {
  id: string;
  onClose: () => void;
};

// Fetches the case's PDF report (/api/get-report) and opens it in a new tab. Shows a
// loading toast while generating and a visible error toast if it fails — instead of
// silently closing (which made the Report button look dead when the report is
// unavailable, e.g. on a dev checkout without the volume data).
const ReportScreen = ({ id, onClose }: Props): React.ReactElement | null => {
  const [status, setStatus] = useState<'loading' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    fetch(`${APP_CONSTANTS.API_ORIGIN}/api/get-report/${id}`, { method: 'GET' })
      .then(async (res) => {
        if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
        return res.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank', 'noopener,noreferrer');
        onClose();
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [id, onClose]);

  // Auto-dismiss the error toast after a few seconds.
  useEffect(() => {
    if (status !== 'error') return;
    const t = setTimeout(onClose, 5000);
    return () => clearTimeout(t);
  }, [status, onClose]);

  const toast: React.CSSProperties = {
    position: 'fixed',
    bottom: '28px',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 9999,
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    background: 'rgba(14,15,18,0.92)',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: '12px',
    padding: '12px 16px',
    color: '#fff',
    fontFamily: "'Space Grotesk', system-ui, sans-serif",
    fontSize: '13px',
    boxShadow: '0 16px 40px -12px rgba(0,0,0,0.7)',
  };

  if (status === 'loading') {
    return (
      <div style={toast}>
        <span
          className="vp-spinner"
          style={{ width: 16, height: 16, borderWidth: 2 }}
        />
        Generating report…
      </div>
    );
  }

  return (
    <div style={toast}>
      <span>Report isn’t available for this case.</span>
      <button
        onClick={onClose}
        style={{
          background: 'transparent',
          border: '1px solid rgba(255,255,255,0.2)',
          color: '#fff',
          borderRadius: '8px',
          padding: '4px 10px',
          cursor: 'pointer',
          fontFamily: 'inherit',
          fontSize: '12px',
        }}
      >
        Dismiss
      </button>
    </div>
  );
};

export default ReportScreen;
