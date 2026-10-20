# CourtScribe AI

Mobile-first live transcription and digital stenography for Philippine court hearings,
interviews, meetings and lectures — **web / PWA build deployed on Vercel**.

> **Assisted, uncertified transcription.** Output is a working draft, not a certified transcript,
> official judicial record or guaranteed evidence. Recording requires authorization from the
> presiding court or competent authority; recordings are confidential personal data (RA 10173).

## What works in this build

- **New session**: title, case no., venue, date, participants with roles (Judge, Court Stenographer,
  Prosecutor, Defense/Plaintiff's/Defendant's Counsel, Witness, Interpreter, Court Clerk, Other),
  language (English `en-PH` / Filipino `fil-PH` / Experimental Mixed), mode (Live STT / Manual-Steno /
  Hybrid), provider, glossary, storage mode. Mandatory authorization confirmation, mic permission
  check with live level meter, network and storage checks.
- **Live transcription**: MediaRecorder audio saved to IndexedDB as timestamped, sequence-numbered
  chunks (default 5 s, never overwritten). Recognition goes through a provider interface
  (`startSession / sendAudio / receiveInterimResult / receiveFinalResult / finishSession / reconnect /
  handleError`) with the browser **Web Speech API** (default) and a **demo** provider. Interim / final /
  corrected / needs-review / inaudible styling, Smart Follow + Jump to Live, fixed toolbar
  (speaker, bookmark types, pause/resume, note, stop with confirmation, more tools), header with
  elapsed time + save + connection state, wake lock, offline handling, mic-loss handling, language
  change mid-session without stopping audio. The engine lives outside React, so recording continues
  while scrolling, editing or navigating to other tabs.
- **Crash recovery**: checkpoints every 5 s; Home shows a recovery banner for interrupted sessions
  (last confirmed audio time, chunk and segment counts) with Resume / Review / Mark finished. Resume
  continues the same timeline in a new audio run.
- **Review**: playback across runs, waveform (when decodable), bookmarks on the timeline,
  tap-to-seek, play passage, inline edit, speaker reassignment, mark reviewed, insert `(inaudible)` /
  `(unclear)`, search, filters, find & replace, undo/redo, per-segment revision history with restore.
  User corrections are never overwritten by recognition output (held suggestions are shown instead).
- **Steno workspace**: editable / searchable / importable (JSON, CSV) / exportable dictionary,
  word-boundary-safe live expansion (`\abbr` keeps it literal), practice pad.
- **Exports**: TXT, DOCX (line-numbered), searchable PDF (DRAFT watermark, page/line numbers), SRT,
  JSON (with revisions), original audio. Templates: Verbatim, Court-Style Q&A, Clean Reading (derived),
  Interview, Meeting Notes. Every export is labelled DRAFT / assisted / not certified.
- **Settings**: General, Audio & Microphone, Language & Recognition, Stenography, Transcript
  Formatting, Storage & Backups, Privacy & Security, Accessibility, About. Advanced sections collapsed.
- **PWA**: installable, offline app shell (Workbox), update prompt that never interrupts a recording.

## Speech recognition engines (all free)

| Engine | Where | Live? | Audio saved? | Notes |
|---|---|---|---|---|
| Browser live (Web Speech API) | Chrome / Edge / Android Chrome | Word-by-word | Desktop: yes · **Android: no** (see below) | Needs internet; Chrome sends audio to Google. `en-PH → en-US`, `fil-PH → tl-PH → en-US` fallback. |
| On-device Whisper (transformers.js, `onnx-community/whisper-tiny` / `-base`, q8) | Any modern browser with WASM (WebGPU optional) | ~10 s blocks, a few seconds behind | Yes | Free, private, offline after a one-time download (~55 MB tiny / ~92 MB base). Output always **Needs review**. |

**Android Chrome mic contention (root cause of "no transcript on my phone").** Android gives the
microphone to one user at a time. When MediaRecorder/getUserMedia holds it, `SpeechRecognition`
starts but hears nothing (it ends with `no-speech`/`audio-capture`, or silently). The app now:

