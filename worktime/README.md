# BESY 근무기록 (웹사이트)

Claude 로그인 없이 **주소만 열면 쓰는** 근무기록 사이트입니다.

- 첫 화면: 이름을 누르고 PIN을 입력해요. (혜린 님 / 유정 님)
- 혜린 님 화면: 근무 시작 · 일시정지 · 퇴근, 오늘 할 일, 이번 달 누적 근무
- 유정 님 화면: 내 근무 + 관리자(실시간 근무 상태, 월별 달력·통계, 혜린 님 급여와 3.3% 원천세)
- 모든 기록은 노션 「BESY 근무기록 사이트」 페이지 안의 두 표에 저장돼요.
  - **BESY 근무 기록**: 퇴근할 때마다 한 줄씩 쌓여요.
  - **BESY 근무 상태**: 지금 근무 중인지, 오늘 할 일이 저장돼요. 사이트가 알아서 관리해요.

## 올리는 방법 (Render, 무료)
1. https://render.com 에서 GitHub로 로그인해요.
2. **+ New → Web Service → Public Git Repository**에 `https://github.com/yoo4684-cmd/1`을 넣어요.
3. 설정을 이렇게 채워요.
   | 항목 | 값 |
   |---|---|
   | Branch | `claude/sharp-pascal-11hobw` |
   | Root Directory | `worktime` |
   | Build Command | `npm install` |
   | Start Command | `npm start` |
   | Instance Type | Free |
4. Environment Variables에 `NOTION_TOKEN`(노션 통합 토큰)을 넣어요. `SECRET`(아무 긴 글자)은 넣어도 되고 안 넣어도 돼요.
5. 노션에서 「BESY 근무기록 사이트」 페이지를 열고 `•••` → 연결에서 통합을 추가해요.

무료 서버는 한동안 안 쓰면 잠들어요. 그래서 처음 열 때 최대 1분 정도 걸릴 수 있어요.

## 내 컴퓨터에서 실행
```bash
cp .env.example .env   # 토큰 입력
npm start              # http://localhost:3000
```
