import React, { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE } from "../../helpers/constants";
import type { AIAction, AISidebarProps, ChatMessage } from "./types";
import "./AISidebar.css";

const SendIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
    <line x1="22" y1="2" x2="11" y2="13" />
    <polygon points="22 2 15 22 11 13 2 9 22 2" />
  </svg>
);

const BotIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="10" rx="2" />
    <circle cx="12" cy="5" r="2" />
    <line x1="12" y1="7" x2="12" y2="11" />
    <line x1="8" y1="15" x2="8" y2="15" strokeWidth={2.5} />
    <line x1="16" y1="15" x2="16" y2="15" strokeWidth={2.5} />
    <path d="M8 19 Q12 21 16 19" />
  </svg>
);

let messageCounter = 0;

function makeId() {
  messageCounter += 1;
  return `msg-${Date.now()}-${messageCounter}`;
}

function formatTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function renderBubbleText(text: string) {
  const lines = text.split("\n");
  return lines.map((line, lineIndex) => {
    const parts = line.split(/(\*\*[^*]+\*\*)/g);
    return (
      <React.Fragment key={`line-${lineIndex}`}>
        {parts.map((part, partIndex) => {
          if (part.startsWith("**") && part.endsWith("**")) {
            return <strong key={`${lineIndex}-${partIndex}`}>{part.slice(2, -2)}</strong>;
          }
          return <React.Fragment key={`${lineIndex}-${partIndex}`}>{part}</React.Fragment>;
        })}
        {lineIndex < lines.length - 1 ? <br /> : null}
      </React.Fragment>
    );
  });
}

