# docu-motion — Plan 3: Voice, Export and Touch-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `npm run make -- "<topic>"` produces a narrated MP4 by default, plus a thumbnail and a YouTube package. A second command, `npm run touch`, covers the result-screen operations: regenerate a scene, edit a narration, re-render, swap in your own recording, and pick a thumbnail.

**Architecture:**
- `packages/core/src/media/` wraps Remotion's bundled ffmpeg/ffprobe: probing, silence detection, cutting.
- `packages/core/src/voice/` holds one `TtsEngine` per provider behind a common interface.
- The `voice` step becomes real. A new `package` step (thumbnail + YouTube) closes the pipeline.
- `packages/core/src/generate/touch.ts` holds the touch-up operations. They work by editing `project.json` and clearing the right checkpoints, then re-running `generate`, so no second execution path exists.
- `packages/scenes` gains a `Thumbnail` composition (1280×720).

**Tech Stack:** Plan 2 stack plus `msedge-tts` 2.1.1. ElevenLabs and OpenAI TTS are called over REST with the injected `fetch`, so there is no SDK. ffmpeg/ffprobe come from Remotion's compositor via `npx remotion ffmpeg|ffprobe`, the same way `probe.ts` does it today.

**Spec:** `docs/superpowers/specs/2026-10-24-docu-motion-design.md` (revised). This plan covers §4.1 steps 5 and 8, the touch-up operations, §4.3, the §6 rows for TTS failure and upload split mismatch, and §8. Earlier plans: `2026-10-24-plan-1-foundation.md` and `2026-10-24-plan-2-generator.md`.

**Branch:** `plan-3-voice-export`, created from `plan-2-generator`, or from `main` if Plan 2 has been merged by then.

## Global Constraints

- All Plan 1 and Plan 2 constraints still hold:
  - exact pins, Zod 3.25.76, Node ≥ 22;
  - keys are never logged and never stored in `project.json`;
  - no network in unit tests: `fetch`, the TTS client, the clock and `sleep` are injected.
- Docker is the reference environment. Verify every task with:
  - `docker compose --profile dev run --rm dev test`
  - `docker compose --profile dev run --rm dev typecheck`
  - and, when the task touches rendering, media or e2e: `docker compose --profile dev run --rm dev test:visual`
- Never render natively on Windows.
- Scene duration with audio is `durationFromAudio(seconds)`, i.e. `ceil((seconds + 1.2) * 30)` (Plan 1). Without audio it is `estimateDurationFrames(narration)`.
- Default voice engine is `edge` (spec §2.2, §4.1). `make --voice none` keeps the Plan 2 silent behaviour.
- Edge default voices: `fr` → `fr-FR-DeniseNeural`, `en` → `en-US-AriaNeural`, `es` → `es-ES-ElviraNeural`, `de` → `de-DE-KatjaNeural`, `it` → `it-IT-ElsaNeural`, `pt` → `pt-BR-FranciscaNeural`. Any other language: the first voice in the Edge voice list whose `Locale` starts with `<language>-`. `voice.voiceId` overrides all of this.
- Audio files:
  - TTS output: `voice/<sceneId>.mp3`
  - recording cuts: `voice/<sceneId>.wav`
  - After any audio write, call `invalidateBundle(projectDir)`. The bundle is keyed by the asset list, so a re-voiced file at the same path would otherwise be served stale.
- Silence detection follows the skill's `decouper_voix.py`:
  - ffmpeg `silencedetect=n=-38dB:d=1.2`;
  - ignore silences that start within 0.05 s of the start or end within 0.05 s of the end;
  - require exactly `scenes − 1` silences;
  - cut at each silence midpoint.
- Recording script: the narrations joined with `\n<break time="2.0s" />\n`, scene titles never included.
- Thumbnail: 1280×720, PNG ≤ 2 MB. If the PNG exceeds 2 MB, re-render it as JPEG at quality 90 and record the warning `Thumbnail saved as JPEG (PNG over 2 MB)`.
- YouTube package:
  - 3 titles, each ≤ 70 characters (counted as code points);
  - a description made of: a 2–3 sentence hook, chapters, a sources list, and 3–5 hashtags;
  - chapters are computed from the real scene durations and start at `0:00`.
