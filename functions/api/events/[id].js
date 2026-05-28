/**
 * GET    /api/events/:id  – get a single event
 * PUT    /api/events/:id  – update an event (requires owner club or admin)
 * DELETE /api/events/:id  – delete an event (requires owner club or admin)
 */
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestGet({ env, params }) {
  const { id } = params;
  try {
    const event = await env.DB.prepare(
      `SELECT e.*, d.name AS department_name, l.name AS location_name
       FROM events e
       JOIN departments d ON e.department_id = d.id
       LEFT JOIN locations l ON e.location_id = l.id
       WHERE e.id = ?`
    ).bind(id).first();
    if (!event) return json({ error: 'Event not found' }, 404);
    return json({ event });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}

export async function onRequestPut({ env, request, params, data }) {
  const user = data?.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const { id } = params;
  const event = await env.DB.prepare('SELECT * FROM events WHERE id = ?').bind(id).first();
  if (!event) return json({ error: 'Event not found' }, 404);

  // Allow department-level users to manage their own events
  const userDeptId = user.department_id || user.club_id;
  if (user.type === 'club' || user.type === 'department') {
    if (userDeptId !== event.department_id) {
      return json({ error: 'Forbidden' }, 403);
    }
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const { title, description, location_id, start_datetime, end_datetime } = body;
  try {
    await env.DB.prepare(
      `UPDATE events SET title=?, description=?, location_id=?, start_datetime=?, end_datetime=? WHERE id = ?`
    ).bind(
      title ?? event.title,
      description ?? event.description,
      location_id ?? event.location_id,
      start_datetime ?? event.start_datetime,
      end_datetime ?? event.end_datetime,
      id
    ).run();
    return json({ message: 'Event updated' });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}

export async function onRequestDelete({ env, params, data }) {
  const user = data?.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const { id } = params;
  const event = await env.DB.prepare('SELECT * FROM events WHERE id = ?').bind(id).first();
  if (!event) return json({ error: 'Event not found' }, 404);

  const userDeptId2 = user.department_id || user.club_id;
  if (user.type === 'club' || user.type === 'department') {
    if (userDeptId2 !== event.department_id) {
      return json({ error: 'Forbidden' }, 403);
    }
  }

  try {
    await env.DB.prepare('DELETE FROM events WHERE id = ?').bind(id).run();
    return json({ message: 'Event deleted' });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}
