export async function onRequestPatch({ params, request, env }) {
  try {
    await ensureTables(env);
    const folderId = params.id;
    if (!folderId) {
      return Response.json({ error: 'Missing id' }, { status: 400 });
    }

    let body = null;
    try {
      body = await request.json();
    } catch (_) {
      return Response.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const { name, icon, color, sort_order } = body || {};
    if (!name && typeof icon === 'undefined' && typeof color === 'undefined' && typeof sort_order === 'undefined') {
      return Response.json({ error: 'Nothing to update' }, { status: 400 });
    }

    const now = new Date().toISOString();
    const sets = [];
    const binds = [];
    if (typeof name !== 'undefined') {
      sets.push('name = ?');
      binds.push(name);
    }
    if (typeof icon !== 'undefined') {
      sets.push('icon = ?');
      binds.push(icon ?? null);
    }
    if (typeof color !== 'undefined') {
      sets.push('color = ?');
      binds.push(color ?? null);
    }
    if (typeof sort_order !== 'undefined') {
      sets.push('sort_order = ?');
      binds.push(sort_order ?? null);
    }
    sets.push('updated_at = ?');
    binds.push(now, folderId);

    const sql = `UPDATE folders SET ${sets.join(', ')} WHERE id = ?`;
    await env.surveyforge
      .prepare(sql)
      .bind(...binds)
      .run();

    return Response.json({ success: true, id: folderId, name, icon, color, sort_order, updated_at: now });
  } catch (e) {
    return Response.json({ error: 'DB error', detail: String(e?.message || e) }, { status: 500 });
  }
}

export async function onRequestDelete({ params, env }) {
  try {
    await ensureTables(env);
    const folderId = params.id;
    if (!folderId) {
      return Response.json({ error: 'Missing id' }, { status: 400 });
    }

    // 이 폴더에 속한 설문들의 folder_id를 NULL 로 초기화
    await env.surveyforge
      .prepare('UPDATE surveys SET folder_id = NULL WHERE folder_id = ?')
      .bind(folderId)
      .run();

    // 폴더 행 삭제
    await env.surveyforge
      .prepare('DELETE FROM folders WHERE id = ?')
      .bind(folderId)
      .run();

    return Response.json({ success: true, id: folderId });
  } catch (e) {
    return Response.json({ error: 'DB error', detail: String(e?.message || e) }, { status: 500 });
  }
}

async function ensureTables(env) {
  await env.surveyforge
    .prepare(`
      CREATE TABLE IF NOT EXISTS folders (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        icon TEXT,
        color TEXT,
        sort_order INTEGER,
        created_at TEXT,
        updated_at TEXT
      )
    `)
    .run();

  // surveys 테이블이 없을 수도 있으므로 같이 보장
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
        folder_id TEXT,
        created_at TEXT,
        updated_at TEXT
      )
    `)
    .run();
}