- Step order becomes `sources, facts, script, scenes, voice, layout, render, package`.

## Review Focus

1. **Edge TTS unreachable** (offline, blocked network, Microsoft endpoint change).
   - When one scene fails, that scene gets an estimated duration and the warning `Voice failed: <cause>`, and the other scenes proceed (spec §6).
   - When every scene fails, the step fails with `Voice engine "edge" failed for every scene: <first cause>`, so no fully silent video ships unnoticed.
   - Pinned in Task 3.
2. **A recording whose pause count is wrong** (a pause mid-sentence, or a `<break>` that was skipped).
   - Nothing is applied: the existing audio and `voice.engine` are untouched.
   - The error states how many pauses were found, how many are needed, and the detected silence times.
   - The user can pass explicit cut times to override.
   - Pinned in Task 7.
3. **Edit one narration, then re-render.**
   - Only that scene is re-voiced: the other audio files keep their bytes and their mtime.
   - The new audio is actually in the video, not a stale bundled copy.
   - The video duration matches the new audio.
   - Pinned in Tasks 3 and 6.
4. **YouTube chapters for short scenes.**
   - YouTube needs ≥ 3 chapters, each ≥ 10 s, with the first at `0:00`.
   - Scenes shorter than 10 s merge into the previous chapter, keeping the earlier scene's label.
   - If fewer than 3 chapters remain, the description omits chapters entirely and adds the warning `Too few chapters for YouTube (need 3 of ≥ 10 s)`.
   - Pinned in Task 5.
5. **Thumbnail words with accents, emoji or a very long word.**
   - Limits count characters, not bytes.
   - The text stays inside the 1280×720 frame, inset 40 px on every side, measured with the same pixel diff against the thumbnail background.
   - Pinned in Task 4.

---

### Task 1: Media helpers (ffmpeg/ffprobe)

**Files:**
- Create: `packages/core/src/media/ffmpeg.ts`, `packages/core/src/media/silence.ts`
- Modify: `packages/core/src/render/probe.ts` (reuse the shared spawn helper; behaviour unchanged)
- Test: `packages/core/test/render/media.test.ts` (visual project, because it needs the ffmpeg binary). Fixtures are generated in the test with ffmpeg `lavfi`; no binary fixtures are committed.

**Interfaces:**
- Produces:
  - `runRemotionTool(tool: 'ffmpeg' | 'ffprobe', args: string[], opts?: {signal?: AbortSignal}): Promise<{stdout: string; stderr: string}>`
    - one spawn helper, `cwd` = the core package dir;
    - rejects with the last 500 characters of stderr on a non-zero exit;
    - `probeMedia` is rewritten on top of it.
  - `probeAudioSeconds(file: string): Promise<number>`: reads `format.duration` and throws if it is not finite. It does not require a video stream.
  - `detectSilences(file: string, opts?: {noiseDb?: number; minSeconds?: number}): Promise<{silences: {start: number; end: number}[]; duration: number}>`
    - defaults: `-38` dB and `1.2` s;
    - parses `silence_start`, `silence_end` and `Duration` from stderr;
    - applies the 0.05 s edge filter.
  - `cutAudio(input: string, start: number, end: number, output: string): Promise<void>`: writes a 16-bit PCM WAV (`-c:a pcm_s16le`).
  - `cutsFromSilences(silences, count: number): number[] | undefined`: returns the midpoints when `silences.length === count - 1`, otherwise `undefined`.

