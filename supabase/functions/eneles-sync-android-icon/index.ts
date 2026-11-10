import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GITHUB_ACTIONS_DISPATCH_TOKEN = Deno.env.get("GITHUB_ACTIONS_DISPATCH_TOKEN");

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json"
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "Méthode non autorisée." }, 405);

  const authorization = req.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) {
    return json({ ok: false, error: "Session administrateur requise." }, 401);
  }

  const token = authorization.slice(7).trim();
  const { data: authData, error: authError } = await admin.auth.getUser(token);
  if (authError || !authData.user) {
    return json({ ok: false, error: "Session utilisateur invalide." }, 401);
  }

  const { data: profile, error: profileError } = await admin
    .from("Profils")
    .select("role,banni")
    .eq("id", authData.user.id)
    .maybeSingle();

  if (profileError || !profile || profile.banni === true ||
      !/^(admin|administrateur)$/i.test(String(profile.role || ""))) {
    return json({ ok: false, error: "Cette action est réservée aux administrateurs." }, 403);
  }

  if (!GITHUB_ACTIONS_DISPATCH_TOKEN) {
    return json({ ok: false, error: "Le jeton sécurisé de déclenchement GitHub n'est pas configuré." }, 503);
  }

  let body: any;
  try { body = await req.json(); }
  catch { return json({ ok: false, error: "Corps JSON invalide." }, 400); }

  const rawUrl = String(body?.logo_png_url || "").trim();
  let logoUrl: URL;
  try { logoUrl = new URL(rawUrl); }
  catch { return json({ ok: false, error: "URL du logo invalide." }, 400); }

  if (logoUrl.protocol !== "https:" ||
      logoUrl.hostname !== "pub-0433751d08eb49fcafb7355ef0bf42ab.r2.dev" ||
      !/^\/site-logo-[0-9]+-[a-z0-9]+-pdf\.png$/.test(logoUrl.pathname) ||
      logoUrl.search || logoUrl.hash) {
    return json({ ok: false, error: "Seule la version PNG préparée par le stockage public Eneles est autorisée." }, 400);
  }

  try {
    const endpoint = "https://api.github.com/repos/ouali-nat/Eneles-Archives/actions/workflows/android-apk.yml/dispatches";
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + GITHUB_ACTIONS_DISPATCH_TOKEN,
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        ref: "main",
        inputs: { logo_png_url: logoUrl.toString() }
      })
    });

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 1200);
      console.error("[Eneles APK] GitHub workflow_dispatch refused:", response.status, detail);
      return json({
        ok: false,
        error: "GitHub n'a pas accepté le lancement du workflow (HTTP " + response.status + ")."
      }, 502);
    }

    return json({
      ok: true,
      workflow: "android-apk.yml",
      branch: "main",
      status: "dispatch_requested"
    }, 202);
  } catch (error) {
    console.error("[Eneles APK] GitHub dispatch request failed:", error);
    return json({ ok: false, error: "Connexion à GitHub impossible pour lancer la compilation." }, 502);
  }
});
