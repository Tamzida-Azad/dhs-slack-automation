const fs = require('fs');
const path = require('path');
const config = require('./config');

const SESSION_PATH = path.join(path.dirname(config.paths.storageState), 'portal-session.json');
const DISMISSALS_PATH = path.join(path.dirname(config.paths.storageState), 'dismissals.json');

const LEAVE_PHRASES = [
  /on leave/i,
  /half day leave/i,
  /not working for the day/i,
  /not[- ]working/i,
  /family emergency/i,
  /out of office/i,
  /\booo\b/i,
  /\bleave\b/i,
  /\bvisit\b/i,
];

function loadSession() {
  if (!fs.existsSync(SESSION_PATH)) {
    throw new Error(
      `Missing ${SESSION_PATH}. Run: npm run refresh-portal-session`
    );
  }
  const session = JSON.parse(fs.readFileSync(SESSION_PATH, 'utf8'));
  if (!session.anonKey || !session.accessToken || !session.functionsBase) {
    throw new Error('portal-session.json is incomplete. Re-run: npm run refresh-portal-session');
  }
  if (!session.supabaseUrl && session.functionsBase) {
    session.supabaseUrl = session.functionsBase.replace(/\/functions\/v1\/?$/, '');
  }
  return session;
}

function saveSession(session) {
  fs.mkdirSync(path.dirname(SESSION_PATH), { recursive: true });
  fs.writeFileSync(SESSION_PATH, JSON.stringify(session, null, 2));
}

function accessTokenExpiresAt(accessToken) {
  try {
    const payload = JSON.parse(
      Buffer.from(String(accessToken).split('.')[1], 'base64url').toString('utf8')
    );
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

function isAccessTokenExpired(accessToken, skewMs = 60_000) {
  const expMs = accessTokenExpiresAt(accessToken);
  if (expMs == null) return false;
  return Date.now() >= expMs - skewMs;
}

/**
 * Exchange refresh_token for a new access_token via Supabase Auth.
 * Persists updated tokens to portal-session.json.
 */
async function refreshAccessToken(session) {
  if (!session.refreshToken) {
    throw new Error(
      'portal-session.json has no refreshToken. Re-run: npm run refresh-portal-session'
    );
  }
  const supabaseUrl =
    session.supabaseUrl ||
    (session.functionsBase || '').replace(/\/functions\/v1\/?$/, '');
  if (!supabaseUrl) {
    throw new Error('portal-session.json is missing supabaseUrl. Re-run: npm run refresh-portal-session');
  }

  const url = `${supabaseUrl}/auth/v1/token?grant_type=refresh_token`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: session.anonKey,
      Authorization: `Bearer ${session.anonKey}`,
    },
    body: JSON.stringify({ refresh_token: session.refreshToken }),
  });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`token refresh returned non-JSON (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }

  if (!res.ok || !json.access_token) {
    throw new Error(
      `token refresh failed HTTP ${res.status}: ${json?.error_description || json?.msg || json?.error || text.slice(0, 200)}`
    );
  }

  session.accessToken = json.access_token;
  if (json.refresh_token) session.refreshToken = json.refresh_token;
  session.savedAt = new Date().toISOString();
  saveSession(session);
  return session;
}

async function ensureFreshSession(session) {
  if (isAccessTokenExpired(session.accessToken)) {
    return refreshAccessToken(session);
  }
  return session;
}

function loadDismissals() {
  if (!fs.existsSync(DISMISSALS_PATH)) {
    return { taskIds: new Set(), meetingIds: new Set() };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(DISMISSALS_PATH, 'utf8'));
    return {
      taskIds: new Set((raw.taskIds || []).map(String)),
      meetingIds: new Set((raw.meetingIds || []).map(String)),
    };
  } catch {
    return { taskIds: new Set(), meetingIds: new Set() };
  }
}

async function callFunctionOnce(session, name, body) {
  const url = `${session.functionsBase}/${name}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: session.anonKey,
      Authorization: `Bearer ${session.accessToken}`,
    },
    body: JSON.stringify(body ?? {}),
  });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    const err = new Error(`${name} returned non-JSON (HTTP ${res.status}): ${text.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }

  if (!res.ok) {
    const err = new Error(
      `${name} failed HTTP ${res.status}: ${json?.error || json?.message || text.slice(0, 200)}`
    );
    err.status = res.status;
    throw err;
  }
  if (json && json.success === false) {
    throw new Error(`${name} success=false: ${json?.error || json?.message || 'unknown'}`);
  }
  return json;
}

async function callFunction(session, name, body) {
  try {
    return await callFunctionOnce(session, name, body);
  } catch (error) {
    if (error.status !== 401) throw error;
    await refreshAccessToken(session);
    return callFunctionOnce(session, name, body);
  }
}

function isLeaveMeeting(summary) {
  const title = String(summary || '');
  return LEAVE_PHRASES.some((re) => re.test(title));
}

function groupTasksByProject(tasks) {
  const order = [];
  const map = new Map();

  for (const task of tasks) {
    const projectName = task.project_name || task.projectName || 'Untitled project';
    const projectId = String(task.project_id ?? task.projectId ?? projectName);
    const key = `${projectId}::${projectName}`;
    if (!map.has(key)) {
      map.set(key, { name: projectName, tasks: [] });
      order.push(key);
    }
    map.get(key).tasks.push(task.name || task.taskName || 'Untitled task');
  }

  return order.map((key) => map.get(key));
}

/**
 * Fetch today's plan parts from live portal edge functions (no UI clicks).
 * Matches My DHS "Refresh Plan" content, minus local dismissals when available.
 */
async function fetchPlanFromApi(options = {}) {
  const timezone =
    options.timezone ||
    process.env.DHS_TIMEZONE ||
    Intl.DateTimeFormat().resolvedOptions().timeZone ||
    'Asia/Dhaka';

  const session = await ensureFreshSession(loadSession());
  const dismissals = loadDismissals();

  const [tasksRes, meetingsRes] = await Promise.all([
    callFunction(session, 'ac-my-tasks', {}),
    callFunction(session, 'my-calendar-events', { timezone }),
  ]);

  const tasks = (tasksRes.tasks || [])
    .filter((t) => !t.is_completed)
    .filter((t) => !dismissals.taskIds.has(String(t.task_id ?? t.id ?? '')));

  const meetings = (meetingsRes.events || [])
    .filter((e) => !isLeaveMeeting(e.summary))
    .filter((e) => !dismissals.meetingIds.has(String(e.id ?? '')))
    .map((e) => e.summary)
    .filter(Boolean);

  const projects = groupTasksByProject(tasks);

  return {
    title: "Today's Plan:",
    projects,
    meetings,
    meta: {
      timezone,
      taskCount: tasks.length,
      meetingCount: meetings.length,
      projectCount: projects.length,
      email: tasksRes.email || meetingsRes.email || null,
      source: 'portal-api',
    },
  };
}

module.exports = {
  SESSION_PATH,
  DISMISSALS_PATH,
  loadSession,
  refreshAccessToken,
  ensureFreshSession,
  fetchPlanFromApi,
};
