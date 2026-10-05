const path = require('path');
const { loadEnv } = require('./load-env');

loadEnv();

const rootDir = path.resolve(__dirname, '..');

function required(name) {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(
      `Missing ${name}. Copy .env.example to .env and set your portal/Slack values.`
    );
  }
  return value;
}

function parseSlackChannels(raw) {
  const channels = {};
  for (const part of raw.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const colon = trimmed.indexOf(':');
    if (colon === -1) {
      throw new Error(
        `Invalid DHS_SLACK_CHANNELS entry "${trimmed}" — use slug:CHANNEL_ID pairs separated by commas`
      );
    }
    const slug = trimmed.slice(0, colon).trim().replace(/^#/, '');
    const id = trimmed.slice(colon + 1).trim();
    if (!slug || !id) {
      throw new Error(`Invalid DHS_SLACK_CHANNELS entry "${trimmed}"`);
    }
    channels[slug] = id;
  }
  if (Object.keys(channels).length === 0) {
    throw new Error('DHS_SLACK_CHANNELS must list at least one channel');
  }
  return channels;
}

const channelMap = parseSlackChannels(required('DHS_SLACK_CHANNELS'));
const channelOrder = (process.env.DHS_CHANNEL_ORDER || Object.keys(channelMap).join(','))
  .split(',')
  .map((s) => s.trim().replace(/^#/, ''))
  .filter(Boolean);

for (const slug of channelOrder) {
  if (!channelMap[slug]) {
    throw new Error(`DHS_CHANNEL_ORDER references unknown channel "${slug}"`);
  }
}

module.exports = {
  rootDir,
  urls: {
    portalHome: required('DHS_PORTAL_HOME'),
    myDhs: required('DHS_PORTAL_MY_DHS'),
    slack: process.env.DHS_SLACK_APP_URL || 'https://app.slack.com/',
    slackWorkspace: required('DHS_SLACK_WORKSPACE_URL'),
  },
  slack: {
    teamId: required('DHS_SLACK_TEAM_ID'),
    channels: channelMap,
  },
  channels: channelOrder,
  workspaceHint: process.env.DHS_WORKSPACE_HINT || 'your Slack workspace',
  paths: {
    browserProfile: path.join(rootDir, 'browser-profile'),
    storageState: path.join(rootDir, 'auth', 'storage-state.json'),
    logsDir: path.join(rootDir, 'logs'),
  },
  timeouts: {
    navigation: 60_000,
    action: 30_000,
    loginWaitMs: 10 * 60_000,
  },
  /** After a Slack post fails: wait delayMs, then retry up to maxRetries more times. */
  slackRetry: {
    maxRetries: 10,
    delayMs: 10 * 60_000,
  },
};
