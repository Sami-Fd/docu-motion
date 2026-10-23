# docu-motion — design spec

Date: 2026-10-24
Status: draft, awaiting review
Origin: the `documentaire-motion-design` Claude skill (https://github.com/Sami-Fd/documentaire-motion-design)

## 1. Purpose

An open-source, self-hosted app that turns a topic into a documentary/explainer video in coded motion design (Remotion, React/SVG), rendered to MP4 with voice-over, subtitles, a YouTube thumbnail and YouTube metadata. It reproduces the workflow of the `documentaire-motion-design` skill, but works with **any LLM provider** (Claude, GPT, Gemini, Mistral, OpenRouter, local Ollama, or a subscription via official CLIs).

**Audience:** video creators who run the app on their own machine with their own keys or subscriptions. They are not necessarily developers.

**Success criteria**
- `git clone && npm install && npm start` (or `docker compose up`) opens a working local web UI.
- A user with only an Ollama install, or only a Gemini free-tier key, can produce a complete MP4 without the pipeline breaking on malformed model output.
- Every figure shown on screen is traceable to a source, or visibly marked unverified.
- Videos can be produced in any left-to-right language; the UI is in English.

**Decisions taken during brainstorming**

| Topic | Decision |
|---|---|
| Distribution | Open-source, self-hosted, user's own keys (MIT) |
| Interface | Local web UI (browser) |
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
│  │   └─ youtube/   titles, description, chapters
│  ├─ server/   Fastify REST API + SSE progress + job queue
│  └─ web/      React (Vite) wizard + @remotion/player preview
├─ skill/       link/reference to the original SKILL.md
├─ Dockerfile
└─ docker-compose.yml
```

**Dependency direction:** `web → server → core → scenes`. `core` never imports from `server` or `web`. A future CLI would be a thin layer over `core`.

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
           audio?: {path: string; seconds: number}; durationFrames: number}[];
  voice: {engine: 'edge' | 'elevenlabs' | 'openai' | 'upload' | 'none'; voiceId?: string};
  youtube?: {titles: string[]; description: string; chapters: {t: string; label: string}[]; hashtags: string[]};
  thumbnail?: {spec: ThumbnailSpec};
};
```

Each pipeline step is a function `(project, ctx) => Promise<Project>` that writes `project.json` when it finishes. Users may stop, edit by hand, and resume.

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

## 4. Pipeline (UI wizard)

Each step can be edited and re-run independently; re-running a step marks downstream steps stale.

1. **Brief**: topic, language, target length (1–10 min), style, tone/audience, provider + model, sources (URLs, PDF/TXT/MD uploads, pasted text), web search mode.
2. **Research → fact sheet**:
   - Fetch URLs (readability extraction) and parse PDFs to text into `sources/`.
   - Web search: `native` uses the provider's built-in search tool when `capabilities.nativeWebSearch`; `tavily` / `brave` use their APIs with a user key. Results become `kind: 'search'` sources.
   - LLM extracts facts with `sourceId` + verbatim `excerpt`. The app checks that each excerpt really appears in the source text; if not, `verified: false`.
   - With no sources and no search, the LLM may propose facts from its own knowledge, all with `verified: false`.
   - UI: list of facts with excerpt, source link, ⚠️ on unverified; user can edit, delete, mark verified.
3. **Outline + narration**: 8–12 scenes (scaled to target length), one idea per scene, 25–45 words, written for speech in the target language, rounded numbers, no scene titles in the spoken text. Only facts from the fact sheet may be used; the prompt passes them by id, and the response lists the fact ids used per scene.
4. **Scenes**: per scene, the LLM picks a scene type and fills its schema, including cues. UI shows the live `@remotion/player` preview beside an auto-generated form for the scene's schema; user can edit fields, change type, or regenerate one scene. Each data scene shows its source line on screen (`Source: …`) from the fact's source.
5. **Voice**:
   - `edge`: edge-tts through a Node implementation (`msedge-tts` or equivalent), voice list filtered by language.
   - `elevenlabs`, `openai`: their TTS APIs, per scene.
   - `upload`: one recording; `prepare` exports the narration joined with pause markers (`<break time="2.0s" />` for ElevenLabs), then the app splits on long silences (ffmpeg `silencedetect`, same logic as `decouper_voix.py`). If the pause count doesn't match the scene count, the UI shows the waveform with detected cuts for manual adjustment.
   - `none`: subtitles only, durations estimated from word count.
   - Scene duration = audio length + 1.2 s (or estimate). The preview updates.
6. **Export**:
   - **Layout check**: render a still at ~80% of each scene; in the browser preview, measure SVG text/element bounding boxes against the safe area (y 260–880, inside the frame) and detect overlaps between text boxes. Problems are listed per scene with a link to edit it.
   - **Render** MP4 1920×1080 via `@remotion/renderer` with progress over SSE; cancellable.
   - **Verify** with ffprobe (Remotion's bundled binary): audio stream present, duration matches.
   - **Thumbnail**: LLM proposes 3 `ThumbnailSpec`s (2–4 huge words, a shocking figure or question, 1–2 characters, a strong graphic element); rendered as 1280×720 stills; user picks one; PNG under 2 MB.
   - **YouTube package**: 3 titles under 70 characters, description (2–3 sentence hook, chapters from real scene durations starting at `0:00`, sources list, 3–5 hashtags), narration `.txt`.

## 5. Server

- Fastify, serves the built web app and the API on `localhost:3210` (bound to localhost by default; the bind address is configurable for Docker).
- REST: CRUD on projects, run step, get/patch `project.json`, upload sources/audio, settings, provider test.
- SSE: `/projects/:id/events` streams step progress and logs.
- Jobs: one in-memory queue per project; long jobs (research, voice, render) run there; cancelling stops the subprocess or aborts the request.
- Static: project files (audio, stills, MP4) are served to the Player and for download.
- Data directory: `./data` (native) or a mounted volume (Docker).

## 6. Error handling

| Failure | Behaviour |
|---|---|
| Invalid scene JSON after 3 retries | Scene falls back to a simple `title` scene with its narration summary, `status: 'fallback'`, highlighted in UI; pipeline continues |
| Provider auth/quota/network error | Step stops with a message naming the provider and the cause; the project stays as it was |
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
- **e2e**: fake provider + `voice: none` → full pipeline → short MP4 checked by ffprobe.
- **web**: component tests for the scene form and fact sheet; one Playwright smoke test (create project, reach preview).
- **CI**: GitHub Actions running lint, typecheck, unit tests, still snapshots, e2e, and a Docker build. No real API keys in CI.

## 9. Scope

**v1 (this spec):** everything above.

**Later (explicitly out of v1):** LLM-written custom code scenes (hybrid mode), right-to-left languages, vision-model visual checks, standalone CLI, Electron/desktop packaging, direct YouTube upload, background music, vertical 9:16 format, multi-user/hosted mode.

## 10. Open risks

- **CLI provider terms**: providers' policies on third-party use of subscriptions may change; the mode stays opt-in and experimental, and may be removed.
- **Small local models** may produce weak narration even when the JSON is valid; the editable UI is the mitigation. Recommended models are documented.
- **edge-tts** relies on an unofficial Microsoft endpoint that may break; it is isolated behind the voice interface, with other engines available.
- **Fact verification** proves an excerpt exists in a source, not that the source is right; the UI says so.
