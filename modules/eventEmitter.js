const Emitter = require('events');

const emitter = new Emitter();

const events = {
  'parameters:update': 'parameters_update',
};


module.exports = { emitter, events };
