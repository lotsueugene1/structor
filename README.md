# structor

Architecture-first workspace for software teams. The canonical architecture
graph is the source of truth; the canvas, the Node Workspace, manual editing,
and Structor AI are interfaces onto that same graph.

## Development

```bash
npm install
npm run dev          # http://localhost:3000
```

Verification (run against a live dev server; stop `next dev` before `npm run build`
because both use `.next`):

```bash
npm run typecheck
npm run lint
npm run verify:landing      # home navigation, responsive layout, motion
npm run verify:repository   # import pipeline, privacy filters, canvas end-to-end
npm run verify:frontend     # onboarding, Node Workspace, projections, mobile
npm run build
```

## Canvas engine and licensing

The architecture canvas is built on the [tldraw SDK](https://tldraw.dev).
tldraw runs without a key on `localhost` and in non-production builds, but a
production deployment (HTTPS on a real domain with `NODE_ENV=production`)
requires a license key or the editor stops rendering after a few seconds.

Set the key as a server environment variable (no `NEXT_PUBLIC_` prefix):

```bash
TLDRAW_LICENSE_KEY=tldraw-...
```

The workspace page reads it on the server and passes it into the canvas.
tldraw still validates the key in the browser; it is a product license, not
an API credential, and does not grant access to any data.

- Trial (100 days, no watermark) and commercial licenses are available from
  https://tldraw.dev/pricing. Hobby licenses are free for non-commercial
  projects but must keep the "made with tldraw" watermark visible.
- Under commercial and hobby licenses tldraw receives no telemetry.
- tldraw's own user-preference persistence is disabled: Structor supplies an
  in-memory user so nothing is written to `localStorage`.

## Architecture generation

Start → Generate architecture drafts components from a description. Start
blank is a separate path and opens an empty canvas.

Server-side environment:

```bash
AWS_REGION=us-east-1
BEDROCK_MODEL_ID=us.anthropic.claude-sonnet-4-5-20250929-v1:0
```

Use the default AWS credential chain (`AWS_ACCESS_KEY_ID` /
`AWS_SECRET_ACCESS_KEY`, a shared profile, or an instance role). The model ID
is a US cross-region inference profile; the account must have Bedrock access
to Claude Sonnet in `us-east-1`.

## Privacy model

Uploaded repositories are analyzed in memory and never written to disk or
object storage. Only architecture metadata and lightweight source references
(path, symbol, line range) are kept; source text, secrets, and archives are
discarded when the request completes. See `src/app/api/repositories/import`.
