# docu-motion — Plan 1: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A TypeScript monorepo where a hand-written `project.json` (9 scene types, 4 styles, optional audio) renders to a verified 1920×1080 MP4 and to per-scene stills.

**Architecture:** `packages/scenes` is a Remotion library: the visual kit from the skill, ported so the theme comes from props via React context, plus 9 scene types each with a Zod schema, component and example. `packages/core` holds the project model (`project.json` load/save/validate) and the render module (bundle, still, video, probe). Later plans add LLM, voice, server and web on top of `core`.

**Tech Stack:** Node ≥ 20, npm workspaces, TypeScript 5.8.3, React 19.1.0, Remotion 4.0.538 (`remotion`, `@remotion/cli`, `@remotion/bundler`, `@remotion/renderer`, `@remotion/google-fonts`), Zod 3.25.76, Vitest 3.2.4, pngjs 7.0.0, pixelmatch 7.1.0.

**Spec:** `docs/superpowers/specs/2026-10-24-docu-motion-design.md` (sections 2.1, 2.2, 6, 8 are the ones this plan implements). The skill's kit to port: `C:\Users\sami_\Downloads\skill-documentaire-motion-design\documentaire-motion-design\SKILL.md` ("Kit : fichiers du projet").

**Roadmap (later plans, not in this one):** 2 AI pipeline · 3 voice + export · 4 server + web UI · 5 Docker, CI, release.

## Global Constraints

