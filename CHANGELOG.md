# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [0.1.0] - Unreleased

First release of `@deapi/node-red-deapi`.

### Added

- **deAPI** node with 11 operations: generate, edit, upscale and remove the background of images, OCR, generate and animate video, text to speech, transcription of audio/video files and URLs (YouTube, X, Twitch, Kick, direct links), music generation and text embeddings.
- **deAPI config** node that keeps the API key in Node-RED credentials.
- Model defaults (size, steps, voice, frame count) read from the deAPI model catalog (`GET /models`, all pages, cached for 10 minutes).
- Model suggestions in the editor for the selected operation, after the config node is deployed.
- Message overrides: `msg.model`, `msg.prompt`, `msg.params`, `msg.filename`, `msg.operation`, `msg.output`.
- Job progress in the node status, `msg.deapi` with `requestId`, `resultUrl`, `price` and the full transcript.
- Three example flows (Menu → Import → Examples).
- Requires Node-RED 4.0 or newer and Node.js 20 or newer. No runtime dependencies.

[0.1.0]: https://github.com/deapi-ai/node-red-contrib-deapi/releases/tag/v0.1.0
