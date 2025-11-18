export async function onRequestGet({ env }) {
  await ensureSurveysTable(env);
  const result = await env.surveyforge
    .prepare(`SELECT * FROM surveys ORDER BY datetime(created_at) DESC`)
    .all();
  return Response.json(result.results || []);
}

export async function onRequestPost({ request, env }) {
  await ensureSurveysTable(env);

  let body = null;
  try {
    body = await request.json();
  } catch (_) {
    return new Response("Invalid JSON", { status: 400 });
  }

  const {
    survey_id,
    title,
    description,
    questions,
    story,
    created_at,
    updated_at,
  } = body || {};

  if (!survey_id || !title) {
    return new Response("Missing fields", { status: 400 });
  }

  // Normalize TEXT columns
  const questionsText =
    typeof questions === "string" ? questions : JSON.stringify(questions ?? []);
  const storyText =
    typeof story === "string" ? story : story ? JSON.stringify(story) : null;
  const createdAt = created_at || new Date().toISOString();
  const updatedAt = updated_at || createdAt;

  try {
    await env.surveyforge
      .prepare(
        `INSERT INTO surveys (survey_id, title, description, questions, story, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        survey_id,
        title,
        description ?? null,
        questionsText,
        storyText,
        createdAt,
        updatedAt
      )
      .run();
  } catch (e) {
    // If UNIQUE constraint fails, try update
    if (String(e?.message || "").includes("UNIQUE")) {
      await env.surveyforge
        .prepare(
          `UPDATE surveys
             SET title = ?, description = ?, questions = ?, story = ?, updated_at = ?
           WHERE survey_id = ?`
        )
        .bind(
          title,
          description ?? null,
          questionsText,
          storyText,
          updatedAt,
          survey_id
        )
        .run();
    } else {
      return new Response("DB error", { status: 500 });
    }
  }

  return Response.json({ success: true });
}

async function ensureSurveysTable(env) {
  await env.surveyforge
    .prepare(
      `CREATE TABLE IF NOT EXISTS surveys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        survey_id TEXT UNIQUE,
        title TEXT,
        description TEXT,
        questions TEXT,
        story TEXT,
        created_at TEXT,
        updated_at TEXT
      )`
    )
    .run();
  await env.surveyforge
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_surveys_survey_id ON surveys (survey_id)`
    )
    .run();
}
