export async function onRequestGet({ env }) {
  try {
    await ensureTables(env);
    const result = await env.surveyforge
      .prepare(`SELECT * FROM folders ORDER BY COALESCE(sort_order, 9999), name`)
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

    const { id, name, icon, color, sort_order } = body || {};
    if (!id || !name) {
      return Response.json({ error: 'Missing id or name' }, { status: 400 });
    }

    const now = new Date().toISOString();

    try {
      await env.surveyforge
        .prepare(`
          INSERT INTO folders (id, name, icon, color, sort_order, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `)
        .bind(id, name, icon ?? null, color ?? null, sort_order ?? null, now, now)
        .run();
    } catch (e) {
      if (String(e?.message || '').includes('UNIQUE')) {
        // 이미 존재하면 이름/스타일만 업데이트
        await env.surveyforge
          .prepare(`
            UPDATE folders
            SET name = ?, icon = ?, color = ?, sort_order = ?, updated_at = ?
            WHERE id = ?
          `)
          .bind(name, icon ?? null, color ?? null, sort_order ?? null, now, id)
          .run();
      } else {
        return Response.json({ error: 'DB error', detail: String(e?.message || e) }, { status: 500 });
      }
    }

    return Response.json({ success: true, id, name, icon, color, sort_order, updated_at: now });
  } catch (e) {
    return Response.json({ error: 'DB error', detail: String(e?.message || e) }, { status: 500 });
  }
}

async function ensureTables(env) {
  // 폴더 테이블만 정의 (surveys/results는 다른 핸들러에서 생성)
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
}
