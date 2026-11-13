// Passenger loads this file with require(). Keep static imports out of the
// entrypoint because Next's server graph uses top-level await.
Promise.all([import('next'), import('node:http')]).then(([nextModule, httpModule]) => {
  const next = nextModule.default;
  const { createServer } = httpModule;
  const port = Number(process.env.PORT || 3000);
  const hostname = process.env.HOSTNAME || "0.0.0.0";
  const app = next({ dev: false, hostname, port });
  const handle = app.getRequestHandler();
  return app.prepare().then(() => {
    createServer((req, res) => handle(req, res)).listen(port, hostname, () => {
      console.log(`Vocero listening on ${hostname}:${port}`);
    });
  });
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