- Pin all Remotion packages to exactly `4.0.538`; React/react-dom `19.1.0`.
- Dependency direction: `core → scenes`; `scenes` imports nothing from `core`.
- Video: 1920×1080, 30 fps. Thumbnail compositions (Plan 3) will be 1280×720.
- Safe area for scene content: y 260–880, inside the frame rect x 30–1890, y 30–1050. The scene title (`Label`) sits near y=150, subtitles at the bottom.
- Scene duration with audio = audio seconds + 1.2 s, rounded up to frames. Without audio = `ceil((words / 2.4 + 1.5) * 30)`.
- Styles: `papier` (default, Fredoka), `craie` (Caveat), `infographie` (Poppins), `nuit` (Space Grotesk). Colour values copied verbatim from the skill's `theme.ts`.
- Code identifiers in English; on-screen strings come from project data, never hard-coded French.
- `project.json` carries `version: 1`; every write first copies the previous file to `project.json.bak`.
- Paths may contain spaces and non-ASCII characters (the author's own is `D:\Sami\perso`).

## Review Focus

1. **Cue word not found literally** (different case, accents, punctuation, e.g. cue "Sécu" vs narration "sécu,"): the element still appears at the right time, or it falls back to a stagger. It must never be invisible or appear at frame 0 for every element. Pinned in Task 3.
2. **Over-long strings in scene data** (60-character bar labels, 200-character titles): rejected by the schema with a readable error instead of overflowing the frame. Pinned in Task 4.
3. **Hand-edited or wrong-version `project.json`**: loading fails with a message that names the JSON path of the bad field and the file, and never overwrites the file. Pinned in Task 1.
4. **Scene whose audio file is missing on disk**: the render still succeeds, that scene is silent, and the probe reports the actual result. Pinned in Task 6.
5. **Project directory with spaces/accents** (`tmp/mon projet é/`): bundle, still and video all work. Pinned in Task 6.

---

### Task 1: Monorepo scaffold + project model

**Files:**
- Create: `package.json` (root, workspaces `packages/*`, scripts `test`, `typecheck`, `test:visual`), `tsconfig.base.json`, `vitest.workspace.ts`, `.gitignore` (`node_modules`, `dist`, `data`, `out`, `*.mp4`, `.env`), `.nvmrc` (`20`)
- Create: `packages/scenes/package.json` (name `@docu-motion/scenes`), `packages/scenes/tsconfig.json`
- Create: `packages/core/package.json` (name `@docu-motion/core`), `packages/core/tsconfig.json`
- Create: `packages/core/src/project/schema.ts`, `packages/core/src/project/store.ts`
- Test: `packages/core/test/project/store.test.ts`

**Interfaces:**
- Produces (`schema.ts`): `ProjectSchema` (Zod) and `type Project = z.infer<typeof ProjectSchema>`, exactly the shape in spec §2.2. In this task `scenes[].spec` is `z.unknown()`; Task 4 swaps it for `SceneSpecSchema`. `StyleName = 'papier' | 'craie' | 'infographie' | 'nuit'`. `ProviderRef = {kind: 'api' | 'cli' | 'fake'; provider: string; model?: string}`.
- Produces (`store.ts`):
  - `loadProject(dir: string): Promise<Project>`
  - `saveProject(dir: string, p: Project): Promise<void>` writes `project.json` atomically (tmp file + rename) after copying the old file to `project.json.bak`.
  - `class ProjectLoadError extends Error { file: string; issues: {path: string; message: string}[] }`
  - `PROJECT_VERSION = 1`

- [ ] **Step 1: Write failing tests** in `store.test.ts`, using a fresh temp dir per test (`fs.mkdtemp`):
  - `round-trips a valid project`: save then load gives a deep-equal result.
  - `keeps a backup`: save A, save B, then `project.json.bak` parses to A.
  - `rejects wrong version`: `version: 2` throws `ProjectLoadError` with an issue whose `path === 'version'`.
  - `names the bad field`: `scenes[0].durationFrames = "x"` gives an issue with `path === 'scenes.0.durationFrames'`, and the error message contains the file path.
  - `does not touch an invalid file`: after a failed load, the file bytes are unchanged and no `.bak` was written.
- [ ] **Step 2:** Run `npm install && npx vitest run packages/core/test/project`. Expected: FAIL (modules missing).
- [ ] **Step 3:** Implement `schema.ts` and `store.ts`. Issue paths are Zod `issue.path.join('.')`.
- [ ] **Step 4:** Run `npx vitest run packages/core/test/project && npm run typecheck`. Expected: PASS, 5 tests.
- [ ] **Step 5:** Commit: `git add -A && git commit -m "feat(core): monorepo scaffold and project.json model"`

### Task 2: Themed visual kit

**Files:**
- Create: `packages/scenes/src/theme.ts`, `packages/scenes/src/kit.tsx`
- Test: `packages/scenes/test/theme.test.ts`

**Interfaces:**
- Produces (`theme.ts`):
  - `type Theme = {name: StyleName; colors: Palette; filter: 'papier' | 'craie' | 'plat' | 'lueur'; font: string}`. `Palette` has the keys of the skill's `PAPIER` object, with the same names (`creme`, `ciel`, … `accent`), so the colours can be checked against the skill.
  - `getTheme(style: string | undefined): Theme` returns `papier` for unknown or undefined input. It loads Google fonts with subsets `['latin', 'latin-ext']`.
  - `ThemeProvider: React.FC<{style: StyleName; children}>`, `useTheme(): Theme`
- Produces (`kit.tsx`): the skill's `papier.tsx` components, renamed, reading colours and font from `useTheme()` instead of module constants. Same props, same visual output:
  `StyleDefs` (was DefsPapier, filter id stays `papier`), `useSpringIn(delay, bounce = true)` (was useRessort), `Pop`, `Slide` (was Glisse; props `dx, dy, delay`), `Label` (was Etiquette; props `title, text?, x?, y?, delay?, width?`), `Character` (was Personnage; `elderly` for vieux), `Coin` (was Piece), `Sun`, `Cloud`, `Sea`, `Drop` (was Goutte), `Hills` (was Collines), `Background` (was Fond), `Canvas` (was Toile), `Text` (was Texte; `onBackground` for surFond, `bold` for gras, `anchor`, `opacity`, `size`, `color`), `clampInterp(f, a, b)` (was interp), `arc(cx, cy, R, r, a0, a1)` (from the skill's example scenes).
  Every prop called `delai` becomes `delay`.

- [ ] **Step 1: Write failing tests** in `theme.test.ts`:
  - `getTheme('craie').colors.ciel === '#2f4a3c'`, `getTheme('nuit').colors.texteFond === '#eef1ff'`, `getTheme('infographie').filter === 'plat'`
  - `getTheme('nope').name === 'papier'` and `getTheme(undefined).name === 'papier'`
  - every style's palette has exactly the key set of `papier`'s
- [ ] **Step 2:** Run `npx vitest run packages/scenes/test/theme.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `theme.ts` (colours verbatim from the skill) and port `kit.tsx`.
- [ ] **Step 4:** Run the tests + `npm run typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(scenes): themed visual kit ported from the skill`

### Task 3: Cue timing

**Files:**
- Create: `packages/scenes/src/timing.ts`
- Test: `packages/scenes/test/timing.test.ts`

**Interfaces:**
- Produces:
  - `cueFrame(narration: string, cue: string | undefined, durationFrames: number, fallbackIndex: number): number`
  - `estimateDurationFrames(text: string): number`, i.e. `ceil((words / 2.4 + 1.5) * 30)`
  - `durationFromAudio(seconds: number): number`, i.e. `ceil((seconds + 1.2) * 30)`

Algorithm: normalise both strings (NFD, strip combining marks, lowercase, collapse whitespace). If the cue is found at normalised index `i`, return `round(i / len * (durationFrames - 15) * 0.85)` (the skill's formula). If the cue is absent or not found, return `15 + fallbackIndex * 12`, clamped to `durationFrames - 20`.

- [ ] **Step 1: Write failing tests:**
  - cue `"TVA"` in `"… la CSG, puis la TVA."` (length 100, index 80, 300 frames) returns `round(80/100*285*0.85)` (= 194)
  - `cueFrame("La sécu, c'est…", "Sécu", 300, 0)` returns the same value as the exact-match `"sécu"`
  - missing cue: `fallbackIndex` 0, 1, 2 give 15, 27, 39; with `durationFrames = 40` and index 5 the result is clamped to 20
  - `cue = undefined` takes the fallback path
  - `estimateDurationFrames` on 24 words gives `ceil((10 + 1.5) * 30)` = 345; `durationFromAudio(10)` gives 336
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(scenes): cue timing with accent-insensitive matching and fallback`

### Task 4: Scene schemas and registry

**Files:**
- Create: `packages/scenes/src/types/<type>.schema.ts` for each of `title, bars, donut, counter, pictograms, comparison, quote, timeline, list`
- Create: `packages/scenes/src/types/examples.ts`, `packages/scenes/src/schema.ts`
- Modify: `packages/core/src/project/schema.ts` (`scenes[].spec` becomes `SceneSpecSchema`)
- Test: `packages/scenes/test/schema.test.ts`

**Interfaces:**
- Produces (`schema.ts`): `SceneSpecSchema` = `z.discriminatedUnion('type', [...])`, `type SceneSpec`, `SCENE_TYPES: readonly SceneType[]`, `EXAMPLES: Record<SceneType, SceneSpec>`.
- Shared fields: `title: string ≤ 48` (scene heading shown in `Label`), optional `source: string ≤ 80`.
- Each element that appears in sequence has an optional `cue: string ≤ 40`.
- Field limits (these values are a decision of this plan, sized to the 1920 px safe area at the kit's font sizes):

| Type | Fields |
|---|---|
| title | `title ≤ 48`, `subtitle? ≤ 70`, `decor: 'hills' \| 'sea' \| 'none'`, `characters: 0–6` |
| bars | `bars: 2–8 × {label ≤ 18, value: number ≥ 0, cue?}`, `unit? ≤ 8` |
| donut | `parts: 2–6 × {label ≤ 26, value > 0, cue?}`, values sum to 100 ± 0.5 (refine) |
| counter | `value: number`, `prefix? ≤ 4`, `suffix? ≤ 10`, `label ≤ 60`, `cue?` |
| pictograms | `groups: 1–2 × {label ≤ 24, count 1–12, elderly: boolean, ratio? ≤ 8, cue?}` |
| comparison | `left`, `right`: `{heading ≤ 24, value ≤ 12, caption? ≤ 40, cue?}` |
| quote | `text ≤ 180`, `author ≤ 40` |
| timeline | `events: 3–6 × {date ≤ 10, label ≤ 28, cue?}` |
| list | `items: 2–5 × {text ≤ 60, icon: 'coin' \| 'drop' \| 'sun' \| 'cloud' \| 'character' \| 'none', cue?}` |

- [ ] **Step 1: Write failing tests:**
  - every `EXAMPLES[t]` parses, and `SCENE_TYPES.length === 9`
  - a donut with parts summing to 90 fails with an issue on `parts`
  - a bars label of 19 characters fails at path `bars.0.label`; 1 bar or 9 bars fail
  - a title of 49 characters fails
  - an unknown `type: 'map'` fails
  - `ProjectSchema` accepts a project whose scenes use every example
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement the schemas and examples. Examples use realistic data, including the skill's Sécu figures (49/20/13/8/10 donut; 2.5 vs 1.6 pictograms).
- [ ] **Step 4:** Run the tests + `npm run typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(scenes): scene type schemas with layout-safe limits`

### Task 5: Film composition and Remotion entry

**Files:**
- Create: `packages/scenes/src/film/Film.tsx`, `packages/scenes/src/film/Subtitles.tsx`, `packages/scenes/src/film/SceneView.tsx`, `packages/scenes/src/Root.tsx`, `packages/scenes/src/index.ts` (calls `registerRoot`), `packages/scenes/src/lib.ts` (public exports for other packages)
- Create: placeholder `packages/scenes/src/types/<type>.tsx` for all 9 (each renders `Canvas` + `Background` + `Label` of `spec.title`; Task 7 replaces them)
- Test: `packages/scenes/test/film.test.ts`

**Interfaces:**
- Consumes: Task 1 `Project`, which is re-declared structurally here as `FilmInput` so `scenes` doesn't depend on `core`; Task 2 kit; Task 3 timing; Task 4 `SceneSpec`.
- Produces:
  - `type FilmInput = {style: StyleName; subtitles: boolean; assetBase: string | null; scenes: {id: string; narration: string; spec: SceneSpec; durationFrames: number; audioPath?: string}[]}`
  - `type SceneProps<S> = {spec: S; narration: string; durationFrames: number; index: number}`
  - `SCENE_COMPONENTS: Record<SceneType, React.FC<SceneProps<any>>>`
  - `calculateFilmMetadata: CalculateMetadataFunction<FilmInput>` returns `durationInFrames = Σ durationFrames` (minimum 1)
  - Compositions registered in `Root.tsx`: id `Film` (1920×1080, 30 fps), id `SceneStill`, whose props are `FilmInput & {sceneIndex: number}` and which renders a single scene for stills
  - Audio URL rule: `assetBase === null` gives `staticFile(audioPath)`, otherwise `` `${assetBase}/${audioPath}` ``
- Film behaviour: copied from the skill's `moteur/film.tsx`. That covers `Series`, the 10-frame fade in/out, sentence-proportional subtitles and `Html5Audio` per scene when `audioPath` is set, all wrapped in `ThemeProvider`.

- [ ] **Step 1: Write failing tests** (plain functions, no browser):
  - `calculateFilmMetadata` with durations `[90, 120]` gives `durationInFrames === 210`
  - empty scenes give `1`
  - `SCENE_COMPONENTS` has a key for every entry of `SCENE_TYPES`
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests + `npm run typecheck`. Then run `npx remotion compositions packages/scenes/src/index.ts`. Expected: lists `Film` and `SceneStill`.
- [ ] **Step 5:** Commit: `feat(scenes): film composition driven by project props`

### Task 6: Render module

**Files:**
- Create: `packages/core/src/render/bundle.ts`, `packages/core/src/render/render.ts`, `packages/core/src/render/probe.ts`, `packages/core/src/render/toFilmInput.ts`
- Create fixture: `packages/core/test/fixtures/tone.mp3` (2 s 440 Hz, generated once with `npx remotion ffmpeg -f lavfi -i sine=frequency=440:duration=2 tone.mp3`)
- Test: `packages/core/test/render/render.test.ts` (in the `visual` Vitest project: slow, needs Chrome)

**Interfaces:**
- Consumes: Task 1 `Project`; Task 5 `FilmInput`, composition ids `Film` and `SceneStill`.
- Produces:
  - `toFilmInput(p: Project, projectDir: string, assetBase: string | null): FilmInput`. It drops `audioPath` for any scene whose `audio.path` file doesn't exist, and logs a warning naming the scene id.
  - `bundleScenes(publicDir: string): Promise<string>` uses `@remotion/bundler` `bundle()` with the entry `packages/scenes/src/index.ts` and `publicDir` = the project dir. Results are cached per publicDir for the process.
  - `renderSceneStill(projectDir: string, p: Project, sceneIndex: number, atRatio = 0.8): Promise<string>`, which writes `out/stills/<sceneId>.png`
  - `renderVideo(projectDir: string, p: Project, opts?: {onProgress?: (r: number) => void; signal?: AbortSignal; concurrency?: number}): Promise<string>`, which writes `out/video.mp4`. It uses `selectComposition` + `renderMedia` with codec `h264`, and passes `signal` through Remotion's `cancelSignal` (`makeCancelSignal`).
  - `probeMedia(file: string): Promise<{durationSeconds: number; hasAudio: boolean; width: number; height: number}>`. It spawns `npx remotion ffprobe -v error -show_streams -show_format -of json <file>` and parses the JSON.

- [ ] **Step 1: Write failing tests** (each test copies the fixture project into a temp dir named `mon projet é` to cover Review Focus 5):
  - `renders a still per scene`: a 2-scene project (title + bars examples) gives 2 PNGs of 1920×1080 (read with pngjs)
  - `renders a video with audio`: scene 0 has `audio.path = 'voice/s0.mp3'` (tone fixture, `durationFrames = durationFromAudio(2)`), scene 1 has none. `probeMedia` reports `hasAudio === true`, `width === 1920`, and `durationSeconds` within 0.1 s of `(96 + d1) / 30` (`durationFromAudio(2)` = 96)
  - `missing audio is silent, not fatal`: `audio.path` points at a missing file, the render succeeds and `hasAudio === false`
  - `cancels`: aborting after the first progress callback rejects with an error whose message matches `/cancel/i`
- [ ] **Step 2:** Run `npm run test:visual -- render`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: PASS (allow ~2 min).
- [ ] **Step 5:** Commit: `feat(core): render stills, video and probe from project.json`

### Task 7: The 9 scene components + visual snapshots

**Files:**
- Modify: `packages/scenes/src/types/<type>.tsx` (replace the placeholders)
- Create: `packages/core/test/render/snapshots.test.ts`, `packages/core/test/render/__snapshots__/<type>-<style>.png` (36 files, recorded once)
- Create: `scripts/contact-sheet.ts` (assembles the stills of a project into one PNG grid for eyeballing: `npm run sheet -- <projectDir>`)

**Interfaces:**
- Consumes: Task 2 kit, Task 3 `cueFrame(narration, el.cue, durationFrames, i)` for every sequenced element, Task 4 types, Task 6 `renderSceneStill`.
- Produces: real components in `SCENE_COMPONENTS`. Layout follows the skill's examples:
  - `Label` at y=150
  - content within y 260–880
  - `Source: <source>` bottom right at (1850, 880), size 24, `onBackground`, opacity 0.75
  - `bars` heights interpolated over 20 frames from the cue frame
  - `donut` uses `arc` with each part sweeping in from its cue frame (the skill's `Financement`)
  - `counter` interpolates 0 → value over 30 frames, formatted with `Intl.NumberFormat(locale)`, where `locale` is a new `FilmInput.language` field (add it, default `'fr'`; `toFilmInput` fills it from `brief.language`)
  - `pictograms` uses the skill's `Panneau` layout with one or two cards
  - `title` uses `Hills` / `Sea` and characters popping in as in the skill's `Titre`
  - `timeline` dots on a horizontal line at y=560
  - `list` cards stacked from y=300
  - `quote` a large card with the author line
  - `comparison` two cards at x=540 / 1380

- [ ] **Step 1: Write the snapshot test**: for each type × style, render `EXAMPLES[type]` with a 300-frame duration at ratio 0.8, then compare with pixelmatch (threshold 0.1) against the stored PNG. Fail if more than 0.5% of pixels differ. When `UPDATE_SNAPSHOTS=1`, or the file is missing, write the PNG and pass. Add one more test, `layout stays inside frame`: for every example, assert there are no non-background pixels in the 30 px border band. Do this by comparing the border band with the same render of `Background` alone.
- [ ] **Step 2:** Run with the placeholders. Expected: the border test passes, and snapshots get recorded. **Delete the recorded snapshots**: they're placeholders.
- [ ] **Step 3:** Implement the 9 components.
- [ ] **Step 4:** Run `UPDATE_SNAPSHOTS=1 npm run test:visual -- snapshots`, then `npm run sheet` on a project built from all 9 examples, once per style. **Open the 4 contact sheets and look at them.** Check for overlaps, text overflowing, legibility in `craie` and `nuit`, and colours that match the skill. Fix, re-record and look again. Then run without `UPDATE_SNAPSHOTS`. Expected: PASS, 37 tests.
- [ ] **Step 5:** Commit: `feat(scenes): nine scene types with visual snapshots`

### Task 8: Demo project, CLI render script, README, public repo

**Files:**
- Create: `examples/secu/project.json` (10 scenes covering all 9 types, narration from the skill's example + plausible extra scenes, `voice.engine: 'none'`)
- Create: `scripts/render-project.ts` (`npm run render -- <projectDir> [--style craie]`: loads, applies the style override, renders the video, probes, and prints `OK <path> <duration>s audio=<bool>`; exits 1 with the `ProjectLoadError` issues on bad input)
- Create: `README.md` (what it is, status "Plan 1 of 5: rendering engine", requirements, `npm install`, `npm run render -- examples/secu`, link to the skill repo and the spec), `LICENSE` (MIT, "Copyright (c) 2026 Sami"), `CONTRIBUTING.md` (short, like the skill repo's)
- Test: `packages/core/test/render/demo.test.ts` (visual project)

**Interfaces:**
- Consumes: Task 1 `loadProject`, `ProjectLoadError`; Task 6 `renderVideo`, `probeMedia`.

- [ ] **Step 1: Write failing tests:**
  - `demo project validates`: `loadProject('examples/secu')` succeeds
  - `render script reports bad input`: running the script on a temp dir with `version: 2` exits with code 1, and stderr contains `version`
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement the demo project, the script and the docs.
- [ ] **Step 4:** Run `npm test && npm run test:visual && npm run render -- examples/secu --style nuit`. Expected: all PASS and an `OK … audio=false` line. Open the MP4 and watch it.
- [ ] **Step 5:** Commit, then publish:
  ```bash
  git add -A && git commit -m "feat: demo project, render script and docs"
  gh repo create Sami-Fd/docu-motion --public --source=. --push \
    --description "Self-hosted app that turns a topic into a coded motion-design documentary video (Remotion) with any LLM provider"
  gh repo edit Sami-Fd/docu-motion --add-topic remotion,motion-design,video,llm,claude,openai,ollama
  ```
  Expected: `gh repo view Sami-Fd/docu-motion --json visibility` prints `PUBLIC`.
