# Daily Head Start → Slack Automation

Automates copying your **Daily Head Start (DHS)** plan from the SJ Innovation Developer Portal and posting a formatted version to Slack — without logging in every day.

| Item | Detail |
|------|--------|
| **Source** | [SJ Dev Portal → My DHS](https://developer.sjinnovation.us/dashboard/my-dhs) |
| **Destinations** | Slack `#daily-head-start` and `#sj-qa` (SJ Innovation workspace) |
| **Schedule** | Weekdays at **12:00 PM Asia/Dhaka** (Windows Task Scheduler) |
| **Stack** | Node.js + Playwright + persistent browser profile |

---

## What this achieves

Before this automation, the daily routine was manual:

1. Open the SJ Developer Portal and go to **My DHS**
2. Click **Refresh Plan** and **Copy Plan**
3. Open Slack, switch to the SJ Innovation workspace
4. Paste into `#daily-head-start`
5. Paste again into `#sj-qa`

**After setup, this project:**

- Copies the DHS plan automatically
- Reformats it for Slack (bold section headers + spacing)
- Posts to **both** Slack channels
- Reuses a saved browser session so you are not prompted to log in each run
- Runs on a weekday noon schedule on your Windows PC

---

## Message format

The raw “Copy Plan” text is reshaped before posting:

```
Today's Plan:                    ← bold
                                 ← 1 blank line
CalystaPro CRM | Hardik Soni     ← bold (project name; names vary by day)
○ task …
○ task …

                                 ← 2 blank lines
CalystaPro EMR | …               ← bold
○ task …

                                 ← 2 blank lines
Meetings:                        ← bold
• meeting …
• meeting …
```

Project names are detected dynamically from whatever the portal returns that day.

---

## Repository layout

```
daily-head-start/
├── README.md                 ← this guide
├── package.json
├── src/
│   ├── config.js             ← URLs, Slack team/channel IDs
│   ├── save-auth.js          ← one-time interactive login
│   ├── post-dhs.js           ← main automation (copy → format → post)
│   └── format-plan.js        ← DHS text → Slack-friendly layout
├── scripts/
│   ├── run-daily.bat         ← Task Scheduler entry point
│   └── register-task.ps1     ← creates weekday 12:00 task
├── browser-profile/          ← LOCAL ONLY (gitignored) — saved logins
├── auth/                     ← LOCAL ONLY (gitignored) — storage state
└── logs/                     ← LOCAL ONLY (gitignored) — run logs
```

---

## Prerequisites

- Windows PC (Task Scheduler is used for the noon job)
- Node.js 18+ recommended
- Access to:
  - [https://developer.sjinnovation.us/](https://developer.sjinnovation.us/)
  - Slack workspace **SJ Innovation**
- PC timezone preferably **Bangladesh Standard Time** (`Asia/Dhaka`) so 12:00 local = noon BD time

---

## One-time setup (for you or a teammate)

### 1. Clone and install

```bash
git clone https://github.com/<your-user>/daily-head-start.git
cd daily-head-start
npm install
npx playwright install chromium
```

### 2. Sign in once (save session)

```bash
npm run save-auth
```

A headed Chromium window opens with portal + Slack tabs. Sign in manually, open **SJ Innovation** in Slack, then press **Enter** in the terminal.

This writes cookies into `browser-profile/` (never commit this folder).

### 3. Confirm Slack channel IDs (if needed)

Defaults in `src/config.js` are for the SJ Innovation workspace used during original setup:

| Channel | Slack ID |
|---------|----------|
| `#daily-head-start` | `G7ELUQV45` |
| `#sj-qa` | `GS3M9CTGB` |
| Team | `T0285LK1G` |

If your workspace differs, update `src/config.js` after opening each channel in the browser and copying the ID from the URL:

`https://app.slack.com/client/<TEAM_ID>/<CHANNEL_ID>`

### 4. Test a manual run

```bash
# Watch the browser while it runs
set DHS_HEADED=1&& npm run post-dhs

# Or headless (production-style)
npm run post-dhs

# Plan only — no Slack post
set DHS_DRY_RUN=1&& set DHS_HEADED=1&& npm run post-dhs
```

Confirm messages appear in both Slack channels with bold headers.

### 5. Register the weekday schedule

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\register-task.ps1
```

Creates Windows task **`SJ-Daily-Head-Start`**: Mon–Fri at **12:00 PM** local time.

Useful commands:

```powershell
Get-ScheduledTask -TaskName 'SJ-Daily-Head-Start' | Get-ScheduledTaskInfo
Start-ScheduledTask -TaskName 'SJ-Daily-Head-Start'    # run now
Unregister-ScheduledTask -TaskName 'SJ-Daily-Head-Start' -Confirm:$false
```

The PC should be **on** around noon. If it was asleep, `StartWhenAvailable` can start the task after wake.

---

## Day-to-day usage

| Situation | Action |
|-----------|--------|
| Normal weekday | Nothing — Task Scheduler runs at 12:00 |
| Need to post now | `npm run post-dhs` or `Start-ScheduledTask -TaskName 'SJ-Daily-Head-Start'` |
| Login wall / expired session | `npm run save-auth` again |
| Change channels or schedule hour | Edit `src/config.js` / `scripts/register-task.ps1`, re-register task |

---

## Security notes

- **Do not commit** `browser-profile/`, `auth/`, or `logs/` — they contain session cookies and may include plan text.
- Each person should use **their own** local profile after `save-auth` (do not share cookie folders).
- Prefer a **private** GitHub repo if this stays internal to SJ Innovation.

---

## Troubleshooting

| Problem | What to try |
|---------|-------------|
| `Copy Plan button not found` | Portal still loading — re-run; confirm My DHS opens while logged in |
| Slack workspace chooser / welcome page | `npm run save-auth`, then open `https://sjinnovation.slack.com/` once |
| Bold headers look like plain text | Slack rich paste may have failed; re-run headed and check composer; report if it persists |
| Profile already in use | Close other Chromium windows using `browser-profile`, delete `browser-profile/lockfile` if stuck |
| Task did not run | Check Task Scheduler history; ensure PC was awake; run `Get-ScheduledTaskInfo` |

---

## npm scripts

| Script | Purpose |
|--------|---------|
| `npm run save-auth` | Interactive login → save persistent profile |
| `npm run post-dhs` | Full automation (headless by default) |
| `npm run post-dhs:headed` | Same with visible browser |
| `npm run post-dhs:dry` | Format/copy only, no Slack post |
| `npm run register-task` | Register Windows noon weekday task |

---

## Credits / context

Built for SJ Innovation QA workflow to reduce daily manual DHS posting. Original implementer path on disk:

`C:\Users\TAMZIDA\qa-automation\daily-head-start`
