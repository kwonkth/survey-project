/*******************************************************
 *  Fantasy Quest Survey Tool — Rebuilt Script.js
 *  완전 리빌드 버전 (중복 제거 / 충돌 제거 / 모듈화 / 안정화)
 *******************************************************/


/* =======================================================
   전역 DOM 요소
======================================================= */
let surveyModal, completionModal,
    createNewSurveyBtn, completeSurveyBtn,
    addChapterBtn, questionBlocksContainer;

let lastCreatedSurveyId = '';
let currentSurveyId = null;
let aiGeneratedSurvey = null;

/* =======================================================
   초기화 – DOMContentLoaded
======================================================= */
document.addEventListener("DOMContentLoaded", () => {

    // 주요 DOM 요소 로드
    surveyModal = document.getElementById("surveyModal");
    completionModal = document.getElementById("completionModal");
    createNewSurveyBtn = document.getElementById("createNewSurvey");
    completeSurveyBtn = document.getElementById("completeSurvey");
    addChapterBtn = document.querySelector(".add-chapter");
    questionBlocksContainer = document.querySelector("#step2 .question-blocks");

    // 이벤트 리스너 초기화
    initEventListeners();

    // 대시보드 렌더링 (index.html 전용, 로컬 캐시 기반이지만 대시보드 화면은 dashboard.html에서 DB 기반으로 표시)
    if (typeof renderMainDashboard === "function") {
        renderMainDashboard();
    }

    // 업로드/템플릿 버튼 연결 (index.html 전용)
    const uploadSurveyBtn = document.getElementById("uploadSurveyBtn");
    const surveyUploadInput = document.getElementById("surveyUploadInput");
    const downloadSurveyTemplateBtn = document.getElementById("downloadSurveyTemplateBtn");

    if (uploadSurveyBtn && surveyUploadInput) {
        uploadSurveyBtn.addEventListener("click", () => surveyUploadInput.click());
        surveyUploadInput.addEventListener("change", (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                try {
                    const json = JSON.parse(ev.target.result);
                    const imported = importSurveysFromJSON(json);
                    alert(`퀘스트 ${imported}건을 불러왔습니다.`);
                    if (typeof renderMainDashboard === "function") {
                        renderMainDashboard();
                    }
                } catch (err) {
                    console.error(err);
                    alert("JSON을 읽는 중 오류가 발생했습니다. 양식을 확인해주세요.");
                } finally {
                    surveyUploadInput.value = "";
                }
            };
            reader.readAsText(file, 'utf-8');
        });
    }

    if (downloadSurveyTemplateBtn) {
        downloadSurveyTemplateBtn.addEventListener("click", () => {
            const template = createSurveyTemplate();
            const blob = new Blob([JSON.stringify(template, null, 2)], { type: 'application/json;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'survey_template.json';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        });
    }

    // AI 설문 생성 모달 & 미리보기 모달 제어
    const aiGenModal = document.getElementById('aiGenModal');
    const openAiGenBtn = document.getElementById('openAiGenModal');
    const aiGenClose = document.getElementById('aiGenClose');
    const aiGenCancel = document.getElementById('aiGenCancel');
    const aiGenerateBtn = document.getElementById('aiGenerateBtn');
    const aiTopicInput = document.getElementById('aiTopicInput');
    const aiCountButtons = document.querySelectorAll('.ai-count-btn');
    let aiSelectedQuestionCount = 5;

    const aiPreviewModal = document.getElementById('aiPreviewModal');
    const aiPreviewClose = document.getElementById('aiPreviewClose');
    const aiPreviewCancelBtn = document.getElementById('aiPreviewCancelBtn');
    const aiPreviewSaveBtn = document.getElementById('aiPreviewSaveBtn');
    const aiPreviewModalTitle = document.getElementById('aiPreviewModalTitle');
    const aiPreviewModalDesc = document.getElementById('aiPreviewModalDesc');
    const aiPreviewQuestionContainer = document.getElementById('aiPreviewQuestionContainer');
    const aiPreviewTabs = document.querySelectorAll('.ai-preview-tab');
    const aiPreviewEditPanel = document.getElementById('aiPreviewEditPanel');
    const aiPreviewLivePanel = document.getElementById('aiPreviewLivePanel');
    const aiAddQuestionBtn = document.getElementById('aiAddQuestionBtn');

    function escapeHtml(str) {
        return String(str || '').replace(/[&<>"']/g, (ch) => {
            const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
            return map[ch] || ch;
        });
    }

    function buildQuestionEditorHtml(q, index) {
        const safeText = String(q.text || '').trim();
        const safeType = ['radio', 'checkbox', 'text'].includes(q.type) ? q.type : 'text';
        const isRequired = q.required !== false;
        const optionsJoined = Array.isArray(q.options) ? q.options.map(o => String(o)).join('\n') : '';
        const maxSelNum = q.maxSelection != null ? parseInt(q.maxSelection, 10) : NaN;
        const maxSelValue = Number.isFinite(maxSelNum) && maxSelNum > 0 ? maxSelNum : '';
        const optionsGroupStyle = safeType === 'text' ? 'style="display:none;"' : '';
        const maxGroupStyle = safeType === 'checkbox' ? '' : 'style="display:none;"';
        return `
            <div class="ai-q-header">
                <div class="ai-q-header-left">
                    <span class="ai-q-handle" draggable="true" title="질문 순서 변경">⠿</span>
                    <span class="ai-q-label">Q${index + 1}</span>
                </div>
                <div class="ai-q-header-right">
                    <button type="button" class="btn-icon ai-q-duplicate" title="질문 복제">❐</button>
                    <button type="button" class="btn-icon ai-q-delete" title="질문 삭제">🗑️</button>
                </div>
            </div>
            <div class="ai-q-body">
                <div class="form-group">
                    <label>질문 내용</label>
                    <input type="text" class="form-control ai-q-text" value="${escapeHtml(safeText)}">
                </div>
                <div class="form-group">
                    <label>질문 유형</label>
                    <select class="form-control ai-q-type">
                        <option value="radio" ${safeType === 'radio' ? 'selected' : ''}>객관식 (단일 선택)</option>
                        <option value="checkbox" ${safeType === 'checkbox' ? 'selected' : ''}>객관식 (복수 선택)</option>
                        <option value="text" ${safeType === 'text' ? 'selected' : ''}>서술형</option>
                    </select>
                </div>
                <div class="form-group ai-q-options-group" ${optionsGroupStyle}>
                    <label>보기 옵션</label>
                    <textarea class="form-control ai-q-options" rows="3" style="display:none;">${escapeHtml(optionsJoined)}</textarea>
                    <div class="ai-option-actions">
                        <button type="button" class="btn-text ai-add-option-row">+ 옵션 추가</button>
                        <button type="button" class="btn-text ai-bulk-toggle">일괄 입력 모드</button>
                    </div>
                    <div class="ai-option-list"></div>
                    <div class="ai-bulk-editor" style="display:none;">
                        <textarea class="form-control ai-bulk-text" rows="4"></textarea>
                        <div class="ai-bulk-actions">
                            <button type="button" class="btn btn-secondary ai-bulk-cancel">취소</button>
                            <button type="button" class="btn btn-primary ai-bulk-apply">적용</button>
                        </div>
                    </div>
                </div>
                <div class="form-group ai-q-maxselection-group" ${maxGroupStyle}>
                    <label>최대 선택 개수 (선택사항)</label>
                    <input type="number" class="form-control ai-q-maxselection" min="1" placeholder="제한 없음" value="${maxSelValue !== '' ? maxSelValue : ''}">
                </div>
                <div class="form-group" style="display:flex;align-items:center;gap:8px;">
                    <input type="checkbox" class="ai-q-required" ${isRequired ? 'checked' : ''} />
                    <span>필수 질문</span>
                </div>
            </div>
        `;
    }

    function setupQuestionOptionList(wrapper, optionsArray) {
        const textarea = wrapper.querySelector('.ai-q-options');
        const listEl = wrapper.querySelector('.ai-option-list');
        if (!textarea || !listEl) return;
        const initial = Array.isArray(optionsArray) && optionsArray.length ? optionsArray : [''];
        listEl.innerHTML = '';
        initial.forEach(text => {
            const row = document.createElement('div');
            row.className = 'ai-option-row';
            row.innerHTML = `
                <span class="ai-option-handle" draggable="true" title="보기 순서 변경">≡</span>
                <input type="text" class="form-control ai-option-input" value="${escapeHtml(String(text))}">
                <button type="button" class="btn-icon ai-option-delete">🗑️</button>
            `;
            listEl.appendChild(row);
        });
        syncOptionsToTextarea(wrapper);
    }

    function syncOptionsToTextarea(wrapper) {
        const textarea = wrapper.querySelector('.ai-q-options');
        const listEl = wrapper.querySelector('.ai-option-list');
        if (!textarea || !listEl) return;
        const values = Array.from(listEl.querySelectorAll('.ai-option-input'))
            .map(input => input.value.trim())
            .filter(Boolean);
        textarea.value = values.join('\n');
    }

    function renumberPreviewQuestions() {
        const rows = aiPreviewQuestionContainer?.querySelectorAll('.ai-preview-question') || [];
        rows.forEach((row, idx) => {
            const label = row.querySelector('.ai-q-label');
            if (label) label.textContent = `Q${idx + 1}`;
        });
    }

    function renderLivePreviewFromDom() {
        if (!aiPreviewLivePanel) return;
        aiPreviewLivePanel.innerHTML = '';
        const rows = aiPreviewQuestionContainer?.querySelectorAll('.ai-preview-question') || [];
        rows.forEach((row, idx) => {
            const textInput = row.querySelector('.ai-q-text');
            const typeSelect = row.querySelector('.ai-q-type');
            const requiredCheckbox = row.querySelector('.ai-q-required');
            const optionInputs = row.querySelectorAll('.ai-option-input');
            const text = textInput?.value?.trim() || `문항 ${idx + 1}`;
            const type = typeSelect?.value || 'text';
            const required = !!requiredCheckbox?.checked;
            const options = Array.from(optionInputs).map(inp => inp.value.trim()).filter(Boolean);

            const qEl = document.createElement('div');
            qEl.className = 'ai-live-question';
            const title = document.createElement('div');
            title.className = 'ai-live-q-title';
            title.textContent = `Q${idx + 1}. ${text}`;
            qEl.appendChild(title);

            if (type === 'text') {
                const input = document.createElement('input');
                input.type = 'text';
                input.className = 'form-control';
                input.placeholder = required ? '필수 질문입니다.' : '답변을 입력하세요.';
                input.disabled = true;
                qEl.appendChild(input);
            } else {
                const list = document.createElement('ul');
                list.className = 'ai-live-options';
                options.forEach(opt => {
                    const li = document.createElement('li');
                    const label = document.createElement('label');
                    const inp = document.createElement('input');
                    inp.type = type === 'checkbox' ? 'checkbox' : 'radio';
                    inp.disabled = true;
                    label.appendChild(inp);
                    label.appendChild(document.createTextNode(' ' + opt));
                    li.appendChild(label);
                    list.appendChild(li);
                });
                qEl.appendChild(list);
            }

            aiPreviewLivePanel.appendChild(qEl);
        });
    }

    function setAiPreviewMode(mode) {
        if (!aiPreviewEditPanel || !aiPreviewLivePanel) return;
        if (mode === 'preview') {
            aiPreviewEditPanel.style.display = 'none';
            aiPreviewLivePanel.style.display = 'block';
            renderLivePreviewFromDom();
        } else {
            aiPreviewEditPanel.style.display = 'block';
            aiPreviewLivePanel.style.display = 'none';
        }
        if (aiPreviewTabs && aiPreviewTabs.length) {
            aiPreviewTabs.forEach(tab => {
                tab.classList.toggle('active', tab.dataset.mode === mode);
            });
        }
    }

    let draggingQuestionCard = null;
    let draggingOptionRow = null;

    if (aiPreviewQuestionContainer) {
        aiPreviewQuestionContainer.addEventListener('dragstart', (e) => {
            const qHandle = e.target.closest('.ai-q-handle');
            const optHandle = e.target.closest('.ai-option-handle');
            if (qHandle) {
                const card = qHandle.closest('.ai-preview-question');
                if (card) {
                    draggingQuestionCard = card;
                    card.classList.add('dragging');
                }
            } else if (optHandle) {
                const row = optHandle.closest('.ai-option-row');
                if (row) {
                    draggingOptionRow = row;
                    row.classList.add('dragging');
                }
            }
        });

        aiPreviewQuestionContainer.addEventListener('dragend', () => {
            if (draggingQuestionCard) {
                draggingQuestionCard.classList.remove('dragging');
                draggingQuestionCard = null;
                renumberPreviewQuestions();
            }
            if (draggingOptionRow) {
                const wrapper = draggingOptionRow.closest('.ai-preview-question');
                if (wrapper) syncOptionsToTextarea(wrapper);
                draggingOptionRow.classList.remove('dragging');
                draggingOptionRow = null;
            }
        });

        aiPreviewQuestionContainer.addEventListener('dragover', (e) => {
            if (draggingQuestionCard) {
                e.preventDefault();
                const targetCard = e.target.closest('.ai-preview-question');
                if (!targetCard || targetCard === draggingQuestionCard) return;
                const rect = targetCard.getBoundingClientRect();
                const after = e.clientY > rect.top + rect.height / 2;
                if (after) {
                    targetCard.after(draggingQuestionCard);
                } else {
                    targetCard.before(draggingQuestionCard);
                }
            } else if (draggingOptionRow) {
                e.preventDefault();
                const list = draggingOptionRow.closest('.ai-option-list');
                if (!list) return;
                const targetRow = e.target.closest('.ai-option-row');
                if (!targetRow || targetRow === draggingOptionRow) return;
                const rect = targetRow.getBoundingClientRect();
                const after = e.clientY > rect.top + rect.height / 2;
                if (after) {
                    targetRow.after(draggingOptionRow);
                } else {
                    targetRow.before(draggingOptionRow);
                }
            }
        });

        aiPreviewQuestionContainer.addEventListener('input', (e) => {
            if (e.target.classList.contains('ai-option-input')) {
                const wrapper = e.target.closest('.ai-preview-question');
                if (wrapper) syncOptionsToTextarea(wrapper);
            }
        });
    }

    if (aiPreviewTabs && aiPreviewTabs.length) {
        aiPreviewTabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const mode = tab.dataset.mode || 'edit';
                setAiPreviewMode(mode);
            });
        });
    }

    function collectUpdatedQuestionsFromDom() {
        const rows = aiPreviewQuestionContainer?.querySelectorAll('.ai-preview-question') || [];
        const updatedQuestions = [];
        rows.forEach((row, index) => {
            const textInput = row.querySelector('.ai-q-text');
            const typeSelect = row.querySelector('.ai-q-type');
            const optionsTextarea = row.querySelector('.ai-q-options');
            const requiredCheckbox = row.querySelector('.ai-q-required');
            const maxSelInput = row.querySelector('.ai-q-maxselection');

            const base = Array.isArray(aiGeneratedSurvey?.questions) ? aiGeneratedSurvey.questions[index] || {} : {};
            const type = typeSelect?.value || base.type || 'text';
            const text = textInput?.value?.trim() || base.text || `문항 ${index + 1}`;
            let options = [];
            if (type === 'radio' || type === 'checkbox') {
                const raw = optionsTextarea?.value || '';
                options = raw.split('\n').map(v => v.trim()).filter(Boolean);
            }
            const required = !!requiredCheckbox?.checked;

            let maxSelection;
            if (type === 'checkbox' && maxSelInput && maxSelInput.value) {
                const n = parseInt(maxSelInput.value, 10);
                if (Number.isFinite(n) && n > 0) {
                    maxSelection = n;
                }
            }

            updatedQuestions.push({
                id: base.id || `q_${index + 1}`,
                order: index + 1,
                text,
                type,
                required,
                options,
                maxSelection
            });
        });
        return updatedQuestions;
    }

    function openAiModal() {
        if (aiGenModal) {
            aiGenModal.style.display = 'block';
            document.body.style.overflow = 'hidden';
        }
    }

    function closeAiModal() {
        if (aiGenModal) {
            aiGenModal.style.display = 'none';
            document.body.style.overflow = 'auto';
        }
    }

    function openAiPreviewModal() {
        if (!aiPreviewModal || !aiGeneratedSurvey) return;

        // 제목/설명
        aiPreviewModalTitle.textContent = aiGeneratedSurvey.title || '제목 없음';
        aiPreviewModalDesc.textContent = aiGeneratedSurvey.description || '설명 없음';

        // 질문 목록 렌더링 (리스트형 편집 UI)
        const questions = Array.isArray(aiGeneratedSurvey.questions) ? aiGeneratedSurvey.questions : [];
        aiPreviewQuestionContainer.innerHTML = '';

        questions.forEach((q, index) => {
            const wrapper = document.createElement('div');
            wrapper.className = 'ai-preview-question';
            const safeType = ['radio', 'checkbox', 'text'].includes(q.type) ? q.type : 'text';
            const safeOptions = Array.isArray(q.options) ? q.options.map(o => String(o)) : [];
            wrapper.innerHTML = buildQuestionEditorHtml({
                text: q.text,
                type: safeType,
                required: q.required,
                options: safeOptions
            }, index);
            aiPreviewQuestionContainer.appendChild(wrapper);
            setupQuestionOptionList(wrapper, safeOptions);

            const typeSelect = wrapper.querySelector('.ai-q-type');
            const optionsGroup = wrapper.querySelector('.ai-q-options-group');
            const maxGroup = wrapper.querySelector('.ai-q-maxselection-group');
            if (typeSelect && optionsGroup) {
                typeSelect.addEventListener('change', () => {
                    if (typeSelect.value === 'text') {
                        optionsGroup.style.display = 'none';
                        if (maxGroup) maxGroup.style.display = 'none';
                    } else {
                        optionsGroup.style.display = '';
                        if (maxGroup) {
                            maxGroup.style.display = typeSelect.value === 'checkbox' ? '' : 'none';
                        }
                    }
                });
            }
        });

        renumberPreviewQuestions();
        setAiPreviewMode('edit');
        aiPreviewModal.style.display = 'block';
        document.body.style.overflow = 'hidden';
    }

    function closeAiPreviewModal() {
        if (aiPreviewModal) {
            aiPreviewModal.style.display = 'none';
            document.body.style.overflow = 'auto';
        }
    }

    if (openAiGenBtn) {
        openAiGenBtn.addEventListener('click', openAiModal);
    }
    if (aiGenClose) {
        aiGenClose.addEventListener('click', closeAiModal);
    }
    if (aiGenCancel) {
        aiGenCancel.addEventListener('click', closeAiModal);
    }

    window.addEventListener('click', (e) => {
        if (e.target === aiGenModal) {
            closeAiModal();
        }
        if (e.target === aiPreviewModal) {
            closeAiPreviewModal();
        }
    });

    // AI 질문 개수 선택 버튼 동작
    if (aiCountButtons && aiCountButtons.length) {
        aiCountButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const count = parseInt(btn.dataset.count || '5', 10);
                aiSelectedQuestionCount = count === 10 ? 10 : 5;
                aiCountButtons.forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
            });
        });
    }

    if (aiGenerateBtn) {
        aiGenerateBtn.addEventListener('click', async () => {
            const topic = aiTopicInput?.value?.trim();
            const questionCount = aiSelectedQuestionCount === 10 ? 10 : 5;

            if (!topic) {
                alert('설문 주제를 입력해주세요.');
                return;
            }

            aiGenerateBtn.disabled = true;
            const originalText = aiGenerateBtn.textContent;
            aiGenerateBtn.textContent = '생성 중...';

            try {
                const res = await fetch('/api/generate-survey', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        topic,
                        questionCount,
                        includeNameQuestion: true
                    })
                });

                if (!res.ok) {
                    const err = await res.json().catch(() => ({}));
                    throw new Error(err?.error || `AI 생성 실패 (${res.status})`);
                }

                const data = await res.json();
                aiGeneratedSurvey = data;
                closeAiModal();
                openAiPreviewModal();
            } catch (e) {
                console.error(e);
                alert('AI 설문 생성 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
            } finally {
                aiGenerateBtn.disabled = false;
                aiGenerateBtn.textContent = originalText;
            }
        });
    }

    async function saveAiSurveyDraftAndClose() {
        if (!aiGeneratedSurvey) {
            closeAiPreviewModal();
            return;
        }

        const updatedQuestions = collectUpdatedQuestionsFromDom();
        aiGeneratedSurvey.questions = updatedQuestions;

        try {
            const surveyId = `survey_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
            const now = new Date().toISOString();

            currentSurveyId = surveyId;
            lastCreatedSurveyId = surveyId;

            await API.postSurvey({
                survey_id: surveyId,
                title: aiGeneratedSurvey.title || 'AI 생성 설문',
                description: aiGeneratedSurvey.description || '',
                questions: JSON.stringify(aiGeneratedSurvey.questions || []),
                story: aiGeneratedSurvey.story_context ? JSON.stringify(aiGeneratedSurvey.story_context) : null,
                status: 'draft',
                created_at: now,
                updated_at: now
            });

            alert('작성 중인 설문이 임시 저장되었습니다.');
        } catch (err) {
            console.error(err);
            alert('임시 저장 중 오류가 발생했습니다.');
        } finally {
            closeAiPreviewModal();
        }
    }

    if (aiPreviewSaveBtn) {
        aiPreviewSaveBtn.addEventListener('click', async () => {
            if (!aiGeneratedSurvey) {
                alert('먼저 AI로 설문을 생성해주세요.');
                return;
            }

            const updatedQuestions = collectUpdatedQuestionsFromDom();
            aiGeneratedSurvey.questions = updatedQuestions;

            aiPreviewSaveBtn.disabled = true;
            const prevText = aiPreviewSaveBtn.textContent;
            aiPreviewSaveBtn.textContent = '저장 중...';

            try {
                const surveyId = `survey_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
                const now = new Date().toISOString();

                currentSurveyId = surveyId;
                lastCreatedSurveyId = surveyId;

                await API.postSurvey({
                    survey_id: surveyId,
                    title: aiGeneratedSurvey.title || 'AI 생성 설문',
                    description: aiGeneratedSurvey.description || '',
                    questions: JSON.stringify(aiGeneratedSurvey.questions || []),
                    story: aiGeneratedSurvey.story_context ? JSON.stringify(aiGeneratedSurvey.story_context) : null,
                    status: 'active',
                    created_at: now,
                    updated_at: now
                });

                // 링크 생성 및 완료 모달 표시
                const surveyUrl = `${window.location.origin}/survey.html?surveyId=${encodeURIComponent(surveyId)}`;
                const shareInput = document.getElementById('shareLinkInput');
                const qrImg = document.getElementById('qrCodeImage');
                if (shareInput) shareInput.value = surveyUrl;
                if (qrImg) {
                    qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(surveyUrl)}`;
                }

                closeAiPreviewModal();
                if (completionModal) {
                    completionModal.style.display = 'block';
                    document.body.style.overflow = 'hidden';
                }
            } catch (err) {
                console.error(err);
                alert('설문 저장 중 오류가 발생했습니다.');
            } finally {
                aiPreviewSaveBtn.disabled = false;
                aiPreviewSaveBtn.textContent = prevText;
            }
        });
    }

    if (aiPreviewCancelBtn) {
        aiPreviewCancelBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            await saveAiSurveyDraftAndClose();
        });
    }

    if (aiPreviewClose) {
        aiPreviewClose.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            await saveAiSurveyDraftAndClose();
        });
    }

function importSurveysFromJSON(json) {
    // 입력 형태: { surveys: [...] } 또는 단일 설문 객체 또는 설문 배열 허용
    let surveys = [];
    if (Array.isArray(json)) surveys = json;
    else if (json && Array.isArray(json.surveys)) surveys = json.surveys;
    else if (json && typeof json === 'object') surveys = [json];

    if (!Array.isArray(surveys) || surveys.length === 0) {
        throw new Error('유효한 설문 데이터가 없습니다.');
    }

    const now = new Date().toISOString();
    let imported = 0;

    return Promise.all(surveys.map(async (raw, idx) => {
        const surveyId = raw.id && String(raw.id).trim() ? String(raw.id) : `survey_${Date.now().toString(36)}${Math.random().toString(36).slice(2,6)}`;
        const title = String(raw.title || '제목 없음');
        const description = String(raw.description || '');

        // 질문 정규화
        const questions = Array.isArray(raw.questions) ? raw.questions.slice() : [];
        const normalized = questions.map((q, i) => {
            const qid = q.id && String(q.id).trim() ? String(q.id) : `q_${i + 1}`;
            const order = Number.isFinite(q.order) ? Number(q.order) : i + 1;
            const text = String(q.text || '').trim();
            let type = String(q.type || 'text');
            if (/객관식/.test(type) && /복수|체크/.test(type)) type = 'checkbox';
            else if (/객관식/.test(type)) type = 'radio';
            else if (/주관식/.test(type)) type = 'text';
            else if (/scale|척도/.test(type)) type = 'scale';
            else if (!['text','radio','checkbox','scale'].includes(type)) type = 'text';
            const required = q.required !== false;
            const options = Array.isArray(q.options) ? q.options.map(o => String(o)).filter(Boolean) : [];
            const maxSelNum = q.maxSelection != null ? parseInt(q.maxSelection, 10) : NaN;
            const maxSelection = Number.isFinite(maxSelNum) && maxSelNum > 0 ? maxSelNum : undefined;
            return { id: qid, order, text, type, required, options, maxSelection };
        }).filter(q => q.text);

        await API.postSurvey({
            survey_id: surveyId,
            title,
            description,
            questions: JSON.stringify(normalized),
            story: null,
            created_at: now,
            updated_at: now
        });
        imported++;
        if (idx === surveys.length - 1) lastCreatedSurveyId = surveyId;
        return true;
    })).then(() => imported);
}
/* =======================================================
   기본 이름 질문 보장 (moved to global scope above)
====================================================== */

    const copyBtn = document.getElementById("copyLinkBtn");
    if (copyBtn) {
        copyBtn.addEventListener("click", async () => {
            const input = document.getElementById("shareLinkInput");
            const text = input?.value || "";

            if (!text) {
                alert("복사할 링크가 없습니다.");
                return;
            }

            try {
                if (navigator.clipboard && window.isSecureContext) {
                    await navigator.clipboard.writeText(text);
                } else {
                    input?.select();
                    document.execCommand("copy");
                }
                copyBtn.disabled = true;
                const prev = copyBtn.textContent;
                copyBtn.textContent = "복사됨";
                setTimeout(() => { copyBtn.textContent = prev; copyBtn.disabled = false; }, 1200);
            } catch (e) {
                console.error(e);
                alert("링크를 복사하는 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
            }
        });
    }

    const closeCompletionBtn = document.getElementById("closeCompletion");
    if (closeCompletionBtn) {
        closeCompletionBtn.addEventListener("click", (e) => {
            e.preventDefault();
            closeCompletionModal();
        });
    }

    const viewResultsBtn = document.getElementById("viewResults");
    if (viewResultsBtn) {
        viewResultsBtn.addEventListener("click", (e) => {
            e.preventDefault();
            const lastId = lastCreatedSurveyId;
            const url = lastId ? `analytics.html?surveyId=${lastId}` : 'analytics.html';
            window.location.href = url;
        });
    }

    // 설문관리 페이지에서 넘어온 기존 설문 편집 진입 (index.html?surveyId=...)
    (async () => {
        try {
            const params = new URLSearchParams(window.location.search);
            const editSurveyId = params.get('surveyId');
            if (!editSurveyId || !aiPreviewModal) return;

            const found = await API.getSurvey(editSurveyId);
            if (!found || !(found.survey_id || found.id)) return;

            let questions = found.questions;
            if (typeof questions === 'string') {
                try { questions = JSON.parse(questions); } catch { questions = []; }
            }

            aiGeneratedSurvey = {
                title: found.title || '제목 없음',
                description: found.description || '',
                questions: Array.isArray(questions) ? questions : []
            };

            openAiPreviewModal();
        } catch (err) {
            console.error('기존 설문 편집을 위한 로드 중 오류', err);
        }
    })();
});

/* =======================================================
   이벤트 리스너 초기화
======================================================= */
function initEventListeners() {

    /* --- 설문 생성 모달 열기 --- */
    if (createNewSurveyBtn) {
        createNewSurveyBtn.addEventListener("click", openSurveyModal);
    }

    /* --- 창 전체 클릭(외부 클릭 감지) --- */
    window.addEventListener("click", (e) => {
        if (e.target === surveyModal) closeSurveyModal();
        if (e.target === completionModal) closeCompletionModal();
    });

    /* --- ESC 키 닫기 --- */
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            closeSurveyModal();
            closeCompletionModal();
        }
    });

    /* --- Event Delegation (동적 요소 포함 전부 처리) --- */
    document.addEventListener("click", (e) => {

        /* ✦ 모달 닫기 버튼 */
        if (e.target.closest(".close")) {
            e.preventDefault();
            closeSurveyModal();
            closeCompletionModal();
            return;
        }

        /* ✦ 다음 단계 이동 */
        if (e.target.closest(".next-step")) {
            const btn = e.target.closest(".next-step");
            const step = parseInt(btn.dataset.next);
            if (step === 2) {
                const titleInput = document.getElementById("surveyTitle");
                const title = titleInput ? titleInput.value.trim() : "";
                if (!title) {
                    alert("제목을 입력해주십시오");
                    return;
                }
            }
            setActiveStep(step);
            return;
        }

        /* ✦ 이전 단계 이동 */
        if (e.target.closest(".prev-step")) {
            const step = parseInt(e.target.closest(".prev-step").dataset.prev);
            setActiveStep(step);
            return;
        }

        /* ✦ 아바타 선택 */
        if (e.target.closest(".avatar-option")) {
            document.querySelectorAll(".avatar-option")
                .forEach(el => el.classList.remove("selected"));
            e.target.closest(".avatar-option").classList.add("selected");
            return;
        }

        /* ✦ 테마 선택 */
        if (e.target.closest(".theme-option")) {
            document.querySelectorAll(".theme-option")
                .forEach(el => el.classList.remove("selected"));
            e.target.closest(".theme-option").classList.add("selected");
            return;
        }

        /* ✦ 새로운 챕터 추가 */
        if (e.target.closest(".add-chapter")) {
            addNewChapter();
            return;
        }

        /* ✦ 선택지 추가 */
        if (e.target.classList.contains("add-option")) {
            const container = e.target.closest(".answer-options");
            if (container) {
                const row = document.createElement("div");
                row.className = "answer-option";
                row.innerHTML = `
                    <input class="form-control" placeholder="선택지" />
                    <button class="btn-icon">🗑️</button>
                `;
                container.insertBefore(row, e.target);
                validateSurvey();
            }
            return;
        }

        /* ✦ 삭제 버튼 (옵션/챕터) */
        if (e.target.closest(".btn-icon") && e.target.textContent.includes("🗑️")) {
            const optionRow = e.target.closest(".answer-option");
            if (optionRow) {
                optionRow.remove();
                validateSurvey();
                return;
            }
            const block = e.target.closest(".question-block");
            if (block) {
                if (block.dataset.defaultName === "1") {
                    return; // 기본 이름 질문은 삭제 불가
                }
                block.remove();
                updateChapterNumbers();
                validateSurvey();
            }
            return;
        }

        /* ✦ 배경 색상 변경 (🎨 버튼) */
        if (e.target.closest(".btn-icon") && e.target.textContent.includes("🎨")) {
            const block = e.target.closest(".question-block");
            showColorPicker(block);
            return;
        }

        /* ✦ 설문 완성 버튼 */
        if (e.target.id === "completeSurvey") {
            handleCompleteSurvey();
            return;
        }

        /* ✦ AI 미리보기: 질문 삭제 */
        if (e.target.closest('.ai-q-delete')) {
            const card = e.target.closest('.ai-preview-question');
            if (card) {
                card.remove();
                if (typeof renumberPreviewQuestions === 'function') {
                    renumberPreviewQuestions();
                }
            }
            return;
        }

        /* ✦ AI 미리보기: 질문 복제 */
        if (e.target.closest('.ai-q-duplicate')) {
            const card = e.target.closest('.ai-preview-question');
            if (card && aiPreviewQuestionContainer) {
                const clone = card.cloneNode(true);
                aiPreviewQuestionContainer.appendChild(clone);
                if (typeof renumberPreviewQuestions === 'function') {
                    renumberPreviewQuestions();
                }
            }
            return;
        }

        /* ✦ AI 미리보기: 새 질문 추가 */
        if (e.target.id === 'aiAddQuestionBtn') {
            if (aiPreviewQuestionContainer) {
                const index = aiPreviewQuestionContainer.querySelectorAll('.ai-preview-question').length;
                const wrapper = document.createElement('div');
                wrapper.className = 'ai-preview-question';
                const q = { text: '', type: 'radio', required: true, options: [] };
                wrapper.innerHTML = buildQuestionEditorHtml(q, index);
                aiPreviewQuestionContainer.appendChild(wrapper);
                setupQuestionOptionList(wrapper, q.options);
                if (typeof renumberPreviewQuestions === 'function') {
                    renumberPreviewQuestions();
                }
            }
            return;
        }

        /* ✦ AI 미리보기: 옵션 한 줄 추가 */
        if (e.target.closest('.ai-add-option-row')) {
            const group = e.target.closest('.ai-q-options-group');
            if (group) {
                const list = group.querySelector('.ai-option-list');
                if (list) {
                    const row = document.createElement('div');
                    row.className = 'ai-option-row';
                    row.innerHTML = `
                        <span class="ai-option-handle" draggable="true" title="보기 순서 변경">≡</span>
                        <input type="text" class="form-control ai-option-input" />
                        <button type="button" class="btn-icon ai-option-delete">🗑️</button>
                    `;
                    list.appendChild(row);
                    if (typeof syncOptionsToTextarea === 'function') {
                        const wrapper = group.closest('.ai-preview-question');
                        if (wrapper) syncOptionsToTextarea(wrapper);
                    }
                }
            }
            return;
        }

        /* ✦ AI 미리보기: 옵션 삭제 */
        if (e.target.closest('.ai-option-delete')) {
            const row = e.target.closest('.ai-option-row');
            if (row) {
                const wrapper = row.closest('.ai-preview-question');
                row.remove();
                if (wrapper && typeof syncOptionsToTextarea === 'function') {
                    syncOptionsToTextarea(wrapper);
                }
            }
            return;
        }

        /* ✦ AI 미리보기: 일괄 입력 모드 토글 */
        if (e.target.closest('.ai-bulk-toggle')) {
            const group = e.target.closest('.ai-q-options-group');
            if (group) {
                const bulk = group.querySelector('.ai-bulk-editor');
                const textareaBulk = group.querySelector('.ai-bulk-text');
                const hidden = group.querySelector('.ai-q-options');
                const wrapper = group.closest('.ai-preview-question');
                if (bulk && textareaBulk && hidden && wrapper) {
                    if (typeof syncOptionsToTextarea === 'function') {
                        syncOptionsToTextarea(wrapper);
                    }
                    textareaBulk.value = hidden.value;
                    bulk.style.display = bulk.style.display === 'none' || !bulk.style.display ? 'block' : 'none';
                }
            }
            return;
        }

        /* ✦ AI 미리보기: 일괄 입력 취소 */
        if (e.target.closest('.ai-bulk-cancel')) {
            const bulk = e.target.closest('.ai-bulk-editor');
            if (bulk) bulk.style.display = 'none';
            return;
        }

        /* ✦ AI 미리보기: 일괄 입력 적용 */
        if (e.target.closest('.ai-bulk-apply')) {
            const bulk = e.target.closest('.ai-bulk-editor');
            if (bulk) {
                const group = bulk.closest('.ai-q-options-group');
                const textareaBulk = bulk.querySelector('.ai-bulk-text');
                const list = group?.querySelector('.ai-option-list');
                const wrapper = bulk.closest('.ai-preview-question');
                if (group && textareaBulk && list) {
                    list.innerHTML = '';
                    const lines = textareaBulk.value.split('\n').map(v => v.trim()).filter(Boolean);
                    if (lines.length === 0) {
                        lines.push('');
                    }
                    lines.forEach(text => {
                        const row = document.createElement('div');
                        row.className = 'ai-option-row';
                        row.innerHTML = `
                            <span class="ai-option-handle" draggable="true" title="보기 순서 변경">≡</span>
                            <input type="text" class="form-control ai-option-input" value="${escapeHtml(text)}" />
                            <button type="button" class="btn-icon ai-option-delete">🗑️</button>
                        `;
                        list.appendChild(row);
                    });
                    if (wrapper && typeof syncOptionsToTextarea === 'function') {
                        syncOptionsToTextarea(wrapper);
                    }
                }
                bulk.style.display = 'none';
            }
            return;
        }
    });

    /* --- 입력 검증 (제목/질문/옵션 입력 시) --- */
    document.addEventListener("input", () => {
        validateSurvey();
    });
}


/* =======================================================
   모달 제어 함수
======================================================= */
function openSurveyModal() {
    surveyModal.style.display = "block";
    document.body.style.overflow = "hidden";
    setActiveStep(1);
}

function closeSurveyModal() {
    surveyModal.style.display = "none";
    document.body.style.overflow = "auto";
}

function closeCompletionModal() {
    completionModal.style.display = "none";
    document.body.style.overflow = "auto";
}


/* =======================================================
   단계 이동
======================================================= */
const steps = document.querySelectorAll(".step");
const stepContents = document.querySelectorAll(".step-content");

function setActiveStep(step) {

    steps.forEach(el => {
        const num = parseInt(el.dataset.step);
        el.classList.remove("active", "completed");
        if (num === step) el.classList.add("active");
        if (num < step) el.classList.add("completed");
    });

    stepContents.forEach(el => {
        el.classList.remove("active");
        if (el.id === `step${step}`) {
            el.classList.add("active");
            el.style.animation = "fadeIn .25s ease-out";
        }
    });

    surveyModal.scrollTo(0, 0);
}


/* =======================================================
   질문 추가 기능
======================================================= */
function addNewChapter() {
    const chapterNum = document.querySelectorAll("#step2 .question-blocks .question-block").length + 1;

    const block = document.createElement("div");
    block.className = "question-block";
    block.innerHTML = `
        <div class="question-header">
            <h3>Chapter ${chapterNum}</h3>
            <div class="question-actions">
                <button class="btn-icon">🎨</button>
                <button class="btn-icon">🗑️</button>
            </div>
        </div>

        <div class="form-group">
            <label>답변 유형</label>
            <select class="form-control">
                <option>객관식 (단일 선택)</option>
                <option>주관식 (자유 기록)</option>
            </select>
        </div>

        <div class="answer-options">
            <div class="answer-option">
                <input class="form-control" placeholder="선택지 1">
                <button class="btn-icon">🗑️</button>
            </div>
            <button class="btn-text add-option">+ 선택지 추가</button>
        </div>
    `;

    const addBtn = questionBlocksContainer.querySelector(".add-chapter");
    if (addBtn) {
        questionBlocksContainer.insertBefore(block, addBtn);
    } else {
        questionBlocksContainer.appendChild(block);
    }
    validateSurvey();
}


/* =======================================================
   챕터 번호 최신화
======================================================= */
function updateChapterNumbers() {
    document.querySelectorAll("#step2 .question-blocks .question-block").forEach((block, i) => {
        block.querySelector("h3").textContent = `Chapter ${i + 1}`;
    });
}


/* =======================================================
   설문 검증
======================================================= */
function validateSurvey() {
    if (!completeSurveyBtn) return;

    const title = document.querySelector("#step1 input[type=text]")?.value.trim();
    const questions = document.querySelectorAll("#step2 .question-blocks .question-block");

    let valid = !!title && questions.length > 0;

    questions.forEach(q => {
        const text = q.querySelector("textarea")?.value.trim();
        if (!text) valid = false;
    });

    completeSurveyBtn.disabled = !valid;
}


/* =======================================================
   색상 선택기
======================================================= */
function showColorPicker(block) {
    const picker = document.createElement("div");
    picker.className = "color-picker";

    const colors = ["#FFE0B2", "#E1BEE7", "#C8E6C9", "#BBDEFB", "#FFF9C4"];
    picker.innerHTML = colors.map(c => `
        <div class="color-item" style="background:${c}" data-color="${c}"></div>
    `).join("");

    document.body.appendChild(picker);

    const rect = block.getBoundingClientRect();
    picker.style.left = rect.left + "px";
    picker.style.top = rect.top + window.scrollY + "px";

    picker.addEventListener("click", (e) => {
        if (e.target.dataset.color) {
            block.style.background = e.target.dataset.color;
            picker.remove();
        }
    });
}


/* =======================================================
   설문 완성 처리
======================================================= */
async function handleCompleteSurvey() {

    const surveyId = "survey_" + Date.now().toString(36);
    currentSurveyId = surveyId;
    const now = new Date().toISOString();

    const title = document.querySelector("#step1 input[type=text]")?.value;
    const description = document.querySelector("#step1 textarea")?.value;

    const surveyData = {
        id: surveyId,
        title,
        description,
        createdAt: now,
        updatedAt: now,
        questions: []
    };

    // 질문 수집: 모든 챕터를 사용자가 입력한 내용/유형 그대로 저장
    const collected = [];
    document.querySelectorAll(".question-block").forEach((block, i) => {
        const qtext = block.querySelector("textarea")?.value?.trim() || "";
        const qtypeRaw = block.querySelector("select")?.value || "";

        // 타입 정규화
        let qtype = 'text';
        if (qtypeRaw.includes('객관식')) qtype = 'radio';
        if (qtypeRaw.includes('복수') || qtypeRaw.includes('체크')) qtype = 'checkbox';

        const question = {
            id: `q_${i+1}`,
            order: i + 1,
            text: qtext,
            type: qtype,
            required: true,
            options: []
        };

        if (qtype === 'radio' || qtype === 'checkbox') {
            block.querySelectorAll(".answer-option input")
                .forEach(o => {
                    const v = o.value.trim();
                    if (v) question.options.push(v);
                });
        }

        collected.push(question);
    });

    surveyData.questions = collected.map((q, idx) => ({ ...q, order: idx + 1 }));

    // Optional story merging: if a story was prepared elsewhere, include; otherwise null
    const storyObject = null; // 스토리가 없어도 저장 가능해야 함

    // Persist to DB (Cloudflare D1 via Worker)
    try {
        await API.postSurvey({
            survey_id: surveyId,
            title: title || '',
            description: description || '',
            questions: JSON.stringify(surveyData.questions),
            story: storyObject ? JSON.stringify(storyObject) : null,
            created_at: now,
            updated_at: now
        });
        // For convenience, remember last created ID for navigation
        try { localStorage.setItem('surveyGuide.lastCreatedSurvey', surveyId); } catch {}
    } catch (e) {
        console.error('설문 저장 실패', e);
        alert('설문을 저장하는 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
        return;
    }

    // URL 생성
    const base = window.location.href.replace("index.html", "");
    const surveyUrl = `${base}survey.html?surveyId=${surveyId}`;

    // 모달 업데이트
    document.getElementById("shareLinkInput").value = surveyUrl;
    document.getElementById("qrCodeImage").src =
        `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(surveyUrl)}`;

    closeSurveyModal();
    completionModal.style.display = "block";
    document.body.style.overflow = "hidden";

    // 대시보드(별도 페이지)에서 API 기반으로 목록을 불러옵니다.
}


// Removed legacy data-folder export; DB is the single source of truth.


/* =======================================================
   대시보드(메인 index.html) 렌더링
   - 좌측: 전체 설문 통계 카드 (개수 / 총 응답 / 평균 완료율)
   - 우측: 가장 최근 설문 완료율 도넛 그래프
======================================================= */
let latestSurveyDonutChart = null;

const latestDonutCenterPlugin = {
    id: 'latestDonutCenter',
    afterDraw(chart, args, opts) {
        const { ctx, chartArea } = chart;
        if (!chartArea) return;
        const text = opts && typeof opts.text === 'string' ? opts.text : '';
        if (!text) return;
        const x = (chartArea.left + chartArea.right) / 2;
        const y = (chartArea.top + chartArea.bottom) / 2;
        ctx.save();
        ctx.font = '700 22px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans KR", sans-serif';
        ctx.fillStyle = '#2d3436';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, x, y);
        ctx.restore();
    }
};

async function getNormalizedResultsForDashboard(surveyId) {
    try {
        const res = await fetch(`/api/results/${encodeURIComponent(surveyId)}`, { method: 'GET' });
        if (!res.ok) return [];
        const rows = await res.json();
        const out = [];
        (rows || []).forEach(row => {
            let ansObj = row.answers;
            if (typeof ansObj === 'string') {
                try { ansObj = JSON.parse(ansObj); } catch { ansObj = {}; }
            }
            let arr = [];
            if (Array.isArray(ansObj)) {
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
    } catch {
        return [];
    }
}

function calcCompletionSummaryForDashboard(questions, responses) {
    const qCount = Array.isArray(questions) ? questions.length : 0;
    if (!responses.length || !qCount) {
        return { completionRate: 0, completedCount: 0 };
    }
    const completedCount = responses.filter(r => Array.isArray(r.answers) && r.answers.length === qCount).length;
    const completionRate = responses.length ? Math.round((completedCount / responses.length) * 100) : 0;
    return { completionRate, completedCount };
}

function renderLatestSurveyDonutCard(latestMeta) {
    const titleEl = document.getElementById('latestSurveyTitle');
    const completionEl = document.getElementById('latestSurveyCompletion');
    const countsEl = document.getElementById('latestSurveyCounts');
    const updatedEl = document.getElementById('latestSurveyUpdated');
    const canvas = document.getElementById('latestSurveyDonut');

    if (!canvas) return;

    const hasData = latestMeta && typeof latestMeta.completionRate === 'number';
    const rate = hasData ? latestMeta.completionRate : 0;
    const completed = hasData ? latestMeta.completedCount : 0;
    const total = hasData ? latestMeta.responsesCount : 0;
    const title = latestMeta?.title || '-';
    const updatedAt = latestMeta?.updatedAt || null;

    if (titleEl) titleEl.textContent = hasData ? `최신 설문: "${title}"` : '최근 설문 데이터가 없습니다.';
    if (completionEl) completionEl.textContent = `완료율: ${rate}%`;
    if (countsEl) countsEl.textContent = `응답수: ${completed} / ${total}`;
    if (updatedEl) {
        if (updatedAt) {
            const d = new Date(updatedAt);
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            updatedEl.textContent = `최근 업데이트: ${y}-${m}-${day}`;
        } else {
            updatedEl.textContent = '최근 업데이트: -';
        }
    }

    if (typeof Chart === 'undefined') return;

    if (latestSurveyDonutChart) {
        latestSurveyDonutChart.destroy();
        latestSurveyDonutChart = null;
    }

    const ctx = canvas.getContext('2d');
    const data = [rate, Math.max(0, 100 - rate)];

    latestSurveyDonutChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['완료', '미완료'],
            datasets: [{
                data,
                backgroundColor: ['#6C5CE7', '#dfe6e9'],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '70%',
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (ctx) => {
                            const label = ctx.label || '';
                            const v = ctx.parsed || 0;
                            return `${label}: ${v}%`;
                        }
                    }
                },
                latestDonutCenter: {
                    text: `${rate}%`
                }
            }
        },
        plugins: [latestDonutCenterPlugin]
    });
}

async function renderMainDashboard() {
    const inProgress = document.getElementById('inProgressQuestContainer');
    const stats = document.getElementById('questStatsContainer');

    try {
        const res = await fetch('/api/surveys', { method: 'GET' });
        const surveys = res.ok ? await res.json() : [];

        if (inProgress) {
            inProgress.innerHTML = '<h3> 설문 관리</h3>';
            if (!surveys.length) {
                inProgress.innerHTML += '<div class="empty-quest-item">최근 작업한 설문이 없습니다.</div>';
            } else {
                const list = document.createElement('div');
                surveys
                    .slice()
                    .sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at))
                    .slice(0, 5)
                    .forEach(row => {
                        const id = row.survey_id || row.id;
                        let questions = row.questions;
                        if (typeof questions === 'string') {
                            try { questions = JSON.parse(questions); } catch { questions = []; }
                        }
                        const item = document.createElement('div');
                        item.className = 'quest-item';
                        item.innerHTML = `
                            <div class="quest-avatar">📝</div>
                            <div class="quest-info">
                                <h4>${row.title || '제목 없음'}</h4>
                                <div class="progress-bar"><div class="progress" style="width:0%"></div></div>
                                <div style="font-size:0.9rem;color:#666;">문항 ${questions?.length || 0}개</div>
                            </div>`;
                        item.addEventListener('click', () => {
                            window.location.href = `dashboard.html?surveyId=${id}`;
                        });
                        list.appendChild(item);
                    });
                inProgress.appendChild(list);
            }
        }

        // 설문 메타 정보 정규화
        const metaSurveys = (surveys || []).map(row => {
            let questions = row.questions;
            if (typeof questions === 'string') {
                try { questions = JSON.parse(questions); } catch { questions = []; }
            }
            return {
                id: row.survey_id || row.id,
                title: row.title || '제목 없음',
                questions: Array.isArray(questions) ? questions : [],
                createdAt: row.created_at || row.createdAt || null,
                updatedAt: row.updated_at || row.updatedAt || row.created_at || null
            };
        });

        let totalResponses = 0;
        const enriched = [];

        for (const s of metaSurveys) {
            const responses = await getNormalizedResultsForDashboard(s.id);
            const { completionRate, completedCount } = calcCompletionSummaryForDashboard(s.questions, responses);
            const info = {
                ...s,
                responsesCount: responses.length,
                completedCount,
                completionRate
            };
            enriched.push(info);
            totalResponses += responses.length;
        }

        const withResponses = enriched.filter(s => s.responsesCount > 0);
        const avgCompletion = withResponses.length
            ? Math.round(withResponses.reduce((sum, s) => sum + (s.completionRate || 0), 0) / withResponses.length)
            : 0;

        const latest = enriched
            .slice()
            .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt))[0] || null;

        if (stats) {
            stats.innerHTML = `
                <h3> 설문 통계 </h3>
                <div class="dashboard-stats-grid">
                    <div class="dashboard-stats-left">
                        <div class="stat-item"><span class="stat-value">${metaSurveys.length}</span><span class="stat-label">설문 개수</span></div>
                        <div class="stat-item"><span class="stat-value">${totalResponses}</span><span class="stat-label">총 응답</span></div>
                        <div class="stat-item"><span class="stat-value">${avgCompletion}%</span><span class="stat-label">평균 완료율</span></div>
                    </div>
                    <div class="latest-survey-card">
                        <div class="latest-survey-header">
                            <div class="latest-survey-title">최근 설문 완료율</div>
                            <div class="latest-survey-main-number">${latest ? latest.completionRate : 0}%</div>
                        </div>
                        <div class="latest-survey-donut-wrap">
                            <canvas id="latestSurveyDonut"></canvas>
                        </div>
                        <div class="latest-survey-meta">
                            <div id="latestSurveyTitle">-</div>
                            <div id="latestSurveyCompletion">완료율: 0%</div>
                            <div id="latestSurveyCounts">응답수: 0 / 0</div>
                            <div id="latestSurveyUpdated">최근 업데이트: -</div>
                        </div>
                    </div>
                </div>
            `;
            stats.style.cursor = 'pointer';
            stats.onclick = () => { window.location.href = 'analytics.html'; };
        }

        renderLatestSurveyDonutCard(latest);
    } catch (e) {
        if (inProgress) inProgress.innerHTML = '<h3>작업 중인 설문</h3><div class="empty-quest-item">API 오류로 목록을 불러오지 못했습니다.</div>';
    }
}

