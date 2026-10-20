# Streaming backend seam (not deployed yet)

The web app runs fully in the browser today (Web Speech API or demo provider). For multi-hour
hearings with Google Cloud Speech-to-Text or Azure Speech, deploy a **separate WebSocket relay**
(recommended: Google Cloud Run — supports WebSockets, long request timeouts up to 60 min per
connection, and reconnectable sessions). Vercel Functions have duration limits, so they are only
used for the short-lived token route (`/api/speech/token`).

```
Browser (MediaRecorder WebM/Opus chunks, seq-numbered, saved to IndexedDB first)
   │  wss://<relay>/stream?token=<HMAC ticket from /api/speech/token>&lang=fil-PH
   ▼
Cloud Run relay (Node.js + TypeScript + Fastify + @fastify/websocket)
   │  verifies ticket with STREAMING_SHARED_SECRET, opens provider stream
   ▼
Google STT v2 streamingRecognize (WEBM_OPUS)  |  Azure Speech SDK (compressed audio stream)
```

## Wire protocol (implemented client-side in `src/lib/speech/server.ts`)

Client → relay
- `{"type":"start","language":"en-PH|fil-PH|mixed","glossary":["..."],"resumeFromSeq":12}`
- `{"type":"chunk","seq":13,"startMs":60000,"endMs":65000}` followed by one **binary** frame (the chunk)
- `{"type":"finish"}`

Relay → client
- `{"type":"ack","seq":13}` – chunk accepted; client drops it from its resend queue
- `{"type":"result","key":"g2:r41","text":"...","isFinal":false,"startMs":61200,"endMs":63900,"confidence":0.91}`

Rules
- `key` must be stable for the same utterance across interim revisions and unique across the session
  (prefix it with the provider stream generation, e.g. `g2:` after a rollover).
- Roll provider streams over before provider limits (Google ≈ 5 min per stream) and re-send the
  un-acked tail; the client merge layer (`src/lib/segments.ts`) drops duplicates idempotently.
- Never log audio or transcript text. Keep credentials only in Cloud Run / Vercel env vars.

## Environment variables

| Where  | Variable | Purpose |
| ------ | -------- | ------- |
| Vercel | `STREAMING_SERVICE_URL` | Relay URL (enables relay tickets) |
| Vercel | `STREAMING_SHARED_SECRET` | HMAC secret shared with the relay |
| Vercel | `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION` | Optional: mint 10-min Azure STS tokens |
| Web build | `VITE_STREAMING_URL` | `wss://` relay URL compiled into the app (not a secret) |
| Cloud Run | `GOOGLE_CLOUD_PROJECT`, service account | Google STT access (no JSON keys in the repo) |
