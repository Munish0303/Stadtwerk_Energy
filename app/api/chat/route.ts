import { NextRequest } from "next/server";
import type { ChatMessage } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const FALLBACK_MODELS = ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.8-27b"];

const SYSTEM_PROMPT = `You are "Stadtwerk AI Copilot", an analyst assistant for energy consultants who advise German municipal utilities (Stadtwerke) and energy suppliers.

Expertise: German power market (EPEX day-ahead, DE-LU bidding zone, 15-minute products), merit-order effect, renewable integration (PV, onshore/offshore wind), residual load, standard load profiles (SLP/H0, RLM customers), load forecasting, battery storage & flexibility, EEG/EnWG basics, procurement and hedging, grid operations.

Rules:
- Ground answers in the DATA CONTEXT JSON below when relevant. Quote concrete numbers with units (€/MWh, MW, GW, MWh, %).
- If the data cannot answer the question, say so and explain what data would be needed. Never invent figures.
- Be concise and consultant-ready: short paragraphs or bullets, lead with the insight, then the "so what" for a Stadtwerk.
- State model assumptions and limitations when interpreting forecasts or business cases (e.g. perfect foresight, simplified physics).
- Reply in the language of the user's latest message (English unless they write in German). German energy terms like "Stadtwerk" do not mean the user writes German.
- Use plain ASCII hyphens and standard markdown (bullets, **bold**); no tables.`;

function sanitize(messages: unknown): ChatMessage[] {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter(
      (m): m is ChatMessage =>
        !!m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim() !== "",
    )
    .slice(-12)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
}

export async function POST(req: NextRequest) {
  const key = process.env.GROQ_API_KEY;
  if (!key) {
    return new Response(
      "The AI Copilot is not configured yet. Add a free **GROQ_API_KEY** (https://console.groq.com/keys) to `.env.local` locally or to the Vercel project's Environment Variables, then redeploy.",
      { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  }

  let body: { messages?: unknown; context?: unknown };
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }
  const messages = sanitize(body.messages);
  if (!messages.length || messages[messages.length - 1].role !== "user") {
    return new Response("Expected at least one user message", { status: 400 });
  }

  let ctx = "";
  try {
    ctx = JSON.stringify(body.context ?? {}).slice(0, 14_000);
  } catch {
    ctx = "{}";
  }

  const payload = (model: string) =>
    JSON.stringify({
      model,
      stream: true,
      temperature: 0.3,
      max_tokens: 2500,
      ...(model.startsWith("openai/gpt-oss") ? { reasoning_effort: "low" } : {}),
      messages: [{ role: "system", content: `${SYSTEM_PROMPT}\n\nDATA CONTEXT (current dashboard view):\n${ctx}` }, ...messages],
    });

  const models = [process.env.GROQ_MODEL, ...FALLBACK_MODELS].filter((m, i, a): m is string => !!m && a.indexOf(m) === i);

  let upstream: Response | null = null;
  let lastError = "";
  let usedModel = "";
  for (const model of models) {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: payload(model),
    });
    if (res.ok && res.body) {
      upstream = res;
      usedModel = model;
      break;
    }
    lastError = `${res.status}: ${(await res.text()).slice(0, 300)}`;
    // Only fall through to the next model for model-specific failures; auth/rate errors won't improve.
    if (res.status === 401 || res.status === 403) break;
  }

  if (!upstream?.body) {
    return new Response(`Groq API error (${lastError}). Check your API key, model name or rate limits.`, {
      status: 502,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  // Convert OpenAI-style SSE into a plain text stream for the client.
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const reader = upstream.body.getReader();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let buffer = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const data = trimmed.slice(5).trim();
            if (data === "[DONE]") {
              controller.close();
              return;
            }
            try {
              const delta = JSON.parse(data)?.choices?.[0]?.delta?.content;
              if (delta) controller.enqueue(encoder.encode(delta));
            } catch {
              /* ignore keep-alive / partial lines */
            }
          }
        }
        controller.close();
      } catch (e) {
        controller.error(e);
      }
    },
    cancel() {
      reader.cancel().catch(() => {});
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Model": usedModel },
  });
}
