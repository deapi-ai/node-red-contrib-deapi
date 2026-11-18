'use strict';

const assert = require('assert');
const helper = require('node-red-node-test-helper');
const deapiNode = require('../nodes/deapi.js');
const configNode = require('../nodes/deapi-config.js');
const { DeapiClient, buildRequest } = require('../lib/client');

helper.init(require.resolve('node-red'));

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function flow(operation, extra = {}) {
  return [
    { id: 'c1', type: 'deapi-config', name: 'deAPI' },
    { id: 'n1', type: 'deapi', deapi: 'c1', operation, wires: [['out']], ...extra },
    { id: 'out', type: 'helper' },
  ];
}

const MODELS = {
  data: [
    { slug: 'Flux1schnell', inference_types: ['txt2img'], info: { defaults: { steps: 4, width: 768, height: 768, quality: null, negative_prompt: 'Negative prompt' }, limits: {} } },
    { slug: 'AceStep_1_5_Turbo', inference_types: ['txt2music'], info: { defaults: { format: 'mp3' }, limits: { min_steps: 8, min_guidance: 1 } } },
  ],
};

describe('deapi node (mocked API)', function () {
  let realFetch;
  let calls;

  beforeEach(function (done) {
    realFetch = globalThis.fetch;
    calls = [];
    helper.startServer(done);
  });

  afterEach(function (done) {
    globalThis.fetch = realFetch;
    helper.unload().then(() => helper.stopServer(done));
  });

  function mockFetch(responses) {
    globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      const next = responses.shift();
      if (!next) throw new Error('unexpected fetch ' + url);
      return typeof next === 'function' ? next(url, init) : next;
    };
  }

  it('loads with its config node', function (done) {
    helper.load([configNode, deapiNode], flow('generate-image', { name: 'img' }), function () {
      const n1 = helper.getNode('n1');
      assert.strictEqual(n1.name, 'img');
      assert.strictEqual(n1.operation, 'generate-image');
      done();
    });
  });

  it('generates an image: model defaults, job polling, Buffer output', function (done) {
    mockFetch([
      jsonResponse(MODELS),
      jsonResponse({ data: { request_id: 'r1' } }),
      jsonResponse({ data: { status: 'processing', progress: 40 } }),
      jsonResponse({ data: { status: 'done', result_url: 'https://results.example/img.png', price: { amount: 0.002 } } }),
      new Response(Buffer.from('PNG'), { headers: { 'Content-Type': 'image/png' } }),
    ]);
    helper.load([configNode, deapiNode], flow('generate-image'), { c1: { apiKey: 'test-key' } }, function () {
      const n1 = helper.getNode('n1');
      helper.getNode('out').on('input', function (msg) {
        try {
          assert.ok(Buffer.isBuffer(msg.payload));
          assert.strictEqual(msg.payload.toString(), 'PNG');
          assert.strictEqual(msg.contentType, 'image/png');
          assert.strictEqual(msg.deapi.requestId, 'r1');
          assert.strictEqual(msg.deapi.model, 'Flux1schnell');
          const submit = calls[1];
          assert.ok(submit.url.endsWith('/images/generations'));
          assert.strictEqual(submit.init.headers.Authorization, 'Bearer test-key');
          const body = JSON.parse(submit.init.body);
          assert.deepStrictEqual(body, { model: 'Flux1schnell', steps: 4, width: 1024, height: 768, prompt: 'a red fox', seed: -1 });
          done();
        } catch (err) {
          done(err);
        }
      });
      // client polls every 2 s by default; shorten for the test
      const client = n1.configNode.getClient();
      const wait = client.waitForJob.bind(client);
      client.waitForJob = (id, opts) => wait(id, { ...opts, intervalMs: 1 });
      n1.receive({ payload: 'a red fox', params: { width: 1024 } });
    });
  });

  it('reports API errors on the node', function (done) {
    mockFetch([jsonResponse({ message: 'Unauthenticated.' }, 401)]);
    helper.load([configNode, deapiNode], flow('remove-background'), { c1: { apiKey: 'bad' } }, function () {
      const n1 = helper.getNode('n1');
      n1.on('call:error', function (call) {
        try {
          assert.match(String(call.args[0]), /401: Unauthenticated/);
          done();
        } catch (err) {
          done(err);
        }
      });
      n1.receive({ payload: Buffer.from('fake-image') });
    });
  });

  it('rejects a missing prompt for edit-image', function (done) {
    helper.load([configNode, deapiNode], flow('edit-image'), { c1: { apiKey: 'k' } }, function () {
      const n1 = helper.getNode('n1');
      n1.on('call:error', function (call) {
        try {
          assert.match(String(call.args[0]), /prompt/);
          done();
        } catch (err) {
          done(err);
        }
      });
      mockFetch([]);
      n1.receive({ payload: Buffer.from('img') });
    });
  });
});

