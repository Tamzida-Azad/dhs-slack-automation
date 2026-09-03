const path = require('path');

const rootDir = path.resolve(__dirname, '..');

module.exports = {
  rootDir,
  urls: {
    portalHome: 'https://developer.sjinnovation.us/',
    myDhs: 'https://developer.sjinnovation.us/dashboard/my-dhs',
    slack: 'https://app.slack.com/',
    slackWorkspace: 'https://sjinnovation.slack.com/',
  },
  slack: {
    teamId: 'T0285LK1G',
    channels: {
      'daily-head-start': 'G7ELUQV45',
      'sj-qa': 'GS3M9CTGB',
    },
  },
  channels: ['daily-head-start', 'sj-qa'],
  workspaceHint: 'SJ Innovation',
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
};
