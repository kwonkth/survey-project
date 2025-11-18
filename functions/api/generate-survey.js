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
    const questionCountRaw = Number(payload?.questionCount || 5);
    const questionCount = Number.isFinite(questionCountRaw)
      ? Math.max(1, Math.min(50, questionCountRaw))
      : 5;
    const style = String(payload?.style || '');
    const style_id = String(payload?.style_id || '').trim();
    const includeNameQuestion = Boolean(payload?.includeNameQuestion);
    const questionTypeMode = String(payload?.questionTypeMode || 'auto');
    const mandatoryQuestions = Array.isArray(payload?.mandatoryQuestions)
      ? payload.mandatoryQuestions.map(q => String(q || '').trim()).filter(Boolean)
      : [];

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
    const userContent = buildUserPrompt({
      topic,
      questionCount,
      style,
      styleTemplate,
      includeNameQuestion,
      questionTypeMode,
      mandatoryQuestions
    });

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
    "당신은 '스토리 기반 설문조사 생성 전문 LLM'입니다.",
    '출력은 반드시 JSON 하나만 반환해야 하며, 설명 문장은 출력하지 않습니다.',
    '',
    '출력 형식 규칙 (절대 어기지 말 것):',
    '1) 전체 출력은 JSON 객체 하나만 반환한다.',
    '2) keys: title, description, questions, story_context',
    '3) questions는 배열이며 각 항목은 id, order, text, type, required, options 필드를 가진다.',
    '   - id: "q_1", "q_2" 형식',
    '   - order: 1부터 시작하는 숫자',
    '   - text: 질문 문장 (한국어)',
    '   - type: "radio" | "checkbox" | "text"',
    '   - required: true | false',
    '   - options: type이 radio/checkbox일 때 보기 문자열 배열, text일 때 []',
    '4) story_context는 mood, tone, keywords 배열을 포함한다.',
    '5) JSON 밖에 다른 문장, 설명, 코드블록 기호 등을 절대 출력하지 않는다.',
    '',
    'type 결정 규칙:',
    '- "2지선다/3지선다/4지선다" 등 단일 선택: type = "radio"',
    '- "복수 선택" 또는 "중복 가능": type = "checkbox"',
    '- 그 밖의 서술형: type = "text"',
    '',
    'options 규칙:',
    '- radio/checkbox일 때만 보기 문자열 목록을 넣고, text일 때 options는 빈 배열',
    '',
    '절대 JSON 형식 외의 설명을 출력하지 말 것.'
  ].join('\n');
}

function buildUserPrompt({ topic, questionCount, style, styleTemplate, includeNameQuestion, questionTypeMode, mandatoryQuestions }) {
  const styleLines = [];
  if (style && style.trim()) styleLines.push(`선호 스타일: ${style}`);
  if (styleTemplate && typeof styleTemplate === 'object') {
    if (styleTemplate.mood) styleLines.push(`mood: ${styleTemplate.mood}`);
    if (styleTemplate.tone) styleLines.push(`tone: ${styleTemplate.tone}`);
    if (Array.isArray(styleTemplate.keywords) && styleTemplate.keywords.length) styleLines.push(`keywords: ${styleTemplate.keywords.join(', ')}`);
  }

  const mandatoryBlock = mandatoryQuestions.length
    ? ['필수 포함 질문 목록:', ...mandatoryQuestions.map((q, idx) => `${idx + 1}. ${q}`)].join('\n')
    : '필수 포함 질문 없음';

  return [
    `주제: ${topic}`,
    `문항 수: ${questionCount}`,
    `질문 유형 모드: ${questionTypeMode}`,
    `필수 이름 질문 포함: ${includeNameQuestion}`,
    styleLines.length ? `선택한 분위기 템플릿:\n${styleLines.join('\n')}` : '선택한 분위기 템플릿: 없음',
    mandatoryBlock,
    '',
    '질문 유형 규칙:',
    '- mode = auto  : 문항 의미에 맞게 type을 자동 선택',
    '- mode = fixed_two  : 모든 객관식 문항은 2지선다 (radio)로 생성',
    '- mode = fixed_four : 모든 객관식 문항은 4지선다 (radio)로 생성',
    '- mode = mixed : 객관식과 서술형을 균형 있게 섞어 구성',
    '',
    '필수 포함 질문과 입력 정보를 모두 반영하여 일관된 JSON 설문을 생성하세요.',
    '응답은 반드시 JSON 객체 하나만 출력해야 하며, 다른 문장은 절대 포함하지 마세요.'
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
