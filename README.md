# docu-motion

A self-hosted app that turns a topic into a coded motion-design documentary video (Remotion), working with any LLM provider.

**Status: Plan 1 of 5: rendering engine.** What exists today is the foundation: a `project.json` format, nine animated scene types in four visual styles, and a renderer that turns a project into a 1920x1080, 30 fps MP4. The LLM pipeline, voice-over, web UI and YouTube kit come in later plans.

## Requirements

- Node.js 20 or newer
- Network access when rendering: the first render downloads Chrome Headless Shell (handled by Remotion), and every render fetches the Google fonts from fonts.gstatic.com

## Quick start

```bash
npm install
npm run render -- examples/secu              # writes examples/secu/out/video.mp4
npm run render -- examples/secu --style nuit # override the style (project.json is not modified)
npm run sheet -- examples/secu               # contact sheet of every scene: examples/secu/out/contact-sheet.png
```

Styles: `papier` (default), `craie`, `infographie`, `nuit`. A successful render prints `OK <path> <duration>s audio=<bool>`; an invalid `project.json` prints each problem as `<json path>: <message>` and exits with code 1.

## Tests

```bash
npm test              # unit tests
npm run test:visual   # renders stills and videos, compares snapshots (slower)
npm run typecheck
```

## Layout

- `packages/scenes`: Remotion compositions and the nine scene types (title, bars, donut, counter, pictograms, comparison, quote, timeline, list)
- `packages/core`: `project.json` schema and store, bundling, still/video rendering, media probing
- `examples/secu`: demo project (10 scenes, no voice-over)

## Related

- Skill that this project productises: https://github.com/Sami-Fd/documentaire-motion-design
- Design spec: [docs/superpowers/specs/2026-10-24-docu-motion-design.md](docs/superpowers/specs/2026-10-24-docu-motion-design.md)

## License

MIT, see [LICENSE](LICENSE).

Remotion, which this project depends on, has its own license, separate from this repository's MIT license: https://www.remotion.dev/license
