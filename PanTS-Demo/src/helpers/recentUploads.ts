// Recent uploads persisted in the user's localStorage (mirrors JHU's recentIds
// pattern). Extracted from UploadPage so the logic can be unit-tested.

export type RecentUploadStatus = "Processing" | "Completed" | "Failed";

export type RecentUpload = {
	sessionId: string;
	label: string;
	model: string;
	status: RecentUploadStatus;
	timestamp: number;
	isReconstruction?: boolean;
};

export const RECENT_UPLOADS_KEY = "recentUploads";
export const MAX_RECENT_UPLOADS = 8;

export const loadRecentUploads = (): RecentUpload[] => {
	try {
		const arr = JSON.parse(localStorage.getItem(RECENT_UPLOADS_KEY) || "[]");
		return Array.isArray(arr) ? arr : [];
	} catch {
		return [];
	}
};

export const persistRecentUploads = (list: RecentUpload[]) => {
	try {
		localStorage.setItem(RECENT_UPLOADS_KEY, JSON.stringify(list.slice(0, MAX_RECENT_UPLOADS)));
	} catch (e) {
		console.warn("saveRecentUploads failed", e);
	}
};

export const addRecentUpload = (entry: RecentUpload): RecentUpload[] => {
	const list = [entry, ...loadRecentUploads().filter((u) => u.sessionId !== entry.sessionId)];
	const trimmed = list.slice(0, MAX_RECENT_UPLOADS);
	persistRecentUploads(trimmed);
	return trimmed;
};

export const updateRecentUploadStatus = (
	sessionId: string,
	status: RecentUploadStatus
): RecentUpload[] => {
	const list = loadRecentUploads().map((u) => (u.sessionId === sessionId ? { ...u, status } : u));
	persistRecentUploads(list);
	return list;
};

export const formatRelativeTime = (ts: number): string => {
	const mins = Math.floor((Date.now() - ts) / 60000);
	if (mins < 1) return "Just now";
	if (mins < 60) return `${mins} min${mins === 1 ? "" : "s"} ago`;
	const hours = Math.floor(mins / 60);
	if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
	const days = Math.floor(hours / 24);
	return days === 1 ? "Yesterday" : `${days} days ago`;
};

export const recentStatusColor = (status: RecentUploadStatus): string =>
	status === "Failed" ? "#ef4444" : status === "Processing" ? "#6a6a6a" : "#8f8f8f";
