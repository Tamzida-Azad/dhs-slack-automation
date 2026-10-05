# Daily Head Start → Slack Automation

Automates copying your **Daily Head Start (DHS)** plan from a developer portal and posting a formatted version to Slack — without logging in every day.

| Item | Detail |
|------|--------|
| **Source** | Your org portal **My DHS** page (URL in `.env`) |
| **Destinations** | Slack channels you configure in `.env` |
| **Schedule** | Weekdays at **12:00 PM Asia/Dhaka** (Windows Task Scheduler) |
| **Stack** | Node.js + portal APIs (plan) + Playwright (Slack) + Windows Task Scheduler |

---

## What this achieves

**After setup, this project:**

- Fetches tasks + today's calendar via the same live portal edge functions My DHS uses
- Reformats the plan for Slack (bold section headers + spacing)
- Posts to configured Slack channels (browser paste)
- Reuses a saved browser/portal session
- Falls back to browser **Copy Plan** if the API session expires
- Runs on a weekday noon schedule on your Windows PC

---

## Repository layout

```
dhs-slack-automation/
├── README.md
├── .env.example              ← copy to .env (never commit .env)
├── package.json
├── src/
│   ├── config.js             ← reads portal/Slack settings from .env
│   ├── load-env.js
│   ├── save-auth.js          ← one-time interactive login
│   ├── refresh-portal-session.js
│   ├── portal-api.js
│   ├── post-dhs.js
│   └── format-plan.js
├── scripts/
│   ├── run-daily.bat
│   └── register-task.ps1
├── browser-profile/          ← LOCAL ONLY (gitignored)
├── auth/                     ← LOCAL ONLY (gitignored)
└── logs/                     ← LOCAL ONLY (gitignored)
```

---

## Prerequisites

- Windows PC (Task Scheduler for the noon job)
- Node.js 18+
- Access to your developer portal and Slack workspace
- PC timezone preferably **Asia/Dhaka** if you use the default schedule

---

## One-time setup

### 1. Clone and install

```bash
git clone https://github.com/Tamzida-Azad/dhs-slack-automation.git
cd dhs-slack-automation
npm install
npx playwright install chromium
cp .env.example .env
```

Edit `.env` with your portal URLs, Slack workspace URL, team ID, and channel IDs. Channel IDs appear in the browser when you open a channel:

`https://app.slack.com/client/<TEAM_ID>/<CHANNEL_ID>`

Map channels in `DHS_SLACK_CHANNELS` as `slug:CHANNEL_ID` (comma-separated), e.g. `daily-head-start:G0000000000,team-qa:G0000000001`.

### 2. Sign in once (save session)

```bash
npm run save-auth
```

A headed Chromium window opens. Sign in to the portal and Slack, then press **Enter** in the terminal. Cookies stay in `browser-profile/` (never commit).

### 3. Test a manual run

```bash
set DHS_HEADED=1&& npm run post-dhs
npm run post-dhs
set DHS_DRY_RUN=1&& npm run post-dhs
```

### 4. Register the weekday schedule

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\register-task.ps1
```

Creates task **`SJ-Daily-Head-Start`**: Mon–Fri at **12:00 PM** local time.

---

## Security notes

- **Do not commit** `.env`, `browser-profile/`, `auth/`, or `logs/`.
- Each operator should use **their own** local profile after `save-auth`.
- Organization-specific URLs and Slack IDs belong in `.env`, not in source control.

---

## Troubleshooting

| Problem | What to try |
|---------|-------------|
| `Missing DHS_*` on start | Copy `.env.example` → `.env` and fill values |
| `Copy Plan button not found` | Confirm My DHS opens while logged in |
| Slack workspace chooser | Re-run `npm run save-auth`; open your workspace URL once |
| Profile already in use | Close other Chromium windows using `browser-profile` |

---

## npm scripts

| Script | Purpose |
|--------|---------|
| `npm run save-auth` | Interactive login → save persistent profile |
| `npm run refresh-portal-session` | Capture portal JWT for API plan fetch |
| `npm run post-dhs` | Full automation (API plan + Slack) |
| `npm run post-dhs:browser` | Use My DHS Copy Plan UI |
| `npm run post-dhs:headed` | Visible browser |
| `npm run post-dhs:dry` | Plan only — no Slack post |
| `npm run register-task` | Register Windows weekday task |
