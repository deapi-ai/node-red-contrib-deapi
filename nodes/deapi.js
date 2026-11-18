'use strict';

const { runOperation, OPERATIONS } = require('../lib/client');

module.exports = function (RED) {
  function DeapiNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;
    node.configNode = RED.nodes.getNode(config.deapi);
    node.operation = config.operation || 'generate-image';
    node.model = config.model || '';
    node.prompt = config.prompt || '';
    node.output = config.output || 'auto';
    node.timeout = Number(config.timeout) > 0 ? Number(config.timeout) : 600;
    let staticParams = {};
    if (config.params && config.params.trim()) {
      try {
        staticParams = JSON.parse(config.params);
      } catch (err) {
        node.error(`Extra parameters are not valid JSON: ${err.message}`);
      }
    }

    if (!node.configNode) {
      node.status({ fill: 'red', shape: 'ring', text: 'missing deAPI config' });
    }

    let active = 0;
    node.on('input', async (msg, send, done) => {
      send = send || function () { node.send.apply(node, arguments); };
      done = done || function (err) { if (err) node.error(err, msg); };

      if (!node.configNode) {
        done(new Error('Select or create a deAPI config node with your API key'));
        return;
      }
      const operation = msg.operation && OPERATIONS[msg.operation] ? msg.operation : node.operation;
      const msgParams = msg.params && typeof msg.params === 'object' ? msg.params : {};

      active += 1;
      node.status({ fill: 'blue', shape: 'dot', text: `${operation}: submitting` });
      try {
        const result = await runOperation(
          node.configNode.getClient(),
          operation,
          {
            payload: msg.payload,
            model: msg.model || node.model || undefined,
            prompt: msg.prompt || node.prompt || undefined,
            params: { ...staticParams, ...msgParams },
            filename: msg.filename,
          },
          {
            output: msg.output || node.output,
            timeoutMs: node.timeout * 1000,
            onProgress: (job) => {
              const pct = typeof job.progress === 'number' ? ` ${Math.round(job.progress)}%` : '';
              node.status({ fill: 'blue', shape: 'ring', text: `${operation}: ${job.status || 'processing'}${pct}` });
            },
          },
        );
        msg.payload = result.payload;
        if (result.contentType) msg.contentType = result.contentType;
        msg.deapi = {
          operation,
          model: result.model,
          requestId: result.requestId,
          resultUrl: result.job.result_url || null,
          price: result.job.price || null,
        };
        active -= 1;
        node.status(active > 0 ? { fill: 'blue', shape: 'dot', text: `${active} running` } : { fill: 'green', shape: 'dot', text: `${operation}: done` });
        send(msg);
        done();
      } catch (err) {
        active -= 1;
        node.status({ fill: 'red', shape: 'ring', text: err.message.slice(0, 60) });
        msg.deapi = { operation, error: err.message, requestId: err.job ? err.job.request_id : undefined };
        done(err);
      }
    });

    node.on('close', () => {
      node.status({});
    });
  }

  RED.nodes.registerType('deapi', DeapiNode);
};
