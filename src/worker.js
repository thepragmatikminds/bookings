const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
const DEFAULT_CATALOG = JSON.stringify([{name:'Pre-Purchase & Design Services',services:['Showroom visit','Design consultation','Home measurement','Custom furniture quote']},{name:'Delivery & Fulfillment Services',services:['Furniture delivery','Assembly & installation','Showroom collection']},{name:'Post-Purchase & Care Services',services:['Repairs','Warranty claim','Upholstery & polish care','Returns & exchanges']}]);
const DEFAULT_HOURS = '{"open":"08:00","close":"17:00","days":[1,2,3,4,5,6],"slot":60}';
const COLS = 'id,client,phone,service,date,time,notes,status,created_at,address,amount,assigned,price,paid,source,confirmed_at,stage,(length(photo)>0) AS has_photo';
async function tok(env, id) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode('manage:' + (env.APP_PIN || '')), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return id + '.' + b64u(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(String(id)))).slice(0, 22);
}
async function untok(env, t) { const id = String(t || '').split('.')[0]; return id && (await tok(env, id)) === t ? id : null; }
async function limit(db, key, max, secs, peek) {
  const now = Math.floor(Date.now() / 1000);
  try {
    const r = await db.prepare('SELECT n,ts FROM limits WHERE key=?').bind(key).first(), live = r && now - r.ts < secs;
    if (live && r.n >= max) return true;
    if (peek) return false;
    if (live) await db.prepare('UPDATE limits SET n=n+1 WHERE key=?').bind(key).run();
    else await db.prepare('INSERT OR REPLACE INTO limits (key,n,ts) VALUES (?,1,?)').bind(key, now).run();
  } catch {}
  return false;
}
const note = (db, who, action) => db.prepare('INSERT INTO log (who,action) VALUES (?,?)').bind(who, String(action).slice(0, 200)).run().catch(() => {});
const STATUSES = ['pending', 'confirmed', 'ready', 'done', 'noshow', 'cancelled'];

const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

