// DOM Elements
const createNewSurveyBtn = document.getElementById('createNewSurvey');
const surveyModal = document.getElementById('surveyModal');
const closeModal = document.querySelector('.close');
const nextStepBtns = document.querySelectorAll('.next-step');
const prevStepBtns = document.querySelectorAll('.prev-step');
const completeSurveyBtn = document.getElementById('completeSurvey');
const completionModal = document.getElementById('completionModal');
const closeCompletionBtn = document.getElementById('closeCompletion');
const steps = document.querySelectorAll('.step');
const stepContents = document.querySelectorAll('.step-content');

// Show survey creation modal
createNewSurveyBtn.addEventListener('click', () => {
    surveyModal.style.display = 'block';
    document.body.style.overflow = 'hidden';
    // Reset to first step
    setActiveStep(1);
});

// Close modals
closeModal.addEventListener('click', () => {
    surveyModal.style.display = 'none';
    document.body.style.overflow = 'auto';
});

closeCompletionBtn.addEventListener('click', () => {
    completionModal.style.display = 'none';
    surveyModal.style.display = 'none';
    document.body.style.overflow = 'auto';
});

// Close modal when clicking outside
window.addEventListener('click', (e) => {
    if (e.target === surveyModal) {
        surveyModal.style.display = 'none';
        document.body.style.overflow = 'auto';
    }
    if (e.target === completionModal) {
        completionModal.style.display = 'none';
        document.body.style.overflow = 'auto';
    }
});

// Navigation between steps
nextStepBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const nextStep = parseInt(btn.getAttribute('data-next'));
        setActiveStep(nextStep);
    });
});

prevStepBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const prevStep = parseInt(btn.getAttribute('data-prev'));
        setActiveStep(prevStep);
    });
});

