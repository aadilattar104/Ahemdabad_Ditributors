// Chat.jsx — Ask a Question page
// Text-to-SQL chatbot powered by Groq + Llama 3.3 70B
// Users type natural language questions, get data-driven answers

import { useState, useRef, useEffect } from "react";
import { sendChatMessage } from "../services/api";

// ── Suggested questions ───────────────────────────────────────────────────────
const SUGGESTIONS = [
  "Which shop had the highest revenue this year?",
  "Show me month-wise revenue for all distributors",
  "What are the top 5 SKUs by qty sold?",
  "Which city has the most sales?",
  "What is the total revenue from Reliance stores?",
  "Which distributor sold the most units in April?",
  "Show recurring shops that ordered multiple times",
  "What is the stock on hand for all MT stores?",
];

// ── Message bubble ────────────────────────────────────────────────────────────
function Message({ msg, onOptionClick }) {
  const isUser = msg.role === "user";
  const [showSql, setShowSql] = useState(false);
  const [copied, setCopied]   = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(msg.sql || "");
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard API unavailable — silently ignore
    }
  };

  return (
    <div style={{
      display: "flex",
      justifyContent: isUser ? "flex-end" : "flex-start",
      marginBottom: 12,
    }}>
      {!isUser && (
        <div style={S.avatar}>
          <i className="ti ti-chart-bar" style={{ fontSize: 13 }} />
        </div>
      )}
      <div style={{ maxWidth: "72%", display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{
          ...S.bubble,
          background: isUser
            ? "var(--color-text-info, #378ADD)"
            : "var(--color-background-primary)",
          color: isUser ? "#fff" : "var(--color-text-primary)",
          border: isUser ? "none" : "0.5px solid var(--color-border-tertiary)",
          borderRadius: isUser ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
          alignSelf: isUser ? "flex-end" : "flex-start",
        }}>
          {msg.loading ? (
            <div style={{ display: "flex", gap: 4, alignItems: "center", padding: "4px 2px" }}>
              {[0, 1, 2].map(i => (
                <div key={i} style={{
                  width: 6, height: 6, borderRadius: "50%",
                  background: "var(--color-text-tertiary)",
                  animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite`,
                }} />
              ))}
            </div>
          ) : (
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
              {msg.content}
            </p>
          )}
        </div>

        {/* Clarification option buttons (Fix JSX-1 & JSX-2) */}
        {!isUser && !msg.loading && msg.clarification_options && (
          <div style={S.optionButtons}>
            {msg.clarification_options.map((opt, i) => (
              <button
                key={i}
                style={S.optionBtn}
                onClick={() => onOptionClick(opt)}
              >
                {opt}
              </button>
            ))}
          </div>
        )}

        {/* Show SQL toggle + copy button for assistant messages (Fix JSX-4) */}
        {!isUser && !msg.loading && msg.sql && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              style={S.sqlToggle}
              onClick={() => setShowSql(s => !s)}
            >
              <i className="ti ti-code" style={{ fontSize: 11 }} />
              {showSql ? "Hide SQL" : "Show SQL"}
            </button>
            <button
              style={S.copyBtn}
              onClick={handleCopy}
              title="Copy SQL to clipboard"
            >
              <i className={`ti ${copied ? "ti-check" : "ti-clipboard"}`} style={{ fontSize: 11 }} />
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
        )}
        {showSql && msg.sql && (
          <pre style={S.sqlBlock}>{msg.sql}</pre>
        )}

        {/* Error badge */}
        {msg.error && (
          <p style={S.errorNote}>
            <i className="ti ti-alert-circle" style={{ fontSize: 11, marginRight: 4 }} />
            {msg.error}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
// Props:
//   context — active dashboard filter object from parent (city, distributor, month, year, chain).
//             If not yet wired from parent props, pass an empty object — see TODO below.
export default function Chat({ context }) {
  // TODO: wire `context` from the parent dashboard state when the parent passes it down.
  // For now, fall back to an empty object so the pipeline receives a valid (if empty) context.
  const activeContext = context || {};

  const [messages,  setMessages]  = useState([
    {
      role: "assistant",
      content: "Hi! I can answer questions about your sales data. Ask me anything — top shops, revenue by month, SKU performance, stock levels, and more.",
      sql: null,
    }
  ]);
  const [input,     setInput]     = useState("");
  const [loading,   setLoading]   = useState(false);
  const bottomRef = useRef();
  const inputRef  = useRef();

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async (question) => {
    const q = (question || input).trim();
    if (!q || loading) return;

    setInput("");
    setLoading(true);

    // Add user message
    setMessages(prev => [...prev, { role: "user", content: q }]);

    // Add loading placeholder
    const loadingId = Date.now();
    setMessages(prev => [...prev, { role: "assistant", content: "", loading: true, id: loadingId }]);

    try {
      // Fix JSX-3: pass active context instead of hardcoded {}
      const result = await sendChatMessage(q, activeContext);

      // Fix JSX-1: handle clarification_needed response
      if (result.clarification_needed) {
        setMessages(prev => prev.map(m =>
          m.id === loadingId
            ? {
                role: "assistant",
                content: result.clarification_message,
                clarification_options: result.clarification_options,
                sql: null,
                error: null,
                id: loadingId,
              }
            : m
        ));
      } else {
        setMessages(prev => prev.map(m =>
          m.id === loadingId
            ? {
                role: "assistant",
                content: result.answer,
                sql: result.sql,
                error: result.error,
                id: loadingId,
              }
            : m
        ));
      }
    } catch (e) {
      setMessages(prev => prev.map(m =>
        m.id === loadingId
          ? { role: "assistant", content: "Sorry, something went wrong. Please try again.", error: e.message, id: loadingId }
          : m
      ));
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  // Fix JSX-2: clicking a clarification option sends it as a new message
  const handleOptionClick = (optionLabel) => {
    sendMessage(optionLabel);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div style={S.page}>

      {/* Header */}
      <div style={S.header}>
        <div>
          <p style={S.h1}>Ask a Question</p>
          <p style={S.subtitle}>Powered by Llama 3.3 70B — queries your live sales data</p>
        </div>
      </div>

      {/* Chat area */}
      <div style={S.chatArea}>

        {/* Suggestions — shown only when no user messages yet */}
        {messages.length === 1 && (
          <div style={S.suggestions}>
            <p style={S.suggestionsLabel}>Try asking:</p>
            <div style={S.suggestionsGrid}>
              {SUGGESTIONS.map((s, i) => (
                <button
                  key={i}
                  style={S.suggestionChip}
                  onClick={() => sendMessage(s)}
                  disabled={loading}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Messages */}
        <div style={S.messages}>
          {messages.map((msg, i) => (
            <Message
              key={msg.id || i}
              msg={msg}
              onOptionClick={handleOptionClick}
            />
          ))}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Input bar */}
      <div style={S.inputBar}>
        <div style={S.inputWrapper}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your sales data… (Enter to send)"
            disabled={loading}
            rows={1}
            style={S.textarea}
          />
          <button
            onClick={() => sendMessage()}
            disabled={loading || !input.trim()}
            style={{
              ...S.sendBtn,
              opacity: (loading || !input.trim()) ? 0.45 : 1,
              cursor:  (loading || !input.trim()) ? "default" : "pointer",
            }}
          >
            <i className="ti ti-send" style={{ fontSize: 16 }} />
          </button>
        </div>
        <p style={S.hint}>
          <i className="ti ti-info-circle" style={{ fontSize: 11, marginRight: 4 }} />
          Answers are generated from your actual database. Only data you've uploaded is available.
        </p>
      </div>

      <style>{`
        @keyframes bounce {
          0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
          40%            { transform: scale(1.0); opacity: 1.0; }
        }
      `}</style>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const S = {
  page: {
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    background: "var(--color-background-tertiary)",
    overflow: "hidden",
  },
  header: {
    padding: "1.5rem 2rem 1rem",
    borderBottom: "0.5px solid var(--color-border-tertiary)",
    background: "var(--color-background-primary)",
    flexShrink: 0,
  },
  h1: {
    margin: 0, fontSize: 22, fontWeight: 600,
    color: "var(--color-text-primary)",
  },
  subtitle: {
    margin: "2px 0 0", fontSize: 13,
    color: "var(--color-text-secondary)",
  },
  chatArea: {
    flex: 1,
    overflowY: "auto",
    padding: "1.5rem 2rem",
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },
  suggestions: {
    marginBottom: 8,
  },
  suggestionsLabel: {
    margin: "0 0 10px",
    fontSize: 12,
    color: "var(--color-text-tertiary)",
    fontWeight: 500,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  suggestionsGrid: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
  },
  suggestionChip: {
    padding: "6px 12px",
    borderRadius: 20,
    border: "0.5px solid var(--color-border-secondary)",
    background: "var(--color-background-primary)",
    color: "var(--color-text-secondary)",
    fontSize: 12,
    cursor: "pointer",
    textAlign: "left",
    transition: "border-color 0.1s",
  },
  messages: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  avatar: {
    width: 28, height: 28, borderRadius: "50%",
    background: "var(--color-text-info, #378ADD)",
    color: "#fff",
    display: "flex", alignItems: "center", justifyContent: "center",
    flexShrink: 0,
    marginRight: 8,
    marginTop: 2,
  },
  bubble: {
    padding: "10px 14px",
    borderRadius: 16,
    maxWidth: "100%",
  },
  // Clarification option buttons row
  optionButtons: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 4,
  },
  optionBtn: {
    padding: "5px 12px",
    borderRadius: 16,
    border: "0.5px solid var(--color-text-info, #378ADD)",
    background: "transparent",
    color: "var(--color-text-info, #378ADD)",
    fontSize: 12,
    cursor: "pointer",
    transition: "background 0.1s",
  },
  sqlToggle: {
    alignSelf: "flex-start",
    background: "transparent",
    border: "none",
    cursor: "pointer",
    fontSize: 11,
    color: "var(--color-text-tertiary)",
    display: "flex", alignItems: "center", gap: 4,
    padding: "2px 0",
  },
  // Copy-to-clipboard button next to Show SQL
  copyBtn: {
    alignSelf: "flex-start",
    background: "transparent",
    border: "none",
    cursor: "pointer",
    fontSize: 11,
    color: "var(--color-text-tertiary)",
    display: "flex", alignItems: "center", gap: 4,
    padding: "2px 0",
  },
  sqlBlock: {
    margin: 0,
    padding: "10px 12px",
    background: "var(--color-background-secondary)",
    border: "0.5px solid var(--color-border-tertiary)",
    borderRadius: "var(--border-radius-md)",
    fontSize: 11,
    color: "var(--color-text-secondary)",
    overflowX: "auto",
    whiteSpace: "pre",
    maxWidth: 500,
  },
  errorNote: {
    margin: 0,
    fontSize: 11,
    color: "var(--color-text-danger, #EF4444)",
    display: "flex", alignItems: "center",
  },
  inputBar: {
    padding: "1rem 2rem",
    borderTop: "0.5px solid var(--color-border-tertiary)",
    background: "var(--color-background-primary)",
    flexShrink: 0,
  },
  inputWrapper: {
    display: "flex",
    gap: 8,
    alignItems: "flex-end",
    background: "var(--color-background-secondary)",
    border: "0.5px solid var(--color-border-secondary)",
    borderRadius: 12,
    padding: "8px 8px 8px 14px",
  },
  textarea: {
    flex: 1,
    border: "none",
    background: "transparent",
    resize: "none",
    outline: "none",
    fontSize: 13,
    color: "var(--color-text-primary)",
    lineHeight: 1.5,
    fontFamily: "inherit",
    maxHeight: 120,
    overflowY: "auto",
  },
  sendBtn: {
    width: 34, height: 34,
    borderRadius: 8,
    border: "none",
    background: "var(--color-text-info, #378ADD)",
    color: "#fff",
    display: "flex", alignItems: "center", justifyContent: "center",
    flexShrink: 0,
    transition: "opacity 0.15s",
  },
  hint: {
    margin: "8px 0 0",
    fontSize: 11,
    color: "var(--color-text-tertiary)",
    display: "flex", alignItems: "center",
  },
};