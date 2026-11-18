# node-red-contrib-deapi

[Node-RED](https://nodered.org) nodes for [deAPI](https://deapi.ai). They run open-source AI models for images, video, speech, transcription, music and embeddings, with one API key and pay-per-use pricing.

| Operation | Input (`msg.payload`) | Output (`msg.payload`) | Default model |
| --- | --- | --- | --- |
| Image: generate from text | prompt | PNG `Buffer` | FLUX.1 schnell |
| Image: edit with a prompt | image `Buffer`/URL + `msg.prompt` | PNG `Buffer` | FLUX.2 Klein 4B |
| Image: remove background | image `Buffer`/URL | transparent PNG `Buffer` | Ben2 |
| Image: upscale 4x | image `Buffer`/URL | PNG `Buffer` | RealESRGAN x4 |
| Image: extract text (OCR) | image `Buffer`/URL | text | Nanonets OCR |
| Video: generate from text | prompt | MP4 `Buffer` | LTX-2.3 22B |
| Video: animate an image | image `Buffer`/URL + `msg.prompt` | MP4 `Buffer` | LTX-2.3 22B |
| Audio: text to speech | text | MP3 `Buffer` | Kokoro (41 voices) |
| Audio/Video: transcribe | audio/video `Buffer`, or a YouTube, X, Twitch, Kick or direct URL | text | Whisper Large V3 |
| Audio: generate music | description (`msg.params.lyrics` optional) | MP3 `Buffer` | ACE-Step 1.5 Turbo |
| Text: create embeddings | text | vectors (array) | BGE-M3 |

Every other model in the deAPI catalog can be selected in the **Model** field.

## Install

From the Node-RED editor: **Menu → Manage palette → Install**, search for `node-red-contrib-deapi`.

Or from your Node-RED user directory (usually `~/.node-red`):

```bash
npm install node-red-contrib-deapi
```

Requires Node-RED 3.0 or newer and Node.js 18 or newer. The package has no runtime dependencies.

## Setup

1. Get an API key at [app.deapi.ai](https://app.deapi.ai/register).
2. Drop a **deAPI** node (category **AI**) into a flow, open it and add a new **deAPI config** with your key.
3. Pick an operation and deploy.

After you deploy the config node, the **Model** field suggests every model available for the selected operation.

## Usage

The node submits a job, waits for it to finish (the node status shows progress) and returns the result:

- `msg.payload`: the file as a `Buffer`, the text, or the embedding vectors
- `msg.contentType`: for example `image/png`, `video/mp4`, `audio/mpeg`
- `msg.deapi`: `{ operation, model, requestId, resultUrl, price }`

Set **Output** to **Result URL only** to skip the download and get the result URL instead. The URL is valid for a few hours.

### Overrides from the message

| Property | Example |
| --- | --- |
| `msg.model` | `"ZImageTurbo_INT8"` |
| `msg.prompt` | `"make the background a sunny beach"` |
| `msg.params` | `{"width": 1024, "height": 768}`, `{"voice": "bm_george", "lang": "en-gb", "speed": 1.1}`, `{"duration": 60, "lyrics": "[Instrumental]"}` |
| `msg.filename` | `"meeting.wav"` (name of an uploaded `Buffer`) |
| `msg.operation` | `"remove-background"` |

Model defaults (size, steps, voice, frame count) come from the deAPI model catalog, so most operations only need `msg.payload`.

## Example flows

Import from **Menu → Import → Examples → node-red-contrib-deapi**:

- **Product photo cleanup**: image URL → upscale 4x → remove background → transparent PNG on disk
- **Transcribe a video**: YouTube URL → Whisper transcript → text file
- **Generate image, video and speech**: three prompts → `image.png`, `video.mp4`, `voice.mp3`

Tip: run **upscale** before **remove background**. The upscaler returns an RGB image, so it would drop the transparency.

## Pricing

You pay deAPI per job, for example about $0.002 for a FLUX image, $0.0003 for a background removal and $0.00003 for a short voice line. See [deapi.ai/pricing](https://deapi.ai/pricing).

## Development

```bash
npm install
npm test                         # mocked tests
DEAPI_API_KEY=... npm test       # adds a live end-to-end test
```

## Links

- [deAPI documentation](https://docs.deapi.ai)
- [Issues](https://github.com/deapi-ai/node-red-contrib-deapi/issues)

## License

MIT
