const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
const STATUSES = ['pending', 'confirmed', 'done', 'cancelled'];

async function settings(db) {
  const { results } = await db.prepare('SELECT key, value FROM settings').all();
  return Object.fromEntries(results.map(r => [r.key, r.value]));
}

async function insert(db, b, status) {
  const c = s => String(s || '').trim().slice(0, 300);
  const v = { client: c(b.client), phone: c(b.phone), service: c(b.service), date: c(b.date), time: c(b.time), notes: c(b.notes) };
  if (!v.client || !v.service || !/^\d{4}-\d\d-\d\d$/.test(v.date) || !/^\d\d:\d\d$/.test(v.time)) return json({ error: 'Please fill in client, service, date and time.' }, 400);
  const clash = await db.prepare("SELECT id FROM bookings WHERE date=? AND time=? AND status!='cancelled'").bind(v.date, v.time).first();
  if (clash) return json({ error: 'That time slot is already taken.' }, 409);
  const r = await db.prepare('INSERT INTO bookings (client,phone,service,date,time,notes,status) VALUES (?,?,?,?,?,?,?)')
    .bind(v.client, v.phone, v.service, v.date, v.time, v.notes, status).run();
  return json({ id: r.meta.last_row_id }, 201);
}

export async function onRequest({ request, env, params }) {
  const db = env.DB, m = request.method;
  const [res, id] = params.path || [];
  const body = m === 'GET' || m === 'DELETE' ? {} : await request.json().catch(() => ({}));

  // Public: website booking requests (always saved as "pending")
  if (res === 'request') {
    if (m === 'GET') { const s = await settings(db); return json({ business_name: s.business_name, services: s.services }); }
    if (m === 'POST') return insert(db, body, 'pending');
  }

  // Everything else needs the PIN (set APP_PIN as a secret in Cloudflare)
  if (!env.APP_PIN || request.headers.get('x-pin') !== env.APP_PIN) return json({ error: 'Wrong or missing PIN' }, 401);

  if (res === 'settings') {
    if (m === 'PUT') {
      for (const k of ['business_name', 'services']) if (typeof body[k] === 'string' && body[k].trim())
        await db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(k, body[k].trim().slice(0, 500)).run();
    }
    return json(await settings(db));
  }
  if (res === 'bookings') {
    if (m === 'GET') {
      const from = new URL(request.url).searchParams.get('from') || '0000-00-00';
      const { results } = await db.prepare('SELECT * FROM bookings WHERE date>=? ORDER BY date,time').bind(from).all();
      return json(results);
    }
    if (m === 'POST') return insert(db, body, 'confirmed');
    if (m === 'PATCH' && id && STATUSES.includes(body.status)) { await db.prepare('UPDATE bookings SET status=? WHERE id=?').bind(body.status, id).run(); return json({ ok: true }); }
    if (m === 'DELETE' && id) { await db.prepare('DELETE FROM bookings WHERE id=?').bind(id).run(); return json({ ok: true }); }
  }
  return json({ error: 'Not found' }, 404);
}
