export async function onRequestGet({ params, env }) {
  try {
    await ensureResultsTable(env);
    const surveyId = params.surveyId;
    const result = await env.surveyforge
      .prepare(`SELECT * FROM results WHERE survey_id = ? ORDER BY datetime(created_at) DESC`)
      .bind(surveyId)
      .all();

    // Attempt to parse answers TEXT to JSON for each row
    const rows = (result?.results || []).map(r => {
      try {
        if (typeof r.answers === 'string') r.answers = JSON.parse(r.answers);
      } catch (_) {}
      return r;
    });

    return Response.json(rows);
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
