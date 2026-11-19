/* 2026-11-19 rev.1 — functions/api/apply.js (특강 신청 저장 API 처음 만듦 · index.html rev.11과 짝)
 *
 * 하는 일: 신청 팝업에서 보낸 정보를 검사한 뒤 D1의 applicants 표에 저장한다.
 * 주소: POST /api/apply   (Cloudflare Pages가 functions 폴더를 보고 자동으로 만들어 줌)
 * 필요: Pages 설정에서 D1 데이터베이스를 바인딩 이름 "DB"로 연결해야 함 (env.DB)
 *
 * 돌려주는 답:
 *   200 { ok: true, applicant: {...} }   저장 성공
 *   400 { ok: false, message: "..." }    입력값 문제
 *   403 { ok: false }                    다른 사이트에서 보낸 요청
 *   409 { ok: false, error: "duplicate" } 이미 신청한 이메일
 *   500 { ok: false }                    서버 문제 (DB 연결 안 됨 등)
 */

// 칸마다 최대 글자 수 (D1 표와 화면 입력칸의 maxlength와 같게)
const MAX_LENGTH = { name: 50, phone: 20, email: 254, company: 100, position: 50 };
const MAX_BODY_BYTES = 4096; // 신청 한 건은 이보다 훨씬 작음 — 큰 요청은 거절
const EMAIL_RULE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// JSON 답장 만들기
function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

// 글자 칸 읽기: 문자열이 아니면 빈칸, 앞뒤 빈칸 제거
function readText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

// 입력값 검사 — 문제가 있으면 안내 문장, 없으면 null
function findInputProblem(data) {
  if (!data.name) return '이름을 입력해 주세요.';
  if (!data.phone) return '연락처를 입력해 주세요.';
  if (!data.email) return '이메일을 입력해 주세요.';

  for (const key of Object.keys(MAX_LENGTH)) {
    if (data[key].length > MAX_LENGTH[key]) return '입력한 내용이 너무 깁니다.';
  }

  const phoneDigits = data.phone.replace(/[^0-9]/g, '');
  if (!/^[0-9\-\s+()]+$/.test(data.phone) || phoneDigits.length < 9 || phoneDigits.length > 13) {
    return '연락처를 숫자로 정확히 입력해 주세요.';
  }
  if (!EMAIL_RULE.test(data.email)) return '이메일 형식을 확인해 주세요.';
  return null;
}

export async function onRequestPost({ request, env }) {
  // 1) 다른 사이트에서 몰래 보내는 요청 막기 (우리 페이지에서 보낸 요청만 받음)
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) {
    return jsonResponse(403, { ok: false });
  }

  // 2) DB 연결 확인
  if (!env.DB) {
    console.error('D1 바인딩 "DB"가 연결되지 않았습니다.');
    return jsonResponse(500, { ok: false });
  }

  // 3) 보낸 내용 읽기 (너무 크거나 JSON이 아니면 거절)
  let body;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return jsonResponse(400, { ok: false, message: '입력한 내용이 너무 깁니다.' });
    body = JSON.parse(raw);
  } catch {
    return jsonResponse(400, { ok: false, message: '잘못된 요청입니다.' });
  }
  if (!body || typeof body !== 'object') {
    return jsonResponse(400, { ok: false, message: '잘못된 요청입니다.' });
  }

  const data = {
    name: readText(body.name),
    phone: readText(body.phone),
    email: readText(body.email),
    company: readText(body.company),
    position: readText(body.position),
  };

  // 4) 입력값 검사
  const problem = findInputProblem(data);
  if (problem) return jsonResponse(400, { ok: false, message: problem });

  // 5) 저장 (값은 bind로 따로 넘겨서 SQL 인젝션 방지 · 소속/직위는 비었으면 NULL)
  try {
    const saved = await env.DB.prepare(
      `INSERT INTO applicants (name, company, position, phone, email)
       VALUES (?1, ?2, ?3, ?4, ?5)
       RETURNING id, name, company, position, phone, email, created_at`
    )
      .bind(data.name, data.company || null, data.position || null, data.phone, data.email)
      .first();

    if (!saved) return jsonResponse(500, { ok: false });

    return jsonResponse(200, {
      ok: true,
      applicant: {
        id: saved.id,
        name: saved.name,
        company: saved.company || '',
        position: saved.position || '',
        phone: saved.phone,
        email: saved.email,
        created_at: saved.created_at,
      },
    });
  } catch (error) {
    // 같은 이메일로 이미 신청한 경우 (applicants.email 중복 금지 규칙)
    const message = String((error && error.message) || error);
    if (message.includes('UNIQUE') && message.includes('email')) {
      return jsonResponse(409, { ok: false, error: 'duplicate' });
    }
    console.error('신청 저장 실패:', message);
    return jsonResponse(500, { ok: false });
  }
}