# BESY 근무기록

혜린 님의 출퇴근·근무시간을 기록하고, 퇴근할 때 "오늘 한 일"을 Notion **BESY 근무 기록** 데이터베이스에 자동으로 저장하는 사이트입니다.

## 기능
- **근무 시작**: 출근 시각을 기록하고 타이머를 시작합니다.
- **일시정지 / 근무 재개**: 쉰 시간은 근무시간에서 자동으로 빠집니다.
- **퇴근**: 오늘 한 일을 입력하고 저장하면 Notion에 한 줄(페이지)이 생깁니다.
  - 속성: 이름, 날짜, 직원, 회사, 출근, 퇴근, 근무시간(분), 휴식시간(분), 오늘 한 일
  - 페이지 본문: 근무 요약과 오늘 한 일(줄마다 글머리표)
- 새로고침하거나 브라우저를 닫아도 진행 중인 근무는 그대로 남습니다(브라우저 저장소).
- Notion 저장에 실패해도 기록은 기기에 남고, "최근 기록"에서 다시 시도할 수 있습니다.

## Notion 연동 설정 (처음 한 번)
1. https://www.notion.so/profile/integrations 에서 **새 통합(Internal integration)**을 만들고 토큰(`ntn_...`)을 복사합니다.
2. Notion에서 **BESY 근무 기록** 데이터베이스를 열고, 오른쪽 위 `•••` → **연결(Connections)**에서 방금 만든 통합을 추가합니다.
3. `.env.example`을 `.env`로 복사하고 `NOTION_TOKEN`에 토큰을 넣습니다. DB ID는 이미 들어 있습니다.

## 실행
Node.js 18 이상이면 되고, 따로 설치할 패키지는 없습니다.
```bash
cd worktime
cp .env.example .env   # 토큰 입력
npm start              # http://localhost:3000
```
Notion 토큰이 브라우저에 보이지 않도록 서버(`server.js`)가 대신 Notion API를 호출합니다.
Render나 Railway 같은 Node 호스팅에 올리면 휴대폰에서도 접속할 수 있습니다. 이때 환경변수에 `NOTION_TOKEN`, `NOTION_DATABASE_ID`를 설정하세요.
