# Railway deployment

This project is prepared for Railway as a persistent Node.js service. Deploy the repository from GitHub, allow Railway to use `railway.json`, and configure the variables below in the Railway service settings.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | MySQL/TiDB connection string used by Drizzle for owner-scoped personas and WhatsApp session metadata |
| `JWT_SECRET` | Session signing secret for the control-center login flow |
| `GROQ_API_KEY` | Server-side Groq credential for assistant preview and AI responses; never expose it to the browser |
| `GROQ_MODEL` | Optional Groq model override; defaults to `llama-3.3-70b-versatile` |
| `WHATSAPP_AUTH_DIR` | Persistent auth directory; use `/data/whatsapp_auth` when a Railway volume is mounted at `/data` |
| `VITE_APP_TITLE` | Optional browser title |

Attach a Railway volume and mount it at `/data`. Without persistent storage, Baileys credentials can be lost on redeploy or restart and the account may require re-pairing. Keep the control-center and WhatsApp worker in the same persistent service or expose a protected service boundary between them.

The build uses `corepack enable && pnpm install --frozen-lockfile && pnpm build`; the runtime uses `pnpm start`. Railway supplies the `PORT` variable, which the application already reads dynamically. The healthcheck targets `/`, which serves the control-center shell.

Never commit `.env`, Baileys auth files, API keys, database credentials, or generated runtime state. Add secrets through Railway’s Variables UI. After deployment, open the control center, sign in, generate a fresh QR, and scan it promptly from WhatsApp → Linked devices → Link a device.
