import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  BASE_URL: z.string().url().default("http://localhost:3000"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

  MONGO_URI: z.string().min(1).default("mongodb://localhost:27017"),
  MONGO_DB: z.string().min(1).default("tinyurl"),
  MONGO_MAX_POOL_SIZE: z.coerce.number().int().positive().default(100),

  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
  /** Raise for managed Redis over the public internet (e.g. 1000). */
  REDIS_COMMAND_TIMEOUT_MS: z.coerce.number().int().positive().default(200),
  CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(86_400),
  NEGATIVE_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(60),

  CODE_LENGTH: z.coerce.number().int().min(6).max(8).default(7),
  ID_BLOCK_SIZE: z.coerce.number().int().positive().default(1_000),

  ANALYTICS_BATCH_SIZE: z.coerce.number().int().positive().default(500),
  ANALYTICS_FLUSH_INTERVAL_MS: z.coerce.number().int().positive().default(1_000),
  ANALYTICS_MAX_BUFFER: z.coerce.number().int().positive().default(50_000),
  CLICK_RETENTION_DAYS: z.coerce.number().int().positive().default(90),

  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),

  SHUTDOWN_GRACE_MS: z.coerce.number().int().min(0).default(0),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),

  /** Honour x-forwarded-for for client identity. Enable only behind a trusted proxy/load balancer. */
  TRUST_PROXY: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  CIRCUIT_FAILURE_THRESHOLD: z.coerce.number().int().positive().default(5),
  CIRCUIT_RESET_MS: z.coerce.number().int().positive().default(10_000),

  /** Tracing is off unless an OTLP/HTTP endpoint (e.g. http://collector:4318) is configured. */
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  OTEL_SERVICE_NAME: z.string().min(1).default("tinyurl"),
  OTEL_SAMPLE_RATIO: z.coerce.number().min(0).max(1).default(0.05),

  API_KEY: z.string().min(8).optional(),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid configuration: ${issues}`);
  }
  return parsed.data;
}
