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
      renderOptionChart(surveyId, sel.value);
    };
    // default to first eligible
    sel.value = eligible[0].id;
    renderOptionChart(surveyId, sel.value);
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
    const toggleBtn = document.getElementById('exportToggleBtn');
    const menu = document.getElementById('exportMenu');
    const getData = () => state.latestStats || null;

    const ensureSelected = () => {
      if (!state.selectedSurveyId || !state.latestStats) {
        alert('먼저 설문을 선택해 주세요.');
        return false;
      }
      return true;
    };

    if (toggleBtn && menu) {
      toggleBtn.addEventListener('click', () => {
        menu.classList.toggle('open');
      });

      document.addEventListener('click', (e) => {
        if (!menu.classList.contains('open')) return;
        if (e.target === toggleBtn || toggleBtn.contains(e.target)) return;
        if (menu.contains(e.target)) return;
        menu.classList.remove('open');
      });
    }

    if (btnJson) btnJson.addEventListener('click', () => {
      if (!ensureSelected()) return;
      const data = getData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
      download(`${safeFilename(data.title || data.surveyId)}_stats.json`, blob);
    });

    if (btnCsv) btnCsv.addEventListener('click', () => {
      if (!ensureSelected()) return;
      const data = getData();
      // UTF-8 BOM을 붙여서 한글이 깨지지 않도록 함
      const csv = '\uFEFF' + toCSV(data);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      download(`${safeFilename(data.title || data.surveyId)}_stats.csv`, blob);
    });

    if (btnXls) btnXls.addEventListener('click', () => {
      if (!ensureSelected()) return;
      const data = getData();
      // Excel에서도 깨지지 않도록 UTF-8 BOM이 포함된 CSV를 .csv 확장자로 저장
      const csv = '\uFEFF' + toCSV(data);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      download(`${safeFilename(data.title || data.surveyId)}_stats_excel.csv`, blob);
    });
  }

  function toCSV(data) {
    const surveyId = data.surveyId;
    const meta = state.surveys.find(s => s.id === surveyId) || { questions: [] };
    const allQuestions = Array.isArray(meta.questions) ? meta.questions : [];
    const nameQuestion = allQuestions.find(q => isNameQuestion(q));
    const normalQuestions = allQuestions.filter(q => !isNameQuestion(q));

    const rows = [];
    // Header row: 이름, 제출 일시, 각 문항 텍스트
    const header = ['이름', '제출 일시'];
    normalQuestions.forEach((q, idx) => {
      header.push(sanitizeCSV(q.text || `문항 ${idx + 1}`));
    });
    rows.push(header);

    const responses = Array.isArray(data.rawResponses) ? data.rawResponses : [];

    responses.forEach((r, rowIdx) => {
      const line = [];
      // 이름
      let nameVal = '';
      if (nameQuestion) {
        const ans = (r.answers || []).find(a => a.questionId == nameQuestion.id);
        if (ans && ans.value != null) {
          nameVal = String(Array.isArray(ans.value) ? ans.value[0] : ans.value);
        }
      }
      line.push(nameVal);

      // 제출 일시
      line.push(formatDateForCsv(r.createdAt));

      // 각 문항별 응답
      normalQuestions.forEach(q => {
        const ans = (r.answers || []).find(a => a.questionId == q.id);
        if (!ans || ans.value == null) {
          line.push('');
          return;
        }
        const opts = toOptionArray(q.options);
        const values = Array.isArray(ans.value) ? ans.value : [ans.value];
        const labels = values.map(v => {
          const s = String(v);
          const match = opts.find(o => o.value === s || o.label === s);
          return match ? match.label : s;
        });
        line.push(labels.join(', '));
      });

      rows.push(line);
    });

    return rows.map(r => r.map(cell => wrapCSV(String(cell ?? ''))).join(',')).join('\n');
  }

  function toCSVWide(data) {
    const surveyId = data.surveyId;
    const meta = state.surveys.find(s => s.id === surveyId) || { questions: [] };
    const allQuestions = Array.isArray(meta.questions) ? meta.questions : [];
    const nameQuestion = allQuestions.find(q => isNameQuestion(q));
    const normalQuestions = allQuestions.filter(q => !isNameQuestion(q));

    const rows = [];
    // Header row: 이름, 제출 일시, 각 문항 텍스트
    const header = ['이름', '제출 일시'];
    normalQuestions.forEach((q, idx) => {
      header.push(sanitizeCSV(q.text || `문항 ${idx + 1}`));
    });
    rows.push(header);

    const responses = Array.isArray(data.rawResponses) ? data.rawResponses : [];

    responses.forEach((r, rowIdx) => {
      const line = [];
      // 이름
      let nameVal = '';
      if (nameQuestion) {
        const ans = (r.answers || []).find(a => a.questionId == nameQuestion.id);
        if (ans && ans.value != null) {
          nameVal = String(Array.isArray(ans.value) ? ans.value[0] : ans.value);
        }
      }
      line.push(nameVal);

      // 제출 일시
      line.push(formatDateForCsv(r.createdAt));

      // 각 문항별 응답
      normalQuestions.forEach(q => {
        const ans = (r.answers || []).find(a => a.questionId == q.id);
        if (!ans || ans.value == null) {
          line.push('');
          return;
        }
        const opts = toOptionArray(q.options);
        const values = Array.isArray(ans.value) ? ans.value : [ans.value];
        const labels = values.map(v => {
          const s = String(v);
          const match = opts.find(o => o.value === s || o.label === s);
          return match ? match.label : s;
        });
        line.push(labels.join(', '));
      });

      rows.push(line);
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
    responsesBySurvey: {},
    optionChartType: 'doughnut',
    dateFilter: { from: null, to: null }
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
      wireChartTypeToggle();
      wireDateFilter();
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

  function getFilteredResponsesForSurvey(surveyId) {
    const all = state.responsesBySurvey[surveyId] || [];
    const filter = state.dateFilter || {};
    const from = filter.from || null;
    const to = filter.to || null;
    if (!from && !to) return all;
    return all.filter(r => {
      if (!r.createdAt) return false;
      const t = new Date(r.createdAt);
      if (Number.isNaN(t.getTime())) return false;
      if (from && t < from) return false;
      if (to && t > to) return false;
      return true;
    });
  }

  function getAnswerDistribution(surveyId, questionId) {
    const meta = state.surveys.find(s => s.id === surveyId);
    if (!meta) return { labels: [], counts: [] };
    const q = (meta.questions || []).find(x => x.id == questionId);
    const options = toOptionArray(q && q.options);
    if (!q || options.length === 0) return { labels: [], counts: [] };
    const responses = getFilteredResponsesForSurvey(surveyId);
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

  // 색상 팔레트: 한 질문 안에서 선택지 1~5번까지만 색으로 구분 (이후는 순환)
  const OPTION_COLOR_PALETTE = [
    '#4a6baf', // 1번 선택지
    '#f5b041', // 2번 선택지
    '#e74c3c', // 3번 선택지
    '#27ae60', // 4번 선택지
    '#9b59b6'  // 5번 선택지
  ];

  function getIndexedColor(index) {
    return OPTION_COLOR_PALETTE[index % OPTION_COLOR_PALETTE.length];
  }

  function renderOptionBarsForAllQuestions(surveyId){
    // 막대그래프는 더 이상 사용하지 않으므로 비워둡니다.
    return;
  }

  function renderOptionChart(surveyId, questionId){
    const ctx = document.getElementById('chart2');
    const optionEmpty = document.getElementById('optionEmpty');
    if (!ctx) return;
    const { labels, counts } = getAnswerDistribution(surveyId, questionId);
    if (!labels.length) {
      if (state.doughnutChart) { state.doughnutChart.destroy(); state.doughnutChart = null; }
      if (optionEmpty) optionEmpty.style.display = 'block';
      renderOptionStatsTable(surveyId, questionId, [], []);
      return;
    }
    if (optionEmpty) optionEmpty.style.display = 'none';
    if (state.doughnutChart) { state.doughnutChart.destroy(); state.doughnutChart = null; }

    const colors = labels.map((_, idx) => getIndexedColor(idx));
    const borders = colors;
    const total = counts.reduce((sum, v) => sum + (typeof v === 'number' ? v : 0), 0);
    const chartType = state.optionChartType === 'bar' ? 'bar' : 'doughnut';

    setSelectedQuestionTitle(surveyId, questionId);
    renderOptionStatsTable(surveyId, questionId, labels, counts);

    const options = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          onClick: (evt, legendItem, legend) => {
            const index = legendItem.index;
            const ci = legend.chart;
            if (ci && typeof ci.toggleDataVisibility === 'function') {
              ci.toggleDataVisibility(index);
              ci.update();
            }
          }
        },
        tooltip: {
          callbacks: {
            label: (context) => {
              const label = context.label || '';
              const raw = context.raw;
              const value = typeof raw === 'number' ? raw : Number(raw) || 0;
              if (!total) return `${label}: ${value}명`;
              const pct = Math.round((value / total) * 100);
              return `${label}: ${value}명 (${pct}%)`;
            }
          }
        },
        datalabels: {
          color: '#333',
          font: { weight: '700', size: 13 },
          anchor: chartType === 'bar' ? 'end' : 'center',
          align: chartType === 'bar' ? 'end' : 'center',
          formatter: (value, context) => {
            const dataArr = context.chart.data.datasets[0].data || [];
            const totalLocal = dataArr.reduce((sum, v) => sum + (typeof v === 'number' ? v : 0), 0);
            if (!totalLocal) return '';
            const pct = Math.round((value / totalLocal) * 100);
            return pct ? `${pct}%` : '';
          }
        }
      }
    };

    if (chartType === 'bar') {
      options.scales = {
        x: {
          ticks: {
            autoSkip: false,
            maxRotation: 60,
            minRotation: 45
          }
        },
        y: {
          beginAtZero: true,
          ticks: { precision: 0 }
        }
      };
    }

    state.doughnutChart = new Chart(ctx, {
      type: chartType,
      data: { labels, datasets: [{ data: counts, backgroundColor: colors, borderColor: borders }] },
      options,
      plugins: typeof ChartDataLabels !== 'undefined' ? [ChartDataLabels] : []
    });
  }

  function renderOptionStatsTable(surveyId, questionId, labels, counts) {
    const container = document.getElementById('optionStatsTable');
    if (!container) return;
    const stats = state.latestStats;
    if (!stats || stats.surveyId !== surveyId || !Array.isArray(stats.questions)) {
      container.innerHTML = '';
      return;
    }
    const q = stats.questions.find(x => String(x.id) === String(questionId));
    if (!q || !Array.isArray(q.options) || !q.options.length) {
      container.innerHTML = '<div style="font-size:0.9rem; color:#777;">표시할 데이터가 없습니다.</div>';
      updateKpiForSelectedQuestion(surveyId, null);
      return;
    }

    const rowsHtml = q.options.map(o => `
      <tr>
        <td>${escapeHTML(o.label)}</td>
        <td style="text-align:right;">${o.count}</td>
        <td style="text-align:right;">${o.percent}%</td>
      </tr>`).join('');

    container.innerHTML = `
      <table class="option-table">
        <thead>
          <tr>
            <th style="text-align:left;">선택지</th>
            <th style="text-align:right;">응답 수(명)</th>
            <th style="text-align:right;">비율(%)</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>`;

    updateKpiForSelectedQuestion(surveyId, q);
  }

  function updateKpiForSelectedQuestion(surveyId, q) {
    const stats = state.latestStats;
    const surveyTotalEl = document.getElementById('kpiSurveyTotal');
    const topEl = document.getElementById('kpiTopOption');

    if (!surveyTotalEl && !topEl) return;

    if (!stats || stats.surveyId !== surveyId) {
      if (surveyTotalEl) surveyTotalEl.textContent = '0건';
      if (topEl) topEl.textContent = '-';
      return;
    }

    const totalResponses = stats.totalResponses || 0;
    if (surveyTotalEl) surveyTotalEl.textContent = `${totalResponses}건`;

    if (!q) {
      if (topEl) topEl.textContent = '-';
      return;
    }

    let topLabel = '-';
    if (Array.isArray(q.options) && q.options.length) {
      const topOpt = q.options.reduce((best, curr) => {
        if (!best) return curr;
        return (curr.count || 0) > (best.count || 0) ? curr : best;
      }, null);
      if (topOpt && (topOpt.count || 0) > 0) {
        topLabel = `${topOpt.label} – ${topOpt.percent}%`;
      }
    }
    if (topEl) topEl.textContent = topLabel;
  }

  function setOptionEmpty(show){ const el = document.getElementById('optionEmpty'); if (el) el.style.display = show ? 'block' : 'none'; }
  function setDropoutEmpty(show){ const el = document.getElementById('dropoutEmpty'); if (el) el.style.display = show ? 'block' : 'none'; }

  function setSelectedQuestionTitle(surveyId, questionId){
    const titleEl = document.getElementById('selectedQuestionTitle');
    const totalEl = document.getElementById('selectedQuestionTotal');
    if (!titleEl && !totalEl) return;
    const stats = state.latestStats;
    if (!stats || stats.surveyId !== surveyId || !Array.isArray(stats.questions)) {
      if (titleEl) titleEl.textContent = '';
      if (totalEl) totalEl.textContent = '';
      return;
    }
    const q = stats.questions.find(x => String(x.id) === String(questionId));
    if (!q) {
      if (titleEl) titleEl.textContent = '';
      if (totalEl) totalEl.textContent = '';
      return;
    }
    if (titleEl) {
      const base = `Q${q.number}. ${q.text || ''}`;
      const t = String(q.type || '').toLowerCase();
      const isMulti = t === 'checkbox' || /checkbox|복수|다중|체크/.test(t);
      titleEl.textContent = isMulti ? `${base} (복수 선택 가능)` : base;
    }
    if (totalEl) {
      const total = typeof q.respondedCount === 'number' ? q.respondedCount : 0;
      totalEl.textContent = `총 응답: ${total}건`;
    }
  }

  function onSurveySelected(surveyId){
    // Reset charts
    if (!surveyId) {
      if (state.selectedDropoutChart) { state.selectedDropoutChart.destroy(); state.selectedDropoutChart = null; }
      if (state.doughnutChart) { state.doughnutChart.destroy(); state.doughnutChart = null; }
      setDropoutEmpty(true); setOptionEmpty(true);
      updateKpiForSelectedQuestion(null, null);
      return;
    }
    // Load results for this survey from DB then render
    API.getResults(surveyId).then(rows => {
      const responses = normalizeResultsRows(rows);
      state.responsesBySurvey[surveyId] = responses;
      rebuildStatsForCurrentSurvey();
    }).catch(() => {
      // failure state: clear visuals
      if (state.selectedDropoutChart) { state.selectedDropoutChart.destroy(); state.selectedDropoutChart = null; }
      if (state.doughnutChart) { state.doughnutChart.destroy(); state.doughnutChart = null; }
      setDropoutEmpty(true); setOptionEmpty(true);
      state.latestStats = null;
    });
  }

  function rebuildStatsForCurrentSurvey() {
    const surveyId = state.selectedSurveyId;
    if (!surveyId) return;
    const meta = state.surveys.find(s => s.id === surveyId) || { id: surveyId, title: '' };
    const filteredResponses = getFilteredResponsesForSurvey(surveyId);
    const stats = computeSurveyStats(meta, filteredResponses);
    state.latestStats = { surveyId, title: meta.title, rawResponses: filteredResponses, ...stats };
    populateQuestionSelect(surveyId);
    updateKpiForSelectedQuestion(surveyId, null);
  }

  function wireChartTypeToggle() {
    const container = document.getElementById('overallDoughnutContainer');
    if (!container) return;
    const buttons = container.querySelectorAll('.chart-type-btn');
    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        const type = btn.dataset.type === 'bar' ? 'bar' : 'doughnut';
        if (state.optionChartType === type) return;
        state.optionChartType = type;
        buttons.forEach(b => b.classList.toggle('active', b === btn));
        if (state.selectedSurveyId) {
          const sel = document.getElementById('questionSelect');
          const qId = sel && sel.value;
          if (qId) {
            renderOptionChart(state.selectedSurveyId, qId);
          }
        }
      });
    });
  }

  function wireDateFilter() {
    const select = document.getElementById('dateRangePreset');
    if (!select) return;

    const apply = () => {
      const code = select.value || '7d';
      const now = new Date();
      let from = null;
      let to = null;
      if (code === '7d') {
        to = now;
        from = new Date(now);
        from.setDate(from.getDate() - 6);
      } else if (code === '1m') {
        to = now;
        from = new Date(now);
        from.setMonth(from.getMonth() - 1);
      } else if (code === '6m') {
        to = now;
        from = new Date(now);
        from.setMonth(from.getMonth() - 6);
      } else if (code === '1y') {
        to = now;
        from = new Date(now);
        from.setFullYear(from.getFullYear() - 1);
      } else if (code === 'all') {
        from = null;
        to = null;
      }

      state.dateFilter = { from, to };
      const labelEl = document.getElementById('kpiDateRangeLabel');
      if (labelEl) {
        const text = select.options[select.selectedIndex]?.text || '';
        labelEl.textContent = text;
      }
      rebuildStatsForCurrentSurvey();
    };

    select.addEventListener('change', apply);
    // 초기값: 최근 7일
    if (!select.value) select.value = '7d';
    apply();
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
  function formatDateForCsv(iso){
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,'0');
    const day = String(d.getDate()).padStart(2,'0');
    const hh = String(d.getHours()).padStart(2,'0');
    const mm = String(d.getMinutes()).padStart(2,'0');
    return `${y}-${m}-${day} ${hh}:${mm}`;
  }
});
