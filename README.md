# Ask AI

A Chrome extension that answers questions about the page or YouTube video you're on, using the AI model built into your browser. Nothing leaves your device.

## What it does

- **Page Q&A.** Ask anything about the article, post, or page you're reading.
- **YouTube Q&A.** Ask about a video — answers are based on the captions, no watching required.
- **Page-aware suggestions.** Starter questions adapt to the kind of page you're on.

All of it runs on Chrome's built-in Gemini Nano. No API keys, no server round-trips, no account.

## Who it's for

Anyone who wants quick answers about what they're reading or watching, without sending every page they visit to a third-party server. If you've tried browser-based AI assistants and uninstalled them once you noticed the privacy policy, this is the same shape of tool with the privacy problem removed.

## How to get it

Coming soon to the Chrome Web Store.

In the meantime, load it as an unpacked extension — see below.

## Run it locally

You'll need Chrome 138 or newer with Gemini Nano enabled. One-time Chrome setup:

1. Visit `chrome://flags/#optimization-guide-on-device-model` and set it to **Enabled BypassPerfRequirement**.
2. Restart Chrome.
3. Visit `chrome://components` and find **Optimization Guide On Device Model**. Click **Check for update** and wait for it to download.

Then load the extension:

1. Clone this repo: `git clone https://github.com/jtysonwilliams/Ask-AI.git`
2. Open `chrome://extensions`, turn on **Developer mode**.
3. Click **Load unpacked** and select the `AskAI` folder.
4. Pin the extension and click its icon on any page.

## Privacy

Page text is processed by Chrome's on-device AI model. Nothing is sent to a server, nothing is logged, no telemetry. See [PRIVACY.md](PRIVACY.md) for the full posture.

## License

MIT — see [LICENSE](LICENSE).

## Feedback

Email [feedback@joshapproved.com](mailto:feedback@joshapproved.com) with bugs, feature requests, or anything else.
