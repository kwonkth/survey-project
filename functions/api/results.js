export async function onRequestPost({ request, env }) {
  try {
    await ensureResultsTable(env);

    let body = null;
    try {
      body = await request.json();
    } catch (_) {
      return Response.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const { result_id, survey_id, answers, created_at } = body || {};
    if (!result_id || !survey_id || typeof answers === 'undefined') {
      return Response.json({ error: 'Missing fields' }, { status: 400 });
    }

    const answersText = typeof answers === 'string' ? answers : JSON.stringify(answers);
    const createdAt = created_at || new Date().toISOString();

    await env.surveyforge
      .prepare(
        `INSERT INTO results (result_id, survey_id, answers, created_at)
         VALUES (?, ?, ?, ?)`
      )
      .bind(result_id, survey_id, answersText, createdAt)
      .run();

    // 이 설문에 대한 총 응답 수(=이번 응답의 참여 순번)를 계산
    const countResult = await env.surveyforge
      .prepare(`SELECT COUNT(*) AS cnt FROM results WHERE survey_id = ?`)
      .bind(survey_id)
      .all();

    const order = (countResult && Array.isArray(countResult.results) && countResult.results[0]?.cnt) || 0;

    return Response.json({ success: true, order });
  } catch (e) {
    return Response.json({ error: 'DB error', detail: String(e?.message || e) }, { status: 500 });
  }
}

export async function onRequestGet({ env }) {
  // Optional: for /api/results to return all results
  try {
    await ensureResultsTable(env);
    const result = await env.surveyforge
      .prepare(`SELECT * FROM results ORDER BY datetime(created_at) DESC`)
      .all();
    return Response.json(result.results || []);
  } catch (e) {
    return Response.json({ error: 'DB error', detail: String(e?.message || e) }, { status: 500 });
  }
}

async function ensureResultsTable(env) {
  await env.surveyforge
    .prepare(`CREATE TABLE IF NOT EXISTS results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      result_id TEXT UNIQUE,
      survey_id TEXT,
      answers TEXT,
      created_at TEXT
    )`)
    .run();
}
