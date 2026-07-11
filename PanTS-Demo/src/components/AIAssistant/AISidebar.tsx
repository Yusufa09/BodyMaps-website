// Trigger typecheck using the latest AI assistant files.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE } from "../../helpers/constants";
import type {
  AIAction,
  AIModelInfo,
  AISidebarProps,
  ChatMessage,
} from "./types";
import "./AISidebar.css";

const MODEL_STORAGE_KEY = "bodymaps-ai-model";

const SendIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2.1}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M22 2 11 13" />
    <path d="m22 2-7 20-4-9-9-4 20-7Z" />
  </svg>
);

const CloseIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    aria-hidden="true"
  >
    <path d="m7 7 10 10M17 7 7 17" />
  </svg>
);

const BotIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.7}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="4" y="10" width="16" height="10" rx="2.8" />
    <path d="M12 10V6" />
    <circle cx="12" cy="5" r="2" />
    <path d="M8.5 15h.01M15.5 15h.01M9 18c1.4.9 4.6.9 6 0" />
  </svg>
);

const ChevronIcon = () => (
  <svg
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="m6.5 8 3.5 3.5L13.5 8" />
  </svg>
);

const CheckIcon = () => (
  <svg
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="m5 10 3 3 7-7" />
  </svg>
);

let messageCounter = 0;

function makeId() {
  messageCounter += 1;
  return `msg-${Date.now()}-${messageCounter}`;
}

function renderMessageText(content: string) {
  return content.split("\n").map((line, lineIndex, lines) => {
    const parts = line.split(/(\*\*[^*]+\*\*)/g);

    return (
      <React.Fragment key={`${lineIndex}-${line}`}>
        {parts.map((part, partIndex) => {
          if (part.startsWith("**") && part.endsWith("**")) {
            return (
              <strong key={`${lineIndex}-${partIndex}`}>
                {part.slice(2, -2)}
              </strong>
            );
          }

          return (
            <React.Fragment key={`${lineIndex}-${partIndex}`}>
              {part}
            </React.Fragment>
          );
        })}

        {lineIndex < lines.length - 1 ? <br /> : null}
      </React.Fragment>
    );
  });
}

const SUGGESTION_CHIPS = [
  "Segment the liver and tell me its volume",
  "What does the liver do?",
  "What organs are visible in this scan?",
];

type AICommandResponse = {
  reply?: string;
  actions?: AIAction[];
  source?: string;
  model?: string | null;
};

type ModelState = "loading" | "ollama" | "fallback";

