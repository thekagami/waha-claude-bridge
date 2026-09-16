import express from "express";

const app = express();
app.use(express.json());

// ---- Config (set these as environment variables on Railway) ----
const WAHA_URL = process.env.WAHA_URL;              // e.g. https://your-waha.up.railway.app
const WAHA_API_KEY = process.env.WAHA_API_KEY || ""; // only if you enabled WAHA's own auth
const WAHA_SESSION = process.env.WAHA_SESSION || "default";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || ""; // optional shared secret, checked below
const SYSTEM_PROMPT =
  process.env.SYSTEM_PROMPT ||
  "You are a helpful assistant chatting over WhatsApp. Keep replies concise and conversational.";

if (!WAHA_URL || !ANTHROPIC_API_KEY) {
  console.error("Missing required env vars: WAHA_URL and/or ANTHROPIC_API_KEY");
}

// Very simple in-memory per-chat history. Resets on restart/redeploy.
// Fine for personal use; swap for a real DB if you want it to persist.
const history = new Map();
const MAX_TURNS = 20;

app.get("/", (req, res) => res.send("WAHA-Claude bridge is running"));

app.post("/webhook", async (req, res) => {
  // Ack immediately — WAHA expects a fast response and will retry otherwise
  res.sendStatus(200);

  if (WEBHOOK_SECRET) {
    const provided = req.headers["x-webhook-secret"];
    if (provided !== WEBHOOK_SECRET) {
      console.warn("Rejected webhook: bad secret");
      return;
    }
  }

  try {
    const event = req.body;
    if (event?.event !== "message") return;

    const msg = event.payload;
    if (!msg || msg.fromMe) return; // ignore messages you send yourself

    const chatId = msg.from;
    const text = msg.body;
    if (!text) return; // ignore non-text messages (images, voice, etc.) for now

    console.log(`Incoming from ${chatId}: ${text}`);

    const past = history.get(chatId) || [];
    past.push({ role: "user", content: text });

    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: past,
      }),
    });

    if (!claudeRes.ok) {
      const errText = await claudeRes.text();
      console.error("Anthropic API error:", claudeRes.status, errText);
      await sendText(chatId, "Sorry, I hit an error generating a reply.");
      return;
    }

    const data = await claudeRes.json();
    const reply =
      data.content
        ?.filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim() || "Sorry, I couldn't generate a reply.";

    past.push({ role: "assistant", content: reply });
    history.set(chatId, past.slice(-MAX_TURNS));

    await sendText(chatId, reply);
  } catch (err) {
    console.error("Error handling webhook:", err);
  }
});

async function sendText(chatId, text) {
  const res = await fetch(`${WAHA_URL}/api/sendText`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(WAHA_API_KEY ? { "X-Api-Key": WAHA_API_KEY } : {}),
    },
    body: JSON.stringify({ session: WAHA_SESSION, chatId, text }),
  });
  if (!res.ok) {
    console.error("WAHA sendText error:", res.status, await res.text());
  }
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Bridge listening on port ${PORT}`));
