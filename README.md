# Rev Voice – Revolt Motors Assistant (Gemini Live)

A real-time, conversational voice interface for Revolt Motors built with Node.js/Express and the Gemini API. It supports:

- Server-to-server architecture over WebSockets (`/ws`)
- Microphone capture and streaming PCM16 → server
- Audio-to-text on the server (PCM16 → WAV) + Gemini `generateContent`
- Low-latency responses with interruption support
- Language selection (English/Hindi/Hinglish + several Indian languages)
- Clean, responsive UI with status indicators and a text input bar

## Demo Flow
1. Open the app and click "Enable Microphone" to grant mic permission.
2. Click "Connect" → "Start Mic" → speak → "Stop Mic" to send.
3. Or type a message and click the send icon.
4. Click "Interrupt" to cancel an in-flight AI response.

---

## Requirements
- Node.js 18+ (Node 20+ recommended). Uses global `fetch` when available.
- A Google AI Studio API key: `https://aistudio.google.com`
- Windows/Mac/Linux supported. Tested on Windows Git Bash.

## Quick Start

```bash
# 1) Install dependencies
npm install

# 2) Create your .env in the project root
#   GOOGLE_API_KEY=your_key_here
#   GEMINI_MODEL=gemini-2.0-flash

# 3) Run the server
npm start

# 4) Open the app in your browser
#   http://localhost:3000
```

### .env
```ini
# Required
GOOGLE_API_KEY=YOUR_GOOGLE_AI_STUDIO_KEY

# Optional (defaults to gemini-2.0-flash)
# For final submission the requirement is:
# gemini-2.5-flash-preview-native-audio-dialog
# For development to avoid strict rate limits:
# gemini-2.0-flash-live-001 or gemini-live-2.5-flash-preview
GEMINI_MODEL=gemini-2.0-flash

# Optional
PORT=3000
```

## Scripts
- `npm start` – start Express server and WebSocket endpoint.

## Architecture
- Backend: Node.js/Express HTTP server that also hosts a WebSocket server at `/ws`.
- Frontend: Static files served from `public/`.
- Flow:
  - The browser captures microphone audio (16 kHz mono PCM16 chunks) and sends them to the server over WebSocket.
  - On `stop_mic`, the server encodes buffered PCM16 into WAV, calls Gemini `generateContent` with system instructions + conversation history, and returns the AI’s text.
  - The client plays TTS (browser SpeechSynthesis) and displays text.
  - Interruption: an AbortController cancels any in-flight API call; client TTS is canceled immediately.

## Features
- Mic permission banner – explicit user consent on first load
- Live status indicators: Server, Gemini, Mic
- Interrupt support for spoken replies
- Language selection affects:
  - Prompt (requested reply language or Hinglish phrasing)
  - TTS voice locale for playback on the client
- Responsive UI with a horizontal compact layout for very small screens (< 678px)

## Usage Tips
- Keep questions concise to minimize latency.
- For best real-time behavior during development, prefer a `*-live-*` model (e.g., `gemini-2.0-flash-live-001`). For final submission, use `gemini-2.5-flash-preview-native-audio-dialog`.

## File Structure
```
revvoice/
  public/
    index.html       # UI, mic permission banner, status, controls
    main.js          # WebSocket client, mic capture, TTS, UI logic
    styles.css       # Responsive, compact layout, send icon styling
    sendicon.png     # Paper plane icon for send button
  server/
    index.js         # Express + WS, PCM16→WAV, Gemini calls, interrupts
  package.json
  .gitignore
  README.md
```

## Troubleshooting
- Port already in use (EADDRINUSE)
  - Kill the process using port 3000 or set a different `PORT` in `.env`.
- "Missing GOOGLE_API_KEY"
  - Ensure `.env` exists in the project root and the key is valid.
- Mic permission not appearing
  - Click the "Enable Microphone" banner, and ensure your browser allows mic for `http://localhost:3000`.
- High latency
  - Use a `*-live-*` model during development, keep utterances shorter, ensure a stable network.
- TTS voice mismatch
  - Browser speech voices vary by OS and installed languages. We map locales (e.g., hi-IN) but availability depends on your system.

## Deployment Notes
- Run behind HTTPS for production so the mic permission UX is smooth.
- Use a process manager (PM2, systemd) and set `PORT` + `GOOGLE_API_KEY` as environment variables.
- Consider a reverse proxy (NGINX) for TLS and static caching.

## Security
- Never commit `.env` to source control (already ignored in `.gitignore`).
- Treat your API key as a secret; keep all model calls server-side.

## License
This project is provided for assessment/demo purposes.
