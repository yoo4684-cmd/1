// BESY 근무기록 웹사이트 서버 (외부 패키지 없음, Node 18+)
// - 화면(public/index.html)을 보여주고
// - PIN 로그인, 근무 상태, 퇴근 기록을 노션에 저장/조회합니다.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// .env 파일이 있으면 읽기 (내 컴퓨터에서 실행할 때용)
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const PORT = process.env.PORT || 3000;
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const RECORDS_DB = process.env.NOTION_DATABASE_ID || 'ffcf9ade5a7241849a4867022b0a48c6'; // BESY 근무 기록
const STATE_DB = process.env.NOTION_STATE_DB_ID || '3f4b73a227b544c5a48f42fc22c44330';   // BESY 근무 상태
const SECRET = process.env.SECRET || crypto.createHash('sha256').update('besy:' + (NOTION_TOKEN || 'dev')).digest('hex');
const COMPANY = 'BESY';
const PAYDAY = 5;

// PIN은 원문 대신 해시로만 보관: sha256('besy-pin:' + PIN)
const PEOPLE = {
  hyerin:  { name: '혜린', admin: false, wage: 11000, pin: '7e4e376060748aa0a95e42b87e8c144274aa5b4c2c0a955b5d2c14700f317eca' },
  yujeong: { name: '유정', admin: true,  wage: 0,     pin: '7dc8379e20146918d89f6458cdfee8a56342a71c501bf03dafdc2c00a6e7c41b' },
};

