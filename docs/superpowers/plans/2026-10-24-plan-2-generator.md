# docu-motion — Plan 2: Automatic Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `npm run make -- "<topic>" --style craie` turns a topic into a finished, silent 1920×1080 MP4 with no further input, using any configured LLM provider. It runs sources → facts → script → scenes → voice (`none`) → layout → render, with checkpoints so a rerun resumes where it stopped.

**Architecture:** `packages/core` gains four areas:
- `settings/`: config file + `.env`.
- `llm/`: the provider interface, a validation and retry wrapper, AI SDK and CLI adapters, and a fake provider.
- `research/`: ingestion, web search, facts.
- `generate/`: project creation, one module per step, the orchestrator.

Each step is a pure-ish function `(project, ctx) => Promise<Project>`. The orchestrator saves `project.json` after each step. A thin `scripts/make.ts` drives it. Rendering reuses Plan 1's render module unchanged.

**Tech Stack:** Plan 1 stack plus `ai` 7.0.152, `@ai-sdk/anthropic` 4.0.87, `@ai-sdk/openai` 4.0.101, `@ai-sdk/google` 4.0.104, `@ai-sdk/mistral` 4.0.71, `@ai-sdk/openai-compatible` 3.0.77 (Ollama via its OpenAI-compatible API), `@openrouter/ai-sdk-provider` 3.1.0, `@mozilla/readability` 0.6.0, `linkedom` 0.18.14, `unpdf` 1.9.1.

**Spec:** `docs/superpowers/specs/2026-10-24-docu-motion-design.md` (revised). This plan implements §2.2 (model additions), §3, §4.1 steps 1–7 with voice `none`, §4.3, §6 rows that apply, §8 core/e2e. Plan 1: `docs/superpowers/plans/2026-10-24-plan-1-foundation.md`.

**Branch:** `plan-2-generator`, created from the head of `plan-1-foundation` after its final-review fixes are committed, or from `main` if Plan 1 is merged by then.

## Global Constraints

- Plan 1 constraints still hold: Remotion 4.0.538, React 19.1.0, Zod 3.25.76 (do not upgrade), dependency direction `core → scenes`, paths with spaces and accents.
- Pin every new dependency to the exact version in Tech Stack.
- Unit tests never touch the network. `fetch`, the LLM, the clock and `sleep` are injected. Real-provider calls happen only in manual checks.
- API keys are sent only to their own provider and never appear in logs, thrown error messages or `project.json`. Every error from a provider adapter passes through `redact()`.
- CLI providers never read, copy or log the CLI's own credentials. They only run the installed binary.
- The validation loop allows 3 retries after the first attempt, with the Zod issues appended to the prompt. Transient errors (HTTP 429, HTTP ≥ 500, timeouts, `ECONNRESET`) get 2 retries with backoff of 1 s and then 4 s.
- Script: scene count `n = clamp(round(targetMinutes * 60 / 16), 8, 12)`, 25–45 words per scene. The spec fixes 8–12 scenes, so long targets are capped at about 4 min. This is a known spec limit; do not exceed it.
- `project.json` stays `version: 1`. New fields are optional or have defaults, so Plan 1 projects such as `examples/secu` still load.
- Generator steps in order: `sources, facts, script, scenes, voice, layout, render`. The spec's `package` step is Plan 3. The `voice` step supports only engine `none` here. Any other engine fails with `Voice engine "<x>" arrives in Plan 3`.
- On-screen and spoken text comes from the LLM in `brief.language`. Prompts are written in English and state the output language.

## Review Focus