// Message wording per service group. {name} {service} {date} {time} {business} are filled in automatically.
const MSGS = {
  pre: { confirmed: 'Hello {name}, your {service} with {business} is confirmed for {date} at {time}. We look forward to seeing you! To change or cancel: {link}', ready: 'Hello {name}, your {service} at {business} is ready for you. Please come by whenever suits you.' },
  delivery: { confirmed: 'Hello {name}, your {service} from {business} is scheduled for {date} at {time}. Please make sure someone is available to receive it. To change or cancel: {link}', ready: 'Hello {name}, your {service} from {business} is ready and on its way. Our team will call you on arrival.' },
  post: { confirmed: 'Hello {name}, your {service} request with {business} is booked for {date} at {time}. To change or cancel: {link}', ready: 'Good news {name}! Your {service} with {business} is complete and ready. Please contact us to arrange collection or delivery.' },
  generic: { confirmed: 'Hello {name}, your {service} with {business} is confirmed for {date} at {time}. To change or cancel: {link}', ready: 'Hello {name}, your {service} with {business} is ready.', done: 'Thank you {name} for choosing {business}! We hope you are happy with your {service}. We would love your feedback, a short review helps us a lot.', cancelled: 'Hello {name}, your {service} booking on {date} at {time} with {business} has been cancelled. Please contact us to rebook.' },
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
const mergedMsgs = s => { let o = {}; try { o = JSON.parse(s.messages || '{}'); } catch {} return Object.fromEntries(Object.keys(MSGS).map(k => [k, { ...MSGS[k], ...(o[k] || {}) }])); };
const reminder = (b, s, link = '') => `Hello ${b.client}, a reminder that your ${b.service} with ${s.business_name} is tomorrow at ${b.time}. To reschedule or cancel: ${link}`;
const stagemsg = (b, s) => `Hello ${b.client}, an update on your ${b.service} from ${s.business_name}: it is now at the "${b.stage}" stage.`;
const followup = (b, s) => `Hello ${b.client}, it has been a while since your ${b.service} with ${s.business_name}. Is there anything we can help with, such as a new piece, a repair or a design consultation?`;
function message(b, s, link = '') {
  let cat; try { cat = JSON.parse(s.catalog).find(c => c.services.includes(b.service)); } catch {}
  const M = mergedMsgs(s), tpl = (M[kind(cat ? cat.name : '')] || {})[b.status] || M.generic[b.status];
  if (!tpl) return '';
  const v = { name: b.client, service: b.service, date: b.date, time: b.time, business: s.business_name, link };
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
  o.hours = o.hours || DEFAULT_HOURS;
  o.brand = o.brand || '#0F766E';
  o.team = o.team || '[]';
  o.currency = o.currency || 'MWK';
  o.stages = o.stages || 'Design approved, Building, Finishing, Ready for delivery';
  o.messages = JSON.stringify(mergedMsgs(o));
  return o;
}

async function insert(env, b, status, after) {
  const db = env.DB;
  const c = s => String(s || '').trim().slice(0, 300);
  const v = { client: c(b.client), phone: c(b.phone), service: c(b.service), date: c(b.date), time: c(b.time), notes: c(b.notes), address: c(b.address), amount: c(b.amount), assigned: c(b.assigned), source: status === 'pending' ? (c(b.source) || 'general') : 'staff' };
  const photo = typeof b.photo === 'string' && b.photo.startsWith('data:image/') && b.photo.length < 400000 ? b.photo : '';
  if (!v.client || !v.service || !/^\d{4}-\d\d-\d\d$/.test(v.date) || !/^\d\d:\d\d$/.test(v.time)) return json({ error: 'Please fill in client, service, date and time.' }, 400);
  if (status === 'pending') {
    const h = JSON.parse((await settings(db)).hours), dow = new Date(v.date + 'T00:00:00Z').getUTCDay();
    if (!h.days.includes(dow) || v.time < h.open || v.time > h.close) return json({ error: 'We are closed at that time. Please pick one of the available times.' }, 400);
  }
  const clash = await db.prepare("SELECT id FROM bookings WHERE date=? AND time=? AND status NOT IN ('cancelled','deleted')").bind(v.date, v.time).first();
  if (clash) return json({ error: 'That time slot is already taken.' }, 409);
  const r = await db.prepare('INSERT INTO bookings (client,phone,service,date,time,notes,address,amount,assigned,photo,price,paid,source,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind(v.client, v.phone, v.service, v.date, v.time, v.notes, v.address, v.amount, v.assigned, photo, status === 'pending' ? 0 : Math.max(0, +b.price || 0), status === 'pending' ? 0 : Math.max(0, +b.paid || 0), v.source, status).run();
  if (after) after();
  return json({ id: r.meta.last_row_id, token: await tok(env, r.meta.last_row_id) }, 201);
}

async function handle({ request, env, ctx, params }) {
  const db = env.DB, m = request.method;
  const [res, id] = params.path || [];
  const body = m === 'GET' || m === 'DELETE' ? {} : await request.json().catch(() => ({}));

  // Public: website booking requests (always saved as "pending")
  if (res === 'request') {
    if (m === 'GET') {
      const s = await settings(db), d = new URL(request.url).searchParams.get('date'), vv = new URL(request.url).searchParams.get('v');
      if (vv) try { await db.prepare('INSERT INTO visits (day,source,n) VALUES (?,?,1) ON CONFLICT(day,source) DO UPDATE SET n=n+1').bind(new Date().toISOString().slice(0, 10), vv.slice(0, 40)).run(); } catch {}
      const taken = d ? (await db.prepare("SELECT time FROM bookings WHERE date=? AND status NOT IN ('cancelled','deleted')").bind(d).all()).results.map(r => r.time) : [];
      return json({ business_name: s.business_name, catalog: s.catalog, hours: s.hours, brand: s.brand, logo: s.logo, payinfo: s.payinfo, showroom: s.showroom, taken });
    }
    if (m === 'POST') {
      if (body.website) return json({ id: 0, token: '' }, 201);
      const ip = request.headers.get('cf-connecting-ip') || 'x';
      if (await limit(db, 'ip:' + ip, 10, 3600) || await limit(db, 'ph:' + String(body.phone || '').replace(/\D/g, ''), 5, 86400)) return json({ error: 'Too many requests. Please try again later or call us.' }, 429);
      if (body.waitlist) {
        const c = x => String(x || '').trim().slice(0, 200);
        if (!c(body.client) || !c(body.phone) || !c(body.service) || !/^\d{4}-\d\d-\d\d$/.test(body.date)) return json({ error: 'Please fill in your name, phone and service.' }, 400);
        await db.prepare('INSERT INTO waitlist (client,phone,service,date) VALUES (?,?,?,?)').bind(c(body.client), c(body.phone), c(body.service), body.date).run();
        ctx.waitUntil(pushAll(env, new URL(request.url).origin));
        return json({ ok: true }, 201);
      }
      return insert(env, body, 'pending', () => ctx.waitUntil(pushAll(env, new URL(request.url).origin)));
    }
  }

  // Public: clients change or cancel their own booking through a private link
  if (res === 'manage') {
    const bid = await untok(env, m === 'GET' ? new URL(request.url).searchParams.get('t') : body.t);
    const b = bid && await db.prepare('SELECT client,service,date,time,status,address,stage,price,paid FROM bookings WHERE id=?').bind(bid).first();
    if (!b) return json({ error: 'This link is not valid.' }, 404);
    const s = await settings(db), note = () => ctx.waitUntil(pushAll(env, new URL(request.url).origin));
    if (m === 'GET') return json({ ...b, business_name: s.business_name, brand: s.brand, payinfo: s.payinfo, showroom: s.showroom });
    if (body.action === 'cancel') { await db.prepare("UPDATE bookings SET status='cancelled' WHERE id=?").bind(bid).run(); note(); return json({ ok: true }); }
    if (body.action === 'move') {
      const h = JSON.parse(s.hours), dow = new Date(body.date + 'T00:00:00Z').getUTCDay();
      if (!/^\d{4}-\d\d-\d\d$/.test(body.date) || !/^\d\d:\d\d$/.test(body.time) || !h.days.includes(dow) || body.time < h.open || body.time > h.close) return json({ error: 'We are closed at that time. Please pick another.' }, 400);
      if (await db.prepare("SELECT id FROM bookings WHERE date=? AND time=? AND status NOT IN ('cancelled','deleted') AND id!=?").bind(body.date, body.time, bid).first()) return json({ error: 'That time slot is already taken.' }, 409);
      await db.prepare("UPDATE bookings SET date=?,time=?,status='pending' WHERE id=?").bind(body.date, body.time, bid).run(); note();
      return json({ ok: true });
    }
    return json({ error: 'Not found' }, 404);
  }

  // Everything else needs a PIN: the owner PIN (APP_PIN) or a team member's PIN
  const pinH = request.headers.get('x-pin') || '';
  const team = JSON.parse((await settings(db)).team || '[]');
  const ip = request.headers.get('cf-connecting-ip') || 'x';
  if (await limit(db, 'pin:' + ip, 8, 900, true)) return json({ error: 'Too many wrong PINs. Try again in 15 minutes.' }, 429);
  const owner = !!env.APP_PIN && pinH === env.APP_PIN, mate = owner ? null : team.find(x => x.pin && x.pin === pinH);
  if (!owner && !mate) { await limit(db, 'pin:' + ip, 8, 900); return json({ error: 'Wrong or missing PIN' }, 401); }
  const me = owner ? 'Owner' : mate.name;

  if (res === 'waitlist') {
    if (m === 'GET') return json((await db.prepare('SELECT * FROM waitlist ORDER BY date,id').all()).results);
    if (m === 'DELETE' && id) { await db.prepare('DELETE FROM waitlist WHERE id=?').bind(id).run(); return json({ ok: true }); }
  }
  if (res === 'deleted' || res === 'restore' || res === 'log') {
    if (!owner) return json({ error: 'Owner only' }, 403);
    if (res === 'deleted') { await db.prepare("DELETE FROM bookings WHERE status='deleted' AND deleted_at < datetime('now','-30 day')").run(); return json((await db.prepare("SELECT id,client,service,date,time,deleted_at FROM bookings WHERE status='deleted' ORDER BY deleted_at DESC").all()).results); }
    if (res === 'restore' && id && m === 'POST') { await db.prepare("UPDATE bookings SET status='pending',deleted_at='' WHERE id=? AND status='deleted'").bind(id).run(); await note(db, me, 'Restored booking #' + id); return json({ ok: true }); }
    if (res === 'log') { try { return json((await db.prepare('SELECT ts,who,action FROM log ORDER BY id DESC LIMIT 60').all()).results); } catch { return json([]); } }
  }
  if (res === 'visits' && m === 'GET') {
    if (!owner) return json({ error: 'Owner only' }, 403);
    try { return json((await db.prepare('SELECT day,source,n FROM visits WHERE day>=?').bind(new URL(request.url).searchParams.get('from') || '0000').all()).results); } catch { return json([]); }
  }
  if (res === 'photo' && id) { const r = await db.prepare('SELECT photo FROM bookings WHERE id=?').bind(id).first(); return json({ photo: r ? r.photo : '' }); }
  if (res === 'export' && m === 'GET') {
    if (!owner) return json({ error: 'Owner only' }, 403);
    const { results } = await db.prepare("SELECT * FROM bookings WHERE status!='deleted' ORDER BY date,time").all();
    const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"', cols = ['id', 'date', 'time', 'client', 'phone', 'service', 'status', 'address', 'amount', 'price', 'paid', 'source', 'notes'];
    return new Response([cols.join(','), ...results.map(r => cols.map(c => q(r[c])).join(','))].join('\n'), { headers: { 'content-type': 'text/csv' } });
  }
  if (res === 'push') {
    if (id === 'key' && m === 'GET') return json({ key: (await vapid(db)).pub });
    if (id === 'subscribe' && m === 'POST' && body.endpoint) { await db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)').bind('push:' + body.endpoint, JSON.stringify(body)).run(); return json({ ok: true }); }
    if (id === 'test' && m === 'POST') return json({ sent: await pushAll(env, new URL(request.url).origin) });
  }
  if (res === 'settings') {
    if (m === 'PUT') {
      if (!owner) return json({ error: 'Only the owner can change settings' }, 403);
      await note(db, me, 'Changed settings');
      for (const k of ['business_name', 'catalog', 'country_code', 'hours', 'messages', 'brand', 'team', 'logo', 'currency', 'payinfo', 'showroom', 'stages']) if (typeof body[k] === 'string' && (body[k].trim() || ['payinfo', 'showroom', 'stages'].includes(k)))
        await db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(k, body[k].trim().slice(0, k === 'logo' ? 150000 : 4000)).run();
    }
    const s = await settings(db), names = JSON.parse(s.team || '[]').map(x => x.name);
    if (!owner) delete s.team;
    return json({ ...s, names, me, owner });
  }
  if (res === 'bookings') {
    if (m === 'GET') {
      const from = new URL(request.url).searchParams.get('from') || '0000-00-00';
      const { results } = await db.prepare(`SELECT ${COLS} FROM bookings WHERE date>=? AND status!='deleted' ORDER BY date,time`).bind(from).all();
      const s = await settings(db), cc = String(s.country_code).replace(/\D/g, '') || '265';
      const origin = new URL(request.url).origin;
      return json(await Promise.all(results.map(async b => { const link = origin + '/manage.html?t=' + await tok(env, b.id); return { ...b, wa: waPhone(b.phone, cc), msg: message(b, s, link), rem: reminder(b, s, link), fu: followup(b, s), stg: b.stage ? stagemsg(b, s) : '' }; })));
    }
    if (m === 'POST') { await note(db, me, 'Added booking for ' + String(body.client || '').slice(0, 40)); return insert(env, body, 'confirmed'); }
    if (m === 'PATCH' && id) {
      const sets = [], vals = [];
      for (const k of ['status', 'client', 'phone', 'service', 'date', 'time', 'notes', 'address', 'amount', 'assigned', 'price', 'paid', 'stage']) if (k in body) {
        if (k === 'status' && !STATUSES.includes(body.status)) return json({ error: 'Bad status' }, 400);
        sets.push(k + '=?'); vals.push(k === 'price' || k === 'paid' ? Math.max(0, +body[k] || 0) : String(body[k]).slice(0, 300));
      }
      if (['confirmed', 'ready', 'done'].includes(body.status)) sets.push("confirmed_at=COALESCE(NULLIF(confirmed_at,''),CURRENT_TIMESTAMP)");
      if (!sets.length) return json({ error: 'Nothing to update' }, 400);
      if (body.date && body.time && await db.prepare("SELECT id FROM bookings WHERE date=? AND time=? AND status NOT IN ('cancelled','deleted') AND id!=?").bind(body.date, body.time, id).first()) return json({ error: 'That time slot is already taken.' }, 409);
      await db.prepare(`UPDATE bookings SET ${sets.join(',')} WHERE id=?`).bind(...vals, id).run();
      await note(db, me, 'Edited booking #' + id + ' (' + Object.keys(body).join(', ') + ')');
      return json({ ok: true });
    }
    if (m === 'DELETE' && id) { await db.prepare("UPDATE bookings SET status='deleted',deleted_at=CURRENT_TIMESTAMP WHERE id=?").bind(id).run(); await note(db, me, 'Deleted booking #' + id); return json({ ok: true }); }
  }
  return json({ error: 'Not found' }, 404);
}

export default {
  async scheduled(event, env) {
    await env.DB.prepare("DELETE FROM bookings WHERE status='deleted' AND deleted_at < datetime('now','-30 day')").run().catch(() => {});
    if (env.BACKUPS) { const { results } = await env.DB.prepare('SELECT * FROM bookings').all(); await env.BACKUPS.put('bookings-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(results)); }
  },
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    const path = url.pathname.slice(5).split('/').filter(Boolean);
    try { return await handle({ request, env, ctx, params: { path } }); }
    catch (err) { return json({ error: 'Server error: ' + err.message }, 500); }
  },
};
