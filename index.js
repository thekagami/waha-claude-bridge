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

// Optional: comma-separated list of WhatsApp chat IDs allowed to use the bot,
// e.g. "971501234567@c.us,971501234567@lid". Leave empty/unset to allow everyone.
const ALLOWED_SENDERS = (process.env.ALLOWED_SENDERS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
console.log("ALLOWED_SENDERS:", ALLOWED_SENDERS.length ? ALLOWED_SENDERS : "(none set — allowing everyone)");

console.log("=== Bridge starting ===");
console.log("WAHA_URL set:", !!WAHA_URL, WAHA_URL ? `(${WAHA_URL})` : "");
console.log("WAHA_API_KEY set:", !!WAHA_API_KEY);
console.log("ANTHROPIC_API_KEY set:", !!ANTHROPIC_API_KEY, ANTHROPIC_API_KEY ? `(starts with ${ANTHROPIC_API_KEY.slice(0, 7)}...)` : "");
console.log("ANTHROPIC_MODEL:", ANTHROPIC_MODEL);
console.log("WAHA_SESSION:", WAHA_SESSION);

if (!WAHA_URL || !ANTHROPIC_API_KEY) {
  console.error("!!! Missing required env vars: WAHA_URL and/or ANTHROPIC_API_KEY !!!");
}

// Catch anything that would otherwise crash silently
process.on("unhandledRejection", (reason) => {
  console.error("UNHANDLED REJECTION:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION:", err);
});

// Very simple in-memory per-chat history. Resets on restart/redeploy.
const history = new Map();
const MAX_TURNS = 20;

app.get("/", (req, res) => res.send("WAHA-Claude bridge is running"));

app.post("/webhook", async (req, res) => {
  res.sendStatus(200); // ack immediately — WAHA expects a fast response

  console.log(">>> Webhook hit. Event type:", req.body?.event);

  if (WEBHOOK_SECRET) {
    const provided = req.headers["x-webhook-secret"];
    if (provided !== WEBHOOK_SECRET) {
      console.warn("Rejected webhook: bad secret");
      return;
    }
  }

  try {
    const event = req.body;
    if (event?.event !== "message") {
      console.log("Ignoring non-message event:", event?.event);
      return;
    }

    const msg = event.payload;
    if (!msg) {
      console.log("No payload on message event");
      return;
    }
    if (msg.fromMe) {
      console.log("Ignoring own outgoing message");
      return;
    }

    const chatId = msg.from;
    const text = msg.body;
    if (!text) {
      console.log("No text body (media/other type), ignoring. Payload keys:", Object.keys(msg));
      return;
    }

    console.log(`Incoming from ${chatId}: ${text}`);

    if (ALLOWED_SENDERS.length > 0 && !ALLOWED_SENDERS.includes(chatId)) {
      console.log(`Ignoring message from unauthorized sender: ${chatId}`);
      return;
    }

    const past = history.get(chatId) || [];
    past.push({ role: "user", content: text });

    console.log("Calling Anthropic API...");
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

    console.log("Anthropic response status:", claudeRes.status);

    if (!claudeRes.ok) {
      const errText = await claudeRes.text();
      console.error("Anthropic API error:", claudeRes.status, errText);
      await sendText(chatId, "Sorry, I hit an error generating a reply.");
      return;
    }

    const data = await claudeRes.json();
    console.log("Anthropic response received, content blocks:", data.content?.length);

    const reply =
      data.content
        ?.filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim() || "Sorry, I couldn't generate a reply.";

    console.log("Reply text:", reply);

    past.push({ role: "assistant", content: reply });
    history.set(chatId, past.slice(-MAX_TURNS));

    console.log("Sending reply back via WAHA...");
    await sendText(chatId, reply);
    console.log("Done — sendText call completed.");
  } catch (err) {
    console.error("Error handling webhook:", err);
  }
});

async function sendText(chatId, text) {
  console.log("sendText -> POST", `${WAHA_URL}/api/sendText`, "chatId:", chatId);
  try {
    const res = await fetch(`${WAHA_URL}/api/sendText`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(WAHA_API_KEY ? { "X-Api-Key": WAHA_API_KEY } : {}),
      },
      body: JSON.stringify({ session: WAHA_SESSION, chatId, text }),
    });
    console.log("WAHA sendText response status:", res.status);
    if (!res.ok) {
      console.error("WAHA sendText error:", res.status, await res.text());
    } else {
      console.log("WAHA sendText succeeded.");
    }
  } catch (err) {
    console.error("WAHA sendText threw an exception:", err);
  }
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Bridge listening on port ${PORT}`));