1. **Model output wrapped in prose or markdown fences** (small models, CLIs: "Here is the JSON: ```json {…}``` Hope this helps") is extracted and parsed. Several JSON blocks: the first valid one is used. No JSON at all is a validation failure that counts toward the retries, not a crash. Pinned in Task 2.
2. **A source URL that hangs, returns 404, serves a 50 MB file or a binary** keeps the source with `error` set. Other sources proceed, and no fetch takes more than 15 s or reads more than 5 MB. Pinned in Task 5.
3. **An excerpt that differs from the source only by whitespace, quote style (’ vs ') or case** is still `verified: true`. An invented excerpt is `verified: false`. Pinned in Task 7.
4. **The process is killed after step N** (Ctrl+C, crash, power cut). Rerunning `make` on the same project resumes at step N+1 and makes no LLM call for finished steps. A cancelled run is not recorded as failed. Pinned in Task 11.
5. **A topic with accents, emoji, slashes, or 200 characters** gives a project folder name that is valid on Windows, ASCII, ≤ 48 characters and unique per run. Pinned in Task 1.

---

### Task 1: Project model additions + project creation

**Files:**
- Modify: `packages/core/src/project/schema.ts`
- Create: `packages/core/src/generate/createProject.ts`
- Test: `packages/core/test/project/schema-v1-additions.test.ts`, `packages/core/test/generate/createProject.test.ts`

**Interfaces:**
- Consumes: Plan 1 `ProjectSchema`, `saveProject`, `loadProject`; scenes `estimateDurationFrames`.
- Produces:
  - `STEP_NAMES = ['sources','facts','script','scenes','voice','layout','render'] as const`, `type StepName`.
  - Scene fields: `factIds: string[]` (default `[]`), `warnings: string[]` (default `[]`), `dirty?: boolean`.
  - Project fields:
    - `progress: {done: StepName[]; failed?: {step: StepName; message: string}}`, default `{done: []}`.
    - `brief.sources: string[]` (default `[]`): user URLs, and file paths relative to the project dir.
  - `scenes` may be empty (`[]`) before the script step.
  - `type NewProjectInput = {topic: string; style: StyleName; language: string; targetMinutes: number; provider: ProviderRef; webSearch: 'off'|'native'|'tavily'|'brave'; sources: string[]; voice: Project['voice']}`.
  - `createProject(dataDir: string, input: NewProjectInput, now?: Date): Promise<string>`:
    - Creates `<dataDir>/projects/<slug>-<stamp>/`.
    - Copies each existing local file in `input.sources` into `sources/upload/<basename>` and rewrites its entry to that relative path.
    - Saves `project.json` with empty sources, facts and scenes and `progress.done = []`.
    - Returns the dir.
  - `slugify(topic: string): string`: NFD, strip combining marks, lowercase, runs of non-`[a-z0-9]` become `-`, trim `-`, cut to 32 characters on a `-` boundary when possible. An empty result becomes `video`.
  - `stamp`: `YYYYMMDD-HHMMSS` from `now`. If the dir exists, append `-2`, `-3`…

- [ ] **Step 1: Write failing tests**
  - `loads a Plan 1 project`: `loadProject('examples/secu')` succeeds. Scenes get `factIds: []` and `warnings: []`, and `progress.done` is `[]`.
  - `slugify`:
    - `"Qui finance la Sécu ?"` → `"qui-finance-la-secu"`
    - `"🎬/\\:*?"` → `"video"`
    - A 200-character topic gives a slug of ≤ 32 characters with no trailing `-`.
  - `createProject` in a temp dir named `données é`:
    - The folder name matches `/^[a-z0-9-]{1,48}$/` and `project.json` loads.
    - Two calls with the same `now` give two different dirs.
    - A source file path is copied into `sources/upload/`, and a URL source is kept as is.
- [ ] **Step 2:** Run `npx vitest run packages/core/test/project packages/core/test/generate`. Expected: FAIL.
- [ ] **Step 3:** Implement the schema additions (`.default(...)`, so old files parse) and `createProject.ts`.
- [ ] **Step 4:** Run the same tests plus `npm test` and `npm run typecheck`. Expected: PASS. Existing Plan 1 tests are unchanged.
- [ ] **Step 5:** Commit `feat(core): generator fields in project model and project creation`.

### Task 2: Settings, provider interface, validation loop, fake provider

**Files:**
- Create: `packages/core/src/settings/settings.ts`, `packages/core/src/llm/types.ts`, `packages/core/src/llm/json.ts`, `packages/core/src/llm/makeProvider.ts`, `packages/core/src/llm/fake.ts`, `packages/core/src/llm/redact.ts`
- Test: `packages/core/test/llm/json.test.ts`, `packages/core/test/llm/makeProvider.test.ts`, `packages/core/test/settings/settings.test.ts`

**Interfaces:**
- Produces:
  - Settings:
    - `SettingsSchema` (Zod) and `type Settings`, with defaults:
      ```ts
      {provider: ProviderRef;
       keys: {anthropic?, openai?, google?, mistral?, openrouter?, tavily?, brave?, elevenlabs?: string};
       ollamaBaseUrl: string;   // default 'http://localhost:11434/v1'
       defaultLanguage: string; // default 'fr'
       search: 'auto' | 'native' | 'tavily' | 'brave' | 'off'} // default 'auto'
      ```
    - `loadSettings(dataDir: string, env = process.env): Promise<Settings>` reads `<dataDir>/config.json` if present. Env vars `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `MISTRAL_API_KEY`, `OPENROUTER_API_KEY`, `TAVILY_API_KEY`, `BRAVE_API_KEY` and `OLLAMA_BASE_URL` override file values.
    - `saveSettings(dataDir, s)` writes `config.json`.
    - `defaultDataDir(): string` is `process.env.DOCU_MOTION_DATA ?? <repo>/data`.
  - `llm/types.ts`: the spec §3 interface, verbatim:
    ```ts
    interface LlmProvider {
      generateObject<T>(args: {schema: ZodType<T>; system: string; prompt: string; signal?: AbortSignal}): Promise<T>;
      generateText(args: {system: string; prompt: string; signal?: AbortSignal}): Promise<string>;
      capabilities: {nativeWebSearch: boolean; vision: boolean};
      name: string; // e.g. 'anthropic:claude-…'
    }
    ```
    - `class LlmOutputError extends Error {issues: string[]; raw: string}` is thrown after the retries run out.
    - `class ProviderError extends Error {provider: string; transient: boolean; status?: number}`.
  - `extractJson(text: string): unknown | undefined` (`json.ts`): returns the first parseable JSON object or array found in the text. Candidates are fenced blocks first, then balanced `{…}`/`[…]` spans in order.
  - `makeProvider(raw: RawProvider, opts?: {sleep?: (ms) => Promise<void>}): LlmProvider` where:
    ```ts
    type RawProvider = {
      name: string;
      capabilities: LlmProvider['capabilities'];
      object(args: {jsonSchema: object; schemaName: string; system: string; prompt: string; signal?}): Promise<unknown>; // parsed JSON or raw text
      text(args: {system; prompt; signal?}): Promise<string>;
    };
    ```
    `makeProvider` owns both retry loops:
    - **Validation:** a string result goes through `extractJson`, then `schema.safeParse`. On failure it calls again with the prompt plus `\n\nYour previous answer was invalid:\n- <issue path>: <message>…\nReturn only corrected JSON.` It retries up to 3 times, then throws `LlmOutputError`.
    - **Transient:** a `ProviderError` with `transient: true` is retried 2 times after `sleep(1000)` and then `sleep(4000)`.
    - The JSON schema comes from `zod-to-json-schema` (pin the version that `ai` 7.0.152 already depends on, or use `ai`'s `zodSchema()` helper if it is exported).
  - `redact(message: string, secrets: string[]): string` replaces every secret of 8 or more characters with `***`.
  - `createFakeProvider(responder: (req: {schema: ZodType; system: string; prompt: string}) => unknown | string): LlmProvider` builds on `makeProvider` with zero sleep. `capabilities` defaults to `{nativeWebSearch: false, vision: false}`.

- [ ] **Step 1: Write failing tests**
  - `extractJson`:
    - `'Here: ```json\n{"a":1}\n``` thanks'` → `{a: 1}`
    - `'x {"a":1} y {"b":2}'` → `{a: 1}`
    - `'[1,2]'` → `[1, 2]`
    - `'no json'` → `undefined`
    - `'{"a": "}"}'` → `{a: '}'}` (braces inside strings)
  - Validation loop with a responder that returns, in order, `'garbage'`, `{n: 'x'}`, `{n: 3}` against `z.object({n: z.number()})`:
    - The result is `{n: 3}`.
    - The 3rd prompt contains `n: Expected number`.
    - A responder that is always invalid throws `LlmOutputError` after exactly 4 calls.
  - Transient retry: a raw provider throws `ProviderError({transient: true, status: 429})` twice, then succeeds. The sleeps recorded are `[1000, 4000]`. A third transient failure rethrows. A non-transient error is not retried.
  - `redact('bad key sk-abcdef123456 here', ['sk-abcdef123456'])` → `'bad key *** here'`.
  - Settings:
    - With no `config.json`, defaults apply.
    - `OPENAI_API_KEY=k` in env shows up in `keys.openai`.
    - `saveSettings` followed by `loadSettings` round-trips.
- [ ] **Step 2:** Run `npx vitest run packages/core/test/llm packages/core/test/settings`. Expected: FAIL.
- [ ] **Step 3:** Implement the files.
- [ ] **Step 4:** Same command plus `npm run typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(core): settings and LLM provider core with validation and retry`.

### Task 3: API providers (AI SDK) + connection test

**Files:**
- Create: `packages/core/src/llm/aiSdk.ts`, `packages/core/src/llm/registry.ts`
- Test: `packages/core/test/llm/aiSdk.test.ts`, `packages/core/test/llm/registry.test.ts`

**Interfaces:**
- Consumes: Task 2 `makeProvider`, `RawProvider`, `ProviderError`, `redact`, `Settings`.
- Produces:
  - `createApiProvider(ref: ProviderRef, settings: Settings, deps?: {languageModel?: LanguageModel}): LlmProvider` for `ref.provider` ∈ `anthropic | openai | google | mistral | openrouter | ollama`. `ollama` goes through `@ai-sdk/openai-compatible` with `baseURL = settings.ollamaBaseUrl`.
    - Default models when `ref.model` is unset: anthropic `claude-sonnet-5-5`, openai `gpt-5.1`, google `gemini-2.5-flash`, mistral `mistral-large-latest`, openrouter `anthropic/claude-sonnet-5-5`, ollama `qwen3:14b`. Put these in one `DEFAULT_MODELS` map.
    - `object()`: uses `generateObject` from `ai` with the JSON schema. If the AI SDK throws a no-object or JSON-parse error, it falls back to `generateText` with the schema in the prompt and returns the text, which `makeProvider` then extracts and validates.
    - Errors: AI SDK `APICallError`s map to `ProviderError`, with `transient` set for 429, ≥ 500, timeout and network errors. Messages pass through `redact` with all configured keys.
    - `capabilities.nativeWebSearch` is `true` for `anthropic`, `openai` and `google`, `false` otherwise.
    - A missing key throws `ProviderError('<Provider> API key missing — add it in Settings or <ENV_VAR>', transient: false)`.
  - `createProvider(ref: ProviderRef, settings: Settings): LlmProvider` dispatches: `kind: 'api'` → `createApiProvider`, `'cli'` → Task 4, `'fake'` → the `demoResponder` fake (Task 11).
  - `testConnection(p: LlmProvider): Promise<{ok: true; ms: number} | {ok: false; message: string}>` makes one `generateObject` call with `z.object({ok: z.literal(true)})`.

- [ ] **Step 1: Write failing tests** using `MockLanguageModelV…` from `ai/test` (the class that matches `ai` 7's provider spec) injected through `deps.languageModel`:
  - `object()` returns the parsed object when the mock emits valid JSON.
  - When the mock's structured call fails but the text contains fenced JSON, the result validates through `makeProvider`.
  - A mock that throws `APICallError` with status 429 twice, then succeeds, returns the result.
  - A 401 whose message contains the key gives a `ProviderError` whose message does not contain the key.
  - `createApiProvider({kind: 'api', provider: 'openai'}, settingsWithoutKeys)` throws a message naming `OPENAI_API_KEY`.
  - The registry: `createProvider` with `kind: 'fake'` returns a provider whose name starts with `fake`.
- [ ] **Step 2:** Run `npx vitest run packages/core/test/llm`. Expected: FAIL.
- [ ] **Step 3:** Implement. Read the installed `ai` 7 type definitions for the exact `generateObject` and `generateText` options; do not guess them from older AI SDK versions.
- [ ] **Step 4:** Same command plus `npm run typecheck`. Expected: PASS. Manual check, if a key is available: `npx tsx scripts/make.ts --check` after Task 12 (not required here).
- [ ] **Step 5:** Commit `feat(core): AI SDK providers and provider registry`.

### Task 4: CLI providers (experimental)

**Files:**
- Create: `packages/core/src/llm/cli.ts`
- Test: `packages/core/test/llm/cli.test.ts`, fixture `packages/core/test/fixtures/fake-cli.mjs`

**Interfaces:**
- Consumes: Task 2 `makeProvider`, `ProviderError`.
- Produces: `createCliProvider(ref: ProviderRef, deps?: {command?: string; args?: string[]}): LlmProvider` for `ref.provider` ∈ `claude | codex | gemini`.
  - Commands:
    - claude: `claude -p --output-format json` with the prompt on stdin. The `result` field of the JSON output is the text.
    - codex: `codex exec -` with the prompt on stdin. stdout is the text.
    - gemini: `gemini -p` with the prompt on stdin. stdout is the text.
  - Spawned without a shell (`spawn(cmd, args, {shell: false})`, with `.cmd` resolution on win32 through `where`). Timeout 300 s, killed on abort.
  - `object()` sends `system + prompt + "\n\nReply with only JSON matching this JSON Schema:\n" + JSON.stringify(jsonSchema)` and returns the text for `makeProvider` to extract.
  - `ENOENT` → `ProviderError('<cli> not found — install it and sign in, see README', transient: false)`. A non-zero exit → `ProviderError` with the last 300 characters of stderr.
  - `capabilities = {nativeWebSearch: false, vision: false}`. `name = 'cli:<provider>'`.

- [ ] **Step 1: Write failing tests** with `deps.command = process.execPath` and `deps.args = [fixture]`. The fixture echoes a canned reply chosen by an env var:
  - The reply is fenced JSON inside chatter: `generateObject` validates.
  - The reply is the claude-style `{"result":"{\"n\":3}"}`: it parses through the `result` field.
  - The fixture exits 2 with stderr `not logged in`: `ProviderError` whose message contains `not logged in`.
  - A missing binary: the message contains `not found`.
  - Abort during a fixture that sleeps 10 s: rejects within 2 s.
- [ ] **Step 2–4:** Run `npx vitest run packages/core/test/llm/cli.test.ts`: FAIL, then implement, then PASS. Then `npm run typecheck`.
- [ ] **Step 5:** Commit `feat(core): experimental CLI providers`.

### Task 5: Source ingestion (URLs and files)

**Files:**
- Create: `packages/core/src/research/ingest.ts`
- Test: `packages/core/test/research/ingest.test.ts`, fixtures `packages/core/test/fixtures/article.html`, `packages/core/test/fixtures/sample.pdf` (a 1-page PDF with a known sentence; generate it once and commit it)

**Interfaces:**
- Consumes: Task 1 `Project['sources'][number]` shape.
- Produces: `ingestSource(projectDir: string, input: {id: string; uri: string; kind: 'url'|'file'|'search'; title?: string; text?: string}, deps: {fetch: typeof fetch; timeoutMs?: number; maxBytes?: number}): Promise<Project['sources'][number]>`.
  - Writes `sources/<id>.txt` and returns `{id, kind, title, uri, textPath: 'sources/<id>.txt'}`, or the same entry with `error` and an empty text file.
  - URLs:
    - Fetched with an `AbortSignal.timeout(timeoutMs ?? 15000)`, reading at most `maxBytes ?? 5_000_000` bytes. Past that the fetch is aborted with `error: 'too large'`.
    - Content-type decides the handling:
      - `text/html` → linkedom + Readability `textContent`, with the title from `<title>`.
      - `application/pdf` → `unpdf` `extractText`.
      - `text/plain` and `text/markdown` → as is.
      - Anything else → `error: 'unsupported content type <type>'`.
    - A non-2xx response gives `error: 'HTTP <status>'`.
  - Files: `.pdf`, `.txt` and `.md` are read from the project dir. Any other extension gives `error: 'unsupported file type'`.
  - `text` given (search results with content): written as is.
  - Text is normalised to collapsed whitespace, with paragraphs kept as `\n\n`.

- [ ] **Step 1: Write failing tests** with an injected `fetch` stub:
  - The HTML fixture gives text containing the article's key sentence, and the title comes through.
  - The PDF fixture gives its known sentence.
  - A 404 gives `error: 'HTTP 404'`.
  - A stub that never resolves with `timeoutMs: 50` gives an error matching `/timeout|abort/i` within 1 s.
  - A 6 MB body gives `error: 'too large'`.
  - `image/png` gives `unsupported content type image/png`.
  - A local `.txt` file in a dir with spaces and accents works.
- [ ] **Step 2–4:** Run `npx vitest run packages/core/test/research/ingest.test.ts`: FAIL, implement, PASS.
- [ ] **Step 5:** Commit `feat(core): source ingestion for URLs, PDF and text files`.

### Task 6: Web search + the `sources` step

**Files:**
- Create: `packages/core/src/research/search.ts`, `packages/core/src/generate/steps/sources.ts`, `packages/core/src/generate/context.ts`, `packages/core/src/generate/prompts.ts`
- Test: `packages/core/test/research/search.test.ts`, `packages/core/test/generate/sources.test.ts`

**Interfaces:**
- Consumes: Task 2 `LlmProvider`, `Settings`; Task 5 `ingestSource`.
- Produces:
  - `type StepContext = {projectDir: string; llm: LlmProvider; settings: Settings; fetch: typeof fetch; signal?: AbortSignal; onProgress: (e: {step: StepName; ratio?: number; log?: string}) => void; nativeSearch?: (query: string) => Promise<SearchHit[]>}` (`context.ts`). `type Step = (p: Project, ctx: StepContext) => Promise<Project>`.
  - `type SearchHit = {title: string; url: string; content?: string}`.
  - `tavilySearch(query, key, fetch): Promise<SearchHit[]>` POSTs `https://api.tavily.com/search` with `{query, max_results: 5, include_raw_content: true}`. Hits carry `raw_content ?? content` as `content`.
  - `braveSearch(query, key, fetch): Promise<SearchHit[]>` GETs `https://api.search.brave.com/res/v1/web/search?q=…&count=5` with the `X-Subscription-Token` header. Hits have no content, so they get fetched.
  - `nativeSearchFor(ref: ProviderRef, settings: Settings): ((q: string) => Promise<SearchHit[]>) | undefined`, built with AI SDK provider web-search tools in `generateText`:
    - anthropic `webSearch_20250305`, openai `webSearch`, google `googleSearch`.
    - Hits come from the result's `sources`.
    - Other providers get `undefined`.
  - `resolveWebSearch(settings: Settings, ref: ProviderRef, hasUserSources: boolean): 'off'|'native'|'tavily'|'brave'`. User sources → `'off'`. `settings.search` other than `'auto'` → that value. `'auto'` → native if the provider supports it, else tavily if keyed, else brave if keyed, else `'off'`. `createProject` callers use this (Task 12).
  - `prompts.ts`: exported functions returning `{system, prompt}`: `searchQueries(topic, language)`, `extractFacts(...)`, `writeScript(...)`, `fillScene(...)` (filled in Tasks 6–9). Each states the output language.
  - `sourcesStep: Step`:
    1. Ingests `brief.sources` (ids `s1…`).
    2. If `brief.webSearch !== 'off'`, asks the LLM for `{queries: string[]}` (1–3 items, each ≤ 120 characters) and runs them through the chosen search. It keeps at most 6 unique URLs and ingests them as `kind: 'search'`, with content when provided.
    3. Logs `<n> sources (<k> failed)` through `onProgress`.
    4. A search API error records a progress log line and continues with whatever exists. It does not fail the step.

- [ ] **Step 1: Write failing tests**:
  - `resolveWebSearch` truth table:
    - user sources → `off`;
    - `auto` + anthropic → `native`;
    - `auto` + mistral + Tavily key → `tavily`;
    - `auto` + mistral + no keys → `off`.
  - `tavilySearch` against a fetch stub builds the right request body and maps the hits.
  - `braveSearch` sends the header.
  - `sourcesStep` with a fake LLM that answers `{queries: ['a', 'b']}` and a Tavily stub returning 4 hits per query with 2 duplicate URLs: 6 unique sources with `kind: 'search'`, and text files exist.
  - `sourcesStep` with `webSearch: 'off'` and one user URL makes no LLM call.
  - A Tavily stub that returns 500: the step resolves with zero sources and logs the failure.
- [ ] **Step 2–4:** Run `npx vitest run packages/core/test/research packages/core/test/generate`: FAIL, implement, PASS. Then `npm run typecheck`.
- [ ] **Step 5:** Commit `feat(core): web search and sources step`.

### Task 7: Facts step with excerpt verification

**Files:**
- Create: `packages/core/src/research/verify.ts`, `packages/core/src/generate/steps/facts.ts`
- Test: `packages/core/test/research/verify.test.ts`, `packages/core/test/generate/facts.test.ts`

**Interfaces:**
- Consumes: Task 6 `Step`, `StepContext`, prompts; Task 2 `LlmProvider`.
- Produces:
  - `excerptFound(excerpt: string, sourceText: string): boolean`. Both sides are normalised: NFKC; ’‘ → `'`; “”« » → `"`; dashes → `-`; whitespace collapsed; lowercase. Then a substring check. Excerpts under 12 normalised characters are never verified.
  - `FactsOutputSchema = z.object({facts: z.array(z.object({statement: z.string().min(1).max(200), value: z.string().max(40).optional(), sourceId: z.string().optional(), excerpt: z.string().max(400).optional()})).min(3).max(40)})`.
  - `factsStep: Step`:
    - Sends each source's text, capped at 12 000 characters per source and 60 000 in total, labelled with its id.
    - Assigns ids `f1…`.
    - Sets `verified = sourceId` names a real source and `excerptFound(...)`.
    - With no usable source text, the prompt asks for facts from model knowledge, and all of them get `verified: false`.

- [ ] **Step 1: Write failing tests**:
  - `excerptFound('la  CSG finance 20 %', 'Selon le rapport, la CSG finance 20 % des recettes')` → true.
  - Curly vs straight quotes → true.
  - An invented sentence → false.
  - A 5-character excerpt → false.
  - `factsStep` with a fake LLM returning 3 facts (one with a correct excerpt, one invented, one with an unknown `sourceId`): verified flags are `[true, false, false]` and ids are `f1, f2, f3`.
  - `factsStep` on a project with zero sources sends a prompt containing `from your own knowledge`, and all facts come out unverified.
- [ ] **Step 2–4:** Run `npx vitest run packages/core/test/research/verify.test.ts packages/core/test/generate/facts.test.ts`: FAIL, implement, PASS.
- [ ] **Step 5:** Commit `feat(core): facts step with excerpt verification`.

### Task 8: Script step

**Files:**
- Create: `packages/core/src/generate/steps/script.ts`
- Test: `packages/core/test/generate/script.test.ts`

**Interfaces:**
- Consumes: Task 7 facts; Task 1 scene fields; scenes `estimateDurationFrames`.
- Produces:
  - `sceneCount(targetMinutes: number): number` is `clamp(round(targetMinutes*60/16), 8, 12)`.
  - `ScriptOutputSchema(n: number)`: `z.object({scenes: z.array(z.object({narration: z.string(), factIds: z.array(z.string()).max(6)})).length(n)})`, with a refinement that each narration has 25–45 words (whitespace-separated tokens). The issue path is `scenes.<i>.narration` and the message gives the actual count.
  - `scriptStep: Step`:
    - The prompt states the scene count, the word range, speech style, rounded numbers, no scene titles in the narration, and only the listed fact ids (statements passed by id).
    - Writes scenes with ids `s01…` and `factIds` filtered to existing facts.
    - `spec` is a placeholder `{type: 'title', title: <first 48 characters of the topic>, decor: 'none', characters: 0}` until the scenes step.
    - `durationFrames = estimateDurationFrames(narration)`, `status 'ok'`, `warnings []`.

- [ ] **Step 1: Write failing tests**:
  - `sceneCount`: 1 → 8, 3 → 11, 10 → 12.
  - A fake LLM whose first reply has a 12-word narration and whose second reply is valid: the second prompt contains `scenes.0.narration`, and the result has n scenes.
  - An unknown fact id is dropped from `factIds`.
  - Scene ids are `s01…s11` for 3 minutes.
- [ ] **Step 2–4:** Run `npx vitest run packages/core/test/generate/script.test.ts`: FAIL, implement, PASS.
- [ ] **Step 5:** Commit `feat(core): script step`.

### Task 9: Scenes step, fallback, source line, voice `none` step

**Files:**
- Create: `packages/core/src/generate/steps/scenes.ts`, `packages/core/src/generate/steps/voice.ts`
- Test: `packages/core/test/generate/scenes.test.ts`, `packages/core/test/generate/voice.test.ts`

**Interfaces:**
- Consumes: scenes `SceneSpecSchema`, `SCENE_TYPES`, `EXAMPLES`, `SceneSpec`; Task 8 scenes; Task 2 `LlmOutputError`.
- Produces:
  - `generateSceneSpec(p: Project, index: number, ctx: StepContext, feedback?: string): Promise<{spec: SceneSpec; status: 'ok' | 'fallback'; warning?: string}>`.
    - The prompt contains:
      - the narration;
      - the facts used, with values;
      - one compact example per type (`EXAMPLES`);
      - the rule that each `cue` must be a word or short phrase copied from the narration;
      - the field limits (they come from the schema);
      - `feedback` when given.
    - Validates with `SceneSpecSchema`.
    - After `LlmOutputError`: `{spec: {type: 'title', title: <first sentence of the narration cut to 48 characters on a word boundary>, decor: 'none', characters: 0}, status: 'fallback', warning: 'Scene could not be generated; simple title used'}`.
  - `withSourceLine(spec: SceneSpec, p: Project, factIds: string[]): SceneSpec` sets `spec.source` to the title of the first cited fact's source, cut to 80 characters. Types other than `title` and `quote` only. An existing `source` is overwritten, so the LLM cannot invent one.
  - `scenesStep: Step` runs `generateSceneSpec` for every scene (reporting `ratio`), applies `withSourceLine`, and appends warnings. Unverified cited facts add `Unverified figure: <statement>`.
  - `voiceStep: Step`: engine `none` sets `durationFrames = estimateDurationFrames(narration)` and removes `audio`. Any other engine throws `Error('Voice engine "<x>" arrives in Plan 3')`.

- [ ] **Step 1: Write failing tests**:
  - A fake LLM returns a valid `bars` spec citing fact f1 (source title `"INSEE"`): `spec.source === 'INSEE'`.
  - A fake that always returns an invalid donut (sum 90): `status 'fallback'`, a title spec of ≤ 48 characters, and a warning set after exactly 4 LLM calls.
  - A cited unverified fact adds the `Unverified figure:` warning.
  - `feedback` text appears in the prompt.
  - `voiceStep` with `none` sets durations. With `edge` it rejects with a message containing `Plan 3`.
- [ ] **Step 2–4:** Run `npx vitest run packages/core/test/generate/scenes.test.ts packages/core/test/generate/voice.test.ts`: FAIL, implement, PASS.
- [ ] **Step 5:** Commit `feat(core): scenes step with fallback and source line; silent voice step`.

### Task 10: Layout check + `layout` step

**Files:**
- Create: `packages/core/src/render/layoutCheck.ts`, `packages/core/src/generate/steps/layout.ts`
- Modify: `packages/core/test/render/snapshots.test.ts` (use `pixelsOutsideSafeArea` from `layoutCheck.ts` instead of its local copy)
- Test: `packages/core/test/render/layoutCheck.test.ts` (visual project), `packages/core/test/generate/layout.test.ts` (unit, with `checkScene` injected)

**Interfaces:**
- Consumes: Plan 1 `renderSceneStill`, the `BackgroundStill` composition, and the safe-area constants and diff logic in `snapshots.test.ts` (`SAFE = {x0: 60, x1: 1860, y0: 50, y1: 900}`, channel delta > 8, tolerance 20 px); Task 9 `generateSceneSpec`.
- Produces:
  - `pixelsOutsideSafeArea(scenePng: PNG, backgroundPng: PNG): number`: the logic moved from the test, same constants.
  - `checkSceneLayout(projectDir: string, p: Project, index: number): Promise<{outside: number}>`. It renders the scene still at ratio 0.8 and a `BackgroundStill` in the same style (cached per style for the process), then counts. `title` scenes return `{outside: 0}`, since their decor is full-bleed by design.
  - `layoutStep(deps?: {checkScene?: typeof checkSceneLayout}): Step`. For each scene, if `outside > 20`, it calls `generateSceneSpec(..., feedback: 'The previous layout overflowed the frame; use shorter labels and fewer items.')` once, applies `withSourceLine`, and rechecks. If it still overflows, it adds the warning `Layout may overflow the frame`.
  - This plan's layout check covers the safe area only. Overlap between text boxes (spec §4.1 step 6) needs the browser preview and moves to Plan 4. Text fitting and schema limits from Plan 1 cover the common case.

- [ ] **Step 1: Write failing tests**:
  - Unit: a stub `checkScene` returns 500 then 0 for scene 1: exactly one regeneration and no warning. A stub that always returns 500: one regeneration and the warning.
  - Visual: `checkSceneLayout` on the Plan 1 bars example returns ≤ 20. The same scene with `Source` forced to x = 1885 (a test-only spec with a `source` of 80 `W`s in a 1-bar scene, or reuse the Plan 1 fail-proof approach) returns > 20.
  - The existing snapshot safe-area test still passes using the shared function.
- [ ] **Step 2–4:** Run `npx vitest run packages/core/test/generate/layout.test.ts` and `npm run test:visual -- layoutCheck snapshots`: FAIL, implement, PASS.
- [ ] **Step 5:** Commit `feat(core): layout check and layout step with one automatic retry`.

### Task 11: Generator orchestrator + render step + demo fake provider

**Files:**
- Create: `packages/core/src/generate/generate.ts`, `packages/core/src/generate/steps/render.ts`, `packages/core/src/llm/demoResponder.ts`
- Modify: `packages/core/src/index.ts` (export `generate`, `createProject`, `resolveWebSearch`, `loadSettings`, `saveSettings`, `createProvider`, `testConnection`, the render API)
- Test: `packages/core/test/generate/generate.test.ts` (unit, steps injected), `packages/core/test/llm/demoResponder.test.ts`

**Interfaces:**
- Consumes: every step above; Plan 1 `renderVideo`, `probeMedia`, `saveProject`, `loadProject`.
- Produces:
  - `renderStep: Step`: `renderVideo(projectDir, p, {onProgress → ctx.onProgress({step: 'render', ratio}), signal})`, then `probeMedia`. If `|durationSeconds − Σ durationFrames / 30| > 0.2`, it fails with `Rendered duration <a>s does not match <b>s`.
  - `STEPS: Record<StepName, Step>` in `STEP_NAMES` order.
  - `generate(projectDir: string, ctx: Omit<StepContext, 'projectDir'>, deps?: {steps?: Partial<Record<StepName, Step>>}): Promise<Project>`:
    1. Loads the project and clears `progress.failed`.
    2. Runs each step not in `progress.done`, in order.
    3. After each step: appends it to `done`, `saveProject`, and calls `onProgress({step, ratio: 1})`.
    4. Before each step: if `signal.aborted`, throws `GenerateCancelled` without recording a failure.
    5. A step error other than cancellation: sets `progress.failed = {step, message}` (redacted), saves, and rethrows as `StepFailedError {step}`.
  - `demoResponder` (used by `createProvider({kind: 'fake'})`): returns schema-valid outputs by recognising the schema it is given (queries, facts, script with the requested n, a scene spec cycling through `EXAMPLES` in `SCENE_TYPES` order with cues taken from the narration). It is deterministic, so the e2e video is reproducible.

- [ ] **Step 1: Write failing tests** (unit, steps stubbed so they record calls and add a marker):
  - A full run calls the 7 steps in order, `progress.done` lists all 7, and `project.json` is saved 7 times.
  - Resume: stub `script` throws, and `progress.failed.step === 'script'`. A second `generate` call skips `sources` and `facts` (zero calls) and runs from `script`.
  - Cancel: abort inside `facts` → `GenerateCancelled`, `progress.failed` is undefined, and `done` is `['sources']`.
  - A step error message containing a configured key is saved redacted.
  - `demoResponder` outputs pass `FactsOutputSchema`, `ScriptOutputSchema(11)` and `SceneSpecSchema`.
- [ ] **Step 2–4:** Run `npx vitest run packages/core/test/generate/generate.test.ts packages/core/test/llm/demoResponder.test.ts`: FAIL, implement, PASS. Then `npm test` and `npm run typecheck`.
- [ ] **Step 5:** Commit `feat(core): generator orchestrator with checkpoints, cancel and resume`.

### Task 12: `make` CLI, end-to-end test, README

**Files:**
- Create: `scripts/make.ts`, root script `"make": "tsx --tsconfig tsconfig.base.json scripts/make.ts"`
- Modify: `README.md` (a "Generate a video from a topic" section: settings, `.env` keys, `npm run make` examples, `--check`, CLI providers marked experimental with a terms note), `.gitignore` (`data/` is already there; also add `config.json`), `packages/core/src/llm/demoResponder.ts` (when env `DOCU_MOTION_FAKE_LOG` is set, append one line per call naming the recognised schema to `<that path>`)
- Test: `packages/core/test/render/make.e2e.test.ts` (visual project)

**Interfaces:**
- Consumes: Task 11 exports.
- Produces: the CLI.
  - Usage: `npm run make -- "<topic>" [--style papier|craie|infographie|nuit] [--sources <url|file>...] [--length <min>] [--language <code>] [--provider <name>] [--model <id>] [--voice none] [--data <dir>] [--resume <projectDir>] [--check]`.
  - Defaults: style `papier`, length 3, language from settings, provider from settings, voice `none`. `--provider fake` gives `{kind: 'fake'}`. `claude|codex|gemini` give `{kind: 'cli'}`. Anything else gives `{kind: 'api'}`.
  - Progress lines: `[3/7] script …` plus log lines on stderr.
  - Success prints `OK <mp4 path>` on stdout.
  - Failure prints `FAILED at <step>: <message>` and `Resume with: npm run make -- --resume "<dir>"`, and exits 1.
  - Ctrl+C aborts the signal, prints `Cancelled — resume with …`, and exits 130.
  - `--check` runs `testConnection` and prints `OK <provider> <ms>ms` or the error, exiting 0 or 1.
  - Unknown style or provider: a clear message and exit 1.

- [ ] **Step 1: Write failing e2e tests** that spawn the CLI with `--provider fake --data <temp dir "données é">`:
  - `generates a silent video`: exit 0, stdout `OK …video.mp4`. `probeMedia` reports width 1920, `hasAudio false`, and a duration equal to Σ durationFrames / 30 ± 0.2. `project.json` has 11 scenes, every scene type used at least once, and `progress.done.length === 7`.
  - `resumes`: the same run with env `DOCU_MOTION_FAIL_AT=scenes` (a test hook read only by `scripts/make.ts`, which wraps that step to throw) exits 1 with `FAILED at scenes`. `--resume <dir>` without the env var then exits 0, and the fake responder's call count for the facts schema is unchanged across the resume (the responder logs its calls to `<data>/fake-calls.log` when `DOCU_MOTION_FAKE_LOG` is set).
  - `bad style`: `--style neon` exits 1 and stderr contains `neon`.
- [ ] **Step 2:** Run `npm run test:visual -- make.e2e`. Expected: FAIL.
- [ ] **Step 3:** Implement `scripts/make.ts`, then the README and `.gitignore` changes.
- [ ] **Step 4:** Run `npm test && npm run typecheck && npm run test:visual`. Expected: PASS. Then `npm run make -- "La dette publique française" --provider fake --style craie`, run `npm run sheet` on the printed project dir, and look at the contact sheet.
- [ ] **Step 5:** Commit `feat: make CLI generating a video from a topic`.
