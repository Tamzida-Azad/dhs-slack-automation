const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const config = require('./config');
const { SESSION_PATH, DISMISSALS_PATH } = require('./portal-api');

/**
 * Capture portal JWT + anon key from a live My DHS page (network + localStorage).
 * Pass an existing Playwright page to reuse a browser context; otherwise launches one.
 */
async function refreshPortalSession(options = {}) {
  const headless = options.headless !== false;
  const log = options.log || {
    info: (m, e) => console.log(m, e || ''),
    warn: (m, e) => console.warn(m, e || ''),
  };

  let context = options.context || null;
  let page = options.page || null;
  let ownsContext = false;

  if (!page) {
    if (!fs.existsSync(config.paths.browserProfile)) {
      throw new Error('Missing browser-profile. Run: npm run save-auth');
    }
    fs.mkdirSync(path.dirname(SESSION_PATH), { recursive: true });
    context = await chromium.launchPersistentContext(config.paths.browserProfile, {
      headless,
      viewport: { width: 1400, height: 900 },
      args: ['--disable-blink-features=AutomationControlled'],
    });
    page = context.pages()[0] || (await context.newPage());
    ownsContext = true;
  }

  let anonKey = null;
  let accessToken = null;
  const postBodies = {};

  const onRequest = (req) => {
    const url = req.url();
    if (!/functions\/v1\/(ac-my-tasks|my-calendar-events)/.test(url)) return;
    const headers = req.headers();
    if (headers.apikey) anonKey = headers.apikey;
    if (headers.authorization) {
      accessToken = headers.authorization.replace(/^Bearer\s+/i, '');
    }
    if (url.includes('ac-my-tasks')) postBodies['ac-my-tasks'] = req.postData();
    if (url.includes('my-calendar-events')) postBodies['my-calendar-events'] = req.postData();
  };

  page.on('request', onRequest);

  try {
    log.info('Refreshing portal session from My DHS…');
    await page.goto(config.urls.myDhs, {
      waitUntil: 'domcontentloaded',
      timeout: config.timeouts.navigation,
    });
    await page.waitForTimeout(8000);

    const refresh = page.locator('button:has-text("Refresh Plan")').first();
    if (await refresh.count()) {
      await refresh.click().catch(() => {});
      await page.waitForTimeout(5000);
    }

    const { refreshToken, dismissals } = await page.evaluate(() => {
      const authKey = Object.keys(localStorage).find((k) => k.includes('-auth-token'));
      let refresh_token = null;
      if (authKey) {
        try {
          const parsed = JSON.parse(localStorage.getItem(authKey) || '{}');
          refresh_token = parsed.refresh_token || parsed.currentSession?.refresh_token || null;
        } catch {
          // ignore
        }
      }

      const userId =
        (() => {
          try {
            const parsed = JSON.parse(localStorage.getItem(authKey) || '{}');
            return parsed.user?.id || parsed.currentSession?.user?.id || null;
          } catch {
            return null;
          }
        })() || null;

      const readIds = (key) => {
        try {
          const raw = localStorage.getItem(key);
          if (!raw) return [];
          const parsed = JSON.parse(raw);
          return Array.isArray(parsed) ? parsed.map(String) : [];
        } catch {
          return [];
        }
      };

      const taskIds = userId ? readIds(`my-dhs-dismissed:${userId}`) : [];
      const meetingIds = userId ? readIds(`my-dhs-dismissed-meetings:${userId}`) : [];

      return {
        refreshToken: refresh_token,
        dismissals: { userId, taskIds, meetingIds, savedAt: new Date().toISOString() },
      };
    });

    if (!anonKey || !accessToken) {
      throw new Error(
        'Could not capture portal API credentials from network. Re-run npm run save-auth if login expired.'
      );
    }

    const session = {
      supabaseUrl: 'https://pewtycgwvsifsrtjgbxx.supabase.co',
      functionsBase: 'https://pewtycgwvsifsrtjgbxx.supabase.co/functions/v1',
      anonKey,
      accessToken,
      refreshToken,
      postBodies,
      savedAt: new Date().toISOString(),
    };

    fs.mkdirSync(path.dirname(SESSION_PATH), { recursive: true });
    fs.writeFileSync(SESSION_PATH, JSON.stringify(session, null, 2));
    fs.writeFileSync(DISMISSALS_PATH, JSON.stringify(dismissals, null, 2));

    log.info('Saved portal session', {
      path: SESSION_PATH,
      dismissedTasks: dismissals.taskIds.length,
      dismissedMeetings: dismissals.meetingIds.length,
    });

    return { session, dismissals, page, context };
  } finally {
    page.off('request', onRequest);
    if (ownsContext && context) {
      await context.close();
    }
  }
}

async function main() {
  const result = await refreshPortalSession({ headless: true });
  console.log('Saved portal session:');
  console.log(`- ${SESSION_PATH}`);
  console.log(`- ${DISMISSALS_PATH}`);
  console.log(
    `Dismissals: ${result.dismissals.taskIds.length} tasks, ${result.dismissals.meetingIds.length} meetings`
  );
}

module.exports = { refreshPortalSession };

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
