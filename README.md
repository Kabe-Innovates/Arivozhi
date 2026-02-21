# Arivozhi (அறிவொழி)

IDE-level autocomplete and cross-question memory for Moodle CodeRunner quizes.

![Arivozhi Banner](ArivozhiBanner.png)

## Features

- **Live autocomplete** — Activates Ace Editor's `language_tools` on every CodeRunner question.
- **Cross-question memory** — Symbols defined in one question appear in the autocomplete of subsequent questions, tagged with their origin (e.g. `↩ Q1`).
- **No build step** — Vanilla ES6+ JS, load unpacked and go.

## Install

### Chrome / Edge

1. Clone the repo.
2. Go to `chrome://extensions` → enable **Developer mode**.
3. **Load unpacked** → select the repo folder.

### Firefox

1. Go to `about:debugging#/runtime/this-firefox`.
2. **Load Temporary Add-on…** → select `manifest.json`.

## Browser Support

| Browser | Min Version |
|---------|-------------|
| Chrome  | 111+        |
| Edge    | 111+        |
| Firefox | 128+        |

## License

[MIT](LICENSE) © 2026 Kabe-Innovates
