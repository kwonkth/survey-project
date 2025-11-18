export async function onRequestGet({ params, env }) {
  try {
    await ensureTables(env);
    const surveyId = params.id;
    const result = await env.surveyforge
      .prepare(`SELECT * FROM surveys WHERE survey_id = ? LIMIT 1`)
      .bind(surveyId)
      .all();
    const row = (result?.results || [])[0];
    if (!row) return Response.json({ error: 'Not found' }, { status: 404 });

    // Parse TEXT -> JSON for questions and story
    try {
      if (typeof row.questions === 'string') row.questions = JSON.parse(row.questions);
    } catch (_) { row.questions = []; }
    try {
      if (typeof row.story === 'string') row.story = JSON.parse(row.story);
    } catch (_) { row.story = null; }

    return Response.json(row);
  } catch (e) {
    return Response.json({ error: 'DB error', detail: String(e?.message || e) }, { status: 500 });
  }
}

async function ensureTables(env) {
  await env.surveyforge
    .prepare(`CREATE TABLE IF NOT EXISTS surveys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      survey_id TEXT UNIQUE,
      title TEXT,
      description TEXT,
      questions TEXT,
      story TEXT,
      created_at TEXT,
      updated_at TEXT
    )`)
    .run();
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
