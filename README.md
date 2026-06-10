# GitHub Copilot UBB Budget Monitor

A web-based **Usage-Based Billing (UBB) Budget Monitor** for GitHub Copilot Enterprise. Connects to the GitHub Enterprise Billing Budgets API to display real-time budget controls and their consumption status.

## Features

- **Live API Connection**: Connect with your enterprise slug and PAT to fetch real budget data
- **Budget Dashboard**: Enterprise, Universal, Cost Center, and Individual budget cards
- **User Budget Table**: Per-user consumption with status indicators (🟢 OK / 🟡 NEAR / 🔴 OVER)
- **Blocking Risk Summary**: Users at risk of being blocked, already blocked, cost centers at risk
- **Budget Hierarchy Tree**: Visual tree showing how budget controls layer
- **CSV Cross-Reference**: Optional CSV upload to enrich API data with actual consumption
- **Security-first**: PAT stored only in React state, never persisted

## Tech Stack

- Next.js (App Router) with TypeScript
- Static export — no backend, everything runs in the browser
- No external UI libraries — pure React with inline styles
- Dark theme with neon purple/blue accents

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Required Permissions

Your GitHub PAT needs the `manage_billing:enterprise` scope to access budget data.

## Test Data

A sample CSV is included at `public/sample-data.csv` for testing the CSV cross-reference feature.

## How It Works

1. Enter your enterprise slug and PAT
2. Click "Connect" — fetches all budget pages automatically
3. View budgets organized by scope (Enterprise, Universal, Cost Center, Individual)
4. Optionally upload a CSV to cross-reference consumption data
5. Check the Blocking Risk Summary for users approaching their limits

## Security

- PAT is stored **only** in React state (memory) — never in localStorage, cookies, or any persistent storage
- PAT is sent **directly** to `api.github.com` — never touches any backend
- Input validation on enterprise slug (alphanumeric + hyphens only)
- "Disconnect" button clears the token from state

## Deployment

```bash
npm run build
```

The static export will be in the `out/` directory, ready to deploy to GitHub Pages or any static host.

## License

MIT
