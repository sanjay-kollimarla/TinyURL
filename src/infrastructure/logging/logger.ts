import pino from "pino";
import type { Config } from "../../config/env";

/** Human-readable output in development, structured JSON everywhere else. */
export function createLogger(config: Pick<Config, "NODE_ENV" | "LOG_LEVEL">): pino.Logger {
  const base: pino.LoggerOptions = {
    level: config.LOG_LEVEL,
    redact: ["req.headers.authorization", 'req.headers["x-api-key"]'],
  };
  if (config.NODE_ENV !== "development") return pino(base);

  return pino({
    ...base,
    transport: {
      target: "pino-pretty",
      options: { colorize: true, translateTime: "SYS:HH:MM:ss.l", ignore: "pid,hostname" },
    },
  });
}