- [ ] **Step 1: Write failing tests.**
  - Fixture: ffmpeg `lavfi` builds a 2 s tone, 2 s of silence, a 3 s tone, 2 s of silence and a 2 s tone into `rec.wav`, in a temp dir whose name contains `données é`.
  - `probeAudioSeconds(rec)` ≈ 11 (±0.05).
  - `detectSilences` returns 2 silences near 2–4 and 7–9.
  - `cutsFromSilences(…, 3)` ≈ `[3, 8]`; with `count = 4` it returns `undefined`.
  - `cutAudio(rec, 0, 3, out)` gives a file whose probed length is ≈ 3.
  - `probeMedia` still works on a Plan 1 MP4. Reuse the render fixture, or mark this as covered by the existing render tests.
- [ ] **Step 2:** Run `docker compose --profile dev run --rm dev test:visual -- media`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command, plus `dev test` and `dev typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(core): ffmpeg helpers for audio probing, silence detection and cutting`

### Task 2: TTS engines

**Files:**
- Create: `packages/core/src/voice/engines.ts`, `packages/core/src/voice/edge.ts`, `packages/core/src/voice/rest.ts`, `packages/core/src/voice/voices.ts`
- Test: `packages/core/test/voice/engines.test.ts`

**Interfaces:**
- Consumes:
  - Plan 2 `Settings` (`keys.elevenlabs`, `keys.openai`);
  - `ProviderError`, `redact`;
  - the transient-retry helper from `llm/makeProvider.ts`. Export it there as `withTransientRetry(fn, {sleep, signal})` if it is not exported yet.
- Produces:
  - ```ts
    type TtsEngine = {
      name: 'edge' | 'elevenlabs' | 'openai';
      synthesize(text: string, opts: {voiceId: string; signal?: AbortSignal}): Promise<Uint8Array>; // MP3 bytes
    }
    ```
  - `createTtsEngine(engine: 'edge' | 'elevenlabs' | 'openai', settings: Settings, deps?: {fetch?: typeof fetch; edgeClient?: EdgeClient; sleep?}): TtsEngine`
    - A missing key throws `ProviderError('<Engine> key missing — add it in Settings or <ENV_VAR>')`. ElevenLabs needs `ELEVENLABS_API_KEY`; OpenAI uses `OPENAI_API_KEY`.
    - Errors name the engine and the HTTP status, and are redacted.
    - Transient errors (429, ≥500, network, timeout) get 2 retries with backoff 1 s, then 4 s.
  - ElevenLabs request:
    - `POST https://api.elevenlabs.io/v1/text-to-speech/<voiceId>?output_format=mp3_44100_128`
    - header `xi-api-key`
    - body `{text, model_id: 'eleven_multilingual_v2'}`
  - OpenAI request:
    - `POST https://api.openai.com/v1/audio/speech`
    - `Authorization: Bearer`
    - body `{model: 'gpt-4o-mini-tts', voice: <voiceId>, input: text, response_format: 'mp3'}`
  - Edge: a `msedge-tts` client behind `type EdgeClient = {synthesize(text, voice, signal?): Promise<Uint8Array>; listVoices(): Promise<{ShortName: string; Locale: string}[]>}`, so tests inject a fake.
  - `defaultVoiceFor(engine, language, deps): Promise<string>` uses these defaults:
    - edge: the Global Constraints table, then the voice list;
    - elevenlabs: `21m00Tcm4TlvDq8ikWAM` (Rachel, multilingual);
    - openai: `alloy`.
  - `ELEVENLABS_API_KEY` is added to the Plan 2 settings env overrides, if it is missing there.

- [ ] **Step 1: Write failing tests**, using a fetch stub and a fake edge client:
  - The ElevenLabs request has the right URL, header and body, and returns the bytes.
  - An OpenAI 401 whose message contains the key gives an error that names `OpenAI` and `401` and does not contain the key.
  - A 429 twice, then success, gives the result with sleeps `[1000, 4000]`.
  - `defaultVoiceFor('edge', 'fr')` is `fr-FR-DeniseNeural`.
  - `defaultVoiceFor('edge', 'nl')` picks the first `nl-` voice from the fake list.
  - A missing ElevenLabs key gives a message naming `ELEVENLABS_API_KEY`.
