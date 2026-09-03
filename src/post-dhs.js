const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const config = require('./config');
const { formatDhsPlan } = require('./format-plan');

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function createLogger() {
  fs.mkdirSync(config.paths.logsDir, { recursive: true });
  const filePath = path.join(config.paths.logsDir, `dhs-${stamp()}.log`);
  const write = (level, message, extra) => {
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      message,
      ...(extra || {}),
    });
    fs.appendFileSync(filePath, `${line}\n`);
    const prefix = level === 'error' ? 'ERROR' : level === 'warn' ? 'WARN' : 'INFO';
    console.log(`[${prefix}] ${message}`);
  };
  return {
    filePath,
    info: (message, extra) => write('info', message, extra),
    warn: (message, extra) => write('warn', message, extra),
    error: (message, extra) => write('error', message, extra),
  };
}

async function assertNotLoginWall(page, label) {
  const url = page.url();
  const title = await page.title().catch(() => '');
  const bodyText = await page.locator('body').innerText().catch(() => '');
  const loginHints = [
    /sign in/i,
    /log in/i,
    /login/i,
    /enter your email/i,
    /workspace url/i,
  ];
  const looksLikeLogin =
    /login|signin|sign-in|oauth|auth/i.test(url) ||
    loginHints.some((re) => re.test(title)) ||
    (loginHints.some((re) => re.test(bodyText.slice(0, 500))) &&
      !/daily head start|my dhs|copy plan/i.test(bodyText));

  if (looksLikeLogin && !/my-dhs|client\//i.test(url)) {
    throw new Error(
      `${label} appears to require login (url=${url}). Re-run: npm run save-auth`
    );
  }
}

async function getClipboardText(page) {
  try {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  } catch {
    // Some Chromium builds ignore this; clipboard read may still work.
  }
  return page.evaluate(async () => {
    try {
      return await navigator.clipboard.readText();
    } catch {
      return '';
    }
  });
}

async function extractPlanFromPage(page) {
  const candidates = [
    page.locator('[data-testid*="plan" i]'),
    page.locator('.dhs-plan, #dhs-plan, .plan-content, .plan-text'),
    page.getByRole('region', { name: /plan|daily head start|dhs/i }),
    page.locator('main'),
  ];

  for (const locator of candidates) {
    const count = await locator.count();
    if (!count) continue;
    const text = (await locator.first().innerText()).trim();
    if (text.length > 80 && /task|plan|today|priority|dhs/i.test(text)) {
      return text;
    }
  }
  return '';
}

async function copyDhsPlan(page, log) {
  await page.goto(config.urls.myDhs, {
    waitUntil: 'domcontentloaded',
    timeout: config.timeouts.navigation,
  });
  await assertNotLoginWall(page, 'SJ Developer Portal');

  const refresh = page.locator('button:has-text("Refresh Plan")').first();
  await refresh.waitFor({ state: 'visible', timeout: config.timeouts.navigation });
  log.info('Clicking Refresh Plan');
  await refresh.click({ timeout: config.timeouts.action });

  const copyBtn = page.locator('button:has-text("Copy Plan")').first();
  await copyBtn.waitFor({ state: 'visible', timeout: config.timeouts.navigation });
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(300);

  log.info('Clicking Copy Plan');
  await copyBtn.click({ timeout: config.timeouts.action });
  await page.waitForTimeout(800);

  let plan = (await getClipboardText(page)).trim();
  if (!plan || plan.startsWith('CLIPBOARD_ERR')) {
    log.warn('Clipboard empty after Copy Plan; extracting plan text from page');
    plan = (await extractPlanFromPage(page)).trim();
  }

  if (!plan || plan.length < 40) {
    throw new Error('DHS plan text was empty or too short after copy/extract');
  }

  log.info('Captured DHS plan', { chars: plan.length });
  return plan;
}

