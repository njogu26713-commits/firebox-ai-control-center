# Railway deployment

This project is prepared for Railway as a persistent Node.js service. Deploy the repository from GitHub, allow Railway to use `railway.json`, and configure the variables below in the Railway service settings.

| Variable | Purpose |
|---|---|
| `MONGODB_URI` | MongoDB connection string provided by Railway’s MongoDB service for shared public-workspace personas and WhatsApp session metadata |
| `JWT_SECRET` | Session signing secret retained for optional legacy OAuth/session support; the control center itself does not require login |
| `MONGODB_DB_NAME` | Optional database name; defaults to `firebox` |
| `GROQ_API_KEY` | Server-side Groq credential for assistant preview and AI responses; never expose it to the browser |
| `GROQ_MODEL` | Optional Groq model override; defaults to `llama-3.3-70b-versatile` |
| `WHATSAPP_AUTH_DIR` | Persistent auth directory; use `/data/whatsapp_auth` when a Railway volume is mounted at `/data` |
| `VITE_APP_TITLE` | Optional browser title |

Add Railway’s MongoDB service to the same project and reference its private connection variable from the control-center service as `MONGODB_URI=${{MongoDB.MONGO_URL}}`; Railway’s official MongoDB service exposes `MONGO_URL` for this reference. Also attach a Railway volume and mount it at `/data`, with `WHATSAPP_AUTH_DIR=/data/whatsapp_auth`. On every process start, the service checks that directory and restores the saved Baileys session automatically; without persistent storage, those credentials can be lost on redeploy or restart and the account may require re-pairing. Keep the control-center and WhatsApp worker in the same persistent service or expose a protected service boundary between them.

The service gracefully closes the WhatsApp socket on `SIGTERM`/`SIGINT`, restores the persisted session during startup, and retries non-logout WhatsApp disconnects with backoff. The build uses `corepack enable && pnpm install --frozen-lockfile && pnpm build`; the runtime uses `pnpm start`. The project pins Node.js 20.18.0 through `package.json` and `.nvmrc`, and the start command enables the WebCrypto compatibility flag required by Baileys. Railway supplies the `PORT` variable, which the application already reads dynamically. The healthcheck targets `/`, which serves the control-center shell. Trigger a fresh Railway deployment after pulling this commit so the Node runtime and start command are refreshed.

Never commit `.env`, Baileys auth files, API keys, database credentials, or generated runtime state. Add secrets through Railway’s Variables UI. After deployment, open the public control center, generate a fresh QR, and scan it promptly from WhatsApp → Linked devices → Link a device. Validate this step on the Railway service itself: the development sandbox has previously received external WhatsApp 401/515 connection failures and cannot be treated as proof that a QR is valid or that pairing succeeded. A successful scan must be confirmed from the persistent Railway runtime with outbound WhatsApp connectivity.