- [ ] **Step 2:** Run `npx vitest run packages/core/test/voice` natively for speed (no network), or `dev test`. Expected: FAIL.
- [ ] **Step 3:** Implement. Pin `msedge-tts` at exactly 2.1.1, and read its `.d.ts` for the exact API.
- [ ] **Step 4:** Run `dev test` and `dev typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(core): TTS engines for Edge, ElevenLabs and OpenAI`

### Task 3: Real `voice` step

**Files:**
- Modify: `packages/core/src/generate/steps/voice.ts`, `packages/core/src/project/schema.ts` (scene `audio` gains `hash: string`)
- Test: `packages/core/test/generate/voice.test.ts` (unit: engine and probe injected), `packages/core/test/render/voice.e2e.test.ts` (visual: a real ffmpeg probe with the fake TTS)

**Interfaces:**
- Consumes: Task 1 `probeAudioSeconds`; Task 2 `createTtsEngine` and `defaultVoiceFor`; Plan 1 `invalidateBundle` and `durationFromAudio`.
- Produces:
  - `voiceStep(deps?: {engine?: TtsEngine; probe?: (file) => Promise<number>}): Step`. `STEPS.voice` becomes `voiceStep()`.
  - `audioHash(text: string, engine: string, voiceId: string): string`, the first 16 hex characters of sha256.
  - Behaviour by engine:
    - `none`: unchanged from Plan 2.
    - `upload`: leaves every scene with audio alone. Scenes without audio get the estimate and the warning `No recording for this scene`. A scene with `dirty: true` keeps its recorded audio but gets the warning `Narration edited after recording — record again or switch to a TTS voice`.
    - `edge`, `elevenlabs` and `openai`: for each scene, skip it if `audio.hash === audioHash(...)` and the file exists. Otherwise synthesize, write `voice/<id>.mp3`, probe it, set `audio: {path, seconds, hash}` and `durationFrames: durationFromAudio(seconds)`, clear `dirty`, and remove the scene's own earlier `Voice failed:` warning.
  - Per-scene failure (anything except abort): `durationFrames = estimateDurationFrames`, remove `audio`, add the warning `Voice failed: <redacted cause>`.
  - All scenes failed: throw `Error('Voice engine "<x>" failed for every scene: <first cause>')`.
  - After the loop, call `invalidateBundle(projectDir)` if any file was written.
  - Progress is reported as ratio `(i+1)/n`.
  - Test hook (test-only, read only by `scripts/make.ts`): env `DOCU_MOTION_FAKE_TTS=1` makes `createTtsEngine` return an engine that renders a 440 Hz tone lasting `words / 2.5` seconds via ffmpeg `lavfi`, as MP3. Document it next to the Plan 2 hooks.

- [ ] **Step 1: Write failing unit tests.**
  - With a fake engine and a fixed probe (3.0 s): scenes get `durationFrames` 126 (= `ceil((3+1.2)*30)`), `audio.path` `voice/s01.mp3`, and a hash.
  - On rerun, the engine is not called again, and the file's mtime is unchanged.
  - After editing one narration, only that scene is synthesized (call count 1).
  - The engine throws for scene 2 only: scene 2 is estimated, carries a `Voice failed:` warning, and the other scenes have audio.
  - The engine throws for every scene: the step rejects with `failed for every scene`.
  - The `upload` engine with no audio on scene 3 gives the warning `No recording for this scene`.
  - The `upload` engine with scene 2 `dirty` gives the warning `Narration edited after recording`, and scene 2 keeps its audio.
  - `invalidateBundle` is called once after writes (spy) and not at all when nothing was written.
- [ ] **Step 2: Write the failing visual e2e test.**
  - Set up a 2-scene project with `DOCU_MOTION_FAKE_TTS=1`. Run `voiceStep`, then `renderVideo`.
  - `probeMedia` reports `hasAudio === true`, and the duration equals Σ durationFrames / 30 ± 0.2.
  - Edit scene 1's narration (add 10 words), rerun voice and render. Scene 0's file bytes are unchanged, and the new video is longer. This catches a stale bundle.
