import { hashPassword, generateSalt } from '../../../utils/crypto.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestPost({ env, request, params, data }) {
  const user = data?.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const { id } = params;
  // Allow admin or the department owner to change password
  if (user.type !== 'admin' && !(user.type === 'club' && user.club_id === parseInt(id))) {
    return json({ error: 'Forbidden' }, 403);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const { password } = body;
  if (!password) return json({ error: 'password is required' }, 400);

  try {
    const salt = generateSalt();
    const password_hash = await hashPassword(password, salt);
    await env.DB.prepare(
      `UPDATE departments SET password_hash = ?, salt = ? WHERE id = ?`
    ).bind(password_hash, salt, id).run();
    return json({ message: 'Password updated' });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}
