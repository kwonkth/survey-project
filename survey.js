document.addEventListener('DOMContentLoaded', () => {
    const state = {
        survey: null,
        currentQuestionIndex: 0,
        answers: []
    };

    const API = {
        async getSurvey(id) {
            const res = await fetch(`/api/surveys/${encodeURIComponent(id)}`, { method: 'GET' });
            if (!res.ok) throw new Error(`GET /api/surveys/${id} ${res.status}`);
            return res.json();
        },
        async postResult(payload) {
            const res = await fetch('/api/results', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!res.ok) throw new Error(`POST /api/results ${res.status}`);
            return res.json();
        }
    };

    // 기존 설문에서 저장된 한글 라벨 등의 type 값을 'radio' | 'checkbox' | 'text' 로 정규화
    function normalizeQuestionType(raw) {
        const t = String(raw || '').toLowerCase();
        if (t.includes('checkbox') || t.includes('체크') || t.includes('복수') || t.includes('다중')) return 'checkbox';
        if (t.includes('radio') || t.includes('객관') || t.includes('단일') || t.includes('선다')) return 'radio';
        if (t.includes('text') || t.includes('주관') || t.includes('서술')) return 'text';
        // 알 수 없는 타입은 기본적으로 텍스트 질문으로 처리
        return 'text';
    }

    const params = new URLSearchParams(window.location.search);
    const surveyId = params.get('surveyId');
    const storyFile = params.get('storyFile');

    if (!surveyId) {
        displayError('잘못된 설문 링크입니다.');
        return;
    }

    (async () => {
        try {
            const found = await API.getSurvey(surveyId);
            if (!found || !(found.survey_id || found.id)) {
                displayError('설문을 찾을 수 없습니다.');
                return;
            }
            // Map to expected shape (questions may be TEXT JSON)
            let questions = found.questions;
            if (typeof questions === 'string') {
                try { questions = JSON.parse(questions); } catch { questions = []; }
            }
            state.survey = {
                id: found.survey_id || found.id,
                title: found.title || '-',
                description: found.description || '',
                questions: questions || [],
            };
            await initializeStoryAndRender();
        } catch (e) {
            console.error('Failed to load survey from API', e);
            displayError('설문을 불러오는 데 실패했습니다.');
        }
    })();

    async function initializeStoryAndRender() {
        try {
            if (storyFile && window.StoryEngine) {
                await window.StoryEngine.loadStory(storyFile);
            }
        } catch (_) {}
        renderQuestion();
    }

    function isQuestionVisible(question, answers) {
        if (!question || !question.visibility) return true;
        const parentId = question.visibility.parentId;
        const expected = question.visibility.value;
        if (!parentId || expected == null) return true;

        const parentAnswer = answers.find(a => a.questionId === parentId);
        if (!parentAnswer) return false;

        const v = parentAnswer.value;
        if (Array.isArray(v)) {
            return v.includes(expected);
        }
        return v === expected;
    }

    function findNextVisibleQuestionIndex(fromIndex) {
        const questions = Array.isArray(state.survey?.questions) ? state.survey.questions : [];
        for (let i = fromIndex; i < questions.length; i++) {
            if (isQuestionVisible(questions[i], state.answers)) {
                return i;
            }
        }
        return questions.length;
    }

    function renderQuestion() {
        const questions = Array.isArray(state.survey?.questions) ? state.survey.questions : [];
        if (!questions.length) {
            showCompletionScreen();
            return;
        }

        if (state.currentQuestionIndex < 0) state.currentQuestionIndex = 0;
        if (state.currentQuestionIndex >= questions.length) {
            showCompletionScreen();
            return;
        }

        let question = questions[state.currentQuestionIndex];

        // 현재 질문이 visibility 조건을 만족하지 않으면 다음 보이는 질문으로 건너뛴다.
        if (!isQuestionVisible(question, state.answers)) {
            const nextIndex = findNextVisibleQuestionIndex(state.currentQuestionIndex + 1);
            if (nextIndex >= questions.length) {
                showCompletionScreen();
                return;
            }
            state.currentQuestionIndex = nextIndex;
            question = questions[state.currentQuestionIndex];
        }

        // ID 없으면 q_번호 형태로 보정
        if (!question.id) {
            question.id = `q_${state.currentQuestionIndex + 1}`;
        }

        const questionContainer = document.getElementById('questionContainer');
        const optionsContainer = document.getElementById('optionsContainer');
        const progressEl = document.getElementById('surveyHeaderProgress');

        // 진행 상황 표시: 총 N문항 중 M번째
        if (progressEl && state.survey.questions.length) {
            const total = state.survey.questions.length;
            const current = state.currentQuestionIndex + 1;
            progressEl.textContent = `${total}문항 중 ${current}번째`;
        }

        questionContainer.innerHTML = `<p>${question.text}</p>`;
        optionsContainer.innerHTML = '';

        // Apply optional per-question background/trigger if provided
        try {
            if (window.StoryEngine) {
                if (question.background) {
                    window.StoryEngine.setBackground(question.background);
                }
                if (question.trigger) {
                    window.StoryEngine.handleTrigger(question.trigger, { question });
                }
            }
        } catch (_) {}

        const isLast = state.currentQuestionIndex === state.survey.questions.length - 1;
        const qType = normalizeQuestionType(question.type);
        // 정규화된 타입을 다시 question.type 에도 반영해 두면 이후 로직/analytics에서도 일관되게 사용 가능
        question.type = qType;

        if (qType === 'radio' || qType === 'checkbox') {
            const opts = Array.isArray(question.options) ? question.options : [];
            opts.forEach(optionText => {
                const button = document.createElement('button');
                button.className = 'option-btn';
                button.textContent = optionText;
                button.onclick = () => handleOptionClick(optionText, qType, button, optionsContainer);
                optionsContainer.appendChild(button);
            });

            if (qType === 'checkbox') {
                const maxSel = parseInt(question.maxSelection, 10);
                if (Number.isFinite(maxSel) && maxSel > 0) {
                    const hint = document.createElement('div');
                    hint.textContent = `최대 ${maxSel}개까지 선택할 수 있습니다.`;
                    hint.style.marginTop = '0.5rem';
                    hint.style.fontSize = '0.9rem';
                    hint.style.color = '#ffeaa7';
                    optionsContainer.appendChild(hint);
                }
            }
        } else if (qType === 'text') {
            const textInput = document.createElement('input');
            textInput.type = 'text';
            textInput.className = 'text-input';
            textInput.placeholder = '답변을 입력하세요...';
            optionsContainer.appendChild(textInput);
        }
        // 공통 "다음" 버튼: 항상 표시되며 답변 유효성 검사 후 다음 단계로 이동
        const nextBtn = document.createElement('button');
        nextBtn.textContent = '다음';
        nextBtn.className = 'submit-btn';
        nextBtn.onclick = () => {
            handleNext(question, qType, optionsContainer);
        };
        optionsContainer.appendChild(nextBtn);
        // Add other question types as needed (e.g., 'scale')
    }

    function handleOptionClick(selectedValue, type, button, optionsContainer) {
        const question = state.survey.questions[state.currentQuestionIndex];
        if (!question.id) {
            question.id = `q_${state.currentQuestionIndex + 1}`;
        }
        const isLast = state.currentQuestionIndex === state.survey.questions.length - 1;
        let currentAnswer = state.answers.find(a => a.questionId === question.id);

        if (type === 'radio') {
            // 단일 선택: 다른 버튼 선택 해제, 현재 버튼만 강조
            if (optionsContainer) {
                optionsContainer.querySelectorAll('.option-btn').forEach(btn => btn.classList.remove('selected'));
            }
            if (button) {
                button.classList.add('selected');
            }
            if (!currentAnswer) {
                currentAnswer = { questionId: question.id, value: selectedValue };
                state.answers.push(currentAnswer);
            } else {
                currentAnswer.value = selectedValue;
            }
        } else if (type === 'checkbox') {
            const maxSel = parseInt(question.maxSelection, 10);
            const hasLimit = Number.isFinite(maxSel) && maxSel > 0;

            if (button) {
                const willSelect = !button.classList.contains('selected');
                if (willSelect && hasLimit && optionsContainer) {
                    const selectedCount = optionsContainer.querySelectorAll('.option-btn.selected').length;
                    if (selectedCount >= maxSel) {
                        alert(`최대 ${maxSel}개까지 선택할 수 있습니다.`);
                        return;
                    }
                }
                button.classList.toggle('selected');
            }
            if (!currentAnswer) {
                currentAnswer = { questionId: question.id, value: [selectedValue] };
                state.answers.push(currentAnswer);
            } else {
                // Simple toggle for now
                if (currentAnswer.value.includes(selectedValue)) {
                    currentAnswer.value = currentAnswer.value.filter(v => v !== selectedValue);
                } else {
                    currentAnswer.value.push(selectedValue);
                }
            }
        }
    }

    function handleNext(question, type, optionsContainer) {
        if (!question.id) {
            question.id = `q_${state.currentQuestionIndex + 1}`;
        }

        let currentAnswer = state.answers.find(a => a.questionId === question.id);

        if (type === 'text') {
            const input = optionsContainer ? optionsContainer.querySelector('.text-input') : null;
            const value = input ? input.value.trim() : '';
            if (!value) {
                alert('답변을 선택 (서술형일시 입력)해주세요.');
                return;
            }
            if (!currentAnswer) {
                currentAnswer = { questionId: question.id, value };
                state.answers.push(currentAnswer);
            } else {
                currentAnswer.value = value;
            }
        } else if (type === 'radio') {
            if (!currentAnswer || !currentAnswer.value) {
                alert('답변을 선택 (서술형일시 입력)해주세요.');
                return;
            }
        } else if (type === 'checkbox') {
            const arr = currentAnswer && Array.isArray(currentAnswer.value) ? currentAnswer.value : [];
            if (!arr.length) {
                alert('답변을 선택 (서술형일시 입력)해주세요.');
                return;
            }
        }

        const isLast = state.currentQuestionIndex === state.survey.questions.length - 1;
        if (isLast) {
            showCompletionScreen();
        } else {
            moveToNextQuestion();
        }
    }

    function handleTextSubmit(value) {
        if (!value.trim()) {
            alert('답변을 입력해주세요.');
            return;
        }
        const question = state.survey.questions[state.currentQuestionIndex];
        if (!question.id) {
            question.id = `q_${state.currentQuestionIndex + 1}`;
        }
        state.answers.push({ questionId: question.id, value: value.trim() });
        const isLast = state.currentQuestionIndex === state.survey.questions.length - 1;
        if (isLast) {
            showCompletionScreen();
        } else {
            moveToNextQuestion();
        }
    }

    function moveToNextQuestion() {
        const nextIndex = findNextVisibleQuestionIndex(state.currentQuestionIndex + 1);
        state.currentQuestionIndex = nextIndex;
        renderQuestion();
    }

    function showCompletionScreen() {
        const container = document.querySelector('.mobile-container');
        console.log('[survey] showCompletionScreen called, answers =', state.answers);
        container.innerHTML = `
            <div id="background"></div>
            <div id="content">
                <div class="completion-screen">
                    <h2>참여해주셔서 감사합니다.</h2>
                    <p id="completionStatus">응답을 저장하는 중입니다...</p>
                </div>
            </div>
        `;

        finalizeSurvey();
    }

    async function finalizeSurvey() {
        console.log('[survey] finalizeSurvey start, surveyId =', state.survey && state.survey.id, 'answers =', state.answers);
        const statusEl = document.getElementById('completionStatus');
        if (statusEl) {
            statusEl.textContent = '응답을 저장하는 중입니다...';
        }

        try {
            const created_at = new Date().toISOString();
            const result_id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : `r_${Date.now().toString(36)}${Math.random().toString(36).slice(2,8)}`;
            const payload = {
                result_id,
                survey_id: state.survey.id,
                answers: state.answers,
                created_at
            };
            console.log('[survey] about to POST /api/results', payload);
            // answers는 [{questionId, value}] 배열 형태로 저장
            await API.postResult(payload);
            console.log('[survey] POST /api/results success');
            if (statusEl) {
                statusEl.textContent = '응답이 저장되었습니다. 감사합니다.';
            }
        } catch (e) {
            console.error('[survey] 응답 저장 중 오류', e);
            if (statusEl) {
                statusEl.textContent = '응답 저장 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.';
            }
        }
    }

    function displayError(message) {
        const container = document.querySelector('.mobile-container');
        container.innerHTML = `<div class="error-screen"><h2>오류</h2><p>${message}</p></div>`;
    }
    
});