- [ ] **Step 3:** Run `dev test` and `dev test:visual -- voice`. Expected: FAIL.
- [ ] **Step 4:** Implement.
- [ ] **Step 5:** Run all three Docker suites. Expected: PASS.
- [ ] **Step 6:** Commit: `feat(core): voice step with cached per-scene TTS and graceful failures`

### Task 4: Thumbnail spec and composition

**Files:**
- Create: `packages/scenes/src/thumbnail/schema.ts`, `packages/scenes/src/thumbnail/Thumbnail.tsx`
- Modify: `packages/scenes/src/Root.tsx` (compositions `Thumbnail` and `ThumbnailBackground`, both 1280×720 with 1 frame), `packages/scenes/src/lib.ts`
- Test: `packages/scenes/test/thumbnail.test.ts`, `packages/core/test/render/thumbnail.test.ts` (visual: 3 example specs × 4 styles as snapshots, plus the inside-frame check)

**Interfaces:**
- Consumes: the Plan 1 kit (`Canvas`-like background, `Character`, `Text`, `useTheme`) and `pixelsOutsideSafeArea` (Plan 2 `render/layoutCheck.ts`).
- Produces:
  - `ThumbnailSpecSchema`:
    ```ts
    z.object({
      words: z.array(z.string().min(1).max(14)).min(2).max(4),
      figure: z.string().max(12).optional(),
      characters: z.number().int().min(1).max(2),
      element: z.enum(['arrow-up', 'arrow-down', 'question', 'exclamation', 'coin', 'none']),
      highlight: z.number().int().min(0).max(3),
    })
    ```
    `highlight` is the index of the word drawn in the accent colour, and must be smaller than `words.length` (refinement). Lengths count code points.
  - `type ThumbnailSpec` and `THUMBNAIL_EXAMPLES: ThumbnailSpec[]` (3 examples).
  - Composition `Thumbnail`, props `{style: StyleName; spec: ThumbnailSpec}`: huge words, the left 60 % of the frame, auto-fit size (largest that fits, never below 64 px), the figure as a badge, characters at the bottom right.
  - Composition `ThumbnailBackground`, props `{style}`.
- [ ] **Step 1: Write failing tests.**
  - Schema: a 15-character word fails; `highlight: 3` with 3 words fails; the word `"Sécu 🏥"` counts as 6 code points and passes; the 3 examples parse.
  - Visual: 12 snapshots (examples × styles), recorded on first run.
  - Inside-frame: diff against `ThumbnailBackground`, with no differing pixel outside the 40 px inset.
  - Long-word stress: 4 words of 14 `W`s still pass the inside-frame check.
- [ ] **Step 2–4:** Run `dev test` and `dev test:visual -- thumbnail` (FAIL), then implement and look at the 4 recorded style variants with the Read tool, then run all three suites (PASS).
- [ ] **Step 5:** Commit: `feat(scenes): thumbnail spec and composition`

### Task 5: `package` step (thumbnail + YouTube)

**Files:**
- Create: `packages/core/src/generate/steps/package.ts`, `packages/core/src/generate/youtube.ts`
- Modify:
  - `packages/core/src/project/schema.ts`:
    - add `'package'` to `STEP_NAMES`;
    - `thumbnail` becomes `{options: ThumbnailSpec[]; chosen: number; file: string}`, optional;
    - `youtube` stays as Plan 1 shaped it, plus `warnings: string[]` (default `[]`);
    - a Plan 1/2 project with the old `thumbnail: {spec}` shape must still load: transform it to undefined.
  - `generate.ts`: `STEPS.package`.
  - `prompts.ts`: `proposeThumbnails`, `writeYoutube`.
  - `llm/demoResponder.ts`: answers the two new schemas.
  - `render/render.ts`: add `renderThumbnail(projectDir, p, spec, out): Promise<string>`.
