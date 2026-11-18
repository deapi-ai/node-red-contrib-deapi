'use strict';

const { DeapiClient, OPERATIONS } = require('../lib/client');

module.exports = function (RED) {
  function DeapiConfigNode(config) {
    RED.nodes.createNode(this, config);
    this.name = config.name;
    this.baseUrl = config.baseUrl || undefined;
    this.getClient = () => {
      if (!this.client) {
        this.client = new DeapiClient({ apiKey: this.credentials && this.credentials.apiKey, baseUrl: this.baseUrl });
      }
      return this.client;
    };
  }

  RED.nodes.registerType('deapi-config', DeapiConfigNode, {
    credentials: {
      apiKey: { type: 'password' },
    },
  });

  // Model list for the editor dropdown. Only works for a deployed config node (credentials live on the server).
  RED.httpAdmin.get('/deapi/models/:configId', RED.auth.needsPermission('flows.read'), async (req, res) => {
    const configNode = RED.nodes.getNode(req.params.configId);
    if (!configNode || !configNode.getClient) {
      res.status(404).json({ error: 'Deploy the deAPI config node first to load the model list.' });
      return;
    }
    try {
      const models = await configNode.getClient().listModels();
      const op = OPERATIONS[req.query.operation];
      const filtered = op ? models.filter((m) => (m.inference_types || []).some((t) => t === op.inference || (op.inference === 'audio_file2text' && /2text$/.test(t)))) : models;
      res.json(filtered.map((m) => ({ slug: m.slug, name: m.name || m.slug })));
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });
};
