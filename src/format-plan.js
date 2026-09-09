/**
 * Parse raw DHS "Copy Plan" text into structured sections, then format for Slack.
 *
 * Expected raw shape:
 * Today's Plan:
 * • Project Name
 *   ◦ task
 * • Another Project
 *   ◦ task
 * Meetings:
 * • meeting
 */

function stripBullet(line) {
  return line.replace(/^\s*[•○●▪◦\-]\s*/, '').trim();
}

function parseDhsPlan(raw) {
  const lines = String(raw || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.replace(/\s+$/g, ''));

  const projects = [];
  const meetings = [];
  let mode = 'pre'; // pre | projects | meetings
  let current = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (/^today'?s\s+plan:?$/i.test(trimmed)) {
      mode = 'projects';
      continue;
    }

    if (/^meetings:?$/i.test(trimmed)) {
      mode = 'meetings';
      current = null;
      continue;
    }

    if (mode === 'meetings') {
      meetings.push(stripBullet(trimmed));
      continue;
    }

    // Project header: top-level bullet (•) without leading indent of task bullets
    const isTask = /^\s+[○●▪◦]/.test(line) || /^[○●▪◦]\s/.test(trimmed);
    const isProjectBullet = /^[•●]\s+/.test(trimmed) && !isTask;

    if (mode === 'pre' && isProjectBullet) {
      mode = 'projects';
    }

    if (mode === 'projects') {
      if (isTask) {
        if (!current) {
          current = { name: 'Tasks', tasks: [] };
          projects.push(current);
        }
        current.tasks.push(stripBullet(trimmed));
        continue;
      }

      if (isProjectBullet || (!current && trimmed)) {
        current = { name: stripBullet(trimmed), tasks: [] };
        projects.push(current);
        continue;
      }

      // Continuation / unbulleted task under current project
      if (current) {
        current.tasks.push(stripBullet(trimmed));
      }
    }
  }

  return {
    title: "Today's Plan:",
    projects,
    meetings,
  };
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Format a structured plan ({ title, projects, meetings }) for Slack.
 * @returns {{ plain: string, html: string, mrkdwn: string, parsed: object }}
 */
function formatParsedPlan(parsed) {
  const plainParts = [];
  const htmlParts = [];
  const mrkdwnParts = [];

  plainParts.push(parsed.title);
  htmlParts.push(`<div><strong>${escapeHtml(parsed.title)}</strong></div>`);
  mrkdwnParts.push(`*${parsed.title}*`);

  // 1 blank line after title
  plainParts.push('');
  htmlParts.push('<div><br></div>');
  mrkdwnParts.push('');

  parsed.projects.forEach((project, index) => {
    if (index > 0) {
      // 1 blank line between projects
      plainParts.push('');
      htmlParts.push('<div><br></div>');
      mrkdwnParts.push('');
    }

    plainParts.push(`• ${project.name}`);
    mrkdwnParts.push(`• *${project.name}*`);

    // Nested <ul> so Slack rich-text keeps real indent + small nested bullets
    let projectHtml = `<ul><li><strong>${escapeHtml(project.name)}</strong>`;
    if (project.tasks.length) {
      projectHtml += '<ul>';
      for (const task of project.tasks) {
        plainParts.push(`\t◦ ${task}`);
        mrkdwnParts.push(`\t◦ ${task}`);
        projectHtml += `<li>${escapeHtml(task)}</li>`;
      }
      projectHtml += '</ul>';
    }
    projectHtml += '</li></ul>';
    htmlParts.push(projectHtml);
  });

  if (parsed.meetings.length) {
    // 2 blank lines before Meetings
    plainParts.push('');
    plainParts.push('');
    htmlParts.push('<div><br></div><div><br></div>');
    mrkdwnParts.push('');
    mrkdwnParts.push('');

    plainParts.push('Meetings:');
    htmlParts.push('<div><strong>Meetings:</strong></div>');
    mrkdwnParts.push('*Meetings:*');

    let meetingsHtml = '<ul>';
    for (const meeting of parsed.meetings) {
      plainParts.push(`• ${meeting}`);
      mrkdwnParts.push(`• ${meeting}`);
      meetingsHtml += `<li>${escapeHtml(meeting)}</li>`;
    }
    meetingsHtml += '</ul>';
    htmlParts.push(meetingsHtml);
  }

  return {
    plain: plainParts.join('\n'),
    html: `<div>${htmlParts.join('')}</div>`,
    mrkdwn: mrkdwnParts.join('\n'),
    parsed,
  };
}

/**
 * @param {string|object} rawOrParsed - clipboard text OR structured plan from portal API
 * @returns {{ plain: string, html: string, mrkdwn: string, parsed: object }}
 */
function formatDhsPlan(rawOrParsed) {
  if (rawOrParsed && typeof rawOrParsed === 'object' && Array.isArray(rawOrParsed.projects)) {
    return formatParsedPlan({
      title: rawOrParsed.title || "Today's Plan:",
      projects: rawOrParsed.projects,
      meetings: rawOrParsed.meetings || [],
    });
  }
  return formatParsedPlan(parseDhsPlan(rawOrParsed));
}

module.exports = {
  parseDhsPlan,
  formatDhsPlan,
  formatParsedPlan,
};
