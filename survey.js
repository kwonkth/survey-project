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

    function renderQuestion() {
        const question = state.survey.questions[state.currentQuestionIndex];
        if (!question) {
            // End of survey
            showCompletionScreen();
            return;
        }

        const questionContainer = document.getElementById('questionContainer');
        const optionsContainer = document.getElementById('optionsContainer');

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

        if (question.type === 'radio' || question.type === 'checkbox') {
            question.options.forEach(optionText => {
                const button = document.createElement('button');
                button.className = 'option-btn';
                button.textContent = optionText;
                button.onclick = () => handleOptionClick(optionText, question.type);
                optionsContainer.appendChild(button);
            });
            // 마지막 문항에는 완료 버튼 제공
            if (isLast) {
                const finishBtn = document.createElement('button');
                finishBtn.id = 'finishSurveyBtn';
                finishBtn.textContent = '설문 완료';
                finishBtn.className = 'submit-btn';
                finishBtn.style.marginTop = '1rem';
                finishBtn.onclick = finalizeSurvey;
                optionsContainer.appendChild(finishBtn);
            }
        } else if (question.type === 'text') {
            const textInput = document.createElement('input');
            textInput.type = 'text';
            textInput.className = 'text-input';
            textInput.placeholder = '답변을 입력하세요...';
            optionsContainer.appendChild(textInput);

            const submitBtn = document.createElement('button');
            submitBtn.textContent = isLast ? '설문 완료' : '다음';
            submitBtn.className = 'submit-btn';
            submitBtn.onclick = () => {
                handleTextSubmit(textInput.value);
                if (isLast) finalizeSurvey();
            };
            optionsContainer.appendChild(submitBtn);
        }
        // Add other question types as needed (e.g., 'scale')
    }

    function handleOptionClick(selectedValue, type) {
        const question = state.survey.questions[state.currentQuestionIndex];
        let currentAnswer = state.answers.find(a => a.questionId === question.id);

        if (type === 'radio') {
            if (!currentAnswer) {
                currentAnswer = { questionId: question.id, value: selectedValue };
                state.answers.push(currentAnswer);
            } else {
                currentAnswer.value = selectedValue;
            }
            // Automatically move to next question for single choice
            moveToNextQuestion();
        } else if (type === 'checkbox') {
            // Logic for checkbox (multi-select) would be more complex
            // For now, treat as single select for simplicity
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
            // For multi-select, we might need an explicit 'Next' button
            // Let's add one for consistency
            let nextBtn = optionsContainer.querySelector('.submit-btn');
            if (!nextBtn) {
                nextBtn = document.createElement('button');
                nextBtn.textContent = '다음';
                nextBtn.className = 'submit-btn';
                nextBtn.style.marginTop = '1rem';
                nextBtn.onclick = () => moveToNextQuestion();
                optionsContainer.appendChild(nextBtn);
            }
        }
    }

    function handleTextSubmit(value) {
        if (!value.trim()) {
            alert('답변을 입력해주세요.');
            return;
        }
        const question = state.survey.questions[state.currentQuestionIndex];
        state.answers.push({ questionId: question.id, value: value.trim() });
        moveToNextQuestion();
    }

    function moveToNextQuestion() {
        state.currentQuestionIndex++;
        renderQuestion();
    }

    function showCompletionScreen() {
        const container = document.querySelector('.mobile-container');
        container.innerHTML = `
            <div id="background"></div>
            <div class="completion-screen">
                <h2>참여해주셔서 감사합니다.</h2>
                <p>모든 답변이 기록되었습니다.</p>
            </div>
        `;
        // 저장은 finalizeSurvey에서 수행됨
    }

    async function finalizeSurvey() {
        try {
            const created_at = new Date().toISOString();
            const result_id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : `r_${Date.now().toString(36)}${Math.random().toString(36).slice(2,8)}`;
            // answers는 [{questionId, value}] 배열 형태로 저장
            await API.postResult({
                result_id,
                survey_id: state.survey.id,
                answers: state.answers,
                created_at
            });
        } catch (e) {
            console.error('응답 저장 중 오류', e);
        } finally {
            showCompletionScreen();
        }
    }

    function displayError(message) {
        const container = document.querySelector('.mobile-container');
        container.innerHTML = `<div class="error-screen"><h2>오류</h2><p>${message}</p></div>`;
    }
});