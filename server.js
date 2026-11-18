const Application = require('./src/Application');

const port = Number.parseInt(process.env.PORT || '3000', 10);
const host = process.env.HOST || '127.0.0.1';
const application = new Application();

const server = application.app.listen(port, host, () => {
  console.log(`FindMySpecialist listening at http://${host}:${port}`);
});

server.on('error', error => {
  console.error(`Unable to start server: ${error.message}`);
  process.exitCode = 1;
});
