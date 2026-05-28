/**
 * GET  /api/departments        – list all departments
 * POST /api/departments        – create a new department (requires admin auth)
 */
import { generateSalt, hashPassword } from '../utils/crypto.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestGet({ env }) {
  try {
    const result = await env.DB.prepare(
      `SELECT id, name, created_at FROM departments ORDER BY name ASC`
    ).all();
    return json({ departments: result.results });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}

export async function onRequestPost({ env, request, data }) {
  const user = data?.user;
  if (!user || user.type !== 'admin') {
    return json({ error: 'Unauthorized – admin only' }, 401);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const { name, password } = body;
  if (!name || !password) {
    return json({ error: 'name and password are required' }, 400);
  }

  const salt = generateSalt();
  const password_hash = await hashPassword(password, salt);

  try {
    const result = await env.DB.prepare(
      `INSERT INTO departments (name, password_hash, salt) VALUES (?, ?, ?)`
    ).bind(name, password_hash, salt).run();
    return json({ id: result.meta.last_row_id, message: 'Department created' }, 201);
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return json({ error: 'A department with that name already exists' }, 409);
    }
    return json({ error: err.message }, 500);
  }
}
