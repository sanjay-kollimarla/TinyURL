import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";
import type { z } from "zod";
import type { LinkService } from "../../application/link.service";
import type { Logger, RateLimiter } from "../../application/ports";
import type { RedirectService } from "../../application/redirect.service";
import { ValidationError } from "../../domain/errors";
import type { Link } from "../../domain/link";
import { errorHandler } from "./error-handler";
import { FAVICON_SVG, LANDING_HTML } from "./landing";
import { type AppEnv, apiKeyAuth, rateLimit } from "./middleware";
import { requestContext } from "./request-context";
import { createLinkSchema, statsQuerySchema } from "./schemas";
import { tracing } from "./tracing";

export interface HttpMetrics {
  observeRequest(method: string, route: string, status: number, seconds: number): void;
  render(): Promise<string>;
}

export interface AppDependencies {
  readonly linkService: LinkService;
  readonly redirectService: RedirectService;
  readonly rateLimiter: RateLimiter;
  readonly logger: Logger;
  readonly baseUrl: string;
  readonly apiKey: string | undefined;
  readonly trustProxy: boolean;
  readonly tracingEnabled?: boolean | undefined;
  readonly metrics?: HttpMetrics | undefined;
  /** Resolves when dependencies are reachable; rejects otherwise. */
  readonly checkReadiness: () => Promise<void>;
}

const MAX_BODY_BYTES = 16 * 1024;
const CODE_ROUTE = "/:code{[A-Za-z0-9_-]{3,32}}";

export function createApp(deps: AppDependencies): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const base = deps.baseUrl.replace(/\/+$/, "");
  const present = (link: Link) => toResponse(link, base);

  app.onError(errorHandler(deps.logger));

  if (deps.tracingEnabled) app.use(tracing());

  const { metrics } = deps;
  if (metrics) {
    app.use(async (c, next) => {
      const started = performance.now();
      await next();
      metrics.observeRequest(
        c.req.method,
        c.req.routePath === CODE_ROUTE ? "/:code" : c.req.routePath,
        c.res.status,
        (performance.now() - started) / 1000,
      );
    });
    app.get("/metrics", apiKeyAuth(deps.apiKey), async (c) => c.text(await metrics.render()));
  }

  app.get("/", (c) => c.html(LANDING_HTML));
  const favicon = (c: Context) =>
    c.body(FAVICON_SVG, 200, { "content-type": "image/svg+xml", "cache-control": "public, max-age=86400" });
  app.get("/favicon.svg", favicon);
  app.get("/favicon.ico", favicon);
  app.notFound((c) => c.json({ error: { code: "NOT_FOUND", message: "Route not found" } }, 404));

  app.get("/healthz", (c) => c.json({ status: "ok" }));
  app.get("/readyz", async (c) => {
    try {
      await deps.checkReadiness();
      return c.json({ status: "ready" });
    } catch (err) {
      deps.logger.error({ err }, "readiness check failed");
      return c.json({ status: "unavailable" }, 503);
    }
  });

  const api = new Hono<AppEnv>();
  api.use(requestContext(deps.logger));
  api.use(secureHeaders());
  api.use(
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (c) => c.json({ error: { code: "PAYLOAD_TOO_LARGE", message: "Request body too large" } }, 413),
    }),
  );
  api.use(apiKeyAuth(deps.apiKey));

  api.post("/links", rateLimit(deps.rateLimiter, deps.trustProxy), async (c) => {
    const body = await parseJson(c.req.raw, createLinkSchema);
    const { link, created } = await deps.linkService.create({
      longUrl: body.url,
      alias: body.alias,
      ttlSeconds: body.ttlSeconds,
      expiresAt: body.expiresAt,
    });
    return c.json(present(link), created ? 201 : 200);
  });

  api.get("/links/:code/stats", async (c) => {
    const { days } = parse(statsQuerySchema, c.req.query());
    const { link, daily } = await deps.linkService.getStats(c.req.param("code"), days);
    return c.json({
      ...present(link),
      totalClicks: link.clickCount,
      lastClickedAt: link.lastClickedAt?.toISOString() ?? null,
      daily,
    });
  });

  api.delete("/links/:code", async (c) => {
    await deps.linkService.delete(c.req.param("code"));
    return c.body(null, 204);
  });

  app.route("/api/v1", api);

  // Registered last so that fixed paths above always win.
  app.get(CODE_ROUTE, async (c) => {
    const destination = await deps.redirectService.resolve(c.req.param("code"), {
      referrer: c.req.header("referer") ?? null,
      userAgent: c.req.header("user-agent")?.slice(0, 256) ?? null,
    });
    // 302, not 301: browsers must keep hitting us so analytics and expiry stay accurate.
    return c.redirect(destination, 302);
  });

  return app;
}

function toResponse(link: Link, base: string) {
  return {
    code: link.code,
    shortUrl: `${base}/${link.code}`,
    longUrl: link.longUrl,
    createdAt: link.createdAt.toISOString(),
    expiresAt: link.expiresAt?.toISOString() ?? null,
  };
}

function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const detail = result.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
  throw new ValidationError(detail);
}

async function parseJson<S extends z.ZodType>(request: Request, schema: S): Promise<z.output<S>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ValidationError("Request body must be valid JSON");
  }
  return parse(schema, body);
}
