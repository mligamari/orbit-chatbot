# Orbit

A general-purpose AI chatbot powered by [Groq](https://groq.com). Plain HTML, CSS and JavaScript in `public/`, plus one Vercel serverless function (`api/chat.js`) that talks to Groq so your API key stays on the server.

## Project layout

```
api/chat.js          Server endpoint: validates input, trims history, calls Groq
public/index.html    The page
public/styles.css    Styles (dark/light themes, responsive layout)
public/app.js        Chat logic in the browser
public/assets/robot.png
dev-server.js        Local-only server (not used on Vercel)
test/                Endpoint tests and a Groq mock for local UI testing
```

## Configuration

| Variable       | Required | Default                   |
| -------------- | -------- | ------------------------- |
| `GROQ_API_KEY` | yes      | none                      |
| `GROQ_MODEL`   | no       | `llama-3.3-70b-versatile` |

Never put the key in browser code or commit it. `.env*` files are git-ignored (except `.env.example`).

## Run locally (Node 18+)

```bash
cp .env.example .env.local     # then paste your real key into .env.local
npm run dev                    # http://localhost:3000
```

No key yet? Try the UI with canned replies:

```bash
GROQ_API_KEY=fake node --import ./test/mock-groq.mjs dev-server.js
```

Run the endpoint tests (Groq is stubbed, no key needed):

```bash
npm test
```

## Limits built in

- 4,000 characters per message (browser and server)
- Last 20 messages and at most 24,000 characters sent as context
- 1,024 output tokens per reply
- 25 s timeout to Groq on the server, 30 s in the browser
- 200 KB max request body

## Deploy to Vercel

1. Push this folder to a GitHub repo.
2. In Vercel, **Add New → Project**, import the repo. Framework preset: **Other**. No build command needed; Vercel serves `public/` and turns `api/chat.js` into a function.
3. Under **Settings → Environment Variables**, add `GROQ_API_KEY` (and optionally `GROQ_MODEL`).
4. Deploy (or redeploy after adding variables).
