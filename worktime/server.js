// BESY 근무시간 기록 서버 — 정적 파일 제공 + Notion 저장 프록시 (외부 패키지 없음, Node 18+)
const http = require('http');
const fs = require('fs');
const path = require('path');

// .env 파일이 있으면 읽기
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const PORT = process.env.PORT || 3000;
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;
const PUBLIC_DIR = path.join(__dirname, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

// Notion rich_text는 2000자 제한 → 나눠서 넣기
function richText(str) {
  const chunks = [];
  for (let i = 0; i < str.length; i += 1900) chunks.push({ type: 'text', text: { content: str.slice(i, i + 1900) } });
  return chunks.length ? chunks : [];
}

async function saveToNotion(r) {
  const lines = (r.summary || '').split('\n').filter(l => l.trim());
  const body = {
    parent: { database_id: NOTION_DATABASE_ID },
    icon: { type: 'emoji', emoji: '🕒' },
    properties: {
      '이름': { title: [{ text: { content: `${r.employee} · ${r.date}` } }] },
      '날짜': { date: { start: r.date } },
      '직원': { select: { name: r.employee } },
      '회사': { select: { name: r.company } },
      '출근': { rich_text: richText(r.startText) },
      '퇴근': { rich_text: richText(r.endText) },
      '근무시간(분)': { number: r.workMinutes },
      '휴식시간(분)': { number: r.breakMinutes },
      '오늘 한 일': { rich_text: richText((r.summary || '').slice(0, 1900)) },
    },
    children: [
      { object: 'block', type: 'heading_2', heading_2: { rich_text: richText('근무 요약') } },
      { object: 'block', type: 'paragraph', paragraph: { rich_text: richText(
        `출근 ${r.startText} · 퇴근 ${r.endText} · 실근무 ${r.workText} · 휴식 ${r.breakText}`) } },
      { object: 'block', type: 'heading_2', heading_2: { rich_text: richText('오늘 한 일') } },
      ...lines.slice(0, 90).map(l => ({
        object: 'block', type: 'bulleted_list_item',
        bulleted_list_item: { rich_text: richText(l.replace(/^\s*[-*•]\s*/, '')) },
      })),
    ],
  };
  const resp = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${NOTION_TOKEN}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.message || `Notion 오류 (${resp.status})`);
  return data.url;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/api/status' && req.method === 'GET') {
    return send(res, 200, { notion: Boolean(NOTION_TOKEN && NOTION_DATABASE_ID) });
  }

  if (url.pathname === '/api/records' && req.method === 'POST') {
    if (!NOTION_TOKEN || !NOTION_DATABASE_ID) {
      return send(res, 500, { error: '서버에 NOTION_TOKEN / NOTION_DATABASE_ID가 설정되지 않았습니다.' });
    }
    let raw = '';
    req.on('data', c => { raw += c; if (raw.length > 1e6) req.destroy(); });
    req.on('end', async () => {
      try {
        const record = JSON.parse(raw);
        const notionUrl = await saveToNotion(record);
        send(res, 200, { ok: true, url: notionUrl });
      } catch (e) {
        send(res, 502, { error: e.message });
      }
    });
    return;
  }

  // 정적 파일
  const file = path.normalize(path.join(PUBLIC_DIR, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
});

server.listen(PORT, () => {
  console.log(`BESY 근무기록 → http://localhost:${PORT}`);
  if (!NOTION_TOKEN || !NOTION_DATABASE_ID) console.log('⚠️  Notion 설정 없음: .env에 NOTION_TOKEN, NOTION_DATABASE_ID를 넣어주세요.');
});
