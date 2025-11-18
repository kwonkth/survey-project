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
    const aiQuestionCountInput = document.getElementById('aiQuestionCountInput');
    const aiQuestionTypeSelect = document.getElementById('aiQuestionTypeSelect');
    const aiStyleSelect = document.getElementById('aiStyleSelect');
    const aiIncludeNameInput = document.getElementById('aiIncludeNameInput');
    const aiMandatoryQuestionsInput = document.getElementById('aiMandatoryQuestionsInput');

    const aiPreviewModal = document.getElementById('aiPreviewModal');
    const aiPreviewClose = document.getElementById('aiPreviewClose');
    const aiPreviewCancelBtn = document.getElementById('aiPreviewCancelBtn');
    const aiPreviewSaveBtn = document.getElementById('aiPreviewSaveBtn');
    const aiPreviewModalTitle = document.getElementById('aiPreviewModalTitle');
    const aiPreviewModalDesc = document.getElementById('aiPreviewModalDesc');
    const aiPreviewQuestionContainer = document.getElementById('aiPreviewQuestionContainer');

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

        // 질문 목록 렌더링 (간단 편집 UI)
        const questions = Array.isArray(aiGeneratedSurvey.questions) ? aiGeneratedSurvey.questions : [];
        aiPreviewQuestionContainer.innerHTML = '';

        questions.forEach((q, index) => {
            const wrapper = document.createElement('div');
            wrapper.className = 'ai-preview-question';

            const safeText = String(q.text || '').trim();
            const safeType = ['radio', 'checkbox', 'text'].includes(q.type) ? q.type : 'text';
            const safeOptions = Array.isArray(q.options) ? q.options.map(o => String(o)) : [];
            const isRequired = q.required !== false;

            wrapper.innerHTML = `
                <div class="form-group">
                    <label>Q${index + 1}. 질문 내용</label>
                    <input type="text" class="form-control ai-q-text" value="${safeText.replace(/"/g, '&quot;')}">
                </div>
                <div class="form-group">
                    <label>질문 유형</label>
                    <select class="form-control ai-q-type">
                        <option value="radio" ${safeType === 'radio' ? 'selected' : ''}>객관식 (단일 선택)</option>
                        <option value="checkbox" ${safeType === 'checkbox' ? 'selected' : ''}>객관식 (복수 선택)</option>
                        <option value="text" ${safeType === 'text' ? 'selected' : ''}>서술형</option>
                    </select>
                </div>
                <div class="form-group ai-q-options-group" ${safeType === 'text' ? 'style="display:none;"' : ''}>
                    <label>보기 옵션 (줄바꿈으로 구분)</label>
                    <textarea class="form-control ai-q-options" rows="3">${safeOptions.join('\n')}</textarea>
                </div>
                <div class="form-group" style="display:flex;align-items:center;gap:8px;">
                    <input type="checkbox" class="ai-q-required" ${isRequired ? 'checked' : ''} />
                    <span>필수 질문</span>
                </div>
            `;

            // 유형 변경 시 옵션 영역 토글
            const typeSelect = wrapper.querySelector('.ai-q-type');
            const optionsGroup = wrapper.querySelector('.ai-q-options-group');
            typeSelect.addEventListener('change', () => {
                if (typeSelect.value === 'text') {
                    optionsGroup.style.display = 'none';
                } else {
                    optionsGroup.style.display = '';
                }
            });

            aiPreviewQuestionContainer.appendChild(wrapper);
        });

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

    if (aiGenerateBtn) {
        aiGenerateBtn.addEventListener('click', async () => {
            const topic = aiTopicInput?.value?.trim();
            const questionCount = parseInt(aiQuestionCountInput?.value || '5', 10);
            const style_id = aiStyleSelect?.value || '';
            const includeNameQuestion = !!aiIncludeNameInput?.checked;

            const questionTypeLabel = aiQuestionTypeSelect?.value || '혼합';
            let questionTypeMode = 'auto';
            if (questionTypeLabel.includes('2지선다')) questionTypeMode = 'fixed_two';
            else if (questionTypeLabel.includes('4지선다')) questionTypeMode = 'fixed_four';
            else if (questionTypeLabel.includes('혼합')) questionTypeMode = 'mixed';

            const styleLabel = aiStyleSelect?.selectedOptions?.[0]?.textContent?.trim() || '';
            const mandatoryRaw = aiMandatoryQuestionsInput?.value || '';
            const mandatoryQuestions = mandatoryRaw
                .split('\n')
                .map(v => v.trim())
                .filter(Boolean);

            if (!topic) {
                alert('설문 주제를 입력해주세요.');
                return;
            }

            if (!Number.isFinite(questionCount) || questionCount < 1) {
                alert('문항 수를 올바르게 입력해주세요.');
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
                        style: styleLabel,
                        style_id,
                        includeNameQuestion,
                        questionTypeMode,
                        mandatoryQuestions
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

    if (aiPreviewSaveBtn) {
        aiPreviewSaveBtn.addEventListener('click', async () => {
            if (!aiGeneratedSurvey) {
                alert('먼저 AI로 설문을 생성해주세요.');
                return;
            }

            // 미리보기에서 수정된 값으로 질문 재구성
            const rows = aiPreviewQuestionContainer?.querySelectorAll('.ai-preview-question') || [];
            const updatedQuestions = [];

            rows.forEach((row, index) => {
                const textInput = row.querySelector('.ai-q-text');
                const typeSelect = row.querySelector('.ai-q-type');
                const optionsTextarea = row.querySelector('.ai-q-options');
                const requiredCheckbox = row.querySelector('.ai-q-required');

                const base = Array.isArray(aiGeneratedSurvey.questions) ? aiGeneratedSurvey.questions[index] || {} : {};
                const type = typeSelect?.value || base.type || 'text';
                const text = textInput?.value?.trim() || base.text || `문항 ${index + 1}`;
                let options = [];
                if (type === 'radio' || type === 'checkbox') {
                    const raw = optionsTextarea?.value || '';
                    options = raw.split('\n').map(v => v.trim()).filter(Boolean);
                }
                const required = !!requiredCheckbox?.checked;

                updatedQuestions.push({
                    id: base.id || `q_${index + 1}`,
                    order: index + 1,
                    text,
                    type,
                    required,
                    options
                });
            });

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
                    status: 'draft',
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
            return { id: qid, order, text, type, required, options };
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
});


// Cloudflare API client
const API = {
    async postSurvey(payload) {
        const res = await fetch('/api/surveys', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error(`POST /api/surveys ${res.status}`);
        return res.json();
    }
};

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
            <label>NPC 대사</label>
            <textarea class="form-control" rows="2"></textarea>
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
======================================================= */
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

        if (stats) {
            stats.innerHTML = `
                <h3> 설문 통계 </h3>
                <div class="stat-item"><span class="stat-value">${surveys.length}</span><span class="stat-label">총 퀘스트</span></div>
                <div class="stat-item"><span class="stat-value">0</span><span class="stat-label">총 응답</span></div>
                <div class="stat-item"><span class="stat-value">0%</span><span class="stat-label">평균 완료율</span></div>
            `;
            stats.style.cursor = 'pointer';
            stats.onclick = () => { window.location.href = 'analytics.html'; };
        }
    } catch (e) {
        if (inProgress) inProgress.innerHTML = '<h3>작업 중인 퀘스트</h3><div class="empty-quest-item">API 오류로 목록을 불러오지 못했습니다.</div>';
    }
}