- Test: `packages/core/test/generate/youtube.test.ts`, `packages/core/test/generate/package.test.ts` (unit, with the render injected)

**Interfaces:**
- Produces:
  - `chapters(p: Project): {t: string; label: string}[]` (`youtube.ts`):
    - start times are the cumulative `durationFrames / 30`;
    - labels are the scene spec `title`;
    - the format is `m:ss`, or `h:mm:ss` from 1 h;
    - short scenes merge per Review Focus 4;
    - returns `[]` when fewer than 3 chapters remain.
  - `YoutubeOutputSchema`: `{titles: string[3], each ≤ 70 code points; hook: string (2–3 sentences, ≤ 400 chars); hashtags: string[3..5], each matching /^#[\p{L}\p{N}_]{2,30}$/u}`.
  - `ThumbnailsOutputSchema`: `{options: ThumbnailSpec[3]}`.
  - `describe(p, out: YoutubeOutput, ch): string`: the hook, a blank line, then the chapters lines `0:00 Title`, then `Sources:` with each used source as `- <title> — <uri>` (sources cited by facts used in scenes, deduped, in order), then the hashtags on one line.
  - `packageStep(deps?: {renderThumbnail?}): Step`:
    1. LLM `ThumbnailsOutputSchema`, then render the 3 options to `out/thumbnail-1.png`… `-3.png`; the chosen one (0) is copied to `out/thumbnail.png`, with the JPEG fallback over 2 MB.
    2. LLM `YoutubeOutputSchema`, then `p.youtube = {titles, description, chapters, hashtags, warnings}`.
    3. Write `out/youtube.txt` (titles numbered, a blank line, the description) and `out/narration.txt` (the narrations separated by blank lines).
- [ ] **Step 1: Write failing tests.**
  - `chapters`: durations 10/20/5/30/12 s give the starts `0:00, 0:10, 0:30, 1:05`. The 5 s scene merges into the 0:10 chapter.
  - `chapters` with only 2 chapters ≥ 10 s gives `[]`.
  - A 3 700 s total formats as `1:01:40`.
  - `describe`: contains the hook, `0:00` first, the `Sources:` block with deduped sources, and the hashtags last.
  - A YouTube title of 71 code points is rejected by the schema.
  - `packageStep` with the fake LLM and an injected `renderThumbnail` (writes a 10 KB file): the files exist and `thumbnail.chosen === 0`.
  - With a 3 MB file, the JPEG path is taken and the warning is recorded.
  - The demoResponder answers both schemas with valid output.
- [ ] **Step 2–4:** `dev test` FAIL, then implement, then all three suites PASS. The visual suite is included because `STEP_NAMES` changed and the make e2e must still pass with 8 steps.
- [ ] **Step 5:** Commit: `feat(core): package step with thumbnail options and YouTube kit`

### Task 6: Touch-up operations

**Files:**
- Create: `packages/core/src/generate/touch.ts`
- Modify: `packages/core/src/generate/steps/layout.ts` (export `layoutScene(p, index, ctx, deps?)`, extracted from `layoutStep` and used by it), `packages/core/src/index.ts`
- Test: `packages/core/test/generate/touch.test.ts` (unit, with steps and checks injected)

