/**
 * GET  /api/events?start=&end=   – list events (with optional date range filter)
 * POST /api/events                – create a new event (requires club or admin auth)
 */
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestGet({ env, request }) {
  const url = new URL(request.url);
  const start = url.searchParams.get('start');
  const end   = url.searchParams.get('end');

  let query = `
    SELECT e.*, d.name AS club_name, d.name AS department_name, l.name AS location_name
    FROM events e
    JOIN departments d ON e.department_id = d.id
    LEFT JOIN locations l ON e.location_id = l.id
  `;
  const params = [];

  // Date range filter
  if (start && end) {
    query += ` WHERE e.start_datetime >= ? AND e.start_datetime <= ?`;
    params.push(start, end);
  } else if (start) {
    query += ` WHERE e.start_datetime >= ?`;
    params.push(start);
  }

  // Optional department/club filter (accept either param for compatibility)
  const clubId = url.searchParams.get('club_id');
  const deptId = url.searchParams.get('department_id');
  if (clubId || deptId) {
    const idVal = clubId || deptId;
    query += params.length ? ` AND e.department_id = ?` : ` WHERE e.department_id = ?`;
    params.push(idVal);
  }

  query += ` ORDER BY e.start_datetime ASC`;

  try {
    const result = await env.DB.prepare(query).bind(...params).all();
    return json({ events: result.results });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}

export async function onRequestPost({ env, request, data }) {
  const user = data?.user;
  // Accept legacy 'club', new 'department', and 'admin'
  if (!user || (user.type !== 'club' && user.type !== 'department' && user.type !== 'admin')) {
    return json({ error: 'Unauthorized' }, 401);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const { title, description, location_id, start_datetime, end_datetime, event_type } = body;
  if (!title || !start_datetime || !end_datetime) {
    return json({ error: 'title, start_datetime, and end_datetime are required' }, 400);
  }

  // Admin can specify any department via club_id (backwards compatible) or department_id.
  // Department (club) users use their own club_id as department_id.
  const department_id = user.type === 'admin'
    ? (body.department_id || body.club_id || 0)
    : (user.department_id || user.department_id || user.club_id);
  if (!department_id) {
    return json({ error: 'department_id (or club_id) is required' }, 400);
  }

  try {
    const result = await env.DB.prepare(
      `INSERT INTO events (title, description, location_id, start_datetime, end_datetime, department_id, event_type)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(title, description || '', location_id || null, start_datetime, end_datetime, department_id, event_type || null).run();

    return json({ id: result.meta.last_row_id, message: 'Event created' }, 201);
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}
