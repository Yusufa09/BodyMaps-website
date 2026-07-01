import {
  clearMeasurements as csClearMeasurements,
  LENGTH_TOOL,
  PROBE_TOOL,
  ROI_TOOL,
  moveCornerstoneCrosshairToMm,
  getOrganCentroids,
  setToolGroupOpacity,
  setZoom as csSetZoom,
  zoomToFit as csZoomToFit,
} from "../../helpers/CornerstoneNifti2";
import type { MeasurementToolName } from "../../helpers/CornerstoneNifti2";
import { segmentation_categories } from "../../helpers/constants";
import type { CheckBoxData } from "../../types";
import type { ViewerActions } from "./types";

type OrganStat = { organ_name: string; volume_cm3: number; mean_hu: number };

function normalizeName(value: string) {
  return value.toLowerCase().replace(/_/g, " ").replace(/\s+/g, " ").trim();
}

function displayName(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function organKeyToId(key: string, checkBoxData: CheckBoxData[]): number | null {
  const normalizedKey = normalizeName(key);
  const found = checkBoxData.find((item) => normalizeName(item.label) === normalizedKey);
  if (found) return found.id;
  const index = segmentation_categories.findIndex((category) => normalizeName(category) === normalizedKey);
  if (index === -1) return null;
  return index + 1;
}

function statMatchesOrgan(statName: string, organKey: string) {
  return normalizeName(statName) === normalizeName(organKey);
}

function validVolume(value: number | undefined | null) {
  return typeof value === "number" && Number.isFinite(value) && value !== 999999 && value > 0;
}

async function fetchOrganStats(apiBase: string, caseId: string): Promise<OrganStat[]> {
  const formData = new FormData();
  formData.append("sessionKey", String(caseId));
  const response = await fetch(`${apiBase}/api/mask-data`, { method: "POST", body: formData });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`);
  return (data.organ_metrics ?? []) as OrganStat[];
}

export function buildViewerActions(opts: {
  checkBoxData: CheckBoxData[];
  setCheckState: React.Dispatch<React.SetStateAction<boolean[]>>;
  setOpacityValue: React.Dispatch<React.SetStateAction<number>>;
  handleWindowChange: (width: number | null, center: number | null) => void;
  setViewModeFn: (view: "mpr" | "axial" | "sagittal" | "coronal" | "3d") => void;
  setActiveMeasureToolFn: React.Dispatch<React.SetStateAction<MeasurementToolName | null>>;
  caseId: string;
  apiBase: string;
}): ViewerActions {
  const {
    checkBoxData,
    setCheckState,
    setOpacityValue,
    handleWindowChange,
    setViewModeFn,
    setActiveMeasureToolFn,
    caseId,
    apiBase,
  } = opts;

  const windowPresets: Record<string, { width: number; center: number }> = {
    soft_tissue: { width: 400, center: 40 },
    bone: { width: 1800, center: 400 },
    lung: { width: 1500, center: -600 },
    liver: { width: 150, center: -50 },
  };

  const toolMap: Record<string, MeasurementToolName> = {
    distance: LENGTH_TOOL,
    probe: PROBE_TOOL,
    roi: ROI_TOOL,
  };

  return {
    isolateOrgans(organKeys) {
      setCheckState((previous) => {
        const next = new Array(previous.length).fill(false);
        next[0] = true;
        for (const key of organKeys) {
          const id = organKeyToId(key, checkBoxData);
          if (id !== null && id < next.length) next[id] = true;
        }
        return next;
      });
    },

    showOrgans(organKeys) {
      setCheckState((previous) => {
        const next = [...previous];
        for (const key of organKeys) {
          const id = organKeyToId(key, checkBoxData);
          if (id !== null && id < next.length) next[id] = true;
        }
        return next;
      });
    },

    hideOrgans(organKeys) {
      setCheckState((previous) => {
        const next = [...previous];
        for (const key of organKeys) {
          const id = organKeyToId(key, checkBoxData);
          if (id !== null && id < next.length) next[id] = false;
        }
        return next;
      });
    },

    focusOrgan(organKey) {
      const id = organKeyToId(organKey, checkBoxData);
      if (id !== null) {
        setCheckState((previous) => {
          const next = [...previous];
          next[id] = true;
          return next;
        });
      }
      const centroids = getOrganCentroids();
      if (centroids && id !== null && centroids[id]) moveCornerstoneCrosshairToMm(centroids[id]);
    },

    setOpacity(value) {
      const clamped = Math.max(0, Math.min(100, value));
      setOpacityValue(clamped);
      setToolGroupOpacity(clamped / 100);
    },

    setWindow(width, center) {
      handleWindowChange(width, center);
    },

    setWindowPreset(preset) {
      const selectedPreset = windowPresets[preset];
      if (selectedPreset) handleWindowChange(selectedPreset.width, selectedPreset.center);
    },

    setZoom(value) {
      csSetZoom(value);
    },

    zoomToFit() {
      csZoomToFit();
    },

    setViewMode(view) {
      setViewModeFn(view);
    },

    activateMeasurementTool(tool) {
      setActiveMeasureToolFn(toolMap[tool] ?? null);
    },

    clearMeasurements() {
      csClearMeasurements();
    },

    async getOrganMetric(organ, metric) {
      try {
        const stats = await fetchOrganStats(apiBase, caseId);
        const entry = stats.find((item) => statMatchesOrgan(item.organ_name, organ));
        if (!entry) return `No statistics were found for ${displayName(organ)} in this case.`;
        const volume = validVolume(entry.volume_cm3) ? `${entry.volume_cm3.toFixed(2)} cm³` : "N/A";
        const meanHu = typeof entry.mean_hu === "number" && Number.isFinite(entry.mean_hu) && entry.mean_hu !== 999999 ? `${entry.mean_hu.toFixed(1)} HU` : "N/A";
        if (metric === "volume_cm3") return `The segmented ${displayName(organ)} volume is **${volume}**.`;
        if (metric === "mean_hu") return `The segmented ${displayName(organ)} mean HU is **${meanHu}**.`;
        return `For ${displayName(organ)}: volume is **${volume}** and mean HU is **${meanHu}**.`;
      } catch (error) {
        console.error("[BodyMaps AI metric error]", error);
        return "I could not load organ statistics for this case. The server may not have segmentation metrics available.";
      }
    },

    async listStructures() {
      const names = checkBoxData.map((item) => item.label).filter(Boolean);
      if (!names.length) return "No segmented structures are currently listed for this case.";
      return `This case includes **${names.length} segmented structures**: ${names.join(", ")}.`;
    },

    async getStructureCount() {
      return `This case has **${checkBoxData.length} segmented structures** listed in the viewer.`;
    },

    async getLargestStructure() {
      try {
        const stats = await fetchOrganStats(apiBase, caseId);
        const validStats = stats.filter((item) => validVolume(item.volume_cm3));
        if (!validStats.length) return "I could not determine the largest structure because valid volume metrics are unavailable.";
        const largest = [...validStats].sort((a, b) => b.volume_cm3 - a.volume_cm3)[0];
        const id = organKeyToId(largest.organ_name, checkBoxData);
        if (id !== null) {
          setCheckState((previous) => {
            const next = new Array(previous.length).fill(false);
            next[0] = true;
            next[id] = true;
            return next;
          });
        }
        return `The largest segmented structure is **${displayName(largest.organ_name)}**, with a volume of **${largest.volume_cm3.toFixed(2)} cm³**. I isolated it in the viewer.`;
      } catch (error) {
        console.error("[BodyMaps AI largest error]", error);
        return "I could not calculate the largest segmented structure from this case.";
      }
    },

    async getSmallestStructure() {
      try {
        const stats = await fetchOrganStats(apiBase, caseId);
        const validStats = stats.filter((item) => validVolume(item.volume_cm3));
        if (!validStats.length) return "I could not determine the smallest structure because valid volume metrics are unavailable.";
        const smallest = [...validStats].sort((a, b) => a.volume_cm3 - b.volume_cm3)[0];
        const id = organKeyToId(smallest.organ_name, checkBoxData);
        if (id !== null) {
          setCheckState((previous) => {
            const next = new Array(previous.length).fill(false);
            next[0] = true;
            next[id] = true;
            return next;
          });
        }
        return `The smallest segmented structure is **${displayName(smallest.organ_name)}**, with a volume of **${smallest.volume_cm3.toFixed(2)} cm³**. I isolated it in the viewer.`;
      } catch (error) {
        console.error("[BodyMaps AI smallest error]", error);
        return "I could not calculate the smallest segmented structure from this case.";
      }
    },
  };
}
