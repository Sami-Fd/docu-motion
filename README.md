# docu-motion

A self-hosted app that turns a topic into a coded motion-design documentary video (Remotion), working with any LLM provider.

**Status: Plan 3 of 5: narrated videos and YouTube kit.** A `project.json` format, nine animated scene types in four visual styles, a renderer (1920x1080, 30 fps MP4), a `make` command that generates a narrated video from a topic with an LLM, a `touch` command to edit it afterwards, and a thumbnail plus YouTube text for each video. The web UI comes in a later plan.

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

`make` takes a topic (and optional sources), asks an LLM for facts, a script and scene specs, voices it, then renders the MP4, a 1280x720 thumbnail and a YouTube kit (`out/youtube.txt`: titles, description, chapters, hashtags). Progress goes to stderr, and a successful run prints `OK <path to video.mp4>`, the thumbnail path and the `youtube.txt` path on stdout. The project is written under `data/projects/`.

Docker is the reference way to run it:

```bash
docker compose --profile dev run --rm dev make -- "La dette publique française" --provider fake   # offline demo provider
npm run make -- "La dette publique française" --provider fake                                       # the same, natively
npm run make -- "How vaccines work" --style nuit --length 4 --language en --sources https://example.org/a.html notes.pdf
npm run make -- --resume "data/projects/<project folder>"                                           # continue after a failure or Ctrl+C
npm run make -- --check --provider anthropic                                                        # tests the connection: OK <provider> <ms>ms
```

Put the topic before `--sources`, which takes every following value up to the next option.

Options: `--style papier|craie|infographie|nuit` (default `papier`), `--length <minutes>` (default 3), `--language <code>` (default from settings), `--provider`, `--model`, `--sources <url|file>...`, `--voice edge|elevenlabs|openai|none` (default `edge`), `--voice-id <id>`, `--data <dir>`. On failure it prints `FAILED at <step>: <message>` and the `--resume` command, and exits 1. A finished step is never run again on resume. Ctrl+C exits with code 130.

**Voice.** `edge` (default) is free and needs no key, but needs network access to Microsoft's speech service; it picks a default voice for the language (`fr-FR-DeniseNeural`, `en-US-AriaNeural`, ...) unless you give `--voice-id`. `elevenlabs` and `openai` need `ELEVENLABS_API_KEY` or `OPENAI_API_KEY`; their default voices are Rachel (`21m00Tcm4TlvDq8ikWAM`) and `alloy`, and `--voice-id` overrides them. `none` makes a silent video (the scene length is estimated from the text). To use your own voice, see "Edit a project" below; to change a project's voice afterwards, use `touch ... voice`. If Edge is unreachable for one scene, that scene gets an estimated length and a warning; if it fails for every scene, `make` stops instead of shipping a silent video.

**Settings.** Choose the default provider and web search in `data/config.json` (git-ignored):

```json
{"provider": {"kind": "api", "provider": "anthropic", "model": "claude-sonnet-5-5"}, "defaultLanguage": "fr", "search": "auto"}
```

`search` is `auto`, `native`, `tavily`, `brave` or `off`. `--provider` overrides the file.

**API keys** come from the environment or from a `.env` file at the repo root (git-ignored); the CLI loads it at startup and never prints keys: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `MISTRAL_API_KEY`, `OPENROUTER_API_KEY`, `TAVILY_API_KEY`, `BRAVE_API_KEY`, and `OLLAMA_BASE_URL` for a local Ollama.

**Providers.** `anthropic`, `openai`, `google`, `mistral`, `openrouter` and `ollama` use their API. `claude`, `codex` and `gemini` drive the corresponding command-line tool and are **experimental**: the CLI must be installed and signed in in the environment that runs `make` (the default Docker image does not include them), and using a subscription-based CLI this way may not be allowed by that vendor's terms, so check them before you rely on it. `fake` is an offline provider for demos and tests. The CLI providers run with their own login: the app's API keys such as `ANTHROPIC_API_KEY` are not passed to them.

## Edit a project

