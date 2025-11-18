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

function ensureDefaultNameQuestion() {
    if (!questionBlocksContainer) return;

    const existing = questionBlocksContainer.querySelector('.question-block[data-default-name="1"]');
    if (existing) return;

    const block = document.createElement('div');
    block.className = 'question-block default-name';
    block.dataset.defaultName = '1';
    block.innerHTML = `
        <div class="question-header">
            <h3>Chapter 1</h3>
            <div class="question-actions">
                <button class="btn-icon">🎨</button>
            </div>
        </div>
        <div class="form-group">
            <label>NPC 대사</label>
            <textarea class="form-control" rows="2">모험가여, 당신의 이름을 알려주세요.</textarea>
        </div>
        <div class="form-group">
            <label>답변 유형</label>
            <select class="form-control">
                <option>주관식 (자유 기록)</option>
                <option>객관식 (단일 선택)</option>
            </select>
        </div>
    `;

    const addBtn = questionBlocksContainer.querySelector('.add-chapter');
    if (addBtn) {
        questionBlocksContainer.insertBefore(block, addBtn);
    } else {
        questionBlocksContainer.appendChild(block);
    }

    updateChapterNumbers();
    validateSurvey();
}


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


/* =======================================================
   설문 템플릿 생성 및 JSON 임포트
======================================================= */
function createSurveyTemplate() {
    return {
        surveys: [
            {
                id: "", // 비워두면 자동 생성됩니다
                title: "예시 퀘스트 제목",
                description: "이곳에 퀘스트 설명을 작성합니다.",
                status: "active", // draft | active | closed
                folderId: null,
                questions: [
                    {
                        id: "", // 비워두면 자동 생성됩니다
                        order: 1,
                        text: "모험가여, 당신의 이름을 알려주세요.",
                        type: "text", // text | radio | checkbox | scale
                        required: true,
                        options: []
                    },
                    {
                        id: "",
                        order: 2,
                        text: "이 퀘스트에 참여하시겠습니까?",
                        type: "radio",
                        required: true,
                        options: ["예", "아니오"]
                    }
                ]
            }
        ]
    };
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

    const indexKey = 'surveyGuide.surveyIndex';
    const indexList = JSON.parse(localStorage.getItem(indexKey) || '[]');
    const now = new Date().toISOString();

    let imported = 0;
    const createdIds = [];

    surveys.forEach((raw) => {
        const surveyId = raw.id && String(raw.id).trim() ? String(raw.id) : `survey_${Date.now().toString(36)}${Math.random().toString(36).slice(2,6)}`;
        const title = String(raw.title || '제목 없음');
        const description = String(raw.description || '');
        const status = ['draft', 'active', 'closed'].includes(raw.status) ? raw.status : 'active';
        const folderId = raw.folderId ?? null;

        // 질문 정규화
        const questions = Array.isArray(raw.questions) ? raw.questions.slice() : [];
        const normalized = questions.map((q, idx) => {
            const qid = q.id && String(q.id).trim() ? String(q.id) : `q_${idx + 1}`;
            const order = Number.isFinite(q.order) ? Number(q.order) : idx + 1;
            const text = String(q.text || '').trim();
            let type = String(q.type || 'text');
            // 타입 정규화 (한글 라벨도 수용)
            if (/객관식/.test(type) && /복수|체크/.test(type)) type = 'checkbox';
            else if (/객관식/.test(type)) type = 'radio';
            else if (/주관식/.test(type)) type = 'text';
            else if (/scale|척도/.test(type)) type = 'scale';
            else if (!['text','radio','checkbox','scale'].includes(type)) type = 'text';

            const required = q.required !== false; // 기본 필수
            const options = Array.isArray(q.options) ? q.options.map(o => String(o)).filter(Boolean) : [];
            return { id: qid, order, text, type, required, options };
        }).filter(q => q.text);

        const surveyData = {
            id: surveyId,
            title,
            description,
            createdAt: now,
            updatedAt: now,
            questions: normalized
        };

        // 인덱스에 추가(중복 id는 대체)
        const existingIdx = indexList.findIndex(s => s.id === surveyId);
        const indexMeta = {
            id: surveyId,
            title,
            createdAt: now,
            updatedAt: now,
            status,
            folderId,
            questions: normalized
        };
        if (existingIdx >= 0) indexList[existingIdx] = indexMeta; else indexList.push(indexMeta);

        localStorage.setItem(`surveyGuide.survey.${surveyId}`, JSON.stringify(surveyData));
        imported += 1;
        createdIds.push(surveyId);
    });

    localStorage.setItem(indexKey, JSON.stringify(indexList));
    localStorage.setItem('surveyGuide.lastCreatedSurvey', indexList[indexList.length - 1]?.id || '');

    // Offer to export imported surveys into a folder's data/ (non-blocking)
    setTimeout(() => {
        if (createdIds.length && window.confirm('가져온 설문을 프로젝트의 data/ 폴더로 저장하시겠습니까?')) {
            exportSurveysToDirectory(createdIds).catch(() => {
                // fallback handled inside
            });
        }
    }, 0);

    return imported;
}
/* =======================================================
   기본 이름 질문 보장 (moved to global scope above)
======================================================= */

    const copyBtn = document.getElementById("copyLinkBtn");
    if (copyBtn) {
        copyBtn.addEventListener("click", async () => {
            const input = document.getElementById("shareLinkInput");
            const text = input?.value || "";
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
                alert("링크 복사에 실패했습니다. 수동으로 복사해주세요.");
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
            const lastId = localStorage.getItem('surveyGuide.lastCreatedSurvey');
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
    ensureDefaultNameQuestion();
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

    // 질문 수집
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

    // 이름 질문(q_name) 자동 선행 삽입 (중복 방지)
    const hasName = collected.some(q => q.id === 'q_name' || q.text.includes('이름'));
    const nameQuestion = {
        id: 'q_name',
        order: 0,
        text: '응답자 이름을 작성해주세요',
        type: 'text',
        required: false,
        options: []
    };
    surveyData.questions = hasName ? collected : [nameQuestion, ...collected.map((q, idx) => ({ ...q, order: idx + 1 }))];

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


// Export helper: write one or more surveys into a chosen directory's data/ (or directly if the chosen dir IS data)
async function exportSurveysToDirectory(surveyIds) {
    if (!Array.isArray(surveyIds) || surveyIds.length === 0) return;
    if (!window.showDirectoryPicker) throw new Error('Directory picker not supported');

    const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
    // If the selected directory is already "data", use it. Otherwise, create/get a data subfolder.
    let dataDirHandle = dirHandle;
    try {
        const name = (dataDirHandle && typeof dataDirHandle.name === 'string') ? dataDirHandle.name.toLowerCase() : '';
        if (name !== 'data') {
            dataDirHandle = await dirHandle.getDirectoryHandle('data', { create: true });
        }
    } catch (e) {
        dataDirHandle = await dirHandle.getDirectoryHandle('data', { create: true });
    }

    for (const id of surveyIds) {
        let jsonStr = localStorage.getItem(`surveyGuide.survey.${id}`);
        if (!jsonStr) {
            const indexList = JSON.parse(localStorage.getItem('surveyGuide.surveyIndex') || '[]');
            const meta = indexList.find(i => i.id === id) || {};
            jsonStr = JSON.stringify({ id, title: meta.title || '', questions: meta.questions || [] }, null, 2);
        }
        const fileHandle = await dataDirHandle.getFileHandle(`${id}.json`, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(new Blob([jsonStr], { type: 'application/json;charset=utf-8' }));
        await writable.close();
    }
}


/* =======================================================
   대시보드(메인 index.html) 렌더링
======================================================= */
function renderMainDashboard() {
    const indexKey = 'surveyGuide.surveyIndex';
    const surveys = JSON.parse(localStorage.getItem(indexKey) || '[]');

    // 작업 중인 퀘스트
    const inProgress = document.getElementById('inProgressQuestContainer');
    if (inProgress) {
        inProgress.innerHTML = '<h3>작업 중인 퀘스트</h3>';
        if (surveys.length === 0) {
            inProgress.innerHTML += '<div class="empty-quest-item">최근 작업한 설문이 없습니다.</div>';
        } else {
            const list = document.createElement('div');
            surveys
                .slice()
                .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt))
                .slice(0, 5)
                .forEach(meta => {
                    const responses = JSON.parse(localStorage.getItem(`surveyGuide.responses.${meta.id}`) || '[]');
                    const item = document.createElement('div');
                    item.className = 'quest-item';
                    item.innerHTML = `
                        <div class="quest-avatar">📝</div>
                        <div class="quest-info">
                            <h4>${meta.title || '제목 없음'}</h4>
                            <div class="progress-bar"><div class="progress" style="width:${calcCompletion(meta, responses)}%"></div></div>
                            <div style="font-size:0.9rem;color:#666;">문항 ${meta.questions?.length || 0}개 · 응답 ${responses.length}건</div>
                        </div>`;
                    item.addEventListener('click', () => {
                        window.location.href = `dashboard.html?surveyId=${meta.id}`;
                    });
                    list.appendChild(item);
                });
            inProgress.appendChild(list);
        }
    }

    // 퀘스트 통계
    const stats = document.getElementById('questStatsContainer');
    if (stats) {
        let totalResponses = 0;
        let totalCompletionPct = 0;
        let counted = 0;
        surveys.forEach(meta => {
            const responses = JSON.parse(localStorage.getItem(`surveyGuide.responses.${meta.id}`) || '[]');
            totalResponses += responses.length;
            if (responses.length > 0) {
                totalCompletionPct += calcCompletion(meta, responses);
                counted += 1;
            }
        });

        const avgCompletion = counted ? Math.round(totalCompletionPct / counted) : 0;
        stats.innerHTML = `
            <h3>퀘스트 통계</h3>
            <div class="stat-item"><span class="stat-value">${surveys.length}</span><span class="stat-label">총 퀘스트</span></div>
            <div class="stat-item"><span class="stat-value">${totalResponses}</span><span class="stat-label">총 응답</span></div>
            <div class="stat-item"><span class="stat-value">${avgCompletion}%</span><span class="stat-label">평균 완료율</span></div>
        `;
        stats.style.cursor = 'pointer';
        stats.onclick = () => { window.location.href = 'analytics.html'; };
    }

    function calcCompletion(meta, responses) {
        const qCount = meta.questions?.length || 0;
        if (!responses.length || !qCount) return 0;
        const completed = responses.filter(r => Array.isArray(r.answers) && r.answers.length === qCount).length;
        return Math.round((completed / responses.length) * 100);
    }
}

