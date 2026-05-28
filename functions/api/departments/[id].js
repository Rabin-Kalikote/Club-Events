/**
 * GET    /api/departments/:id  – get a single department (public)
 * PUT    /api/departments/:id  – update a department (requires owner department or admin)
 * DELETE /api/departments/:id  – delete a department (requires admin)
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
    const dept = await env.DB.prepare(
      `SELECT id, name, created_at FROM departments WHERE id = ?`
    ).bind(id).first();
    if (!dept) return json({ error: 'Department not found' }, 404);
    return json({ department: dept });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}

export async function onRequestPut({ env, request, params, data }) {
  const user = data?.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const { id } = params;
  if (user.type === 'club' && user.club_id !== parseInt(id)) {
    return json({ error: 'Forbidden' }, 403);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const { name } = body;
  try {
    await env.DB.prepare(
      `UPDATE departments SET name=COALESCE(?,name) WHERE id=?`
    ).bind(name || null, id).run();
    return json({ message: 'Department updated' });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}

export async function onRequestDelete({ env, params, data }) {
  const user = data?.user;
  if (!user || user.type !== 'admin') return json({ error: 'Unauthorized – admin only' }, 401);

  const { id } = params;
  try {
    await env.DB.prepare('DELETE FROM departments WHERE id = ?').bind(id).run();
    return json({ message: 'Department deleted' });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}