function prettyOrgan(key: string) {
  return key.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function actionButtonLabel(action: AIAction) {
  switch (action.type) {
    case "isolate_organs":
      return `Isolate ${action.organs.map(prettyOrgan).join(", ")}`;
    case "show_organs":
      return `Show ${action.organs.map(prettyOrgan).join(", ")}`;
    case "hide_organs":
      return `Hide ${action.organs.map(prettyOrgan).join(", ")}`;
    case "focus_organ":
      return `Focus ${prettyOrgan(action.organ)}`;
    case "get_organ_metric":
      if (action.metric === "volume_cm3") return `Get ${prettyOrgan(action.organ)} Volume`;
      if (action.metric === "mean_hu") return `Get ${prettyOrgan(action.organ)} Mean HU`;
      return `Get ${prettyOrgan(action.organ)} Metrics`;
    case "set_opacity":
      return `Set Opacity to ${Math.round(action.value)}%`;
    case "set_window":
      return `Apply Window W${Math.round(action.width)} / C${Math.round(action.center)}`;
    case "set_window_preset":
      return `Apply ${action.preset.replace(/_/g, " ")} Window`;
    case "set_zoom":
      return `Set Zoom ${action.value}`;
    case "zoom_to_fit":
      return "Zoom to Fit";
    case "set_view":
      return `Switch to ${action.view.toUpperCase()} View`;
    case "activate_measurement_tool":
      return `Activate ${action.tool.toUpperCase()} Tool`;
    case "clear_measurements":
      return "Clear Measurements";
    case "list_structures":
      return "List Structures";
    case "get_structure_count":
      return "Count Structures";
    case "get_largest_structure":
      return "Find Largest Structure";
    case "get_smallest_structure":
      return "Find Smallest Structure";
  }
}

type PendingAction = {
  id: string;
  action: AIAction;
  status: "pending" | "running" | "done" | "error";
};

const WELCOME_CONTENT = [
  "Hi, I'm **BodyMaps AI**. I can help you explore this CT scan and understand the segmented anatomy.",
  "",
  "Ask me to isolate an organ, explain CT concepts, or list the structures present in this case.",
  "",
  "Try: “Segment the liver”, “What is a CT scan?”, or “List the structures present.”",
].join("\n");

const WELCOME_MESSAGE: ChatMessage = {
  id: "welcome",
  role: "system",
  content: WELCOME_CONTENT,
  timestamp: Date.now(),
};

const SUGGESTION_CHIPS = [
  "Segment the liver",
  "What is a CT scan?",
  "List the structures present",
];

export default function AISidebar({
  open,
  onClose,
  caseId,
  sessionId,
  availableOrgans,
  viewerState,
  actions,
}: AISidebarProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME_MESSAGE]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [pendingByMessage, setPendingByMessage] = useState<Record<string, PendingAction[]>>({});
  const chatEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading, pendingByMessage]);

  useEffect(() => {
    if (open) window.setTimeout(() => textareaRef.current?.focus(), 280);
  }, [open]);

  const handleInput = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(event.target.value);
    const element = event.target;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 100)}px`;
  };

  const executeAction = useCallback(
    async (action: AIAction): Promise<string | null> => {
      switch (action.type) {
        case "isolate_organs":
          actions.isolateOrgans(action.organs);
          return `Done. I isolated ${action.organs.map(prettyOrgan).join(", ")} in the CT slices and 3D segmentation.`;
        case "show_organs":
          actions.showOrgans(action.organs);
          return `Done. I showed ${action.organs.map(prettyOrgan).join(", ")}.`;
        case "hide_organs":
          actions.hideOrgans(action.organs);
          return `Done. I hid ${action.organs.map(prettyOrgan).join(", ")}.`;
        case "focus_organ":
          actions.focusOrgan(action.organ);
          return `Done. I focused on ${prettyOrgan(action.organ)}.`;
        case "get_organ_metric":
          return await actions.getOrganMetric(action.organ, action.metric);
        case "set_opacity":
          actions.setOpacity(action.value);
          return `Done. Opacity is now ${Math.round(action.value)}%.`;
        case "set_window":
          actions.setWindow(action.width, action.center);
          return `Done. Window width is ${Math.round(action.width)} and center is ${Math.round(action.center)}.`;
        case "set_window_preset":
          actions.setWindowPreset(action.preset);
          return `Done. I applied the ${action.preset.replace(/_/g, " ")} window preset.`;
        case "set_zoom":
          actions.setZoom(action.value);
          return `Done. Zoom was set to ${action.value}.`;
        case "zoom_to_fit":
          actions.zoomToFit();
          return "Done. I reset the zoom to fit.";
        case "set_view":
          actions.setViewMode(action.view);
          return `Done. I switched to ${action.view.toUpperCase()} view.`;
        case "activate_measurement_tool":
          actions.activateMeasurementTool(action.tool);
          if (action.tool === "distance") return "Distance tool is active. Click two points in the viewer to measure distance.";
          if (action.tool === "probe") return "HU probe is active. Click a point in the viewer to read its Hounsfield value.";
          return "ROI tool is active. Draw a region in the viewer to measure area and mean HU.";
        case "clear_measurements":
          actions.clearMeasurements();
          return "Done. I cleared all measurements.";
        case "list_structures":
          return await actions.listStructures();
        case "get_structure_count":
          return await actions.getStructureCount();
        case "get_largest_structure":
          return await actions.getLargestStructure();
        case "get_smallest_structure":
          return await actions.getSmallestStructure();
      }
    },
    [actions]
  );

  const handleApplyAction = useCallback(
    async (messageId: string, pendingId: string) => {
      const pending = pendingByMessage[messageId]?.find((item) => item.id === pendingId);
      if (!pending || pending.status === "running" || pending.status === "done") return;

      setPendingByMessage((previous) => ({
        ...previous,
        [messageId]: previous[messageId].map((item) =>
          item.id === pendingId ? { ...item, status: "running" } : item
        ),
      }));

      try {
        const result = await executeAction(pending.action);
        setPendingByMessage((previous) => ({
          ...previous,
          [messageId]: previous[messageId].map((item) =>
            item.id === pendingId ? { ...item, status: "done" } : item
          ),
        }));
        if (result) {
          setMessages((previous) => [
            ...previous,
            { id: makeId(), role: "assistant", content: result, timestamp: Date.now() },
          ]);
        }
      } catch (error) {
        console.error("[BodyMaps AI apply action error]", error);
        setPendingByMessage((previous) => ({
          ...previous,
          [messageId]: previous[messageId].map((item) =>
            item.id === pendingId ? { ...item, status: "error" } : item
          ),
        }));
      }
    },
    [pendingByMessage, executeAction]
  );

  const handleSend = useCallback(
    async (overrideText?: string) => {
      const text = (overrideText ?? input).trim();
      if (!text || loading) return;

      setInput("");
      if (textareaRef.current) textareaRef.current.style.height = "auto";

      setMessages((previous) => [
        ...previous,
        { id: makeId(), role: "user", content: text, timestamp: Date.now() },
      ]);
      setLoading(true);

      try {
        const response = await fetch(`${API_BASE}/api/ai-command`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: text,
            case_id: caseId,
            session_id: sessionId ?? null,
            available_organs: availableOrgans,
            viewer_state: viewerState,
          }),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = (await response.json()) as { reply?: string; actions?: AIAction[] };
        const assistantId = makeId();
        setMessages((previous) => [
          ...previous,
          { id: assistantId, role: "assistant", content: data.reply ?? "Done.", timestamp: Date.now() },
        ]);
        const returnedActions = data.actions ?? [];
        if (returnedActions.length > 0) {
          setPendingByMessage((previous) => ({
            ...previous,
            [assistantId]: returnedActions.map((action, index) => ({
              id: `${assistantId}-action-${index}`,
              action,
              status: "pending",
            })),
          }));
        }
      } catch (error) {
        console.error("[BodyMaps AI send error]", error);
        setMessages((previous) => [
          ...previous,
          {
            id: makeId(),
            role: "assistant",
            content: "I could not connect to the AI backend. Please make sure the Flask server is running and try again.",
            timestamp: Date.now(),
          },
        ]);
      } finally {
        setLoading(false);
      }
    },
    [input, loading, caseId, sessionId, availableOrgans, viewerState]
  );

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
    }
  };

  return (
    <aside className={open ? "ai-sidebar is-open" : "ai-sidebar"} aria-label="BodyMaps AI assistant" aria-hidden={!open}>
      <header className="ai-sidebar__header">
        <div className="ai-sidebar__icon" aria-hidden="true">
          <BotIcon />
        </div>
        <div className="ai-sidebar__titles">
          <span className="ai-sidebar__title">BodyMaps AI</span>
          <span className="ai-sidebar__subtitle">Viewer assistant</span>
        </div>
        <button className="ai-sidebar__close" onClick={onClose} aria-label="Close AI assistant" title="Close" type="button">
          ×
        </button>
      </header>

      <div className="ai-sidebar__chat" role="log" aria-live="polite" aria-relevant="additions">
        {messages.map((message) => {
          const pendingActions = pendingByMessage[message.id] ?? [];
          return (
            <div key={message.id} className={`ai-msg ai-msg--${message.role}`}>
              <div className="ai-msg__bubble">{renderBubbleText(message.content)}</div>
              {pendingActions.length > 0 && (
                <div className="ai-action-list">
                  {pendingActions.map((pending) => (
                    <button
                      key={pending.id}
                      className={pending.status === "done" ? "ai-action-btn ai-action-btn--done" : "ai-action-btn"}
                      type="button"
                      disabled={pending.status === "running" || pending.status === "done"}
                      onClick={() => void handleApplyAction(message.id, pending.id)}
                    >
                      {pending.status === "running" ? "Applying..." : pending.status === "done" ? "Applied" : actionButtonLabel(pending.action)}
                    </button>
                  ))}
                </div>
              )}
              <span className="ai-msg__time">{formatTime(message.timestamp)}</span>
            </div>
          );
        })}

        {loading && (
          <div className="ai-msg ai-msg--assistant">
            <div className="ai-typing" aria-label="AI is thinking">
              <span className="ai-typing__dot" />
              <span className="ai-typing__dot" />
              <span className="ai-typing__dot" />
            </div>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      {messages.length <= 1 && !loading && (
        <div className="ai-sidebar__chips" role="group" aria-label="Suggested commands">
          {SUGGESTION_CHIPS.map((chip) => (
            <button key={chip} className="ai-chip" onClick={() => void handleSend(chip)} disabled={loading} type="button">
              {chip}
            </button>
          ))}
        </div>
      )}

      <div className="ai-sidebar__input-dock">
        <div className="ai-sidebar__input-row">
          <textarea
            ref={textareaRef}
            className="ai-sidebar__textarea"
            rows={1}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder="Ask about CT, organs, or viewer tools…"
            disabled={loading}
            aria-label="Type a command"
          />
          <button className="ai-sidebar__send" onClick={() => void handleSend()} disabled={loading || !input.trim()} aria-label="Send message" type="button">
            <SendIcon />
          </button>
        </div>
        <p className="ai-sidebar__hint">Enter to send · Shift+Enter for new line</p>
      </div>
    </aside>
  );
}
