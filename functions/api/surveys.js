export async function onRequestGet({ env }) {
  try {
    await ensureTables(env);
    const result = await env.surveyforge
      .prepare(`SELECT * FROM surveys ORDER BY datetime(created_at) DESC`)
      .all();

    return Response.json(result.results || []);
  } catch (e) {
    return Response.json({ error: 'DB error', detail: String(e?.message || e) }, { status: 500 });
  }
}

export async function onRequestPost({ request, env }) {
  try {
    await ensureTables(env);

    let body = null;
    try {
      body = await request.json();
    } catch (_) {
      return Response.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const {
      survey_id,
      title,
      description,
      questions,
      story,
      status,      // ★ 추가됨
      created_at,
      updated_at,
    } = body || {};

    if (!survey_id || !title) {
      return Response.json({ error: 'Missing fields' }, { status: 400 });
    }

    const questionsText = typeof questions === 'string' ? questions : JSON.stringify(questions ?? []);
    const storyText = typeof story === 'string' ? story : story ? JSON.stringify(story) : null;
    const createdAt = created_at || new Date().toISOString();
    const updatedAt = updated_at || createdAt;
    const statusValue = status || 'draft';   // ★ 기본값 draft

    try {
      // INSERT
      await env.surveyforge
        .prepare(`
          INSERT INTO surveys 
            (survey_id, title, description, questions, story, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .bind(
          survey_id,
          title,
          description ?? null,
          questionsText,
          storyText,
          statusValue,  
          createdAt,
          updatedAt
        )
        .run();

    } catch (e) {
      // UPDATE
      if (String(e?.message || '').includes('UNIQUE')) {
        await env.surveyforge
          .prepare(`
            UPDATE surveys 
            SET title = ?, description = ?, questions = ?, story = ?, status = ?, updated_at = ?
            WHERE survey_id = ?
          `)
          .bind(
            title,
            description ?? null,
            questionsText,
            storyText,
            statusValue,
            updatedAt,
            survey_id
          )
          .run();
      } else {
        return Response.json({ error: 'DB error', detail: String(e?.message || e) }, { status: 500 });
      }
    }

    return Response.json({ success: true });
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
        status TEXT DEFAULT 'draft',     -- ★ status 컬럼 포함 확인
        created_at TEXT,
        updated_at TEXT
      )
    `)
    .run();

  await env.surveyforge
    .prepare(`CREATE INDEX IF NOT EXISTS idx_surveys_survey_id ON surveys (survey_id)`)
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