`touch` changes a finished project. In Docker (the reference way, and the one to use on Windows for anything that renders), run `docker compose --profile dev run --rm dev touch -- "data/projects/<folder>" rerender`; the examples below use the shorter native form. Scene ids are `s01`, `s02`, ... (see `project.json`). Each command prints one `OK` line; errors exit 1 and Ctrl+C exits 130.

```bash
npm run touch -- "data/projects/<folder>" regenerate s03              # ask the LLM for a new version of scene s03
npm run touch -- "data/projects/<folder>" edit s02 "New narration."   # change the text; only s02 is re-voiced
npm run touch -- "data/projects/<folder>" rerender                    # re-voice changed scenes, render, rebuild thumbnail and YouTube kit
npm run touch -- "data/projects/<folder>" thumbnail 2                 # use thumbnail option 2 (1 to 3)
npm run touch -- "data/projects/<folder>" refresh-youtube             # forget the YouTube copy and thumbnail options
npm run touch -- "data/projects/<folder>" voice openai --voice-id alloy  # change the engine and voice (edge, elevenlabs, openai, none); then rerender
npm run touch -- "data/projects/<folder>" refresh-youtube --youtube   # only the titles, description and hashtags (or --thumbnails)
```

`regenerate`, `edit` and `thumbnail` do not render: run `rerender` afterwards. `refresh-youtube` clears the saved copy; the next `rerender` regenerates it. `touch` reads the settings from the project's data folder (`<data>/projects/<name>`); pass `--data <dir>` if the project lives elsewhere. Put `--` before an argument that starts with `--` (`edit s02 -- "--5 % de dette"`). Do not run `touch` and `make` on the same project at the same time: there is no project lock yet.

**Record your own voice.**

```bash
npm run touch -- "data/projects/<folder>" prepare-recording           # writes out/recording-script.txt
npm run touch -- "data/projects/<folder>" recording my-voice.m4a      # splits the recording into one clip per scene
npm run touch -- "data/projects/<folder>" rerender
```

Read `out/recording-script.txt` aloud and leave a 2 second pause at each `<break time="2.0s" />` line (do not read the markers). In Docker, the recording must be inside the mounted repo folder (for example under `data/`). Then give the file to `recording` (mp3, wav, m4a or webm) and run `rerender`. The pauses are detected automatically; the recording must contain exactly one pause fewer than there are scenes. If the count is wrong, nothing is changed and the command prints how many pauses it found, where they are, and a hint. When there are too many pauses (a pause inside a sentence), it also prints a suggested `--cuts` made of the longest pauses; with too few, it cannot guess, so pass the cut times yourself with `--cuts 12.4,31,58.2` (seconds, one per boundary). Detection can be tuned with `--noise <dB>` (default `-38`, must be negative) and `--min-silence <s>` (default `1.2`). A noisy room, where no pause is found, needs a higher value such as `--noise -30`; a very quiet room or a soft voice, where the file counts as silent or sentences are cut, needs a lower one such as `--noise -45`. If you edit a narration after recording, record again or switch voices with `touch ... voice`.

## Tests

```bash
npm test              # unit tests
npm run test:visual   # renders stills and videos, compares snapshots (slower)
npm run typecheck
```

## Layout

- `packages/scenes`: Remotion compositions and the nine scene types (title, bars, donut, counter, pictograms, comparison, quote, timeline, list)
- `packages/core`: `project.json` schema and store, bundling, still/video rendering, media probing
- `scripts`: the `make` and `touch` commands
- `examples/how-it-works`: demo project, a 10-scene video explaining how docu-motion works (no voice-over)

## Related

- Skill that this project productises: https://github.com/Sami-Fd/documentaire-motion-design
- Design spec: [docs/superpowers/specs/2026-10-24-docu-motion-design.md](docs/superpowers/specs/2026-10-24-docu-motion-design.md)

## License

MIT, see [LICENSE](LICENSE).

Remotion, which this project depends on, has its own license, separate from this repository's MIT license: https://www.remotion.dev/license
