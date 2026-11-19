const MAX_OBJECT_BYTES = 100 * 1024 * 1024;
const OBJECT_PREFIX = "/v1/objects/";
const ISSUER = "https://tdeotqfsbvouresfhkab.supabase.co/auth/v1";
let jwksCache = null;
let jwksFetchedAt = 0;

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map(v => v.trim()).filter(Boolean);
  const headers = new Headers({
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET, HEAD, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, Range",
    "Access-Control-Expose-Headers": "Content-Length, Content-Type, Content-Range, Accept-Ranges, ETag, Last-Modified",
    "Access-Control-Max-Age": "600",
    "X-Content-Type-Options": "nosniff"
  });
  if (origin && allowed.includes(origin)) headers.set("Access-Control-Allow-Origin", origin);
  return headers;
}

function json(data, status, headers) {
  const h = new Headers(headers);
  h.set("Content-Type", "application/json; charset=utf-8");
  h.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(data), { status, headers: h });
}

function decodePart(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function parseJsonPart(value) {
  return JSON.parse(new TextDecoder().decode(decodePart(value)));
}

async function getJwks() {
  const now = Date.now();
  if (jwksCache && now - jwksFetchedAt < 5 * 60 * 1000) return jwksCache;
  const response = await fetch(ISSUER + "/.well-known/jwks.json", {
    headers: { "Accept": "application/json" }
  });
  if (!response.ok) throw new Error("Supabase JWKS unavailable");
  const data = await response.json();
  if (!data || !Array.isArray(data.keys)) throw new Error("Invalid JWKS");
  jwksCache = data.keys;
  jwksFetchedAt = now;
  return jwksCache;
}

async function verifyAccessToken(token) {
  if (!token || token.length > 16384) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  let header, claims, signature;
  try {
    header = parseJsonPart(parts[0]);
    claims = parseJsonPart(parts[1]);
    signature = decodePart(parts[2]);
  } catch {
    return null;
  }

  if (!header || !claims || !header.kid || !["ES256", "RS256"].includes(header.alg)) return null;
  const now = Math.floor(Date.now() / 1000);
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.iss !== ISSUER ||
      !aud.includes("authenticated") ||
      claims.role !== "authenticated" ||
      claims.is_anonymous === true ||
      typeof claims.sub !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(claims.sub) ||
      !Number.isFinite(claims.exp) || claims.exp <= now ||
      (claims.nbf !== undefined && (!Number.isFinite(claims.nbf) || claims.nbf > now)) ||
      (claims.iat !== undefined && (!Number.isFinite(claims.iat) || claims.iat > now + 60))) return null;

  let keys;
  try { keys = await getJwks(); } catch { return null; }
  const jwk = keys.find(k => k.kid === header.kid && (!k.alg || k.alg === header.alg) && (!k.use || k.use === "sig"));
  if (!jwk) return null;

  try {
    let algorithm;
    if (header.alg === "ES256" && jwk.kty === "EC" && jwk.crv === "P-256") {
      algorithm = { name: "ECDSA", namedCurve: "P-256" };
      const key = await crypto.subtle.importKey("jwk", jwk, algorithm, false, ["verify"]);
      const valid = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, signature, new TextEncoder().encode(parts[0] + "." + parts[1]));
      return valid ? { id: claims.sub } : null;
    }
    if (header.alg === "RS256" && jwk.kty === "RSA") {
      algorithm = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };
      const key = await crypto.subtle.importKey("jwk", jwk, algorithm, false, ["verify"]);
      const valid = await crypto.subtle.verify(algorithm, key, signature, new TextEncoder().encode(parts[0] + "." + parts[1]));
      return valid ? { id: claims.sub } : null;
    }
    return null;
  } catch {
    return null;
  }
}

