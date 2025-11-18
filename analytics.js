document.addEventListener('DOMContentLoaded', () => {
  if (typeof Chart !== 'undefined' && typeof ChartDataLabels !== 'undefined') {
    Chart.register(ChartDataLabels);
  }

  // API helpers
  const API = {
    async getSurveys() {
      const res = await fetch('/api/surveys', { method: 'GET' });
      if (!res.ok) throw new Error(`GET /api/surveys ${res.status}`);
      return res.json();
    },
    async getResults(surveyId) {
      const res = await fetch(`/api/results/${encodeURIComponent(surveyId)}`, { method: 'GET' });
      if (!res.ok) return [];
      return res.json();
    }
  };

  // Populate survey selector and render per-survey stats
  function populateSurveySelect() {
    const sel = document.getElementById('surveySelector');
    if (!sel) return;
    sel.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '설문을 선택하세요';
    sel.appendChild(placeholder);
    state.surveys.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.title || s.id;
      sel.appendChild(opt);
    });
    sel.addEventListener('change', () => {
      state.selectedSurveyId = sel.value || null;
      onSurveySelected(state.selectedSurveyId);
    });
  }

  // Populate question selector for the selected survey (exclude name and text-only questions for doughnut)
  function populateQuestionSelect(surveyId) {
    const sel = document.getElementById('questionSelect');
    if (!sel) return;
    sel.innerHTML = '';
    const meta = state.surveys.find(s => s.id === surveyId);
    if (!meta) { sel.disabled = true; return; }
    const eligible = (meta.questions || []).filter(q => {
      const opts = toOptionArray(q.options);
      return !isNameQuestion(q) && opts.length > 0;
    });
    if (eligible.length === 0) {
      sel.disabled = true;
      setOptionEmpty(true);
      return;
    }
    sel.disabled = false;
    eligible.forEach((q, idx) => {
      const opt = document.createElement('option');
      opt.value = q.id;
      opt.textContent = (q.text || `문항 ${idx+1}`).slice(0, 60);
      sel.appendChild(opt);
    });
    sel.onchange = () => {
      renderOptionDoughnut(surveyId, sel.value);
    };
    // default to first eligible
    sel.value = eligible[0].id;
    renderOptionDoughnut(surveyId, sel.value);
  }

  function renderDistributionHTML(q) {
    if (q.type && q.type.includes('객관식')) {
      const rows = q.options.map(o => `
        <tr>
          <td>${escapeHTML(o.label)}</td>
          <td style="text-align:right;">${o.count}</td>
          <td style="text-align:right;">${o.percent}%</td>
        </tr>`).join('');
      return `
        <table style="width:100%; border-collapse:collapse; font-size:0.9rem;">
          <thead>
            <tr><th style="text-align:left;">선택지</th><th style="text-align:right;">응답수</th><th style="text-align:right;">비율</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>`;
    }
    // Text or others: show responded count and sample values (up to 5)
    const samples = (q.textAnswers || []).slice(0, 5).map(a => `• ${escapeHTML(a)}`).join('<br>');
    return `
      <div style="font-size:0.9rem; color:#555;">
        자유응답 수: ${q.respondedCount}${samples ? `<div style="margin-top:0.4rem;">상위 예시:<br>${samples}</div>` : ''}
      </div>`;
  }

  function computeSurveyStats(survey, responses) {
    const total = responses.length;
    const qListRaw = Array.isArray(survey.questions) ? survey.questions : [];
    const qList = qListRaw.filter(q => !isNameQuestion(q));
    const completionRate = calcCompletionRate(survey, responses);
    const questions = qList.map((q, idx) => {
      const answered = responses.filter(r => Array.isArray(r.answers) && r.answers.some(a => a.questionId == q.id)).length;
      const dropoffRate = total ? Math.round(((total - answered) / total) * 100) : 0;

      // Build distribution
      let dist = [];
      let textAnswers = [];
      if (q.type && (q.type === 'radio' || q.type === 'checkbox' || /객관식/.test(q.type))) {
        // Collect options (support objects or primitives)
        const options = toOptionArray(q.options);
        const counts = new Map(options.map(o => [String(o.value), 0]));
        responses.forEach(r => {
          (r.answers || []).forEach(a => {
            if (a.questionId == q.id) {
              const v = Array.isArray(a.value) ? a.value : [a.value];
              v.forEach(val => {
                const key = String(val);
                // match by value or by label text
                const match = options.find(o => String(o.value) === key || String(o.label) === key);
                const k = match ? String(match.value) : key;
                counts.set(k, (counts.get(k) || 0) + 1);
              });
            }
          });
        });
        dist = options.map(o => {
          const count = counts.get(String(o.value)) || 0;
          const percent = answered ? Math.round((count / answered) * 100) : 0;
          return { label: o.label, count, percent };
        });
      } else {
        // Text or scale: gather raw values
        const vals = [];
        responses.forEach(r => {
          (r.answers || []).forEach(a => {
            if (a.questionId == q.id && a.value != null && String(a.value).trim() !== '') {
              vals.push(String(a.value));
            }
          });
        });
        textAnswers = vals;
      }

      return {
        id: q.id,
        number: idx + 1,
        text: q.text || `질문 ${idx + 1}`,
        type: q.type || '',
        respondedCount: answered,
        dropoffRate,
        options: dist,
        textAnswers
      };
    });

    return { totalResponses: total, completionRate, questions };
  }

  function isNameQuestion(q){
    if (!q) return false;
    if (String(q.id).toLowerCase() === 'q_name') return true;
    const t = String(q.text || '');
    return /이름/.test(t);
  }

  function wireExports() {
    const btnJson = document.getElementById('exportJsonBtn');
    const btnCsv = document.getElementById('exportCsvBtn');
    const btnXls = document.getElementById('exportXlsBtn');
    const getData = () => state.latestStats || null;

    const ensureSelected = () => {
      if (!state.selectedSurveyId || !state.latestStats) {
        alert('먼저 설문을 선택해 주세요.');
        return false;
      }
      return true;
    };

    if (btnJson) btnJson.addEventListener('click', () => {
      if (!ensureSelected()) return;
      const data = getData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
      download(`${safeFilename(data.title || data.surveyId)}_stats.json`, blob);
    });

    if (btnCsv) btnCsv.addEventListener('click', () => {
      if (!ensureSelected()) return;
      const data = getData();
      const csv = toCSV(data);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      download(`${safeFilename(data.title || data.surveyId)}_stats.csv`, blob);
    });

    if (btnXls) btnXls.addEventListener('click', () => {
      if (!ensureSelected()) return;
      const data = getData();
      const csv = toCSV(data);
      const blob = new Blob([csv], { type: 'application/vnd.ms-excel;charset=utf-8' });
      download(`${safeFilename(data.title || data.surveyId)}_stats.xls`, blob);
    });
  }

  function toCSV(data) {
    // Flatten per-question stats
    const rows = [];
    rows.push(['SurveyId','SurveyTitle','QuestionNo','QuestionText','Type','Responded','Total','Dropoff(%)','OptionLabel','OptionCount','OptionPercent','SampleTextAnswers']);
    const total = data.totalResponses;
    data.questions.forEach(q => {
      if (q.options && q.options.length) {
        q.options.forEach(o => {
          rows.push([
            data.surveyId,
            data.title || '',
            q.number,
            sanitizeCSV(q.text),
            q.type,
            q.respondedCount,
            total,
            q.dropoffRate,
            sanitizeCSV(o.label),
            o.count,
            o.percent,
            ''
          ]);
        });
      } else {
        const sample = (q.textAnswers || []).slice(0,5).join(' | ');
        rows.push([
          data.surveyId,
          data.title || '',
          q.number,
          sanitizeCSV(q.text),
          q.type,
          q.respondedCount,
          total,
          q.dropoffRate,
          '',
          '',
          '',
          sanitizeCSV(sample)
        ]);
      }
    });
    return rows.map(r => r.map(cell => wrapCSV(String(cell ?? ''))).join(',')).join('\n');
  }

  function wrapCSV(s){
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }
  function sanitizeCSV(s){ return (s||'').replace(/\r|\n/g,' ').trim(); }
  function safeFilename(s){ return (s||'').replace(/[^\w\-\.]+/g,'_').slice(0,80) || 'survey'; }

  function download(filename, blob){
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
  }

  const state = {
    surveys: [],
    chartInstance: null,
    selectedSurveyId: null,
    latestStats: null,
    selectedDropoutChart: null,
    doughnutChart: null,
    responsesBySurvey: {}
  };

  init();

  function init() {
    loadSurveysFromDB().then(() => {
      populateSurveySelect();
      updateSummary();
      const params = new URLSearchParams(window.location.search);
      const preselectId = params.get('surveyId');
      if (preselectId && state.surveys.some(s => s.id === preselectId)) {
        state.selectedSurveyId = preselectId;
        const sel = document.getElementById('surveySelector');
        if (sel) sel.value = preselectId;
        onSurveySelected(preselectId);
      }
      wireExports();
    }).catch(() => {
      // leave empty state
    });
  }

  async function updateSummary() {
    // Lightweight summary: show totals of surveys; responses populated on selection
    setText('totalResponsesValue', '0');
    setText('completionRateValue', '0%');
    setText('dropoffRateValue', '0%');
  }

  function getAnswerDistribution(surveyId, questionId) {
    const meta = state.surveys.find(s => s.id === surveyId);
    if (!meta) return { labels: [], counts: [] };
    const q = (meta.questions || []).find(x => x.id == questionId);
    const options = toOptionArray(q && q.options);
    if (!q || options.length === 0) return { labels: [], counts: [] };
    const responses = state.responsesBySurvey[surveyId] || [];
    const labels = options.map(o => String(o.label));
    const counts = new Map(options.map(o => [String(o.value), 0]));
    responses.forEach(r => {
      (r.answers || []).forEach(a => {
        if (a.questionId == q.id) {
          const vs = Array.isArray(a.value) ? a.value : [a.value];
          vs.forEach(v => {
            const key = String(v);
            const match = options.find(o => String(o.value) === key || String(o.label) === key);
            const k = match ? String(match.value) : key;
            counts.set(k, (counts.get(k) || 0) + 1);
          });
        }
      });
    });
    return { labels, counts: options.map(o => counts.get(String(o.value)) || 0) };
  }

  // 색상 팔레트: 도넛/막대 그래프에서 동일 label이면 동일 색상을 사용
  const OPTION_COLOR_PALETTE = [
    '#4a6baf', '#f5b041', '#e74c3c', '#27ae60',
    '#9b59b6', '#16a085', '#e67e22', '#2c3e50'
  ];
  const optionColorMap = new Map();

  function getColorForLabel(label) {
    const key = String(label || '');
    if (!optionColorMap.has(key)) {
      const idx = optionColorMap.size % OPTION_COLOR_PALETTE.length;
      optionColorMap.set(key, OPTION_COLOR_PALETTE[idx]);
    }
    return optionColorMap.get(key);
  }

  function getBorderColorForLabel(label) {
    const base = getColorForLabel(label);
    // 살짝 어둡게
    return base;
  }

  function renderOptionBarsForAllQuestions(surveyId){
    const ctx = document.getElementById('chart1');
    const containerEmpty = document.getElementById('dropoutEmpty');
    if (!ctx) return;

    const stats = state.latestStats;
    if (!stats || stats.surveyId !== surveyId || !Array.isArray(stats.questions) || !stats.questions.length) {
      if (state.selectedDropoutChart) { state.selectedDropoutChart.destroy(); state.selectedDropoutChart = null; }
      if (containerEmpty) containerEmpty.style.display = 'block';
      return;
    }

    const questions = stats.questions;
    const labels = questions.map(q => `Q${q.number}`);

    // 모든 객관식 문항의 옵션 라벨 집합
    const optionLabelSet = new Set();
    questions.forEach(q => {
      (q.options || []).forEach(o => {
        if (o && typeof o.label !== 'undefined') optionLabelSet.add(String(o.label));
      });
    });

    const optionLabels = Array.from(optionLabelSet);

    if (!optionLabels.length) {
      if (state.selectedDropoutChart) { state.selectedDropoutChart.destroy(); state.selectedDropoutChart = null; }
      if (containerEmpty) containerEmpty.style.display = 'block';
      return;
    }

    const datasets = optionLabels.map(label => {
      const data = questions.map(q => {
        const found = (q.options || []).find(o => String(o.label) === String(label));
        return found ? found.percent : 0;
      });
      return {
        label,
        data,
        backgroundColor: getColorForLabel(label),
        borderColor: getBorderColorForLabel(label),
        borderWidth: 1,
        maxBarThickness: 18
      };
    });

    if (state.selectedDropoutChart) {
      state.selectedDropoutChart.destroy();
      state.selectedDropoutChart = null;
    }

    state.selectedDropoutChart = new Chart(ctx, {
      type: 'bar',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: { beginAtZero: true, max: 100, ticks: { callback: v => `${v}%` } }
        },
        plugins: {
          legend: { position: 'bottom' },
          datalabels: {
            display: true,
            color: '#333',
            anchor: 'end',
            align: 'top',
            font: { weight: 'bold', size: 10 },
            formatter: (value) => value ? `${value}%` : ''
          }
        }
      },
      plugins: typeof ChartDataLabels !== 'undefined' ? [ChartDataLabels] : []
    });

    if (containerEmpty) containerEmpty.style.display = 'none';
  }

  function renderOptionDoughnut(surveyId, questionId){
    const ctx = document.getElementById('chart2');
    const optionEmpty = document.getElementById('optionEmpty');
    if (!ctx) return;
    const { labels, counts } = getAnswerDistribution(surveyId, questionId);
    if (!labels.length) {
      if (state.doughnutChart) { state.doughnutChart.destroy(); state.doughnutChart = null; }
      if (optionEmpty) optionEmpty.style.display = 'block';
      return;
    }
    if (optionEmpty) optionEmpty.style.display = 'none';
    if (state.doughnutChart) state.doughnutChart.destroy();
    const colors = labels.map(label => getColorForLabel(label));
    const borders = labels.map(label => getBorderColorForLabel(label));
    state.doughnutChart = new Chart(ctx, {
      type: 'doughnut',
      data: { labels, datasets: [{ data: counts, backgroundColor: colors, borderColor: borders }] },
      options: { responsive: true, maintainAspectRatio: false }
    });
  }

  function setOptionEmpty(show){ const el = document.getElementById('optionEmpty'); if (el) el.style.display = show ? 'block' : 'none'; }
  function setDropoutEmpty(show){ const el = document.getElementById('dropoutEmpty'); if (el) el.style.display = show ? 'block' : 'none'; }

  function onSurveySelected(surveyId){
    // Reset charts
    if (!surveyId) {
      if (state.selectedDropoutChart) { state.selectedDropoutChart.destroy(); state.selectedDropoutChart = null; }
      if (state.doughnutChart) { state.doughnutChart.destroy(); state.doughnutChart = null; }
      setDropoutEmpty(true); setOptionEmpty(true);
      return;
    }
    // Load results for this survey from DB then render
    API.getResults(surveyId).then(rows => {
      const responses = normalizeResultsRows(rows);
      state.responsesBySurvey[surveyId] = responses;
      // compute and cache stats for exports
      const meta = state.surveys.find(s => s.id === surveyId) || { id: surveyId, title: '' };
      const stats = computeSurveyStats(meta, responses);
      state.latestStats = { surveyId, title: meta.title, ...stats };

      renderOptionBarsForAllQuestions(surveyId);
      populateQuestionSelect(surveyId);
    }).catch(() => {
      // failure state: clear visuals
      if (state.selectedDropoutChart) { state.selectedDropoutChart.destroy(); state.selectedDropoutChart = null; }
      if (state.doughnutChart) { state.doughnutChart.destroy(); state.doughnutChart = null; }
      setDropoutEmpty(true); setOptionEmpty(true);
      state.latestStats = null;
    });
  }

  function renderDropoff(items) {
    const ctx = document.getElementById('dropoffChart');
    const details = document.getElementById('dropoffDetails');
    if (!ctx || !details) return;

    if (state.chartInstance) state.chartInstance.destroy();

    const labels = items.map(i => `Q${i.questionNumber}`);
    const data = items.map(i => i.dropoffRate);

    state.chartInstance = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: '이탈률 (%)',
          data,
          backgroundColor: data.map(rate => rate > 30 ? 'rgba(245,87,108,0.7)' : rate > 15 ? 'rgba(255,193,7,0.7)' : 'rgba(76,175,80,0.7)'),
          borderColor: data.map(rate => rate > 30 ? 'rgba(245,87,108,1)' : rate > 15 ? 'rgba(255,193,7,1)' : 'rgba(76,175,80,1)'),
          borderWidth: 1
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          datalabels: {
            display: true,
            color: '#333',
            anchor: 'end',
            align: 'top',
            font: { weight: 'bold' },
            formatter: (v) => `${v}%`
          },
          tooltip: {
            callbacks: {
              afterBody: (items) => {
                const idx = items[0].dataIndex;
                const it = items && items.length ? items[0] : null;
                const d = items ? items[0].chart.data.datasets[0].data[idx] : null;
                return '';
              }
            }
          }
        },
        scales: {
          y: { beginAtZero: true, max: 100, ticks: { callback: v => `${v}%` } }
        }
      },
      plugins: [ChartDataLabels]
    });

    details.innerHTML = '';
    items.forEach(item => {
      const el = document.createElement('div');
      el.className = 'question-dropoff-item';
      el.innerHTML = `
        <div class="question-number">Q${item.questionNumber}</div>
        <div style="flex:1">
          <div class="question-text">${escapeHTML(truncate(item.questionText, 60))}</div>
          <div class="dropoff-stats">
            <span class="dropoff-rate">이탈률: ${item.dropoffRate}%</span>
            <span class="response-count">응답: ${item.respondedCount}/${item.totalCount}</span>
          </div>
        </div>
      `;
      details.appendChild(el);
    });
  }

  function calcCompletionRate(survey, responses) {
    if (!responses.length) return 0;
    const qCount = survey.questions?.length || 0;
    if (!qCount) return 0;
    const completed = responses.filter(r => Array.isArray(r.answers) && r.answers.length === qCount).length;
    return Math.round((completed / responses.length) * 100);
  }

  async function loadSurveysFromDB() {
    const rows = await API.getSurveys();
    state.surveys = (rows || []).map(r => {
      let questions = r.questions;
      if (typeof questions === 'string') { try { questions = JSON.parse(questions); } catch { questions = []; } }
      return {
        id: r.survey_id || r.id,
        title: r.title || '',
        questions: questions || []
      };
    });
  }

  function normalizeResultsRows(rows) {
    // rows: [{answers: TEXT/JSON, created_at, ...}] -> [{answers: [{questionId, value}], createdAt}]
    const out = [];
    (rows || []).forEach(row => {
      let ansObj = row.answers;
      if (typeof ansObj === 'string') {
        try { ansObj = JSON.parse(ansObj); } catch { ansObj = {}; }
      }
      let arr = [];
      if (Array.isArray(ansObj)) {
        // already an array of {questionId, value}
        arr = ansObj.map(a => ({ questionId: a.questionId, value: a.value }));
      } else if (ansObj && typeof ansObj === 'object') {
        Object.keys(ansObj).forEach(qid => {
          const v = ansObj[qid];
          arr.push({ questionId: qid, value: v });
        });
      }
      out.push({ answers: arr, createdAt: row.created_at });
    });
    return out;
  }

  function toOptionArray(options) {
    if (!Array.isArray(options)) return [];
    return options.map((o, idx) => {
      if (o && typeof o === 'object') {
        const label = o.label ?? o.text ?? String(o.value ?? o.id ?? idx + 1);
        const value = o.value ?? o.label ?? o.text ?? label;
        return { label: String(label), value: String(value) };
      }
      return { label: String(o), value: String(o) };
    });
  }

  function setText(id, text) { const el = document.getElementById(id); if (el) el.textContent = text; }
  function truncate(t, n) { return !t ? '' : (t.length > n ? `${t.slice(0,n)}…` : t); }
  function escapeHTML(s){ return String(s).replace(/[&<>"]+/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
});
