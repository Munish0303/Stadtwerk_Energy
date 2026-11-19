"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useCopilot } from "./CopilotProvider";
import { Markdown } from "./Markdown";
import type { ChatMessage } from "@/lib/types";

const BRIEFING =
  "Write a one-page management briefing for a Stadtwerk executive based on the current view: 3 key findings with numbers, what they mean commercially, and 2–3 recommended next steps.";

export function Copilot() {
  const { context, open, setOpen, pending, clearPending } = useCopilot();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [messages]);

  const send = useCallback(
    async (text: string) => {
      const q = text.trim();
      if (!q || busy) return;
      const history: ChatMessage[] = [...messages, { role: "user", content: q }];
      setMessages([...history, { role: "assistant", content: "" }]);
      setInput("");
      setBusy(true);
      const ac = new AbortController();
      abortRef.current = ac;
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: history, context: { page: context.page, data: context.data } }),
          signal: ac.signal,
        });
        if (!res.body) throw new Error(await res.text());
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let acc = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          acc += dec.decode(value, { stream: true });
          setMessages([...history, { role: "assistant", content: acc }]);
        }
        if (!acc) setMessages([...history, { role: "assistant", content: "_No response received._" }]);
      } catch (e) {
        if ((e as Error).name !== "AbortError") {
          setMessages([...history, { role: "assistant", content: `Request failed: ${(e as Error).message}` }]);
        }
      } finally {
        setBusy(false);
        abortRef.current = null;
      }
    },
    [busy, messages, context],
  );

  useEffect(() => {
    if (open && pending && !busy) {
      clearPending();
      void send(pending);
    }
  }, [open, pending, busy, send, clearPending]);

  if (!open) {
    return (
      <button className="copilot-fab" onClick={() => setOpen(true)} aria-label="Open AI Copilot">
        <SparkIcon /> Ask the Copilot
      </button>
    );
  }

  return (
    <section className="copilot-panel" aria-label="AI Copilot">
      <div className="cp-head">
        <span className="brand-mark" aria-hidden>
          <SparkIcon />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3>AI Copilot</h3>
          <p>Reads the “{context.page}” view · Groq LLM</p>
        </div>
        {messages.length > 0 && (
          <button className="icon-btn" title="New conversation" onClick={() => setMessages([])} disabled={busy}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
              <path d="M3 3v5h5" />
            </svg>
          </button>
        )}
        <button className="icon-btn" title="Close" onClick={() => setOpen(false)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="cp-body" ref={bodyRef}>
        {messages.length === 0 && (
          <>
            <div className="msg assistant">
              <p>
                Hi! I can explain what you see on this page, compare scenarios and draft workshop or management material.
                I only use the numbers shown in the dashboard.
              </p>
            </div>
            <div className="cp-prompts">
              {[...context.prompts, BRIEFING].map((p) => (
                <button key={p} onClick={() => send(p)}>
                  {p === BRIEFING ? "📝 Draft a management briefing for this view" : p}
                </button>
              ))}
            </div>
          </>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            {m.role === "assistant" ? (
              m.content ? <Markdown text={m.content} /> : <span className="spinner" style={{ display: "inline-block", width: 16, height: 16 }} />
            ) : (
              m.content
            )}
          </div>
        ))}
      </div>

      <form
        className="cp-input"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <textarea
          className="textarea"
          rows={1}
          value={input}
          placeholder="Ask about prices, forecasts, business cases…"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(input);
            }
          }}
        />
        {busy ? (
          <button type="button" className="btn" onClick={() => abortRef.current?.abort()}>
            Stop
          </button>
        ) : (
          <button type="submit" className="btn primary" disabled={!input.trim()}>
            Send
          </button>
        )}
      </form>
    </section>
  );
}

function SparkIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2l1.9 5.6L19.5 9.5l-5.6 1.9L12 17l-1.9-5.6L4.5 9.5l5.6-1.9L12 2zm7 12l.9 2.6 2.6.9-2.6.9L19 21l-.9-2.6-2.6-.9 2.6-.9L19 14z" />
    </svg>
  );
}
