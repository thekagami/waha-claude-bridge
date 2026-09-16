# WAHA ↔ Claude Bridge

Connects a self-hosted WAHA (WhatsApp HTTP API) instance to Claude, so
messages you send to a WhatsApp number are answered by Claude.

## Architecture

WhatsApp <-> WAHA (WhatsApp Web session) <-> this bridge <-> Anthropic API

Two services run on Railway:
1. **WAHA** — official Docker image, holds the WhatsApp session
2. **This bridge** — receives WAHA's webhook, calls Claude, sends the reply back

## 1. Get an Anthropic API key

- console.anthropic.com → Settings → API Keys → Create Key
- This is billed separately (pay-per-token) from any claude.ai subscription

## 2. Deploy WAHA on Railway

- New Project → Deploy Docker Image → `devlikeapro/waha`
- Expose port 3000, note the public URL Railway assigns (e.g. `https://waha-production-xxxx.up.railway.app`)
- Open `<that-url>/dashboard`, start a session, scan the QR code with the WhatsApp
  account you want the bot to use (use a secondary number if you don't want it
  tied to your main one)

## 3. Deploy this bridge on Railway

- New Service in the same project → Deploy from this folder (or push it to a
  GitHub repo and connect that repo)
- Set environment variables:
  - `WAHA_URL` = the WAHA public URL from step 2
  - `ANTHROPIC_API_KEY` = key from step 1
  - `ANTHROPIC_MODEL` = `claude-sonnet-5` (default, override if you want a
    different model)
  - `WAHA_SESSION` = `default` (unless you named the session differently)
  - `WEBHOOK_SECRET` = any random string (optional but recommended)
  - `SYSTEM_PROMPT` = optional, customize the assistant's behavior
- Deploy, note this service's public URL too (e.g. `https://bridge-production-yyyy.up.railway.app`)

## 4. Point WAHA's webhook at the bridge

In the WAHA dashboard (or via its API), set the session's webhook to:

```
https://<your-bridge-url>/webhook
```

with event type `message`. If you set `WEBHOOK_SECRET`, add a header
`X-Webhook-Secret: <your secret>` to the webhook config so the bridge
accepts it.

## 5. Test

Message the WhatsApp number linked in step 2 from another phone. You should
get a Claude-generated reply within a few seconds. Check the bridge's Railway
logs if nothing comes back — that will show incoming webhook payloads and any
Anthropic/WAHA API errors.

## Notes

- Conversation history is kept in memory per chat and resets on redeploy —
  fine for personal use; swap in a small database if you want it to persist.
- WAHA runs on WhatsApp Web under the hood and isn't officially supported by
  Meta — keep volume low and personal to minimize ban risk.
- Once this is live, you can safely cancel the Hostinger VPS / decommission
  the old OpenClaw setup.
