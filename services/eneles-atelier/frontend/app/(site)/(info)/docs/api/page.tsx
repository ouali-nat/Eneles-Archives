import type { Metadata } from "next";
import { Callout } from "@/components/essential/docs/Callout";
import { CodeBlock } from "@/components/essential/docs/CodeBlock";
import { ShellPageHeader } from "@/components/essential/layout/SitePageHeader";
import { JsonLd } from "@/components/essential/JsonLd";
import { seoMetadata } from "@/lib/seo/pages";
import { docsIndexJsonLd } from "@/lib/seo/jsonld";

/** Title, description, canonical address, and link previews: lib/seo/pages.ts. */
export const metadata: Metadata = seoMetadata("/docs/api");

/**
 * Shared behaviour for every endpoint, in one place.
 *
 * Written against the actual implementation: the guards in
 * `common/guards/`, `PaginationQueryDto`, the global exception filter, and the
 * `@Throttle` decorators on each controller. Anything here that drifts from
 * those files is a bug in this page.
 */
export default function ApiOverviewPage() {
  return (
    <div>
      <JsonLd data={docsIndexJsonLd("/docs/api")} />
      <ShellPageHeader title="API overview" description="A REST API over JSON. Everything the web app does is available here, and the web app itself uses no private endpoints." />

      <h2
        id="base-url"
        className="mt-12 mb-4 scroll-mt-24 text-xl font-semibold tracking-[-0.01em]"
      >
        Base URL
      </h2>
      <CodeBlock language="HTTP">{"https://api.eneles.example"}</CodeBlock>
      <p className="mb-4 text-[15px] leading-[1.75] text-muted-foreground">
        There is no version prefix and no path prefix. If you self-host, this is
        whatever you set as <code className="rounded border bg-surface px-1.5 py-0.5 font-mono text-[12.5px] text-foreground">NEXT_PUBLIC_API_URL</code>, and every
        path below is relative to it.
      </p>

      <h2
        id="authentication"
        className="mt-12 mb-4 scroll-mt-24 text-xl font-semibold tracking-[-0.01em]"
      >
        Authentication
      </h2>
      <p className="mb-4 text-[15px] leading-[1.75] text-muted-foreground">
        Two schemes, and most endpoints accept either. A JWT identifies a browser
        session; an API key identifies a program.
      </p>

      <CodeBlock language="Terminal">{`# Session token, from the Eneles SSO exchange or an API key
curl <API_BASE_URL>/projects \\
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIs..."

# API key, from the dashboard or POST /api-keys
curl <API_BASE_URL>/projects \\
  -H "x-api-key: txr_9f2c..."`}</CodeBlock>

      <Callout type="note" title="Connexion depuis Eneles">
        L’atelier intégré reçoit la session Google déjà ouverte dans Eneles. Le
        navigateur transmet un jeton Supabase temporaire à l’atelier ; l’API le
        vérifie auprès de Supabase Auth via `POST /auth/eneles-sso` et émet une
        session d’atelier révocable. Aucun deuxième formulaire de connexion
        n’est nécessaire.
      </Callout>

      <Callout type="note" title="Which one to use">
        Scripts and integrations should use an API key. Tokens expire and are
        tied to a session that the user can revoke from settings, which is
        exactly what you do not want a cron job depending on.
      </Callout>

      <p className="mb-4 text-[15px] leading-[1.75] text-muted-foreground">
        A handful of endpoints are public and need no credentials at all:{" "}
        <code className="rounded border bg-surface px-1.5 py-0.5 font-mono text-[12.5px] text-foreground">POST /auth/login</code>,{" "}
        <code className="rounded border bg-surface px-1.5 py-0.5 font-mono text-[12.5px] text-foreground">POST /auth/signup</code>, the OTP verification
        routes, <code className="rounded border bg-surface px-1.5 py-0.5 font-mono text-[12.5px] text-foreground">POST /tikz-compile</code>, the prebuilt template assets, and the Eneles SSO exchange endpoint.
      </p>

      <h2
        id="pagination"
        className="mt-12 mb-4 scroll-mt-24 text-xl font-semibold tracking-[-0.01em]"
      >
        Pagination
      </h2>
      <p className="mb-4 text-[15px] leading-[1.75] text-muted-foreground">
        Every list endpoint is paginated and returns the same envelope. It never
        returns a bare array.
      </p>

      <div className="my-6 overflow-x-auto rounded-xl border">
        <table className="w-full text-[14px]">
          <thead className="border-b bg-surface/40">
            <tr>
              <th className="px-4 py-2.5 text-start text-[13px] font-semibold">
                Query parameter
              </th>
              <th className="px-4 py-2.5 text-start text-[13px] font-semibold">
                Default
              </th>
              <th className="px-4 py-2.5 text-start text-[13px] font-semibold">
                Notes
              </th>
            </tr>
          </thead>
          <tbody className="text-muted-foreground">
            {[
              ["page", "1", "1-based. Values below 1 are rejected."],
              ["limit", "20", "Maximum 100. Larger values are rejected, not clamped."],
              ["sort", "updatedAt", "Field to order by."],
              ["order", "desc", "asc or desc."],
            ].map(([name, def, notes]) => (
              <tr key={name} className="border-b last:border-0">
                <td className="px-4 py-2.5 font-mono text-[13px] text-foreground">
                  {name}
                </td>
                <td className="px-4 py-2.5 font-mono text-[13px]">{def}</td>
                <td className="px-4 py-2.5">{notes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <CodeBlock language="JSON">{`{
  "data": [ /* ... */ ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 137,
    "totalPages": 7,
    "hasNext": true,
    "hasPrev": false
  }
}`}</CodeBlock>

      <h2
        id="errors"
        className="mt-12 mb-4 scroll-mt-24 text-xl font-semibold tracking-[-0.01em]"
      >
        Errors
      </h2>
      <p className="mb-4 text-[15px] leading-[1.75] text-muted-foreground">
        Errors use standard HTTP status codes with a JSON body. Validation
        failures return <code className="rounded border bg-surface px-1.5 py-0.5 font-mono text-[12.5px] text-foreground">message</code> as an array, one entry per
        failed field.
      </p>

      <CodeBlock language="JSON">{`{
  "statusCode": 400,
  "message": ["limit must not be greater than 100"],
  "error": "BadRequestException"
}`}</CodeBlock>

      <Callout type="warning" title="500s are deliberately vague">
        In production, any status of 500 or above returns a generic message and
        a <code>timestamp</code> instead of the real error. Internal details are
        written to the server log, never to the response. Quote that timestamp
        when reporting a problem and support can find the exact entry.
      </Callout>

      <div className="my-6 overflow-x-auto rounded-xl border">
        <table className="w-full text-[14px]">
          <thead className="border-b bg-surface/40">
            <tr>
              <th className="px-4 py-2.5 text-start text-[13px] font-semibold">
                Status
              </th>
              <th className="px-4 py-2.5 text-start text-[13px] font-semibold">
                Means
              </th>
            </tr>
          </thead>
          <tbody className="text-muted-foreground">
            {[
              ["400", "Validation failed. Check message for the field."],
              ["401", "Missing or invalid credentials."],
              ["403", "Authenticated, but not allowed to touch this resource."],
              ["404", "No such resource, or not yours."],
              ["409", "Conflict. On file writes, someone else saved first."],
              ["429", "Rate limited. Back off and retry."],
              ["500", "Our fault. Details are in the server log."],
            ].map(([code, meaning]) => (
              <tr key={code} className="border-b last:border-0">
                <td className="px-4 py-2.5 font-mono text-[13px] text-foreground">
                  {code}
                </td>
                <td className="px-4 py-2.5">{meaning}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2
        id="rate-limits"
        className="mt-12 mb-4 scroll-mt-24 text-xl font-semibold tracking-[-0.01em]"
      >
        Rate limits
      </h2>
      <p className="mb-4 text-[15px] leading-[1.75] text-muted-foreground">
        Limits are per IP, over a rolling 60-second window, and protect the
        shared infrastructure. Eneles does not impose monthly subscription
        quotas; technical file-size, concurrency and runtime safeguards remain.
        Expensive endpoints are stricter.
      </p>

      <div className="my-6 overflow-x-auto rounded-xl border">
        <table className="w-full text-[14px]">
          <thead className="border-b bg-surface/40">
            <tr>
              <th className="px-4 py-2.5 text-start text-[13px] font-semibold">
                Endpoint
              </th>
              <th className="px-4 py-2.5 text-start text-[13px] font-semibold">
                Per minute
              </th>
            </tr>
          </thead>
          <tbody className="text-muted-foreground">
            {[
              ["POST /auth/send-otp", "3"],
              ["POST /auth/login, POST /auth/signup", "5"],
              ["POST /auth/verify-otp, /auth/verify-2fa", "10"],
              ["POST /pdfs/:id/process", "5"],
              ["POST /snips/:id/process", "10"],
              ["POST /compile, POST /projects/:uid/compile", "10"],
              ["POST /tikz-compile", "10"],
              ["POST /projects/:uid/ai/chat", "15"],
              ["POST /projects/:uid/synctex", "120"],
            ].map(([endpoint, limit]) => (
              <tr key={endpoint} className="border-b last:border-0">
                <td className="px-4 py-2.5 font-mono text-[12.5px] text-foreground">
                  {endpoint}
                </td>
                <td className="px-4 py-2.5 font-mono text-[13px]">{limit}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2
        id="ids"
        className="mt-12 mb-4 scroll-mt-24 text-xl font-semibold tracking-[-0.01em]"
      >
        Identifiers
      </h2>
      <p className="mb-4 text-[15px] leading-[1.75] text-muted-foreground">
        Two kinds, and mixing them up is the most common integration mistake.
      </p>
      <ul className="my-5 ms-5 list-disc space-y-2 text-[15px] leading-[1.7] text-muted-foreground marker:text-muted-foreground/40">
        <li>
          <strong className="font-semibold text-foreground">Projects</strong>{" "}
          are addressed by <code className="rounded border bg-surface px-1.5 py-0.5 font-mono text-[12.5px] text-foreground">uid</code>, a 16-character
          alphanumeric string such as <code className="rounded border bg-surface px-1.5 py-0.5 font-mono text-[12.5px] text-foreground">8kX4mN2vRqZw3pT1</code>. This
          is what appears in editor URLs.
        </li>
        <li>
          <strong className="font-semibold text-foreground">
            Everything else
          </strong>{" "}
          uses an integer id: snips, PDFs, files, templates, API keys. These are
          numbers in JSON, not strings.
        </li>
      </ul>
    </div>
  );
}