describe('request builder', function () {
  const client = new DeapiClient({ apiKey: 'k', fetchImpl: async () => jsonResponse(MODELS) });

  it('sends a media URL as source_url for transcription', async function () {
    const req = await buildRequest(client, 'transcribe', { payload: 'https://www.youtube.com/watch?v=abc' });
    assert.strictEqual(req.path, '/audio/transcriptions');
    assert.strictEqual(req.init.body.get('source_url'), 'https://www.youtube.com/watch?v=abc');
    assert.strictEqual(req.init.body.get('model'), 'WhisperLargeV3');
  });

  it('adds music-specific defaults', async function () {
    const req = await buildRequest(client, 'generate-music', { payload: 'lo-fi piano' });
    const form = req.init.body;
    assert.strictEqual(form.get('caption'), 'lo-fi piano');
    assert.strictEqual(form.get('lyrics'), '[Instrumental]');
    assert.strictEqual(form.get('inference_steps'), '8');
    assert.strictEqual(form.get('guidance_scale'), '1');
    assert.strictEqual(form.get('format'), 'mp3');
  });

  it('uploads an image Buffer under the operation field name', async function () {
    const req = await buildRequest(client, 'animate-image', { payload: Buffer.from('img'), prompt: 'orbit' });
    assert.ok(req.init.body.get('first_frame_image'));
    assert.strictEqual(req.init.body.get('prompt'), 'orbit');
  });
});

describe('deapi node (live API)', function () {
  before(function () {
    if (!process.env.DEAPI_API_KEY) this.skip();
  });
  beforeEach(function (done) {
    helper.startServer(done);
  });
  afterEach(function (done) {
    helper.unload().then(() => helper.stopServer(done));
  });

  function liveRun(operation, msg, check) {
    return new Promise((resolve, reject) => {
      helper.load([configNode, deapiNode], flow(operation), { c1: { apiKey: process.env.DEAPI_API_KEY } }, function () {
        const n1 = helper.getNode('n1');
        n1.on('call:error', (call) => reject(call.args[0]));
        helper.getNode('out').on('input', (out) => {
          try {
            check(out);
            resolve(out);
          } catch (err) {
            reject(err);
          }
        });
        n1.receive(msg);
      });
    });
  }

  it('generates an image, removes its background and reads speech back', async function () {
    const img = await liveRun('generate-image', { payload: 'A green apple on a white table, product photo' }, (m) => {
      assert.ok(Buffer.isBuffer(m.payload) && m.payload.length > 10000);
      assert.strictEqual(m.contentType, 'image/png');
    });
    await helper.unload();
    await liveRun('remove-background', { payload: img.payload }, (m) => assert.ok(m.payload.length > 10000));
    await helper.unload();
    const speech = await liveRun('text-to-speech', { payload: 'Hello from Node-RED.' }, (m) => assert.ok(m.payload.length > 1000));
    await helper.unload();
    await liveRun('transcribe', { payload: speech.payload }, (m) => assert.match(m.payload.toLowerCase(), /hello/));
  });
});
