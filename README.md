# docu-motion

A self-hosted app that turns a topic into a coded motion-design documentary video (Remotion), working with any LLM provider.

**Status: Plan 2 of 5: topic-to-video generator.** A `project.json` format, nine animated scene types in four visual styles, a renderer (1920x1080, 30 fps MP4) and a `make` command that generates a silent video from a topic with an LLM. Voice-over, web UI and YouTube kit come in later plans.

## Requirements

- Node.js 22 or newer
- Network access when rendering: the first render downloads Chrome Headless Shell (handled by Remotion), and every render fetches the Google fonts from fonts.gstatic.com

## Quick start

```bash
npm install
npm run render -- examples/how-it-works              # writes examples/how-it-works/out/video.mp4
npm run render -- examples/how-it-works --style nuit # override the style (project.json is not modified)
npm run sheet -- examples/how-it-works               # contact sheet of every scene: examples/how-it-works/out/contact-sheet.png
```

Styles: `papier` (default), `craie`, `infographie`, `nuit`. A successful render prints `OK <path> <duration>s audio=<bool>`; an invalid `project.json` prints each problem as `<json path>: <message>` and exits with code 1.

## Generate a video from a topic

`make` takes a topic (and optional sources), asks an LLM for facts, a script and scene specs, then renders the MP4. Progress goes to stderr, and a successful run prints `OK <path to video.mp4>` on stdout. The project is written under `data/projects/`.

Docker is the reference way to run it:

```bash
docker compose --profile dev run --rm dev make -- "La dette publique française" --provider fake   # offline demo provider
npm run make -- "La dette publique française" --provider fake                                       # the same, natively
npm run make -- "How vaccines work" --style nuit --length 4 --language en --sources https://example.org/a.html notes.pdf
npm run make -- --resume "data/projects/<project folder>"                                           # continue after a failure or Ctrl+C
npm run make -- --check --provider anthropic                                                        # tests the connection: OK <provider> <ms>ms
```

Options: `--style papier|craie|infographie|nuit` (default `papier`), `--length <minutes>` (default 3), `--language <code>` (default from settings), `--provider`, `--model`, `--sources <url|file>...`, `--voice none` (the only engine for now), `--data <dir>`. On failure it prints `FAILED at <step>: <message>` and the `--resume` command, and exits 1. A finished step is never run again on resume. Ctrl+C exits with code 130.

**Settings.** Choose the default provider and web search in `data/config.json` (git-ignored):

```json
{"provider": {"kind": "api", "provider": "anthropic", "model": "claude-sonnet-4-5"}, "defaultLanguage": "fr", "search": "auto"}
```

`search` is `auto`, `native`, `tavily`, `brave` or `off`. `--provider` overrides the file.

**API keys** come from the environment or from a `.env` file at the repo root (git-ignored); the CLI loads it at startup and never prints keys: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `MISTRAL_API_KEY`, `OPENROUTER_API_KEY`, `TAVILY_API_KEY`, `BRAVE_API_KEY`, and `OLLAMA_BASE_URL` for a local Ollama.

**Providers.** `anthropic`, `openai`, `google`, `mistral`, `openrouter` and `ollama` use their API. `claude`, `codex` and `gemini` drive the corresponding command-line tool and are **experimental**: the CLI must be installed and signed in in the environment that runs `make` (the default Docker image does not include them), and using a subscription-based CLI this way may not be allowed by that vendor's terms, so check them before you rely on it. `fake` is an offline provider for demos and tests.

## Tests

```bash
npm test              # unit tests
npm run test:visual   # renders stills and videos, compares snapshots (slower)
npm run typecheck
```

## Layout

- `packages/scenes`: Remotion compositions and the nine scene types (title, bars, donut, counter, pictograms, comparison, quote, timeline, list)
- `packages/core`: `project.json` schema and store, bundling, still/video rendering, media probing
- `examples/how-it-works`: demo project, a 10-scene video explaining how docu-motion works (no voice-over)

## Related

- Skill that this project productises: https://github.com/Sami-Fd/documentaire-motion-design
- Design spec: [docs/superpowers/specs/2026-10-24-docu-motion-design.md](docs/superpowers/specs/2026-10-24-docu-motion-design.md)

## License

MIT, see [LICENSE](LICENSE).

Remotion, which this project depends on, has its own license, separate from this repository's MIT license: https://www.remotion.dev/license