**Interfaces:**
- Consumes: Plan 2 `generate`, `generateSceneSpec`, `applySceneResult`, `loadProject`, `saveProject`, `STEP_NAMES`.
- Produces:
  - `regenerateScene(projectDir, sceneId, ctx): Promise<Project>`:
    1. `generateSceneSpec` then `applySceneResult`, then `layoutScene` for that scene.
    2. Clears `render` and `package` from `progress.done`, then saves.
    3. Does not re-render. The caller runs `rerender`.
  - `editNarration(projectDir, sceneId, text): Promise<Project>`:
    1. Validates the text: 1 to 2000 characters, trimmed.
    2. Sets the narration and marks the scene `dirty: true`.
    3. Clears `voice`, `render` and `package` from `done`, then saves.
  - `rerender(projectDir, ctx): Promise<Project>`:
    1. Clears `voice`, `render` and `package` from `done`, keeping `layout`.
    2. Runs `generate`. The voice step only re-synthesizes changed scenes, thanks to the hash.
    3. Implemented by removing those three step names, then `generate(projectDir, ctx)`.
  - `chooseThumbnail(projectDir, index): Promise<Project>`: copies `out/thumbnail-<index+1>.<ext>` to `out/thumbnail.<ext>` and sets `chosen`. An index outside `0..options.length-1` throws.
  - Unknown scene id: throws `Error('Unknown scene "<id>" — scenes are s01…sNN')`.
- [ ] **Step 1: Write failing tests.**
  - `editNarration` on s02 sets `dirty` and leaves `done` without voice, render and package.
  - `rerender` with a stub voice step that records which scenes changed calls the voice, layout-skipped, render and package stubs in order, and never the earlier steps.
  - `regenerateScene` on s03 calls the LLM once (fake), and the `done` list loses render and package.
  - `chooseThumbnail(…, 2)` copies `-3`; `chooseThumbnail(…, 5)` throws.
  - An unknown id throws the message above.
- [ ] **Step 2–4:** `dev test` FAIL, then implement, then `dev test` and `dev typecheck` PASS.
- [ ] **Step 5:** Commit: `feat(core): touch-up operations — regenerate, edit narration, rerender, choose thumbnail`

### Task 7: Own recording (prepare + split)

**Files:**
- Create: `packages/core/src/voice/recording.ts`
- Test: `packages/core/test/render/recording.test.ts` (visual, uses ffmpeg)

**Interfaces:**
- Consumes: Task 1 `detectSilences`, `cutsFromSilences`, `cutAudio`, `probeAudioSeconds`; Task 6 `rerender`.
- Produces:
  - `prepareRecording(projectDir): Promise<string>`: writes `out/recording-script.txt` per Global Constraints and returns its path.
  - ```ts
    applyRecording(projectDir, file, opts?: {cuts?: number[]}):
      Promise<
        | {ok: true; project: Project}
        | {ok: false; found: number; needed: number; silences: {start, end}[]}
      >
    ```
    - It copies the recording into `voice/recording<ext>`.
    - Cut times are, in this order:
      - `opts.cuts`, which must be strictly increasing and inside the duration (`scenes − 1` values), or
      - `cutsFromSilences` of the detected silences.
    - If there are no cuts, it returns `ok: false` and the project is untouched.
    - On success it cuts `voice/<id>.wav` per scene and sets `audio: {path, seconds, hash: 'upload'}` and `voice.engine = 'upload'`. It then clears `voice`, `render` and `package` from `done`, saves, and calls `invalidateBundle`.
- [ ] **Step 1: Write failing tests.** Each fixture is a recording built with lavfi: N tones separated by 2 s of silence.
  - `prepareRecording` on a 3-scene project gives exactly 2 `<break time="2.0s" />` lines and no titles.
  - 3 scenes with a matching 3-tone recording: ok, 3 wav files, each about its tone length, and the engine is `upload`.
  - 3 scenes with a 2-tone recording: `{ok: false, found: 1, needed: 2}`. `project.json` bytes are unchanged and no wav files are written.
  - The same 2-tone file with explicit `cuts: [2.5, 3.0]`: ok.
  - Non-increasing cuts throw.
- [ ] **Step 2–4:** `dev test:visual -- recording` FAIL, then implement, then all three suites PASS.
- [ ] **Step 5:** Commit: `feat(core): prepare and split an uploaded voice recording`

### Task 8: Plan 2 parked hardening

**Files:**
- Modify: `packages/core/src/llm/cli.ts`, `packages/core/src/llm/aiSdk.ts`
- Test: `packages/core/test/llm/cli.test.ts`, `packages/core/test/llm/aiSdk.test.ts`