// Complete survey
completeSurveyBtn.addEventListener('click', () => {
    console.log('Complete survey button clicked'); // Debug log
    
    // Get all survey data
    const surveyData = {
        title: document.getElementById('surveyTitle')?.value || '제목 없는 설문',
        description: document.getElementById('surveyDescription')?.value || '',
        questions: []
    };

    // Get all questions
    const questionBlocks = document.querySelectorAll('.question-block');
    questionBlocks.forEach(block => {
        const questionText = block.querySelector('.question-text')?.value || '질문 없음';
        const questionType = block.querySelector('.question-type')?.value || 'text';
        const isRequired = block.querySelector('.question-required')?.checked || false;
        
        const question = {
            text: questionText,
            type: questionType,
            required: isRequired,
            options: []
        };

        // Get options for multiple choice questions
        if (questionType === 'radio' || questionType === 'checkbox') {
            const optionInputs = block.querySelectorAll('.option-input');
            optionInputs.forEach(input => {
                if (input?.value?.trim() !== '') {
                    question.options.push(input.value.trim());
                }
            });
        }

        surveyData.questions.push(question);
    });

    console.log('Survey data:', surveyData); // Debug log

    // Generate a random survey ID
    const surveyId = 'survey_' + Math.random().toString(36).substring(2, 11);
    // Save survey data to localStorage
    localStorage.setItem(surveyId, JSON.stringify(surveyData));

    // Encode survey data for URL
    const encodedData = encodeURIComponent(JSON.stringify(surveyData));
    
    // Create survey URL
    const baseUrl = window.location.href.split('?')[0].replace('index.html', '');
    const surveyUrl = `${baseUrl}survey.html?data=${encodedData}`;
    
    // Show completion modal with the shareable link
    const completionModal = document.getElementById('completionModal');
    if (completionModal) {
        console.log('Showing completion modal'); // Debug log
        completionModal.style.display = 'block';
        
        // Update the share link in the completion modal
        const shareLinkInput = document.querySelector('.share-link input');
        if (shareLinkInput) {
            shareLinkInput.value = surveyUrl;
            shareLinkInput.select();
        }
        
        // Generate QR code for the survey
        const qrCodeImg = document.querySelector('.qr-code img');
        if (qrCodeImg) {
            qrCodeImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(surveyUrl)}`;
        }
    } else {
        console.error('Completion modal not found');
    }
});

// Set active step
function setActiveStep(stepNumber) {
    // Update step indicators
    steps.forEach(step => {
        const stepValue = parseInt(step.getAttribute('data-step'));
        if (stepValue === stepNumber) {
            step.classList.add('active');
        } else if (stepValue < stepNumber) {
            step.classList.remove('active');
            step.classList.add('completed');
        } else {
            step.classList.remove('active', 'completed');
        }
    });
    
    // Show active step content
    stepContents.forEach(content => {
        content.classList.remove('active');
        if (content.id === `step${stepNumber}`) {
            content.classList.add('active');
            content.style.animation = 'fadeIn 0.3s ease-out';
        }
    });
    
    // Scroll to top of modal
    surveyModal.scrollTo(0, 0);
}

// Avatar selection
const avatarOptions = document.querySelectorAll('.avatar-option');
avatarOptions.forEach(option => {
    option.addEventListener('click', () => {
        // Remove selected class from all options
        avatarOptions.forEach(opt => opt.classList.remove('selected'));
        // Add selected class to clicked option
        option.classList.add('selected');
    });
});

// Theme selection
const themeOptions = document.querySelectorAll('.theme-option');
themeOptions.forEach(option => {
    option.addEventListener('click', () => {
        // Remove selected class from all options
        themeOptions.forEach(opt => opt.classList.remove('selected'));
        // Add selected class to clicked option
        option.classList.add('selected');
    });
});

// Add new question block
const addChapterBtn = document.querySelector('.add-chapter');
const questionBlocksContainer = document.querySelector('#step2');

addChapterBtn.addEventListener('click', (e) => {
    e.preventDefault();
    const chapterCount = document.querySelectorAll('.question-block').length + 1;
    
    const newQuestionBlock = document.createElement('div');
    newQuestionBlock.className = 'question-block fade-in';
    newQuestionBlock.innerHTML = `
        <div class="question-header">
            <h3>Chapter ${chapterCount}: 새로운 챕터</h3>
            <div class="question-actions">
                <button class="btn-icon" title="배경 변경">🎨</button>
                <button class="btn-icon" title="삭제">🗑️</button>
            </div>
        </div>
        <div class="form-group">
            <label>NPC 대사 (질문)</label>
            <textarea class="form-control" rows="2" placeholder="예: 안녕하세요, 모험가님! 새로운 퀘스트를 시작해볼까요?"></textarea>
        </div>
        <div class="form-group">
            <label>효과음</label>
            <select class="form-control">
                <option>기본 효과음</option>
                <option>마법 효과음</option>
                <option>전투 효과음</option>
                <option>없음</option>
            </select>
        </div>
        <div class="form-group">
            <label>답변 유형</label>
            <select class="form-control">
                <option>객관식 (단일 선택)</option>
                <option>주관식 (자유 기록)</option>
                <option>척도형 (5점/7점)</option>
            </select>
        </div>
        <div class="answer-options">
            <div class="answer-option">
                <input type="text" class="form-control" value="예" placeholder="선택지 1">
                <button class="btn-icon">🗑️</button>
            </div>
            <div class="answer-option">
                <input type="text" class="form-control" value="아니오" placeholder="선택지 2">
                <button class="btn-icon">🗑️</button>
            </div>
            <button class="btn-text">+ 선택지 추가</button>
        </div>
    `;
    
    // Insert the new question block before the add chapter button
    questionBlocksContainer.insertBefore(newQuestionBlock, addChapterBtn);
    
    // Add event listeners to the new delete button
    const deleteBtn = newQuestionBlock.querySelector('.question-actions .btn-icon:last-child');
    deleteBtn.addEventListener('click', () => {
        newQuestionBlock.style.animation = 'fadeOut 0.3s ease-out';
        setTimeout(() => {
            newQuestionBlock.remove();
            // Update chapter numbers
            updateChapterNumbers();
        }, 300);
    });
    
    // Add event listener for adding new answer options
    const addOptionBtn = newQuestionBlock.querySelector('.btn-text');
    addOptionBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const answerOptions = newQuestionBlock.querySelector('.answer-options');
        const optionCount = answerOptions.querySelectorAll('.answer-option').length + 1;
        
        const newOption = document.createElement('div');
        newOption.className = 'answer-option';
        newOption.innerHTML = `
            <input type="text" class="form-control" placeholder="선택지 ${optionCount}">
            <button class="btn-icon">🗑️</button>
        `;
        
        // Insert before the add option button
        answerOptions.insertBefore(newOption, addOptionBtn);
        
        // Add event listener to the delete button of the new option
        const deleteOptionBtn = newOption.querySelector('.btn-icon');
        deleteOptionBtn.addEventListener('click', () => {
            newOption.remove();
        });
    });
    
    // Scroll to the new question block
    newQuestionBlock.scrollIntoView({ behavior: 'smooth' });
});

// Update chapter numbers
function updateChapterNumbers() {
    const questionBlocks = document.querySelectorAll('.question-block');
    questionBlocks.forEach((block, index) => {
        const header = block.querySelector('h3');
        if (header) {
            header.textContent = `Chapter ${index + 1}: ${header.textContent.split(':').pop()}`;
        }
    });
}

// Copy survey link to clipboard
document.querySelector('.share-link button').addEventListener('click', () => {
    const linkInput = document.querySelector('.share-link input');
    linkInput.select();
    document.execCommand('copy');
    
    // Show copied feedback
    const button = document.querySelector('.share-link button');
    const originalText = button.innerHTML;
    button.innerHTML = '✓ 복사됨!';
    button.style.backgroundColor = '#4CAF50';
    
    setTimeout(() => {
        button.innerHTML = originalText;
        button.style.backgroundColor = '';
    }, 2000);
});

// Add fadeIn animation to CSS
const style = document.createElement('style');
style.textContent = `
    @keyframes fadeIn {
        from { opacity: 0; transform: translateY(10px); }
        to { opacity: 1; transform: translateY(0); }
    }
    
    @keyframes fadeOut {
        from { opacity: 1; transform: translateY(0); }
        to { opacity: 0; transform: translateY(10px); }
    }
    
    .fade-in {
        animation: fadeIn 0.3s ease-out forwards;
    }
`;
document.head.appendChild(style);
