# docu-motion — design spec

Date: 2026-10-24 (revised 2026-10-24: automatic one-click flow replaces the 6-step wizard)
Status: revision awaiting review
Origin: the `documentaire-motion-design` Claude skill (https://github.com/Sami-Fd/documentaire-motion-design)

## 1. Purpose

An open-source, self-hosted app that turns a topic into a documentary/explainer video in coded motion design (Remotion, React/SVG), rendered to MP4 with voice-over, subtitles, a YouTube thumbnail and YouTube metadata. It reproduces the workflow of the `documentaire-motion-design` skill, but works with **any LLM provider** (Claude, GPT, Gemini, Mistral, OpenRouter, local Ollama, or a subscription via official CLIs).

**Audience:** video creators who run the app on their own machine with their own keys or subscriptions. They are not necessarily developers.

**Success criteria**
- `git clone && npm install && npm start` (or `docker compose up`) opens a working local web UI.
- From that UI, a user types a topic, picks a style and clicks one button; a complete MP4 with voice-over comes out with no further input.
- A user with only an Ollama install, or only a Gemini free-tier key, can produce a complete MP4 without the pipeline breaking on malformed model output.
- Every figure shown on screen is traceable to a source, or visibly marked unverified.
- Videos can be produced in any left-to-right language; the UI is in English.

**Decisions taken during brainstorming**

| Topic | Decision |
|---|---|
| Distribution | Open-source, self-hosted, user's own keys (MIT) |
| Interface | Local web UI (browser), three screens: home (topic + style → Generate), progress, result |
| Flow | Fully automatic generation; afterwards the user can regenerate a single scene or edit its narration and re-render (no editor, no timeline) |
| Provider choice | User setting (any supported provider); asked on first launch with a connection test |
| CLI | `npm run make` runs the same automatic generator without the web UI |
| What the LLM produces | Structured scene JSON from a fixed library of scene types (not free-form code) |
| Languages | Multilingual videos, English UI |
| Voice | edge-tts (free default), ElevenLabs, OpenAI TTS, uploaded recording, or none |
| Facts | User-supplied sources + web search; unverified facts flagged |
| Stack | TypeScript monorepo: React + Node + Remotion + Vercel AI SDK |
| Packaging | Native Node install and Docker |
| Subscriptions | Experimental "CLI provider" mode via official CLIs |
| Repo | New public repo `Sami-Fd/docu-motion` |

## 2. Architecture

npm workspaces monorepo:

```
docu-motion/
├─ packages/
│  ├─ scenes/   Remotion library: visual kit + scene types + Zod schemas
│  ├─ core/     pipeline logic, no UI
│  │   ├─ project/   project.json load/save, migrations
│  │   ├─ llm/       provider adapters (AI SDK + CLI), structured output
│  │   ├─ research/  source ingestion, web search, fact sheet
│  │   ├─ write/     outline + narration
│  │   ├─ scenes/    scene JSON generation, validation, fallback
│  │   ├─ voice/     TTS engines, upload splitting, durations
│  │   ├─ render/    stills, layout check, MP4, thumbnail, ffprobe
│  │   ├─ youtube/   titles, description, chapters
│  │   └─ generate/  the automatic generator: runs the steps in order with checkpoints
│  ├─ server/   Fastify REST API + SSE progress + job queue
│  └─ web/      React (Vite): home, progress and result screens + settings
├─ skill/       link/reference to the original SKILL.md
├─ Dockerfile
└─ docker-compose.yml
```

**Dependency direction:** `web → server → core → scenes`. `core` never imports from `server` or `web`. The `make` CLI script is a thin layer over `core/generate`, like the server.

### 2.1 `packages/scenes`

Ports the skill's kit: `theme.ts` (4 styles: papier, craie, infographie, nuit), `papier.tsx` (Pop, Glisse, Etiquette, Texte, Personnage, Piece, Soleil, Nuage, Mer, Goutte, Collines, Fond, Toile), `moteur/film.tsx` (scene sequencing, fades, subtitles, audio). Identifiers may be renamed to English, but the visual behaviour stays the same.

Changes from the skill:
- Style comes from composition props, not `getInputProps()` at module load, so the Player can switch style live.
- The film component takes a `Project` (narration, scenes, durations, audio URLs) as props instead of static imports.
- Fonts loaded for the chosen language's script (subsets per language).

**v1 scene types** (each = React component + Zod schema + example JSON):

| Type | Content |
|---|---|
| `title` | title, subtitle, decorative elements (hills, characters, flag-like colour blocks) |
| `bars` | 2–8 bars with labels, values, unit, source |
| `donut` | 2–6 parts summing to 100, labels, source |
| `counter` | animated number with prefix/suffix, label, source |
| `pictograms` | 1–2 groups of characters (count, colour, `elderly`), ratio label |
| `comparison` | two cards side by side (title, value, caption) |
| `quote` | quote text + attribution |
| `timeline` | 3–6 dated events |
| `list` | 2–5 bullet cards with icons from the kit |

Every element of a scene that can appear later declares a `cue`: a word or short phrase from the narration. Timing uses the skill's `instantDuMot` estimate (character position in text), and when no cue matches, the element falls back to staggered appearance.

### 2.2 Project model

A project is a folder `projects/<slug>/` with:

```
project.json        single source of truth (schema-versioned)
sources/            uploaded files + fetched page text
voice/<sceneId>.mp3
out/video.mp4, out/thumbnail.png, out/stills/*.png
logs/
```

`project.json` (abridged):

```ts
type Project = {
  version: 1;
  brief: {topic: string; language: string; targetMinutes: number; style: StyleName; tone?: string;
          provider: ProviderRef; webSearch: 'off' | 'native' | 'tavily' | 'brave'};
  sources: {id: string; kind: 'url' | 'file' | 'search'; title: string; uri: string; textPath: string; error?: string}[];
  facts: {id: string; statement: string; value?: string; sourceId?: string; excerpt?: string; verified: boolean}[];
  scenes: {id: string; narration: string; spec: SceneSpec; status: 'ok' | 'fallback' | 'review';
           factIds: string[]; warnings: string[]; dirty?: boolean;
           audio?: {path: string; seconds: number}; durationFrames: number}[];
  progress: {done: StepName[]; failed?: {step: StepName; message: string}};
  voice: {engine: 'edge' | 'elevenlabs' | 'openai' | 'upload' | 'none'; voiceId?: string};
  youtube?: {titles: string[]; description: string; chapters: {t: string; label: string}[]; hashtags: string[]};
  thumbnail?: {spec: ThumbnailSpec};
};
```

Each pipeline step is a function `(project, ctx) => Promise<Project>` that writes `project.json` when it finishes and adds itself to `progress.done`. Users may stop, edit by hand, and resume. `StepName = 'sources' | 'facts' | 'script' | 'scenes' | 'voice' | 'layout' | 'render' | 'package'`. A scene's `warnings` collects ⚠️ messages shown on the result screen (unverified fact, layout overflow after the automatic retry, TTS failure, fallback). `dirty` marks a scene whose narration was edited since the last render.

## 3. LLM providers

All providers implement one interface:

```ts
interface LlmProvider {
  generateObject<T>(args: {schema: ZodType<T>; system: string; prompt: string}): Promise<T>;
  generateText(args: {system: string; prompt: string}): Promise<string>;
  capabilities: {nativeWebSearch: boolean; vision: boolean};
}
```

- **API providers (AI SDK):** Anthropic, OpenAI, Google, Mistral, OpenRouter, Ollama. Structured output uses the AI SDK's object generation; for models without reliable JSON mode, the adapter asks for JSON in text and parses it.
- **CLI providers (experimental):** `claude -p --output-format json`, `codex exec`, `gemini -p`. The adapter runs the user's installed, already-signed-in CLI as a subprocess, sends the schema in the prompt, and extracts the JSON from the response. The app never reads, stores or forwards CLI credentials. The UI marks the mode "experimental" and links to each provider's terms; the README says to use it only if the provider's terms allow it. Recommended for native installs; in Docker it requires installing the CLI in the image and mounting its config directory (documented, not default).
- **Fake provider:** returns fixtures; used by tests and CI.

**Validation loop:** each `generateObject` result is validated against the Zod schema. On failure, retry up to 3 times with the validation error appended to the prompt. After that, the caller decides the fallback (see §6).

**Settings:** keys come from `.env` or from the Settings page, which writes to a local `config.json` in the data directory. Keys are only sent to the matching provider. A "Test connection" button runs a minimal call per configured provider (or `--version` + a trivial prompt for CLIs).

## 4. Automatic generation and screens

### 4.1 The generator (`core/generate`)

`generate(projectDir, ctx)` runs the steps below in order. Each step is a checkpoint: it saves `project.json` and records itself in `progress.done`, so a retry resumes at the failed step. `ctx` carries the provider, settings, an `onProgress(step, ratio, logLine)` callback and an `AbortSignal`. No step asks the user anything.

1. **sources**:
   - User links are fetched (readability extraction), and PDF/TXT/MD files are parsed to text into `sources/`.
   - With no user sources, web search runs automatically:
     - The provider's built-in search is used when `capabilities.nativeWebSearch`.
     - Otherwise Tavily or Brave is used when a key is set in Settings.
     - Otherwise the step is skipped.
   - Results become `kind: 'search'` sources.
2. **facts**:
   - The LLM extracts facts, each with a `sourceId` and a verbatim `excerpt`.
   - The app checks that each excerpt really appears in the source text; if not, `verified: false`.
   - With no source text at all, the LLM proposes facts from its own knowledge, all `verified: false`, and generation continues.
3. **script**:
   - 8–12 scenes, scaled to the target length, with one idea per scene.
   - 25–45 words per scene, written for speech in the target language, with rounded numbers and no scene titles in the spoken text.
   - Only facts from the fact sheet may be used. The prompt passes them by id, and the response lists `factIds` per scene.
4. **scenes**: per scene, the LLM picks one of the 9 types and fills its schema, including cues. The schema limits are enforced through the validation loop (§3). Each data scene shows its source line (`Source: …`) from the fact's source.
5. **voice**:
   - Voice engines:
     - `edge` (default, free): edge-tts through a Node implementation (`msedge-tts` or equivalent), with the voice picked by language.
     - `elevenlabs`, `openai`: their TTS APIs, per scene.
     - `none`: subtitles only, with durations estimated from word count.
   - Scene duration is the audio length + 1.2 s, or the estimate.
   - The step calls `invalidateBundle` after writing audio.
6. **layout**:
   - Renders a still at ~80% of each scene and measures text and element bounding boxes against the safe area (y 260–880, inside the frame), including overlaps between text boxes.
   - A scene that overflows is regenerated once automatically (step 4 for that scene, with the problem in the prompt).
   - If it still overflows, it gets a warning and generation continues.
7. **render**: MP4 1920×1080 via `@remotion/renderer`, then verified with ffprobe (duration matches; audio present when a voice engine is on).
8. **package**:
   - **Thumbnail:** the LLM proposes 3 `ThumbnailSpec`s (2–4 huge words, a shocking figure or question, 1–2 characters, a strong graphic element). They are rendered as 1280×720 stills (PNG under 2 MB), and the first is the default.
   - **YouTube package:** 3 titles under 70 characters, and a description with a 2–3 sentence hook, chapters from real scene durations starting at `0:00`, the sources list and 3–5 hashtags.
   - **Narration:** a `.txt` file.

Transient provider errors (timeout, rate limit, 5xx) are retried twice with backoff before a step fails.

**Touch-up operations** (also in `core/generate`, used by the result screen):
- `regenerateScene(id)`: re-runs step 4 for one scene, then layout for that scene. The narration is unchanged; the type and data may change.
- `editNarration(id, text)`: saves the text and marks the scene `dirty`. Cues that no longer match fall back to the stagger.
- `rerender()`: redoes the voice for dirty scenes only, then steps 6–7 for them and the final render.
- `useRecording(file)`:
  - `prepareRecording()` exports the narration joined with pause markers.
  - The uploaded recording is split on long silences (ffmpeg `silencedetect`, same logic as `decouper_voix.py`) and becomes the scenes' audio (`voice.engine = 'upload'`).
  - If the pause count doesn't match the scene count, the result screen shows the waveform with detected cuts for manual adjustment.

### 4.2 Screens (`packages/web`)

- **Home**:
  - Main inputs:
    - topic field;
    - 4 style cards with thumbnails;
    - optional "Add sources" (links, PDF/TXT/MD) collapsed;
    - "Advanced" collapsed: language, length 1–10 min (default 3), voice engine and voice, provider and model.
  - The "Generate the video" button opens Settings instead when no provider is configured.
  - Below: earlier projects with thumbnail, title and date.
- **Progress**:
  - The 8 steps in plain words, with a progress bar for the current step (percentage during render), one live log line and Cancel.
  - On failure: the message names the cause and where to fix it (e.g. "OpenAI key rejected → Settings"), with a Retry button that resumes at the failed step.
- **Result**:
  - The video in `@remotion/player`.
  - The scene list, each with:
    - a still;
    - editable narration;
    - sources;
    - ⚠️ warnings;
    - "Regenerate this scene".
  - "Re-render" (enabled when some scene is dirty).
  - "Use my recording".
  - Downloads: MP4, thumbnail (choose 1 of 3), YouTube package.
- **Settings** (gear icon):
  - The provider with key, model, and a "Test connection" button.
  - Voice keys, search key (Tavily/Brave), default language and default voice.
  - Shown automatically on first launch.

### 4.3 CLI

`npm run make -- "<topic>" --style <name> [--sources <url|file>...] [--length <min>] [--language <code>] [--voice <engine>]` creates a project folder, runs `generate` with progress printed per step, and prints `OK <mp4 path>`. It uses the same settings file as the web UI.

## 5. Server

- Fastify, serves the built web app and the API on `localhost:3210` (bound to localhost by default; the bind address is configurable for Docker).
- REST: create project and start generation, list/get/delete projects, retry, cancel, regenerate scene, patch narration, re-render, upload sources/recording, settings, provider test.
- SSE: `/projects/:id/events` streams step progress and logs.
- Jobs: one in-memory queue per project; long jobs (research, voice, render) run there; cancelling stops the subprocess or aborts the request.
- Static: project files (audio, stills, MP4) are served to the Player and for download.
- Data directory: `./data` (native) or a mounted volume (Docker).

## 6. Error handling

| Failure | Behaviour |
|---|---|
| Invalid scene JSON after 3 retries | Scene falls back to a simple `title` scene with its narration summary, `status: 'fallback'`, warning on the result screen; generation continues |
| Provider transient error (timeout, rate limit, 5xx) | Retried twice with backoff, then as below |
| Provider auth/quota error | Step stops with a message naming the provider and the cause; the project stays at the last finished step; Retry resumes there |
| Layout overflow | One automatic regeneration of the scene; if it persists, warning and continue |
| CLI not installed / not logged in | Detected by "Test connection"; clear instructions to install/log in |
| URL unreachable / PDF unreadable | Source kept with `error`, shown in UI; other sources proceed |
| TTS failure on one scene | That scene uses an estimated duration and is flagged; others proceed |
| Upload split mismatch | Manual cut editor (waveform + markers) |
| Render failure | Job marked failed, log in `logs/`, error shown with the last log lines |
| Corrupted / old `project.json` | Schema validation on load; versioned migrations; a backup is kept before each write (`project.json.bak`) |

## 7. Docker

- `Dockerfile`: Node LTS on Debian slim, Chrome Headless Shell dependencies installed per Remotion's Linux docs, `npx remotion browser ensure` at build time, fonts for common scripts (Noto).
- `docker-compose.yml`: one service, port `3210`, volume `./data:/app/data`, `env_file: .env`, `extra_hosts: host.docker.internal:host-gateway` so Ollama on the host is reachable.
- CLI providers are not installed in the default image; docs explain how to extend it.

## 8. Testing

- **scenes**: every scene type × 4 styles rendered as a still from its example JSON, compared with a reference PNG (pixel-diff threshold). Schema round-trip tests.
- **core**: unit tests for timing (`cue` → frame), chapter computation, silence splitting (on a generated test WAV), excerpt verification, provider validation/retry (fake provider returning invalid then valid output), project migrations.
- **e2e**: fake provider + `voice: none` → `generate` → short MP4 checked by ffprobe; resume after an injected failure at each step; `regenerateScene` and `rerender` on a generated project.
- **web**: component tests for the home form and scene list; one Playwright smoke test (topic + style → Generate → result screen with the video), on the fake provider.
- **CI**: GitHub Actions running lint, typecheck, unit tests, still snapshots, e2e, and a Docker build. No real API keys in CI.

## 9. Scope

**v1 (this spec):** everything above.

**Later (explicitly out of v1):** LLM-written custom code scenes (hybrid mode), per-field scene editing forms and a timeline, right-to-left languages, vision-model visual checks, Electron/desktop packaging, direct YouTube upload, background music, vertical 9:16 format, multi-user/hosted mode.

**Delivery plans:**
1. Rendering engine: scenes + project model + render (done).
2. LLM providers + generator steps sources → facts → script → scenes → layout → render with `voice: none`, plus the `make` CLI. Complete silent videos from a topic.
3. Voice (edge default, ElevenLabs, OpenAI, upload + splitting), thumbnail, YouTube package, touch-up operations.
4. Server + web UI (home, progress, result, settings).
5. Docker compose, CI, release.

## 10. Open risks

- **CLI provider terms**: providers' policies on third-party use of subscriptions may change; the mode stays opt-in and experimental, and may be removed.
- **Small local models** may produce weak narration even when the JSON is valid; the mitigation is per-scene regeneration and narration editing on the result screen. Recommended models are documented.
- **Fully automatic generation** means errors surface only at the end; warnings on the result screen and per-scene regeneration are the mitigation, not a review step before rendering.
- **edge-tts** relies on an unofficial Microsoft endpoint that may break; it is isolated behind the voice interface, with other engines available.
- **Fact verification** proves an excerpt exists in a source, not that the source is right; the UI says so.
