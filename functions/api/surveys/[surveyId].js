export async function onRequestGet({ params, env }) {
  try {
    await ensureTables(env);

    const surveyId = params.surveyId;
    if (!surveyId) {
      return Response.json({ error: 'surveyId is required' }, { status: 400 });
    }

    const result = await env.surveyforge
      .prepare(`SELECT * FROM surveys WHERE survey_id = ? LIMIT 1`)
      .bind(surveyId)
      .all();

    const row = (result.results || [])[0];
    if (!row) {
      return Response.json({ error: 'Survey not found' }, { status: 404 });
    }

    return Response.json(row);
  } catch (e) {
    return Response.json({ error: 'DB error', detail: String(e?.message || e) }, { status: 500 });
  }
}

async function ensureTables(env) {
  await env.surveyforge
    .prepare(`
      CREATE TABLE IF NOT EXISTS surveys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        survey_id TEXT UNIQUE,
        title TEXT,
        description TEXT,
        questions TEXT,
        story TEXT,
        status TEXT DEFAULT 'draft',
        created_at TEXT,
        updated_at TEXT
      )
    `)
    .run();

  await env.surveyforge
    .prepare(`
      CREATE TABLE IF NOT EXISTS results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        result_id TEXT UNIQUE,
        survey_id TEXT,
        answers TEXT,
        created_at TEXT
      )
    `)
    .run();
}