- `audioStrategy = auto` (Settings → Audio): on Android, browser live text runs in **transcription
  priority** — no getUserMedia stream is opened, so the recognizer gets the mic; the transcript, notes
  and bookmarks are saved but **no audio**. A banner says so. On desktop both run; if the recognizer
  reports `audio-capture` or keeps hearing silence while the level meter shows sound, the app switches
  to transcription priority automatically and says why.
- For audio **and** text on Android, choose **On-device Whisper**: it taps PCM from the same stream
  MediaRecorder uses (no second mic open) and transcribes in a Web Worker.
- Recognizer reliability: restart on every `end` (Android uses non-continuous mode, one utterance per
  run), backoff only on real errors, watchdog for hung/never-started recognizers, restart when the tab
  becomes visible, unfinished interim text kept as Needs review, every error shown with a fix.
- New Session → **Test speech recognition** shows words live before you start.
- Review → **Transcribe recording** runs Whisper over saved audio (also for imported files), fills
  gaps only by default, never overwrites edited lines, re-runs are idempotent.

Tests: `npm test` (unit, incl. fake-SpeechRecognition provider tests) and
`node scripts/e2e-speech.mjs` (headless Chrome: Android/desktop scenarios with a scripted recognizer,
real Whisper on a fake-mic clip — needs `/workspace/courtscribe/jfk48.wav`).

## Limitations (honest)

- Web Speech API works in Chrome / Edge / Android Chrome (Safari partially). Firefox has none →
  use Manual/Steno or demo. Chrome sends audio to Google's speech service; it needs a connection.
- Filipino and Taglish accuracy is **unverified**; "Experimental Mixed" uses the `fil-PH` recognizer.
- Web Speech gives no word timings; segment timestamps are approximated from arrival time.
- Android Chrome cannot run Web Speech and MediaRecorder together: browser live text there saves no audio (use On-device Whisper for both).
- Whisper tiny/base accuracy on Philippine courtroom speech and Tagalog is unverified; on phones it can lag behind real time (blocks are skipped and can be filled later via Transcribe recording). Very long recordings (>~1 h) may exhaust phone memory when transcribed afterwards.
- Browser storage is not separately encrypted; the Android build will use encrypted SQLite.
- Automatic diarization is not implemented (manual speaker assignment by design).
- Imported audio is transcribed on-device with Whisper on request (no cloud).

## Develop

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # Vitest: segment merge + steno expansion
npm run build      # type-check + production build + service worker
node scripts/e2e.mjs   # headless Chrome smoke test + screenshots (needs `npm run preview`)
```

Structure: `src/lib/segments.ts` (merge logic), `src/lib/steno.ts`, `src/lib/speech/*` (providers),
`src/lib/audio/*` (capture/playback), `src/lib/db.ts` (IndexedDB), `src/store/live.ts` (recording
engine), `src/lib/export/*`, `src/pages/*`, `api/speech/*` (Vercel functions).

## Server-side provider seam (Google / Azure)

Credentials are **never** shipped in the frontend or APK.
- `api/speech/status.ts` — reports configured providers (no secrets).
- `api/speech/token.ts` — mints short-lived tokens (Azure STS token, or an HMAC ticket for the relay).
  Returns `501 not_configured` today.
- `src/lib/speech/server.ts` — client provider that streams the saved chunks to a WebSocket relay.
- `server/README.md` — Cloud Run relay design, wire protocol, env vars.

## Android (Capacitor) — not built yet

`capacitor.config.ts` is ready (`appId ph.courtscribe.app`, `webDir dist`). To produce an APK later:

```bash
npm i @capacitor/android && npx cap add android
npm run build && npx cap sync android
npx cap open android   # build/sign in Android Studio (Gradle)
```

Required before shipping: native Kotlin audio capture module with a **foreground service** +
persistent notification (WebView recording is not reliable in the background), `RECORD_AUDIO` /
`FOREGROUND_SERVICE_MICROPHONE` / `POST_NOTIFICATIONS` runtime permissions, audio-focus and
phone-call interruption handling, encrypted SQLite + app-private audio files, and the cloud
streaming provider (Web Speech is not available inside Android WebView).

## Deploy

Vercel project `courtscribe-ai` (framework: Vite, output `dist`, SPA rewrites in `vercel.json`).
