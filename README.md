# Policy Guardian Chrome Extension

Policy Guardian is a Chrome extension prototype built for the Google Chrome Built-in AI Challenge 2025. It keeps an eye on the pages you visit, detects when you're reading a Terms of Service or Privacy Policy, and uses Chrome's on-device AI APIs to highlight risky clauses.

## Features

- 🔍 **Automatic detection** – Heuristics watch the URL, titles, and headings to detect policy-like documents. A floating call-to-action offers to scan the page when a match is found.
- 🧠 **On-device AI analysis** – When available, the extension calls the Prompt API (via `ai.languageModel`) to request structured JSON with suspicious clauses and risk levels. Summaries are generated with the Summarizer API (`ai.summarizer`) and clauses are rephrased for clarity using the Rewriter API (`ai.rewriter`).
- 🛟 **Risk heatmap** – The popup renders a simple 1–5 score across categories such as data collection, third-party sharing, and dispute resolution.
- ⚠️ **Suspicious clause list** – Shows short excerpts, the reason they were flagged, and (when possible) a plain-language rewrite from the AI model.
- 🧑‍💻 **Manual scan fallback** – Trigger a scan from the popup even if the page was not automatically detected. Heuristic fallbacks keep working when built-in AI models are unavailable.

## Folder structure

```
extension/
  manifest.json
  service_worker.js
  content-script.js
  popup/
    popup.html
    popup.js
    popup.css
```

## Getting started

1. Clone this repository and open the `extension/` folder in Chrome's Extensions management view (`chrome://extensions`).
2. Enable **Developer mode** in the top right corner.
3. Click **Load unpacked** and select the `extension/` directory.
4. Ensure that you are using a Chrome build with the [Built-in AI Early Preview Program](https://developer.chrome.com/docs/ai/join-epp) enabled. The extension requests the `aiLanguageModel`, `aiSummarizer`, and `aiRewriter` capabilities in the manifest. If these APIs are not available, the extension gracefully falls back to heuristic analysis.
5. Visit a known Terms of Service or Privacy Policy page. A floating “Scan for risky clauses” button should appear. You can also open the extension popup and run a manual scan at any time.

> **Note:** The repository omits binary icon assets so the tree stays text-only. Chrome will fall back to its default puzzle-piece icon, but you can drop your own PNGs into `extension/icons/` locally if you want custom artwork; the `.gitignore` keeps them untracked.

## Development notes

- **Prompt shaping** – `service_worker.js` requests structured JSON from the Prompt API to ensure the popup can render heatmaps and clause details without additional parsing.
- **Fallbacks** – When AI APIs are disabled or error out (for example on unsupported hardware), a keyword-based fallback produces a conservative analysis so the UI remains useful.
- **State management** – Tab-specific scan results are stored in `chrome.storage.session`, which survives service worker suspensions but clears automatically when the tab closes.
- **UI** – The popup is written in vanilla JavaScript and listens for scan updates via runtime messages. The floating widget in the content script gives the user a proactive nudge without being intrusive.

## Limitations and next steps

- Chrome's on-device APIs are still behind an early preview program; you may need to opt in or enable feature flags to gain access.
- Large documents are truncated to stay within the Prompt API's token limits. Future versions could chunk documents and merge the results.
- Highlighting flagged clauses directly on the page would require more advanced text anchoring, which is not yet implemented.

## License

This repository is available under the MIT License. See `LICENSE` for details.
