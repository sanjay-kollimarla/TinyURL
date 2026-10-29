import { loadConfig } from "./config/env";
import { buildContainer } from "./container";

const config = loadConfig();
const { app, logger, drain, shutdown } = await buildContainer(config);

const server = Bun.serve({
  port: config.PORT,
  fetch: (request, srv) => app.fetch(request, { ip: srv.requestIP(request)?.address }),
  // Lets several instances share one port on Linux for multi-core scaling.
  reusePort: true,
});
logger.info({ port: server.port }, "tinyurl listening");

let stopping = false;
async function stop(signal: string, exitCode = 0): Promise<void> {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, "shutting down");

  // Hard deadline so a hung dependency can never block a deploy.
  setTimeout(() => {
    logger.error({}, "graceful shutdown timed out");
    process.exit(1);
  }, config.SHUTDOWN_TIMEOUT_MS).unref();

  drain();
  await Bun.sleep(config.SHUTDOWN_GRACE_MS); // let the load balancer notice /readyz
  await server.stop(); // finishes in-flight requests
  await shutdown();
  process.exit(exitCode);
}

process.on("SIGTERM", () => void stop("SIGTERM"));
process.on("SIGINT", () => void stop("SIGINT"));
process.on("unhandledRejection", (err) => {
  logger.error({ err }, "unhandled rejection");
  void stop("unhandledRejection", 1);
});
process.on("uncaughtException", (err) => {
  logger.error({ err }, "uncaught exception");
  void stop("uncaughtException", 1);
});
