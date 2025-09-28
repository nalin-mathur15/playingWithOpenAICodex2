# Policy Guardian Chrome Extension

Policy Guardian is a Chrome extension prototype built for the Google Chrome Built-in AI Challenge 2025. It keeps an eye on the pages you visit, detects when you're reading a Terms of Service or Privacy Policy, and uses Chrome's on-device AI APIs to highlight risky clauses.

## Features

- 🔍 **Automatic detection** – Heuristics watch the URL, titles, and headings to detect policy-like documents. A floating call-to-action offers to scan the page when a match is found.
- 🧠 **On-device AI analysis** – When available, the extension calls the Prompt API to request a structured JSON with suspicious clauses and risk levels. A summary is generated with the Summarizer API and clauses are rephrased for clarity to get rid of legal jargon using the Rewriter API.
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

1. Clone this repository and open the `extension/` folder in Chrome's Extensions page (`chrome://extensions`).
2. Enable **Developer mode** in the top right corner.
3. Click **Load unpacked** and select the `extension/` directory.
4. Visit any Terms of Service or Privacy Policy page. A floating “Scan for risky clauses” button should appear. You can also open the extension popup and run a manual scan at any time.

## Development notes

- **Prompt shaping** – `service_worker.js` requests structured JSON from the Prompt API to ensure the popup can render heatmaps and clause details without additional parsing.
- **Fallbacks** – When AI APIs are disabled or error out (unsupported hardware, etc.), a keyword-based fallback is used for analysis.
- **State management** – Tab-specific scan results are stored in `chrome.storage.session`, which survives service worker suspensions but clears automatically when the tab closes.
- **UI** – The popup is written in vanilla JavaScript and listens for scan updates via runtime messages. The floating widget in the content script gives the user a proactive nudge without being intrusive.

## Limitations and next steps

- Large documents are truncated to stay within the Prompt API's token limits. Future versions could chunk documents and merge the results.
- Highlighting flagged clauses directly on the page would require more advanced text anchoring. Future versions would implement such cleaner integrations into the browsing experience.

## License

This repository is available under the MIT License. See `LICENSE` for details.
