'use strict';

const tracing = require('./tracing');
const logger = require('./logger');
const shardMetrics = require('./shard-metrics');

module.exports = {
  ...tracing,
  ...logger,
  ...shardMetrics,
};