// ───────── 공통 ─────────
const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
const sign = p => `${p}.${crypto.createHmac('sha256', SECRET).update(p).digest('hex').slice(0, 32)}`;
function whoFromToken(req) {
  const t = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const p = t.split('.')[0];
  if (!PEOPLE[p]) return null;
  const a = Buffer.from(t), b = Buffer.from(sign(p));
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? p : null;
}
function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', c => { raw += c; if (raw.length > 1e6) { reject(new Error('too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { reject(e); } });
  });
}
const pad = n => String(n).padStart(2, '0');
// 한국 시간 기준 날짜/시각
const kst = ts => new Date(ts + 9 * 3600e3);
const ymd = ts => { const d = kst(ts); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
const hm = ts => { const d = kst(ts); return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; };
const durM = m => { m = Math.round(m); return m >= 60 ? `${Math.floor(m / 60)}시간${m % 60 ? ' ' + (m % 60) + '분' : ''}` : `${m}분`; };

// ───────── 노션 ─────────
async function notion(method, url, body) {
  const resp = await fetch((process.env.NOTION_API_BASE || 'https://api.notion.com/v1/') + url, {
    method,
    headers: { Authorization: `Bearer ${NOTION_TOKEN}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const msg = data.code === 'object_not_found'
      ? '노션 기록장을 찾을 수 없어요. 노션 「BESY 근무기록 사이트」 페이지에 통합(연결)을 추가해 주세요.'
      : data.code === 'unauthorized' ? '노션 토큰이 올바르지 않아요. NOTION_TOKEN 설정을 확인해 주세요.'
      : (data.message || `노션 오류 (${resp.status})`);
    throw Object.assign(new Error(msg), { status: 502 });
  }
  return data;
}
const rt = str => { const out = []; str = String(str || ''); for (let i = 0; i < str.length && out.length < 100; i += 1900) out.push({ type: 'text', text: { content: str.slice(i, i + 1900) } }); return out; };
const plain = p => (p && (p.rich_text || p.title) || []).map(x => x.plain_text).join('');
const parse = (s, d) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };

// 근무 상태: 사람마다 'BESY 근무 상태' 표의 한 줄. 서버 메모리에 두고 노션에 같이 저장.
const states = {};     // key -> { session, todos }
const stateRows = {};  // key -> notion page id
let statesLoaded = null;
function loadStates() {
  if (!statesLoaded) statesLoaded = (async () => {
    const q = await notion('POST', `databases/${STATE_DB}/query`, { page_size: 100 });
    for (const pg of q.results) {
      const k = plain(pg.properties['키']);
      if (!PEOPLE[k] || stateRows[k]) continue;
      stateRows[k] = pg.id;
      states[k] = { session: parse(plain(pg.properties['세션']), null), todos: parse(plain(pg.properties['할 일']), []) };
    }
    for (const k of Object.keys(PEOPLE)) if (!states[k]) states[k] = { session: null, todos: [] };
  })().catch(e => { statesLoaded = null; throw e; });
  return statesLoaded;
}
const saveChains = {};
function saveState(k) {
  // 같은 사람의 저장은 순서대로 한 번에 하나씩
  saveChains[k] = (saveChains[k] || Promise.resolve()).catch(() => {}).then(async () => {
    const s = states[k];
    const props = { '세션': { rich_text: rt(s.session ? JSON.stringify(s.session) : '') }, '할 일': { rich_text: rt(JSON.stringify(s.todos)) } };
    if (stateRows[k]) await notion('PATCH', `pages/${stateRows[k]}`, { properties: props });
    else {
      const pg = await notion('POST', 'pages', { parent: { database_id: STATE_DB }, properties: { '이름': { title: rt(PEOPLE[k].name) }, '키': { rich_text: rt(k) }, ...props } });
      stateRows[k] = pg.id;
    }
  });
  return saveChains[k];
}
function cleanSession(s) {
  if (!s || typeof s.start !== 'number') return null;
  const pauses = Array.isArray(s.pauses) ? s.pauses.filter(p => typeof p.from === 'number').map(p => ({ from: p.from, to: typeof p.to === 'number' ? p.to : null })) : [];
  return { start: s.start, pauses: pauses.slice(0, 200) };
}
const cleanTodos = t => Array.isArray(t) ? t.slice(0, 100).map(x => ({ id: String(x.id || '').slice(0, 20), text: String(x.text || '').slice(0, 200), done: !!x.done })).filter(x => x.text) : [];

// 퇴근: 근무 기록 표에 한 줄 만들기
async function createRecord(k, s, summary, todos, now) {
  const brk = s.pauses.reduce((a, p) => a + ((p.to ?? now) - p.from), 0);
  const work = now - s.start - brk;
  const r = {
    date: ymd(s.start), startText: hm(s.start), endText: hm(now),
    workMinutes: Math.max(0, Math.round(work / 60000)), breakMinutes: Math.round(brk / 60000),
  };
  const name = PEOPLE[k].name;
  const lines = summary.split('\n').map(l => l.trim()).filter(Boolean).map(l => l.replace(/^[-*•]\s*/, ''));
  const pg = await notion('POST', 'pages', {
    parent: { database_id: RECORDS_DB },
    icon: { type: 'emoji', emoji: '🕒' },
    properties: {
      '이름': { title: rt(`${name} · ${r.date}`) },
      '날짜': { date: { start: r.date } },
      '직원': { select: { name } },
      '회사': { select: { name: COMPANY } },
      '출근': { rich_text: rt(r.startText) },
      '퇴근': { rich_text: rt(r.endText) },
      '근무시간(분)': { number: r.workMinutes },
      '휴식시간(분)': { number: r.breakMinutes },
      '오늘 할 일': { rich_text: rt(todos.map(t => (t.done ? '✓ ' : '○ ') + t.text).join('\n').slice(0, 1900)) },
      '오늘 한 일': { rich_text: rt(summary.slice(0, 1900)) },
    },
    children: [
      { object: 'block', type: 'heading_2', heading_2: { rich_text: rt('근무 요약') } },
      { object: 'block', type: 'paragraph', paragraph: { rich_text: rt(`출근 ${r.startText} · 퇴근 ${r.endText} · 실근무 ${durM(r.workMinutes)} · 휴식 ${durM(r.breakMinutes)}`) } },
      { object: 'block', type: 'heading_2', heading_2: { rich_text: rt('오늘 할 일') } },
      ...(todos.length ? todos.slice(0, 40).map(t => ({ object: 'block', type: 'to_do', to_do: { rich_text: rt(t.text), checked: t.done } }))
        : [{ object: 'block', type: 'paragraph', paragraph: { rich_text: rt('(없음)') } }]),
      { object: 'block', type: 'heading_2', heading_2: { rich_text: rt('오늘 한 일') } },
      ...lines.slice(0, 50).map(l => ({ object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: rt(l) } })),
    ],
  });
  return { ...r, id: pg.id, url: pg.url, employee: name, summary };
}

// 한 사람의 한 달 기록 조회
async function monthRecords(k, month) {
  const [y, m] = month.split('-').map(Number);
  const from = `${y}-${pad(m)}-01`, to = m === 12 ? `${y + 1}-01-01` : `${y}-${pad(m + 1)}-01`;
  const out = []; let cursor;
  do {
    const q = await notion('POST', `databases/${RECORDS_DB}/query`, {
      filter: { and: [
        { property: '직원', select: { equals: PEOPLE[k].name } },
        { property: '날짜', date: { on_or_after: from } },
        { property: '날짜', date: { before: to } },
      ] },
      sorts: [{ property: '날짜', direction: 'ascending' }],
      page_size: 100, start_cursor: cursor,
    });
    for (const pg of q.results) {
      const p = pg.properties;
      out.push({
        id: pg.id, url: pg.url, date: p['날짜']?.date?.start?.slice(0, 10) || '',
        startText: plain(p['출근']), endText: plain(p['퇴근']),
        workMinutes: p['근무시간(분)']?.number || 0, breakMinutes: p['휴식시간(분)']?.number || 0,
        summary: plain(p['오늘 한 일']),
      });
    }
    cursor = q.has_more ? q.next_cursor : undefined;
  } while (cursor);
  return out;
}

// PIN 틀림 횟수 제한 (5번 틀리면 5분 잠금)
const fails = {};

// ───────── 라우팅 ─────────
async function api(req, res, url) {
  if (!NOTION_TOKEN) return send(res, 500, { error: '서버에 NOTION_TOKEN이 설정되지 않았어요.' });

  if (url.pathname === '/api/login' && req.method === 'POST') {
    const { person, pin } = await readBody(req);
    const p = PEOPLE[person];
    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0];
    const f = fails[ip + person] || { n: 0, until: 0 };
    if (f.until > Date.now()) return send(res, 429, { error: 'PIN을 여러 번 틀렸어요. 5분 뒤에 다시 해주세요.' });
    if (!p || sha256('besy-pin:' + String(pin || '')) !== p.pin) {
      f.n++; if (f.n >= 5) { f.until = Date.now() + 5 * 60e3; f.n = 0; }
      fails[ip + person] = f;
      return send(res, 401, { error: 'PIN이 맞지 않아요.' });
    }
    delete fails[ip + person];
    return send(res, 200, { token: sign(person), person, name: p.name, admin: p.admin });
  }

  const me = whoFromToken(req);
  if (!me) return send(res, 401, { error: '다시 로그인해 주세요.' });
  const isAdmin = PEOPLE[me].admin;
  await loadStates();

  if (url.pathname === '/api/me' && req.method === 'GET') {
    const out = { person: me, name: PEOPLE[me].name, admin: isAdmin, state: states[me], now: Date.now() };
    if (isAdmin) out.adminInfo = { people: Object.fromEntries(Object.entries(PEOPLE).map(([k, p]) => [k, { name: p.name, wage: p.wage }])), payday: PAYDAY };
    return send(res, 200, out);
  }

  if (url.pathname === '/api/state' && req.method === 'PUT') {
    const b = await readBody(req);
    states[me] = { session: cleanSession(b.session), todos: cleanTodos(b.todos) };
    await saveState(me);
    return send(res, 200, { ok: true });
  }

  if (url.pathname === '/api/finish' && req.method === 'POST') {
    const b = await readBody(req);
    const summary = String(b.summary || '').trim().slice(0, 5000);
    if (!summary) return send(res, 400, { error: '오늘 한 일을 적어주세요.' });
    const st = states[me];
    const s = cleanSession(b.session) || st.session;
    if (!s) return send(res, 400, { error: '근무 중이 아니에요.' });
    const now = Date.now();
    s.pauses.forEach(p => { if (p.to == null) p.to = now; });
    const todos = cleanTodos(b.todos || st.todos);
    const record = await createRecord(me, s, summary, todos, now);
    states[me] = { session: null, todos: todos.filter(t => !t.done) }; // 못 끝낸 할 일은 내일로
    await saveState(me).catch(() => {});
    return send(res, 200, { ok: true, record, state: states[me] });
  }

  if (url.pathname === '/api/records' && req.method === 'GET') {
    const who = url.searchParams.get('person') || me;
    const month = url.searchParams.get('month') || '';
    if (!PEOPLE[who] || !/^\d{4}-\d{2}$/.test(month)) return send(res, 400, { error: '잘못된 요청이에요.' });
    if (who !== me && !isAdmin) return send(res, 403, { error: '볼 수 없어요.' });
    return send(res, 200, { records: await monthRecords(who, month) });
  }

  if (url.pathname === '/api/states' && req.method === 'GET') {
    if (!isAdmin) return send(res, 403, { error: '볼 수 없어요.' });
    return send(res, 200, { states, now: Date.now() });
  }

  send(res, 404, { error: 'not found' });
}

const PUBLIC_DIR = path.join(__dirname, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith('/api/')) {
    try { await api(req, res, url); }
    catch (e) { console.error(e.message); send(res, e.status || 500, { error: e.message || '서버 오류' }); }
    return;
  }
  if (url.pathname === '/healthz') { res.writeHead(200); return res.end('ok'); }
  const file = path.normalize(path.join(PUBLIC_DIR, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
}).listen(PORT, () => {
  console.log(`BESY 근무기록 → http://localhost:${PORT}`);
  if (!NOTION_TOKEN) console.log('⚠️  NOTION_TOKEN이 없어요. .env 또는 호스팅 환경변수에 넣어주세요.');
});
