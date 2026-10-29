const AUTHOR_NAME = "Sanjay Kollimarla";
const AUTHOR_URL = "https://github.com/sanjay-kollimarla";
const REPO_URL = "https://github.com/sanjay-kollimarla/TinyURL";

/** Two interlocked chain links on a rounded blue tile; scales cleanly down to 16px. */
export const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<rect width="64" height="64" rx="14" fill="#2563eb"/>
<g fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round">
<rect x="11" y="33" width="26" height="14" rx="7" transform="rotate(-45 24 40)"/>
<rect x="27" y="17" width="26" height="14" rx="7" transform="rotate(-45 40 24)"/>
</g>
</svg>`;

/** Minimal self-contained page so the service is usable from a browser. */
export const LANDING_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="author" content="${AUTHOR_NAME}">
<meta name="description" content="Distributed URL shortener built by ${AUTHOR_NAME}: Bun, TypeScript, MongoDB, Redis.">
<title>TinyURL by ${AUTHOR_NAME}</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>
  :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
  body { max-width: 34rem; margin: 0 auto; padding: 0 1rem 3rem; }
  header { display: flex; justify-content: space-between; align-items: center; gap: 1rem;
           padding: 1rem 0; border-bottom: 1px solid #8884; margin-bottom: 2.5rem; flex-wrap: wrap; }
  .brand { display: flex; align-items: center; gap: .6rem; font-weight: 700; font-size: 1.1rem; }
  .brand img { width: 28px; height: 28px; }
  .by { font-size: .9rem; opacity: .85; }
  .by a { color: inherit; font-weight: 600; }
  h1 { margin-bottom: .25rem; }
  p.sub { margin-top: 0; opacity: .7; }
  form { display: grid; gap: .75rem; }
  input, button { font: inherit; padding: .6rem .75rem; border-radius: .4rem; border: 1px solid #8886; }
  button { cursor: pointer; background: #2563eb; color: #fff; border: 0; }
  .row { display: grid; grid-template-columns: 1fr 1fr; gap: .75rem; }
  #result { margin-top: 1.25rem; word-break: break-all; }
  .err { color: #dc2626; }
  footer { margin-top: 3rem; font-size: .85rem; opacity: .7; line-height: 1.6; }
  footer a { color: inherit; }
</style>
</head>
<body>
<header>
  <div class="brand"><img src="/favicon.svg" alt="">TinyURL</div>
  <div class="by">Designed &amp; built by <a href="${AUTHOR_URL}" target="_blank" rel="noopener">${AUTHOR_NAME}</a></div>
</header>
<h1>Shorten a link</h1>
<p class="sub">Optional alias and expiry. Redirects are cached in Redis and clicks are counted asynchronously.</p>
<form id="f">
  <input name="url" type="url" placeholder="https://example.com/a/very/long/link" required>
  <div class="row">
    <input name="alias" placeholder="custom alias (optional)">
    <input name="ttlSeconds" type="number" min="60" placeholder="expires in seconds (optional)">
  </div>
  <input name="apiKey" type="password" placeholder="API key (only if the server requires one)" autocomplete="off">
  <button>Shorten</button>
</form>
<div id="result" aria-live="polite"></div>
<footer>
  Built by <a href="${AUTHOR_URL}" target="_blank" rel="noopener">${AUTHOR_NAME}</a> with Bun, TypeScript, MongoDB and Redis.
  <a href="${REPO_URL}" target="_blank" rel="noopener">Source on GitHub</a>
</footer>
<script>
document.getElementById("f").addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target));
  const body = { url: data.url };
  if (data.alias) body.alias = data.alias;
  if (data.ttlSeconds) body.ttlSeconds = Number(data.ttlSeconds);
  const headers = { "content-type": "application/json" };
  if (data.apiKey) headers["x-api-key"] = data.apiKey;
  const out = document.getElementById("result");
  try {
    const res = await fetch("/api/v1/links", { method: "POST", headers, body: JSON.stringify(body) });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error?.message ?? "Request failed");
    out.replaceChildren();
    const a = Object.assign(document.createElement("a"), { href: json.shortUrl, textContent: json.shortUrl });
    out.append("Short link: ", a);
  } catch (err) {
    out.className = "err";
    out.textContent = err.message;
    return;
  }
  out.className = "";
});
</script>
</body>
</html>`;