async function openSlackChannel(page, channelName, log) {
  const slug = channelName.replace(/^#/, '');
  const channelId = config.slack.channels[slug];
  if (!channelId) {
    throw new Error(`Unknown Slack channel #${slug} — add it to config.slack.channels`);
  }

  const clientUrl = `https://app.slack.com/client/${config.slack.teamId}/${channelId}`;
  log.info(`Opening Slack channel #${slug}`, { clientUrl });

  await page.goto(config.urls.slackWorkspace, {
    waitUntil: 'domcontentloaded',
    timeout: config.timeouts.navigation,
  });
  await page.waitForTimeout(1500);

  await page.goto(clientUrl, {
    waitUntil: 'domcontentloaded',
    timeout: config.timeouts.navigation,
  });
  await page.waitForTimeout(3500);

  // Workspace chooser fallback.
  const bodyText = await page.locator('body').innerText().catch(() => '');
  if (/welcome back|choose a workspace/i.test(bodyText) && !/message/i.test(bodyText.slice(0, 200))) {
    log.warn('Hit Slack workspace chooser; retrying via workspace URL');
    await page.goto(config.urls.slackWorkspace, {
      waitUntil: 'domcontentloaded',
      timeout: config.timeouts.navigation,
    });
    await page.waitForTimeout(4000);
    await page.goto(clientUrl, {
      waitUntil: 'domcontentloaded',
      timeout: config.timeouts.navigation,
    });
    await page.waitForTimeout(3500);
  }

  await assertNotLoginWall(page, 'Slack');

  const composer = page.locator('[data-qa="message_input"]');
  await composer.first().waitFor({ state: 'visible', timeout: config.timeouts.navigation });
  return page;
}

async function postToComposer(page, formatted, log) {
  const composer = page.locator('[data-qa="message_input"]').first();
  await composer.waitFor({ state: 'visible', timeout: config.timeouts.navigation });
  await composer.click({ timeout: config.timeouts.action });
  await page.waitForTimeout(200);

  // Prefer HTML clipboard so Slack rich text keeps bold headers.
  const pasted = await page.evaluate(async ({ html, plain }) => {
    const el = document.querySelector('[data-qa="message_input"]');
    if (!el) return { ok: false, reason: 'no-composer' };

    el.focus();

    try {
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/html': new Blob([html], { type: 'text/html' }),
            'text/plain': new Blob([plain], { type: 'text/plain' }),
          }),
        ]);
        return { ok: true, mode: 'clipboard-html' };
      }
    } catch {
      // fall through to execCommand insert
    }

    try {
      const ok = document.execCommand('insertHTML', false, html);
      return { ok, mode: 'insertHTML' };
    } catch (error) {
      return { ok: false, reason: String(error) };
    }
  }, { html: formatted.html, plain: formatted.plain });

  if (pasted?.mode === 'clipboard-html') {
    await page.keyboard.press('Control+V');
  } else if (!pasted?.ok) {
    // Last resort: Slack mrkdwn (*bold*)
    await page.evaluate(async (value) => {
      await navigator.clipboard.writeText(value);
    }, formatted.mrkdwn);
    await page.keyboard.press('Control+V');
  }

  await page.waitForTimeout(500);

  const send = page.locator('[data-qa="texty_send_button"], button[aria-label="Send now"]');
  if (await send.count()) {
    await send.first().click({ timeout: config.timeouts.action });
  } else {
    await page.keyboard.press('Enter');
  }

  await page.waitForTimeout(1500);
  log.info('Posted formatted message to current Slack channel', {
    pasteMode: pasted?.mode || 'mrkdwn-fallback',
  });
}

async function main() {
  const log = createLogger();
  const headless = process.env.DHS_HEADED !== '1';
  const dryRun = process.env.DHS_DRY_RUN === '1';

  if (!fs.existsSync(config.paths.browserProfile)) {
    throw new Error(`Missing browser profile. Run: npm run save-auth`);
  }

  log.info('Starting DHS post', { headless, dryRun, logFile: log.filePath });

  const context = await chromium.launchPersistentContext(config.paths.browserProfile, {
    headless,
    viewport: { width: 1400, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  });

  let page = context.pages()[0] || (await context.newPage());

  try {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});

    const plan = await copyDhsPlan(page, log);
    const formatted = formatDhsPlan(plan);
    fs.writeFileSync(
      path.join(config.paths.logsDir, `plan-${stamp()}.txt`),
      `${plan}\n\n----- FORMATTED PLAIN -----\n${formatted.plain}\n`,
      'utf8'
    );
    log.info('Formatted DHS plan', {
      projects: formatted.parsed.projects.length,
      meetings: formatted.parsed.meetings.length,
    });

    if (dryRun) {
      log.info('Dry run enabled — skipping Slack posts');
      console.log('\n----- DHS PLAN FORMATTED -----\n');
      console.log(formatted.plain);
      console.log('\n----- END PREVIEW -----\n');
      return;
    }

    const results = [];
    for (const channel of config.channels) {
      try {
        page = await openSlackChannel(page, channel, log);
        await postToComposer(page, formatted, log);
        results.push({ channel, status: 'PASS' });
        log.info(`PASS #${channel}`);
      } catch (error) {
        results.push({ channel, status: 'FAIL', error: String(error.message || error) });
        log.error(`FAIL #${channel}`, { error: String(error.message || error) });
      }
    }

    const failed = results.filter((r) => r.status !== 'PASS');
    if (failed.length) {
      throw new Error(
        `Posted with failures: ${failed.map((f) => `#${f.channel}: ${f.error}`).join(' | ')}`
      );
    }

    log.info('Completed DHS publish to all channels', {
      channels: config.channels.map((c) => `#${c}`),
    });
    console.log(
      `\nSUCCESS: DHS plan posted to ${config.channels.map((c) => `#${c}`).join(' and ')}`
    );
  } finally {
    await context.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
