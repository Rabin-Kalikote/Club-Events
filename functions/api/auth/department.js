/**
 * POST /api/auth/department  – login as a department user
 * Body: { department_id, password }
 * Returns: { token, department: { id, name } }
 */
import { verifyPassword } from '../../utils/crypto.js';
import { signToken } from '../../utils/jwt.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestPost({ env, request }) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const { department_id, password } = body;
  if (!department_id || !password) {
    return json({ error: 'department_id and password are required' }, 400);
  }

  try {
    const dept = await env.DB.prepare(
      `SELECT id, name, password_hash, salt FROM departments WHERE id = ?`
    ).bind(department_id).first();

    if (!dept) return json({ error: 'Department not found' }, 404);

    const valid = await verifyPassword(password, dept.password_hash, dept.salt);
    if (!valid) return json({ error: 'Incorrect password' }, 401);

    const secret = env.JWT_SECRET || 'change-this-secret-in-production';
    const token = await signToken({ type: 'department', department_id: dept.id, department_name: dept.name }, secret);

    return json({ token, department: { id: dept.id, name: dept.name } });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}
