'use strict';

const DEFAULT_BASE_URL = 'https://api.deapi.ai/api/v2';
const FAILED = new Set(['error', 'failed', 'cancelled', 'canceled']);
// Values in the model catalog "defaults" that are UI placeholders, not real defaults.
const IGNORED_DEFAULTS = new Set(['prompt', 'negative_prompt', 'quality']);

/**
 * Operations supported by the node.
 * input:  'text'  msg.payload is the prompt or text
 *         'file'  msg.payload is an image Buffer or image URL
 *         'media' msg.payload is an audio/video Buffer or a media URL (YouTube, X, Twitch, Kick, direct link)
 * output: 'file' downloads result_url into a Buffer, 'text' returns the text result, 'json' parses the result
 * usesDefaults: true copies every model default (width, height, steps...), an array copies only those keys
 */
const OPERATIONS = {
  'generate-image': { label: 'Image: generate from text', path: '/images/generations', body: 'json', input: 'text', inference: 'txt2img', defaultModel: 'Flux1schnell', output: 'file', usesDefaults: true, seed: true },
  'edit-image': { label: 'Image: edit with a prompt', path: '/images/edits', body: 'form', input: 'file', fileField: 'image', inference: 'img2img', defaultModel: 'Flux_2_Klein_4B_BF16', output: 'file', needsPrompt: true, usesDefaults: ['steps'], seed: true },
  'remove-background': { label: 'Image: remove background', path: '/images/background-removals', body: 'form', input: 'file', fileField: 'image', inference: 'img-rmbg', defaultModel: 'Ben2', output: 'file' },
  'upscale-image': { label: 'Image: upscale 4x', path: '/images/upscales', body: 'form', input: 'file', fileField: 'image', inference: 'img-upscale', defaultModel: 'RealESRGAN_x4', output: 'file' },
  'image-to-text': { label: 'Image: extract text (OCR)', path: '/images/ocr', body: 'form', input: 'file', fileField: 'image', inference: 'img2txt', defaultModel: 'LightOnOcr_3_4B_Q8', output: 'text' },
  'generate-video': { label: 'Video: generate from text', path: '/videos/generations', body: 'json', input: 'text', inference: 'txt2video', defaultModel: 'Ltx2_5_22B_Dist_INT8', output: 'file', usesDefaults: true, seed: true },
  'animate-image': { label: 'Video: animate an image', path: '/videos/animations', body: 'form', input: 'file', fileField: 'first_frame_image', inference: 'img2video', defaultModel: 'Ltx2_5_22B_Dist_INT8', output: 'file', needsPrompt: true, usesDefaults: true, seed: true },
  'text-to-speech': { label: 'Audio: text to speech', path: '/audio/speech', body: 'json', input: 'text', textField: 'text', inference: 'txt2audio', defaultModel: 'Kokoro', output: 'file', usesDefaults: true },
  'transcribe': { label: 'Audio/Video: transcribe (file or URL)', path: '/audio/transcriptions', body: 'form', input: 'media', inference: 'audio_file2text', defaultModel: 'WhisperLargeV3Ct2', output: 'text' },
  'generate-music': { label: 'Audio: generate music', path: '/audio/music', body: 'form', input: 'text', textField: 'caption', inference: 'txt2music', defaultModel: 'AceStep_1_5_XL_Turbo_INT8', output: 'file', usesDefaults: true, seed: true },
  'embeddings': { label: 'Text: create embeddings', path: '/embeddings', body: 'json', input: 'text', textField: 'input', inference: 'txt2embedding', defaultModel: 'Bge_M3_FP16', output: 'json' },
};

class DeapiClient {
  constructor({ apiKey, baseUrl, fetchImpl } = {}) {
    if (!apiKey) throw new Error('deAPI API key is missing. Add it in the deAPI config node.');
    this.apiKey = apiKey;
    this.baseUrl = (baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.fetch = fetchImpl || globalThis.fetch;
    this.modelsCache = null;
  }

  async request(path, init = {}) {
    const res = await this.fetch(this.baseUrl + path, {
      ...init,
      headers: { Accept: 'application/json', Authorization: `Bearer ${this.apiKey}`, ...(init.headers || {}) },
    });
    const text = await res.text();
    if (!res.ok) {
      let message = text;
      try {
        const parsed = JSON.parse(text);
        message = parsed.message || text;
        if (parsed.errors) message += ' ' + JSON.stringify(parsed.errors);
      } catch (_) {
        // keep the raw body
      }
      const err = new Error(`deAPI ${path} failed with ${res.status}: ${message}`);
      err.statusCode = res.status;
      throw err;
    }
    return text ? JSON.parse(text) : {};
  }

  async listModels() {
    if (!this.modelsCache || Date.now() - this.modelsCache.at > 10 * 60 * 1000) {
      const body = await this.request('/models?per_page=200');
      this.modelsCache = { at: Date.now(), data: body.data || [] };
    }
    return this.modelsCache.data;
  }

  async modelDefaults(slug, keys) {
    const model = (await this.listModels()).find((m) => m.slug === slug);
    if (!model) return {};
    const info = model.info || {};
    const out = {};
    for (const [key, value] of Object.entries(info.defaults || {})) {
      if (IGNORED_DEFAULTS.has(key) || value === null || value === undefined) continue;
      if (Array.isArray(keys) && !keys.includes(key)) continue;
      out[key] = value;
    }
    const limits = info.limits || {};
    const wantsSteps = keys === true || (Array.isArray(keys) && keys.includes('steps'));
    if (out.steps === undefined && wantsSteps && limits.min_steps) out.steps = limits.min_steps;
    if ((info.inference_types || model.inference_types || []).includes('txt2music')) {
      // Music models expect inference_steps / guidance_scale instead of steps.
      delete out.steps;
      if (out.inference_steps === undefined) out.inference_steps = limits.min_steps || 8;
      if (out.guidance_scale === undefined) out.guidance_scale = limits.min_guidance || 1;
    }
    return out;
  }

  async getJob(requestId) {
    const body = await this.request(`/jobs/${encodeURIComponent(requestId)}`);
    return body.data || body;
  }

  async waitForJob(requestId, { timeoutMs = 600000, intervalMs = 2000, onProgress } = {}) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const job = await this.getJob(requestId);
      if (job.status === 'done') return job;
      if (FAILED.has(job.status)) {
        const reason = [job.error_code, job.error_reason].filter(Boolean).join(': ') || 'unknown error';
        const err = new Error(`deAPI job ${requestId} failed: ${reason}`);
        err.job = job;
        throw err;
      }
      if (onProgress) onProgress(job);
      if (Date.now() > deadline) throw new Error(`deAPI job ${requestId} did not finish within ${Math.round(timeoutMs / 1000)} s`);
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  async download(url) {
    const res = await this.fetch(url);
    if (!res.ok) throw new Error(`Could not download the deAPI result (${res.status})`);
    return {
      buffer: Buffer.from(await res.arrayBuffer()),
      contentType: (res.headers.get('content-type') || '').split(';')[0] || undefined,
    };
  }
}

function isUrl(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value.trim());
}

