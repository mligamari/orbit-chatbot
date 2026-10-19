// Orbit chat endpoint (Vercel serverless function).
// The browser sends recent messages here; this function adds the system prompt,
// enforces limits, and forwards the conversation to Groq. GROQ_API_KEY never
// leaves the server.

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_MODEL = "llama-3.3-70b-versatile";

const MAX_MESSAGE_CHARS = 4000; // per message
const MAX_HISTORY_MESSAGES = 20; // most recent turns kept as context
const MAX_TOTAL_CHARS = 24000; // across all messages sent upstream
const MAX_BODY_BYTES = 200 * 1024;
const MAX_OUTPUT_TOKENS = 1024;
const UPSTREAM_TIMEOUT_MS = 25000;

const SYSTEM_PROMPT = [
  "You are Orbit, a friendly, capable general-purpose AI assistant.",
  "Help with questions on any topic, writing and editing, brainstorming, explaining concepts, and follow-up questions.",
  "Be clear and concise by default; go deeper when the user asks.",
  "Use the earlier messages in the conversation as context for follow-ups.",
  "If you are not sure about something, say so rather than guessing.",
  "You may use simple Markdown: short paragraphs, bullet lists, **bold**, `inline code` and fenced code blocks.",
].join(" ");

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
  // Vercel parses JSON bodies for us; fall back to reading the stream elsewhere.
  if (req.body !== undefined) {
    if (typeof req.body === "string") return JSON.parse(req.body);
    if (Buffer.isBuffer(req.body)) return JSON.parse(req.body.toString("utf8"));
    return req.body;
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error("too large"), { code: "TOO_LARGE" });
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

// Returns { messages } or { error } after validating and trimming the history.
export function prepareMessages(input) {
  if (!Array.isArray(input) || input.length === 0) {
    return { error: "Send at least one message." };
  }

  const cleaned = [];
  for (const m of input) {
    if (!m || (m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string") {
      return { error: "Each message needs a role of user or assistant and text content." };
    }
    const content = m.content.trim();
    if (!content) continue;
    if (content.length > MAX_MESSAGE_CHARS) {
      return { error: `Messages are limited to ${MAX_MESSAGE_CHARS} characters.` };
    }
    cleaned.push({ role: m.role, content });
  }

  if (cleaned.length === 0 || cleaned[cleaned.length - 1].role !== "user") {
    return { error: "The last message must be from the user." };
  }

  // Keep the most recent messages that fit both the count and character budgets.
  const recent = cleaned.slice(-MAX_HISTORY_MESSAGES);
  const kept = [];
  let total = 0;
  for (let i = recent.length - 1; i >= 0; i--) {
    total += recent[i].content.length;
    if (total > MAX_TOTAL_CHARS) break;
    kept.unshift(recent[i]);
  }
  // Start the context on a user turn so it reads naturally.
  while (kept.length && kept[0].role !== "user") kept.shift();

  return { messages: kept };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return send(res, 405, { error: "Use POST." });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return send(res, 500, {
      error: "The server is missing GROQ_API_KEY. Add it as an environment variable and redeploy.",
    });
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    if (err.code === "TOO_LARGE") return send(res, 413, { error: "That request is too large." });
    return send(res, 400, { error: "The request body must be valid JSON." });
  }

  const { messages, error } = prepareMessages(body && body.messages);
  if (error) return send(res, 400, { error });

  const model = (process.env.GROQ_MODEL || "").trim() || DEFAULT_MODEL;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const upstream = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
        temperature: 0.7,
        max_tokens: MAX_OUTPUT_TOKENS,
      }),
      signal: controller.signal,
    });

    const data = await upstream.json().catch(() => null);

    if (!upstream.ok) {
      const detail = data && data.error && data.error.message;
      console.error("Groq error", upstream.status, detail || "");
      if (upstream.status === 401 || upstream.status === 403) {
        return send(res, 502, { error: "Groq rejected the server's API key. Check GROQ_API_KEY." });
      }
      if (upstream.status === 429) {
        return send(res, 429, { error: "Orbit is getting a lot of requests right now. Try again in a moment." });
      }
      if (upstream.status === 404 || (upstream.status === 400 && /model/i.test(detail || ""))) {
        return send(res, 502, { error: `Groq could not use the model "${model}". Check GROQ_MODEL.` });
      }
      return send(res, 502, { error: "Groq returned an error. Please try again." });
    }

    const reply = data && data.choices && data.choices[0] && data.choices[0].message
      ? String(data.choices[0].message.content || "").trim()
      : "";
    if (!reply) return send(res, 502, { error: "Groq returned an empty reply. Please try again." });

    return send(res, 200, { reply, model });
  } catch (err) {
    if (err.name === "AbortError") {
      return send(res, 504, { error: "Groq took too long to respond. Please try again." });
    }
    console.error("Request to Groq failed", err);
    return send(res, 502, { error: "Could not reach Groq. Please try again." });
  } finally {
    clearTimeout(timer);
  }
}