**Interfaces:**
- `cli.ts`: the child env is `process.env` minus `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `MISTRAL_API_KEY`, `OPENROUTER_API_KEY`, `TAVILY_API_KEY`, `BRAVE_API_KEY` and `ELEVENLABS_API_KEY`. The CLIs' own credentials, such as `GEMINI_API_KEY` and the `~/.claude` login, are kept.
- `aiSdk.ts`:
  - The structured-call fallback on HTTP 400 applies only when the error body or message matches `/schema|response_format|json/i`. Every other 400 maps straight to a ProviderError.
  - A Google 400 whose message matches `/API key not valid/i` gets the same key hint as 401/403.
- [ ] **Step 1: Write failing tests.**
  - The fixture CLI echoes `process.env.ANTHROPIC_API_KEY ?? 'unset'`, which gives `unset`, while `GEMINI_API_KEY` passes through.
  - A 400 `"Invalid schema for response_format"` falls back (2 calls).
  - A 400 `"API key not valid"` does not fall back (1 call), and its message has the key hint.
- [ ] **Step 2–4:** `dev test` FAIL, then implement, then PASS.
- [ ] **Step 5:** Commit: `fix(core): strip app keys from CLI children; narrow the 400 fallback`

### Task 9: CLI — voice options, `touch` command, end-to-end

**Files:**
- Modify: `scripts/make.ts` (`--voice edge|elevenlabs|openai|none`, default `edge`; `--voice-id <id>`), `README.md`
- Create: `scripts/touch.ts` (root script `"touch": "tsx --tsconfig tsconfig.base.json scripts/touch.ts"`)
- Test: `packages/core/test/render/touch.e2e.test.ts` (visual)

**Interfaces:**
- Consumes: Tasks 3–7.
- `touch` usage: `npm run touch -- <projectDir> <command>`, where `<command>` is one of:
  - `regenerate <sceneId>`
  - `edit <sceneId> "<text>"`
  - `rerender`
  - `prepare-recording`
  - `recording <file> [--cuts t1,t2,…]`
  - `thumbnail <1|2|3>`
- Output:
  - Each command prints a one-line result, e.g. `OK s03 regenerated — run "rerender" to update the video`, or, for `rerender`, the step lines followed by `OK <mp4>`.
  - The `recording` mismatch prints `Found <f> pauses, need <n>. Detected silences: 2.1–4.0 s, …` and `Pass --cuts with <n> times to override`, then exits 1.
  - Errors exit 1. Ctrl+C exits 130.
- `make` prints the thumbnail path and `out/youtube.txt` after `OK`.
- [ ] **Step 1: Write failing e2e tests.** They spawn the CLIs with `--provider fake`, `DOCU_MOTION_FAKE_TTS=1`, and a data dir named `données é`.
  - `make` → exit 0. `hasAudio` is true. `out/thumbnail.png` (or `.jpg`) and `out/youtube.txt` exist, and `youtube.txt` contains `0:00`.
  - `touch edit s02 "<35 words>"` then `touch rerender` → exit 0. Only `voice/s02.mp3` has a new mtime, and the video duration changed.
  - `touch prepare-recording` writes the script. `touch recording <lavfi-built N-tone wav>` then `touch rerender` → the video audio duration ≈ the tones plus padding.
  - `touch thumbnail 9` → exit 1.
- [ ] **Step 2:** `dev test:visual -- touch.e2e` → FAIL.
- [ ] **Step 3:** Implement, then update the README: the voice options, the `touch` commands, the Edge network note, and the recording workflow.
- [ ] **Step 4:** Run all three Docker suites. Then manually:
  - `docker compose --profile dev run --rm dev make -- "La dette publique" --provider fake --data /app/data/p3-check` with `DOCU_MOTION_FAKE_TTS=1`;
  - open the contact sheet and `thumbnail.png` and look at them.
- [ ] **Step 5:** Commit: `feat: narrated videos by default, touch command, thumbnail and YouTube kit`
