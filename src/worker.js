const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
const DEFAULT_CATALOG = JSON.stringify([{name:'Pre-Purchase & Design Services',services:['Showroom visit','Design consultation','Home measurement','Custom furniture quote']},{name:'Delivery & Fulfillment Services',services:['Furniture delivery','Assembly & installation','Showroom collection']},{name:'Post-Purchase & Care Services',services:['Repairs','Warranty claim','Upholstery & polish care','Returns & exchanges']}]);
const STATUSES = ['pending', 'confirmed', 'ready', 'done', 'cancelled'];

const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

// Message wording per service group. {name} {service} {date} {time} {business} are filled in automatically.
const MSGS = {
  pre: { confirmed: 'Hello {name}, your {service} with {business} is confirmed for {date} at {time}. We look forward to seeing you!', ready: 'Hello {name}, your {service} at {business} is ready for you. Please come by whenever suits you.' },
  delivery: { confirmed: 'Hello {name}, your {service} from {business} is scheduled for {date} at {time}. Please make sure someone is available to receive it.', ready: 'Hello {name}, your {service} from {business} is ready and on its way. Our team will call you on arrival.' },
  post: { confirmed: 'Hello {name}, your {service} request with {business} is booked for {date} at {time}.', ready: 'Good news {name}! Your {service} with {business} is complete and ready. Please contact us to arrange collection or delivery.' },
  generic: { confirmed: 'Hello {name}, your {service} with {business} is confirmed for {date} at {time}.', ready: 'Hello {name}, your {service} with {business} is ready.', cancelled: 'Hello {name}, your {service} booking on {date} at {time} with {business} has been cancelled. Please contact us to rebook.' },
};
const kind = n => /deliver/i.test(n) ? 'delivery' : /post|care/i.test(n) ? 'post' : /pre|design/i.test(n) ? 'pre' : 'generic';

function waPhone(p, cc) {
  const raw = String(p || '').trim(); let d = raw.replace(/\D/g, '');
  if (!d) return '';
  if (raw.startsWith('+')) return d;
  if (d.startsWith('00')) return d.slice(2);
  if (d.startsWith('0')) return cc + d.slice(1);
  return d.startsWith(cc) ? d : cc + d;
}
function message(b, s) {
  let cat; try { cat = JSON.parse(s.catalog).find(c => c.services.includes(b.service)); } catch {}
  const tpl = (MSGS[kind(cat ? cat.name : '')] || {})[b.status] || MSGS.generic[b.status];
  if (!tpl) return '';
  const v = { name: b.client, service: b.service, date: b.date, time: b.time, business: s.business_name };
  return tpl.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? '');
}

// Push notifications: keys are created automatically on first use and kept in the database.
async function vapid(db) {
  const row = await db.prepare("SELECT value FROM settings WHERE key='vapid'").first();
  let jwk = row && JSON.parse(row.value);
  if (!jwk) {
    const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
    jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
    await db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('vapid',?)").bind(JSON.stringify(jwk)).run();
  }
  return { jwk, pub: b64u(new Uint8Array([4, ...unb64u(jwk.x), ...unb64u(jwk.y)])) };
}
async function pushAll(env, origin) {
  const db = env.DB, { jwk, pub } = await vapid(db);
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const { results } = await db.prepare("SELECT key,value FROM settings WHERE key LIKE 'push:%'").all();
  const enc = o => b64u(new TextEncoder().encode(JSON.stringify(o)));
  let ok = 0;
  await Promise.all(results.map(async r => {
    try {
      const sub = JSON.parse(r.value);
      const data = enc({ typ: 'JWT', alg: 'ES256' }) + '.' + enc({ aud: new URL(sub.endpoint).origin, exp: Math.floor(Date.now() / 1000) + 43200, sub: origin });
      const sig = b64u(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(data)));
      const res = await fetch(sub.endpoint, { method: 'POST', headers: { Authorization: `vapid t=${data}.${sig}, k=${pub}`, TTL: '86400', Urgency: 'high' } });
      if (res.ok) ok++; else if (res.status === 404 || res.status === 410) await db.prepare('DELETE FROM settings WHERE key=?').bind(r.key).run();
    } catch {}
  }));
  return ok;
}

