/** Minimal self-contained page so the service is usable from a browser. */
export const LANDING_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TinyURL</title>
<style>
  :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
  body { max-width: 34rem; margin: 4rem auto; padding: 0 1rem; }
  h1 { margin-bottom: .25rem; }
  p.sub { margin-top: 0; opacity: .7; }
  form { display: grid; gap: .75rem; }
  input, button { font: inherit; padding: .6rem .75rem; border-radius: .4rem; border: 1px solid #8886; }
  button { cursor: pointer; background: #2563eb; color: #fff; border: 0; }
  .row { display: grid; grid-template-columns: 1fr 1fr; gap: .75rem; }
  #result { margin-top: 1.25rem; word-break: break-all; }
  .err { color: #dc2626; }
</style>
</head>
<body>
<h1>TinyURL</h1>
<p class="sub">Shorten a link. Optional alias and expiry.</p>
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