/** Build the HTTP request for an operation. Returns { path, init, model }. */
async function buildRequest(client, operationId, { payload, model, prompt, params, filename } = {}) {
  const op = OPERATIONS[operationId];
  if (!op) throw new Error(`Unknown operation "${operationId}"`);
  const slug = model || op.defaultModel;
  const own = {};
  if (op.input === 'text') {
    const text = typeof payload === 'string' || typeof payload === 'number' ? String(payload) : prompt;
    if (!text || !String(text).trim()) throw new Error('msg.payload must contain the text or prompt');
    own[op.textField || 'prompt'] = String(text);
  } else if (op.needsPrompt) {
    const p = prompt || (typeof payload === 'string' && !isUrl(payload) ? payload : undefined);
    if (!p) throw new Error('Set a prompt (node property or msg.prompt) for this operation');
    own.prompt = p;
  }

  const defaults = op.usesDefaults ? await client.modelDefaults(slug, op.usesDefaults) : {};
  const fields = { model: slug, ...defaults, ...own };
  if (operationId === 'generate-music') {
    if (fields.lyrics === undefined) fields.lyrics = '[Instrumental]';
    if (fields.duration === undefined) fields.duration = 30;
  }
  if (op.seed && fields.seed === undefined) fields.seed = -1;
  if (operationId === 'transcribe') fields.include_ts = false;
  Object.assign(fields, params || {});

  if (op.body === 'json') {
    return { path: op.path, model: slug, init: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields) } };
  }

  const form = new FormData();
  if (op.input === 'media') {
    if (Buffer.isBuffer(payload)) form.append('source_file', new Blob([new Uint8Array(payload)]), filename || 'audio.mp3');
    else if (isUrl(payload)) form.append('source_url', payload.trim());
    else throw new Error('msg.payload must be a Buffer (audio or video file) or a media URL');
  } else if (op.input === 'file') {
    let buffer = payload;
    if (isUrl(payload)) buffer = (await client.download(payload.trim())).buffer;
    if (!Buffer.isBuffer(buffer)) throw new Error('msg.payload must be an image Buffer or an image URL');
    form.append(op.fileField, new Blob([new Uint8Array(buffer)]), filename || 'image.png');
  }
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    form.append(key, typeof value === 'object' ? JSON.stringify(value) : typeof value === 'boolean' ? (value ? '1' : '0') : String(value));
  }
  return { path: op.path, model: slug, init: { method: 'POST', body: form } };
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch (_) {
    return text;
  }
}

/** Run an operation end to end. Returns { payload, job, requestId, model, contentType, details }. */
async function runOperation(client, operationId, input, { output = 'auto', timeoutMs, intervalMs, onProgress } = {}) {
  const op = OPERATIONS[operationId];
  const req = await buildRequest(client, operationId, input);
  const submitted = await client.request(req.path, req.init);
  const requestId = (submitted.data && submitted.data.request_id) || submitted.request_id;
  if (!requestId) throw new Error('deAPI did not return a request_id');
  const job = await client.waitForJob(requestId, { timeoutMs, intervalMs, onProgress });

  let payload = job.result_url || job.result;
  let contentType;
  let details;
  if (output !== 'url') {
    if (op.output === 'json') {
      let raw = job.result;
      if ((raw === null || raw === undefined) && job.result_url) raw = (await client.download(job.result_url)).buffer.toString('utf8');
      payload = typeof raw === 'string' ? safeJson(raw) : raw;
    } else if (op.output === 'text') {
      let raw = typeof job.result === 'string' && job.result ? job.result : undefined;
      if (raw === undefined && job.result_url) raw = (await client.download(job.result_url)).buffer.toString('utf8');
      if (raw !== undefined) {
        // Some models (for example WhisperLargeV3Ct2) return JSON such as { text, language, segments }.
        const parsed = safeJson(raw.trim());
        if (parsed && typeof parsed === 'object' && typeof parsed.text === 'string') {
          payload = parsed.text.trim();
          details = parsed;
        } else {
          payload = raw.trim();
        }
      }
    } else if (job.result_url) {
      const file = await client.download(job.result_url);
      payload = file.buffer;
      contentType = file.contentType;
    }
  }
  return { payload, job, requestId, model: req.model, contentType, details };
}

module.exports = { DeapiClient, OPERATIONS, buildRequest, runOperation, DEFAULT_BASE_URL };
