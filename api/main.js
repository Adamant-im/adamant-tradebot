const { start } = require('./server');

start().catch((error) => {
  console.error(`WebUI API failed to start: ${error?.stack || error}`);
  process.exit(1);
});
