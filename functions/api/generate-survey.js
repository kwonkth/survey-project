export async function onRequestPost({ request, env }) {
  try {
    const apiKey = env.OPENROUTER_API_KEY;
    if (!apiKey) {
      return Response.json({ error: 'Missing OPENROUTER_API_KEY' }, { status: 500 });
    }

    let payload = null;
    try {
      payload = await request.json();
    } catch (_) {
      return Response.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const topic = String(payload?.topic || '').trim();
    const questionCount = Math.max(1, Math.min(10, Number(payload?.questionCount || 5)));
    const style = String(payload?.style || '');
    const style_id = String(payload?.style_id || '').trim();
    const includeNameQuestion = Boolean(payload?.includeNameQuestion);

    if (!topic) {
      return Response.json({ error: 'topic is required' }, { status: 400 });
    }

    // Load style template if style_id provided
    let styleTemplate = null;
    if (style_id) {
      try {
        const styleURL = new URL(`/styles/${encodeURIComponent(style_id)}.json`, request.url).toString();
        const sRes = await fetch(styleURL, { method: 'GET' });
        if (sRes.ok) {
          styleTemplate = await sRes.json();
        }
      } catch (_) {}
    }

    const SYSTEM_PROMPT = buildSystemPrompt();
    const userContent = buildUserPrompt({ topic, questionCount, style, styleTemplate, includeNameQuestion });

    const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'anthropic/claude-3.5-sonnet',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userContent }
        ],
        temperature: 0.7,
        response_format: { type: 'json_object' }
      })
    });

    if (!resp.ok) {
      const text = await resp.text();
      return Response.json({ error: 'OpenRouter error', detail: text }, { status: resp.status });
    }

    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content || data?.choices?.[0]?.message?.[0]?.content || '';

    let parsed;
    try {
      parsed = typeof content === 'string' ? JSON.parse(content) : content;
    } catch (e) {
      // Attempt to extract JSON substring
      const match = String(content).match(/\{[\s\S]*\}$/);
      if (match) {
        try { parsed = JSON.parse(match[0]); } catch (_) {}
      }
    }

    if (!parsed || !Array.isArray(parsed?.questions)) {
      return Response.json({ error: 'Malformed model output', raw: content }, { status: 502 });
    }

    const normalized = normalizeSurvey(parsed, { includeNameQuestion });
    return Response.json(normalized);
  } catch (e) {
    return Response.json({ error: 'Server error', detail: String(e?.message || e) }, { status: 500 });
  }
}

function buildSystemPrompt() {
  return [
    '당신은 \'퀘스트 기반 설문 생성 전문 LLM\'입니다.',
    '사용자의 주제·스타일·문항 수를 기반으로, 일관성 있는 JSON 설문을 생성합니다.',
    '',
    '출력 규칙:',
    '- 반드시 JSON만 반환',
    '- 질문 id: q_1, q_2... 형식',
    '- options는 문자열 배열',
    '- 스토리 분위기 정보는 story_context에 정리',
    '- 한국어 출력'
  ].join('\n');
}

function buildUserPrompt({ topic, questionCount, style, styleTemplate, includeNameQuestion }) {
  const styleLines = [];
  if (style && style.trim()) styleLines.push(`선호 스타일: ${style}`);
  if (styleTemplate && typeof styleTemplate === 'object') {
    if (styleTemplate.mood) styleLines.push(`mood: ${styleTemplate.mood}`);
    if (styleTemplate.tone) styleLines.push(`tone: ${styleTemplate.tone}`);
    if (Array.isArray(styleTemplate.keywords) && styleTemplate.keywords.length) styleLines.push(`keywords: ${styleTemplate.keywords.join(', ')}`);
  }
  return [
    `주제: ${topic}`,
    `문항 수: ${questionCount}`,
    styleLines.length ? `스타일 템플릿:\n${styleLines.join('\n')}` : '스타일 템플릿: 없음',
    `필수 문항 포함: ${includeNameQuestion}`,
    '',
    '해당 정보를 기반으로 일관성 있는 설문조사를 생성해 주세요.',
    '응답은 JSON으로만 주세요. 예시:',
    '{',
    '  "title": "...",',
    '  "description": "...",',
    '  "questions": [',
    '    { "id": "q_1", "order": 1, "text": "...", "type": "radio", "required": true, "options": ["A","B"] }',
    '  ],',
    '  "story_context": { "mood": "...", "tone": "...", "keywords": ["..."] }',
    '}'
  ].join('\n');
}

function normalizeSurvey(modelOut, { includeNameQuestion }) {
  const title = String(modelOut?.title || '').trim() || 'AI 생성 설문';
  const description = String(modelOut?.description || '').trim() || '';
  const story_context = modelOut?.story_context && typeof modelOut.story_context === 'object' ? modelOut.story_context : {};
  let questions = Array.isArray(modelOut?.questions) ? modelOut.questions.slice(0, 50) : [];

  // Coerce question fields
  questions = questions.map((q, idx) => {
    const id = q?.id ? String(q.id) : `q_${idx + 1}`;
    const order = Number.isFinite(q?.order) ? Number(q.order) : idx + 1;
    const text = String(q?.text || '').trim() || `문항 ${idx + 1}`;
    let type = String(q?.type || 'text');
    if (/checkbox|다중|복수/.test(type)) type = 'checkbox';
    else if (/radio|단일|객관식/.test(type)) type = 'radio';
    else type = 'text';
    const required = q?.required !== false;
    const options = Array.isArray(q?.options) ? q.options.map(o => String(o)).filter(Boolean) : [];
    return { id, order, text, type, required, options };
  });

  // Ensure sequential order and ids q_1..
  questions = questions.map((q, i) => ({ ...q, id: `q_${i + 1}`, order: i + 1 }));

  if (includeNameQuestion) {
    const nameQ = { id: 'q_name', order: 1, text: '모험가여, 당신의 이름을 알려주세요.', type: 'text', required: false, options: [] };
    questions = [nameQ, ...questions.map((q, i) => ({ ...q, order: i + 2 }))];
  }

  return { title, description, questions, story_context };
}