export default function AISidebar({
  open,
  onClose,
  caseId,
  sessionId,
  availableOrgans,
  viewerState,
  organMetrics = [],
  organReferences = [],
  demographics = null,
  actions,
}: AISidebarProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [models, setModels] = useState<AIModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [modelState, setModelState] = useState<ModelState>("loading");
  const [modelMenuOpen, setModelMenuOpen] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const modelPickerRef = useRef<HTMLDivElement>(null);

  const loadModels = useCallback(async () => {
    setModelState("loading");

    try {
      const response = await fetch(`${API_BASE}/api/ai-models`);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }

      const nextModels: AIModelInfo[] = Array.isArray(data.models)
        ? data.models
        : [];
      setModels(nextModels);

      if (!data.available || nextModels.length === 0) {
        setSelectedModel("");
        setModelState("fallback");
        return;
      }

      const storedModel =
        window.localStorage.getItem(MODEL_STORAGE_KEY) ?? "";
      const defaultModel = String(
        data.default_model || nextModels[0].name
      );
      const nextSelection = nextModels.some(
        (model) => model.name === storedModel
      )
        ? storedModel
        : nextModels.some((model) => model.name === defaultModel)
          ? defaultModel
          : nextModels[0].name;

      setSelectedModel(nextSelection);
      setModelState("ollama");
    } catch (error) {
      console.warn("[BodyMaps AI models]", error);
      setModels([]);
      setSelectedModel("");
      setModelState("fallback");
    }
  }, []);

  useEffect(() => {
    if (!open) return;

    setModelMenuOpen(false);
    void loadModels();
    const focusTimer = window.setTimeout(() => {
      textareaRef.current?.focus();
    }, 180);

    return () => window.clearTimeout(focusTimer);
  }, [open, loadModels]);

  useEffect(() => {
    setMessages([]);
    setInput("");
    setModelMenuOpen(false);
  }, [caseId, sessionId]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "end",
    });
  }, [messages, loading]);

  const closeSidebar = useCallback(() => {
    setModelMenuOpen(false);
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (
        modelMenuOpen &&
        modelPickerRef.current &&
        !modelPickerRef.current.contains(event.target as Node)
      ) {
        setModelMenuOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (modelMenuOpen) {
        setModelMenuOpen(false);
      } else {
        closeSidebar();
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [closeSidebar, modelMenuOpen, open]);

  const selectModel = (value: string) => {
    setSelectedModel(value);
    setModelMenuOpen(false);

    if (value) {
      window.localStorage.setItem(MODEL_STORAGE_KEY, value);
      setModelState("ollama");
    } else {
      window.localStorage.removeItem(MODEL_STORAGE_KEY);
      setModelState(models.length > 0 ? "ollama" : "fallback");
    }
  };

  const handleInput = (
    event: React.ChangeEvent<HTMLTextAreaElement>
  ) => {
    setInput(event.target.value);

    const element = event.target;
    element.style.height = "auto";
    element.style.height = `${Math.min(
      element.scrollHeight,
      124
    )}px`;
  };

  const executeAction = useCallback(
    async (action: AIAction): Promise<void> => {
      switch (action.type) {
        case "isolate_organs":
          actions.isolateOrgans(action.organs);
          break;
        case "show_organs":
          actions.showOrgans(action.organs);
          break;
        case "hide_organs":
          actions.hideOrgans(action.organs);
          break;
        case "focus_organ":
          actions.focusOrgan(action.organ);
          break;
        case "set_opacity":
          actions.setOpacity(action.value);
          break;
        case "set_window":
          actions.setWindow(action.width, action.center);
          break;
        case "set_window_preset":
          actions.setWindowPreset(action.preset);
          break;
        case "set_zoom":
          actions.setZoom(action.value);
          break;
        case "zoom_to_fit":
          actions.zoomToFit();
          break;
        case "set_view":
          actions.setViewMode(action.view);
          break;
        case "activate_measurement_tool":
          actions.activateMeasurementTool(action.tool);
          break;
        case "clear_measurements":
          actions.clearMeasurements();
          break;
        case "get_largest_structure":
          await actions.getLargestStructure();
          break;
        case "get_smallest_structure":
          await actions.getSmallestStructure();
          break;
        case "get_organ_metric":
        case "list_structures":
        case "get_structure_count":
          // The Flask response is already grounded with these values.
          break;
      }
    },
    [actions]
  );

  const applyReturnedActions = useCallback(
    async (returnedActions: AIAction[]) => {
      for (const action of returnedActions) {
        try {
          await executeAction(action);
        } catch (error) {
          console.error(
            "[BodyMaps AI action error]",
            error,
            action
          );
        }
      }
    },
    [executeAction]
  );

  const handleSend = useCallback(
    async (overrideText?: string) => {
      const text = (overrideText ?? input).trim();
      if (!text || loading) return;

      const conversation = messages
        .filter(
          (message) =>
            message.role === "user" ||
            message.role === "assistant"
        )
        .slice(-12)
        .map((message) => ({
          role: message.role,
          content: message.content,
        }));

      setInput("");
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }

      setMessages((previous) => [
        ...previous,
        {
          id: makeId(),
          role: "user",
          content: text,
          timestamp: Date.now(),
        },
      ]);
      setLoading(true);

      try {
        const response = await fetch(`${API_BASE}/api/ai-command`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: text,
            conversation,
            case_id: caseId,
            session_id: sessionId ?? null,
            available_organs: availableOrgans,
            viewer_state: viewerState,
            organ_metrics: organMetrics,
            organ_references: organReferences,
            demographics,
            model: selectedModel || null,
          }),
        });

        const data = (await response.json()) as AICommandResponse;
        if (!response.ok) {
          throw new Error(data.reply || `HTTP ${response.status}`);
        }

        const returnedActions = Array.isArray(data.actions)
          ? data.actions
          : [];
        if (returnedActions.length > 0) {
          void applyReturnedActions(returnedActions);
        }

        setMessages((previous) => [
          ...previous,
          {
            id: makeId(),
            role: "assistant",
            content: data.reply ?? "Done.",
            timestamp: Date.now(),
          },
        ]);
      } catch (error) {
        console.error("[BodyMaps AI send error]", error);
        setMessages((previous) => [
          ...previous,
          {
            id: makeId(),
            role: "assistant",
            content:
              "The assistant service is unavailable right now. Viewer controls are still available from the left panel.",
            timestamp: Date.now(),
          },
        ]);
      } finally {
        setLoading(false);
      }
    },
    [
      input,
      loading,
      messages,
      caseId,
      sessionId,
      availableOrgans,
      viewerState,
      organMetrics,
      organReferences,
      demographics,
      selectedModel,
      applyReturnedActions,
    ]
  );

  const handleKeyDown = (
    event: React.KeyboardEvent<HTMLTextAreaElement>
  ) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
    }
  };

  const modelLabel =
    modelState === "loading"
      ? "Loading models"
      : modelState === "fallback"
        ? "Local fallback"
        : selectedModel || "Automatic";

  return (
    <aside
      id="bodymaps-ai-sidebar"
      className={open ? "ai-sidebar is-open" : "ai-sidebar"}
      aria-label="BodyMaps AI assistant"
      aria-hidden={!open}
    >
      <header className="ai-sidebar__header">
        <div className="ai-sidebar__brand">
          <span className="ai-sidebar__mark">
            <BotIcon />
          </span>
          <span className="ai-sidebar__title">
            BodyMaps AI
          </span>
        </div>

        <button
          className="ai-sidebar__close"
          onClick={closeSidebar}
          aria-label="Close AI assistant"
          title="Close"
          type="button"
        >
          <CloseIcon />
        </button>
      </header>

      <div
        className="ai-sidebar__chat"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
      >
        {messages.map((message) => (
          <div
            key={message.id}
            className={`ai-msg ai-msg--${message.role}`}
          >
            <div className="ai-msg__content">
              {renderMessageText(message.content)}
            </div>
          </div>
        ))}

        {loading && (
          <div className="ai-msg ai-msg--assistant">
            <div
              className="ai-typing"
              aria-label="BodyMaps AI is thinking"
            >
              <span className="ai-typing__dot" />
              <span className="ai-typing__dot" />
              <span className="ai-typing__dot" />
            </div>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      {messages.length === 0 && !loading && (
        <div
          className="ai-sidebar__suggestions"
          role="group"
          aria-label="Suggested prompts"
        >
          {SUGGESTION_CHIPS.map((chip) => (
            <button
              key={chip}
              className="ai-suggestion"
              onClick={() => void handleSend(chip)}
              type="button"
            >
              {chip}
            </button>
          ))}
        </div>
      )}

      <div className="ai-sidebar__composer-wrap">
        <div className="ai-composer">
          <textarea
            ref={textareaRef}
            className="ai-composer__textarea"
            rows={1}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder="Ask about this scan…"
            disabled={loading}
            aria-label="Message BodyMaps AI"
          />

          <div className="ai-composer__footer">
            <div
              ref={modelPickerRef}
              className="ai-model-picker"
            >
              {modelMenuOpen && (
                <div
                  className="ai-model-menu"
                  role="menu"
                  aria-label="Choose an Ollama model"
                >
                  <div className="ai-model-menu__heading">
                    Local model
                  </div>

                  {models.length > 0 ? (
                    <>
                      <button
                        className="ai-model-menu__item"
                        data-selected={!selectedModel}
                        onClick={() => selectModel("")}
                        role="menuitemradio"
                        aria-checked={!selectedModel}
                        type="button"
                      >
                        <span>
                          <strong>Automatic</strong>
                          <small>Use the configured local default</small>
                        </span>
                        {!selectedModel ? <CheckIcon /> : null}
                      </button>

                      {models.map((model) => (
                        <button
                          key={model.name}
                          className="ai-model-menu__item"
                          data-selected={
                            selectedModel === model.name
                          }
                          onClick={() => selectModel(model.name)}
                          role="menuitemradio"
                          aria-checked={
                            selectedModel === model.name
                          }
                          type="button"
                        >
                          <span>
                            <strong>{model.name}</strong>
                            <small>Installed in Ollama</small>
                          </span>
                          {selectedModel === model.name ? (
                            <CheckIcon />
                          ) : null}
                        </button>
                      ))}
                    </>
                  ) : (
                    <div className="ai-model-menu__empty">
                      No Ollama models available
                    </div>
                  )}
                </div>
              )}

              <button
                className="ai-model-picker__button"
                data-state={modelState}
                onClick={() =>
                  setModelMenuOpen((current) => !current)
                }
                disabled={modelState === "loading"}
                aria-haspopup="menu"
                aria-expanded={modelMenuOpen}
                type="button"
              >
                <span
                  className="ai-model-picker__dot"
                  aria-hidden="true"
                />
                <span className="ai-model-picker__text">
                  {modelLabel}
                </span>
                <ChevronIcon />
              </button>
            </div>

            <button
              className="ai-composer__send"
              onClick={() => void handleSend()}
              disabled={loading || !input.trim()}
              aria-label="Send message"
              type="button"
            >
              <SendIcon />
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