function getObjectKey(pathname, userId) {
  if (!pathname.startsWith(OBJECT_PREFIX)) return null;
  const raw = pathname.slice(OBJECT_PREFIX.length);
  if (!raw || raw.length > 900) return null;
  const parts = [];
  for (const part of raw.split("/")) {
    let value;
    try { value = decodeURIComponent(part); } catch { return null; }
    if (!value || value === "." || value === ".." || value.includes("/") ||
        value.indexOf(String.fromCharCode(92)) >= 0 ||
        [...value].some(ch => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127)) return null;
    parts.push(value);
  }
  return "users/" + userId + "/" + parts.join("/");
}

function applyPrivateHeaders(object, headers) {
  object.writeHttpMetadata(headers);
  headers.set("Cache-Control", "private, no-store, max-age=0");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("ETag", object.httpEtag);
  headers.set("Content-Length", String(object.range && object.range.length !== undefined ? object.range.length : object.size));
  headers.set("Accept-Ranges", "bytes");
  if (object.uploaded) headers.set("Last-Modified", object.uploaded.toUTCString());
  if (object.range && object.range.length !== undefined) {
    const offset = object.range.offset || 0;
    headers.set("Content-Range", "bytes " + offset + "-" + (offset + object.range.length - 1) + "/" + object.size);
  }
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      const origin = request.headers.get("Origin") || "";
      if (!origin || !cors.has("Access-Control-Allow-Origin")) return json({ error: "Origin not allowed" }, 403, cors);
      return new Response(null, { status: 204, headers: cors });
    }

    if (url.pathname === "/health" && request.method === "GET") {
      let jwks = "unavailable";
      try { jwks = (await getJwks()).length ? "available" : "no_asymmetric_keys"; } catch {}
      return json({ service: "eneles-atelier-storage", status: "ok", authKeys: jwks }, 200, cors);
    }

    if (!["GET", "HEAD", "PUT", "DELETE"].includes(request.method)) return json({ error: "Method not allowed" }, 405, cors);

    const authHeader = request.headers.get("Authorization") || "";
    const user = authHeader.startsWith("Bearer ") ? await verifyAccessToken(authHeader.slice(7).trim()) : null;
    if (!user) return json({ error: "Valid Supabase user token required" }, 401, cors);

    if (url.pathname === "/v1/me" && request.method === "GET") {
      return json({ userId: user.id, storagePrefix: "users/" + user.id + "/" }, 200, cors);
    }

    const key = getObjectKey(url.pathname, user.id);
    if (!key) return json({ error: "Invalid object path" }, 400, cors);
    if (!env.ATELIER_BUCKET) return json({ error: "Storage unavailable" }, 503, cors);

    try {
      if (request.method === "HEAD") {
        const object = await env.ATELIER_BUCKET.head(key);
        if (!object) return json({ error: "Object not found" }, 404, cors);
        const headers = new Headers(cors);
        applyPrivateHeaders(object, headers);
        return new Response(null, { status: 200, headers });
      }
      if (request.method === "GET") {
        const object = await env.ATELIER_BUCKET.get(key, { range: request.headers });
        if (!object) return json({ error: "Object not found" }, 404, cors);
        const headers = new Headers(cors);
        applyPrivateHeaders(object, headers);
        return new Response(object.body, { status: object.range ? 206 : 200, headers });
      }
      if (request.method === "PUT") {
        const rawLength = request.headers.get("Content-Length");
        const size = rawLength === null ? NaN : Number(rawLength);
        if (!Number.isSafeInteger(size) || size < 0 || size > MAX_OBJECT_BYTES) {
          return json({ error: "Content-Length required; maximum object size is 100 MiB" }, 413, cors);
        }
        const contentType = request.headers.get("Content-Type") || "application/octet-stream";
        await env.ATELIER_BUCKET.put(key, request.body, {
          httpMetadata: { contentType },
          customMetadata: { ownerId: user.id, service: "eneles-atelier" }
        });
        return json({ ok: true, key: key.slice(("users/" + user.id + "/").length), size }, 201, cors);
      }
      if (request.method === "DELETE") {
        await env.ATELIER_BUCKET.delete(key);
        return json({ ok: true }, 200, cors);
      }
    } catch {
      return json({ error: "Storage operation failed" }, 500, cors);
    }
    return json({ error: "Unsupported operation" }, 400, cors);
  }
};