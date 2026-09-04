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

async function callFunction(session, name, body) {
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
    throw new Error(`${name} returned non-JSON (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }

  if (!res.ok) {
    throw new Error(
      `${name} failed HTTP ${res.status}: ${json?.error || json?.message || text.slice(0, 200)}`
    );
  }
  if (json && json.success === false) {
    throw new Error(`${name} success=false: ${json?.error || json?.message || 'unknown'}`);
  }
  return json;
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

  const session = loadSession();
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
  fetchPlanFromApi,
};
