const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { chromium } = require('playwright');
const config = require('./config');

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(String(answer || '').trim());
    });
  });
}

async function main() {
  fs.mkdirSync(config.paths.browserProfile, { recursive: true });
  fs.mkdirSync(path.dirname(config.paths.storageState), { recursive: true });
  fs.mkdirSync(config.paths.logsDir, { recursive: true });

  console.log('Opening a headed Chromium window with a persistent profile.');
  console.log(`Profile: ${config.paths.browserProfile}`);
  console.log('');
  console.log('1) Sign in to the SJ Developer Portal if prompted.');
  console.log('2) Confirm you can open My DHS.');
  console.log('3) Sign in to Slack (SJ Innovation workspace, 100+ members) if prompted.');
  console.log('4) Open #daily-head-start once so Slack remembers it.');
  console.log('5) Return here and press Enter when both sessions look good.');
  console.log('');

  const context = await chromium.launchPersistentContext(config.paths.browserProfile, {
    headless: false,
    viewport: { width: 1400, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const portalPage = context.pages()[0] || (await context.newPage());
  await portalPage.goto(config.urls.myDhs, {
    waitUntil: 'domcontentloaded',
    timeout: config.timeouts.navigation,
  });

  const slackPage = await context.newPage();
  await slackPage.goto(config.urls.slack, {
    waitUntil: 'domcontentloaded',
    timeout: config.timeouts.navigation,
  });

  await ask('Press Enter after you have finished signing in on both tabs... ');

  await context.storageState({ path: config.paths.storageState });
  await context.close();

  console.log('');
  console.log('Saved:');
  console.log(`- Persistent profile: ${config.paths.browserProfile}`);
  console.log(`- Storage state:      ${config.paths.storageState}`);
  console.log('');
  console.log('Next: npm run post-dhs   (dry run / manual post)');
  console.log('Then:  powershell -ExecutionPolicy Bypass -File .\\scripts\\register-task.ps1');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