async function settings(db) {
  const { results } = await db.prepare("SELECT key, value FROM settings WHERE key != 'vapid' AND key NOT LIKE 'push:%'").all();
  const o = Object.fromEntries(results.map(r => [r.key, r.value]));
  o.catalog = o.catalog || DEFAULT_CATALOG;
  o.country_code = o.country_code || '265';
  return o;
}

async function insert(db, b, status, after) {
  const c = s => String(s || '').trim().slice(0, 300);
  const v = { client: c(b.client), phone: c(b.phone), service: c(b.service), date: c(b.date), time: c(b.time), notes: c(b.notes) };
  if (!v.client || !v.service || !/^\d{4}-\d\d-\d\d$/.test(v.date) || !/^\d\d:\d\d$/.test(v.time)) return json({ error: 'Please fill in client, service, date and time.' }, 400);
  const clash = await db.prepare("SELECT id FROM bookings WHERE date=? AND time=? AND status!='cancelled'").bind(v.date, v.time).first();
  if (clash) return json({ error: 'That time slot is already taken.' }, 409);
  const r = await db.prepare('INSERT INTO bookings (client,phone,service,date,time,notes,status) VALUES (?,?,?,?,?,?,?)')
    .bind(v.client, v.phone, v.service, v.date, v.time, v.notes, status).run();
  if (after) after();
  return json({ id: r.meta.last_row_id }, 201);
}

async function handle({ request, env, ctx, params }) {
  const db = env.DB, m = request.method;
  const [res, id] = params.path || [];
  const body = m === 'GET' || m === 'DELETE' ? {} : await request.json().catch(() => ({}));

  // Public: website booking requests (always saved as "pending")
  if (res === 'request') {
    if (m === 'GET') { const s = await settings(db); return json({ business_name: s.business_name, catalog: s.catalog }); }
    if (m === 'POST') return insert(db, body, 'pending', () => ctx.waitUntil(pushAll(env, new URL(request.url).origin)));
  }

  // Everything else needs the PIN (set APP_PIN as a secret in Cloudflare)
  if (!env.APP_PIN || request.headers.get('x-pin') !== env.APP_PIN) return json({ error: 'Wrong or missing PIN' }, 401);

  if (res === 'push') {
    if (id === 'key' && m === 'GET') return json({ key: (await vapid(db)).pub });
    if (id === 'subscribe' && m === 'POST' && body.endpoint) { await db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)').bind('push:' + body.endpoint, JSON.stringify(body)).run(); return json({ ok: true }); }
    if (id === 'test' && m === 'POST') return json({ sent: await pushAll(env, new URL(request.url).origin) });
  }
  if (res === 'settings') {
    if (m === 'PUT') {
      for (const k of ['business_name', 'catalog', 'country_code']) if (typeof body[k] === 'string' && body[k].trim())
        await db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(k, body[k].trim().slice(0, 4000)).run();
    }
    return json(await settings(db));
  }
  if (res === 'bookings') {
    if (m === 'GET') {
      const from = new URL(request.url).searchParams.get('from') || '0000-00-00';
      const { results } = await db.prepare('SELECT * FROM bookings WHERE date>=? ORDER BY date,time').bind(from).all();
      const s = await settings(db), cc = String(s.country_code).replace(/\D/g, '') || '265';
      return json(results.map(b => ({ ...b, wa: waPhone(b.phone, cc), msg: message(b, s) })));
    }
    if (m === 'POST') return insert(db, body, 'confirmed');
    if (m === 'PATCH' && id && STATUSES.includes(body.status)) {
      await db.prepare('UPDATE bookings SET status=? WHERE id=?').bind(body.status, id).run();
      return json({ ok: true });
    }
    if (m === 'DELETE' && id) { await db.prepare('DELETE FROM bookings WHERE id=?').bind(id).run(); return json({ ok: true }); }
  }
  return json({ error: 'Not found' }, 404);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    const path = url.pathname.slice(5).split('/').filter(Boolean);
    try { return await handle({ request, env, ctx, params: { path } }); }
    catch (err) { return json({ error: 'Server error: ' + err.message }, 500); }
  },
};
