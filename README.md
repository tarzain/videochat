# Gemini Live Next.js Demo

Minimal Next.js App Router app that:

- mints short-lived Gemini Live ephemeral tokens on the server
- connects directly from the browser to Gemini Live with `@google/genai`
- streams microphone audio as PCM
- optionally sends camera frames
- plays Gemini audio responses in the browser
- routes demo tool calls through a Next.js API endpoint
- can generate and edit styled images through Nano Banana 2 by default, or Flux via env preset

## Setup

1. Create a Google AI Studio API key.
2. Copy `.env.example` to `.env.local`.
3. Set `GEMINI_API_KEY` and `FAL_KEY`.
4. Optional: set `LIVE_IMAGE_MODEL_PRESET=flux` if you want Flux instead of the default Nano Banana 2 preset.
4. Install dependencies:

```bash
npm install
```

5. Start the app:

```bash
npm run dev
```

6. Open [http://localhost:3000](http://localhost:3000).

## Notes

- The browser uses an ephemeral token, not your long-lived API key.
- The token route locks the Live model config on the server.
- Camera is opt-in because audio+video live sessions are shorter-lived than audio-only sessions without compression.
- The included server tools are `get_time` and `generate_image`.
- `generate_image` uses Nano Banana 2 by default and can be switched to Flux with `LIVE_IMAGE_MODEL_PRESET=flux`.
- Image edit requests can reference the current camera image, the latest generated image, or both.

## Scripts

```bash
npm run dev
npm run lint
npm run build
```
