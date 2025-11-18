document.addEventListener('DOMContentLoaded', () => {
    if (typeof Chart !== 'undefined' && typeof ChartDataLabels !== 'undefined') {
        Chart.register(ChartDataLabels);
    }

    // No persistence; folders are in-memory defaults only
    const API = {
        async getSurveys() {
            const res = await fetch('/api/surveys', { method: 'GET' });
            if (!res.ok) throw new Error(`GET /api/surveys ${res.status}`);
            return res.json();
        },
        async deleteSurvey(id) {
            const res = await fetch(`/api/surveys/${encodeURIComponent(id)}`, { method: 'DELETE' });
            if (!res.ok) throw new Error(`DELETE /api/surveys/${id} ${res.status}`);
            return res.json();
        },
        async getResults(id) {
            const res = await fetch(`/api/results/${encodeURIComponent(id)}`, { method: 'GET' });
            if (!res.ok) throw new Error(`GET /api/results/${id} ${res.status}`);
            return res.json();
        }
    };

    const state = {
        surveys: [],
        surveyMap: new Map(),
        resultCounts: new Map(),
        folders: [], // in-memory only
        folderMap: new Map(),
        selectedFolder: 'all',
        currentFilter: 'all',
        currentSort: 'recent',
        chartInstance: null
    };

    async function init() {
        loadFolders();
        await refreshSurveys();
        renderFolders();
        renderSurveys();
        updateAnalytics();

        // Check for surveyId from URL to highlight a specific survey
        const params = new URLSearchParams(window.location.search);
        const surveyId = params.get('surveyId');
        if (surveyId && state.surveyMap.has(surveyId)) {
            // Ensure the survey is visible by selecting the 'all' folder
            selectFolder('all');
            // Highlight the specific survey card
            highlightSurveyCard(surveyId);
        }
    }

    function loadFolders() {
        state.folders = getDefaultFolders();
        state.folderMap.clear();
        state.folders.forEach(folder => state.folderMap.set(folder.id, folder));
    }

    function getDefaultFolders() {
        return [
            { id: 'all', name: '모든 설문', icon: '📋', color: '#4a6baf' },
            { id: 'draft', name: '작성 중', icon: '✏️', color: '#f39c12' },
            { id: 'active', name: '배포 중', icon: '🚀', color: '#27ae60' },
            { id: 'closed', name: '응답 종료', icon: '✅', color: '#95a5a6' }
        ];
    }

    async function refreshSurveys() {
        try {
            const list = await API.getSurveys();
            // Map API shape to UI shape
            state.surveys = (list || []).map(row => {
                let questions = row.questions;
                if (typeof questions === 'string') {
                    try { questions = JSON.parse(questions); } catch { questions = []; }
                }
                return {
                    id: row.survey_id || row.id,
                    title: row.title || '-',
                    description: row.description || '',
                    createdAt: row.created_at || row.createdAt || null,
                    updatedAt: row.updated_at || row.updatedAt || null,
                    status: row.status || 'active',
                    folderId: row.folder_id || null,
                    questions: questions || []
                };
            });
            state.surveyMap.clear();
            state.surveys.forEach(s => state.surveyMap.set(s.id, s));
            await preloadResultsCounts(state.surveys.map(s => s.id));
        } catch (e) {
            console.error('설문 목록을 불러오는 중 오류', e);
            state.surveys = [];
            state.surveyMap.clear();
            state.resultCounts.clear();
        }
    }

    async function preloadResultsCounts(ids) {
        state.resultCounts.clear();
        await Promise.all(ids.map(async (id) => {
            try {
                const results = await API.getResults(id);
                state.resultCounts.set(id, Array.isArray(results) ? results.length : 0);
            } catch (e) {
                state.resultCounts.set(id, 0);
            }
        }));
    }

    function saveFolders() { /* no-op (no persistence) */ }

    function renderFolders() {
        const folderList = document.getElementById('folderList');
        folderList.innerHTML = '';

        state.folders.forEach(folder => {
            if (folder.id === 'all' || folder.id === 'draft' || folder.id === 'active' || folder.id === 'closed') {
                const count = countSurveysByStatus(folder.id);
                const folderEl = createFolderElement(folder, count);
                folderList.appendChild(folderEl);
            }
        });

        // Add custom folders
        const customFolders = state.folders.filter(f => 
            f.id !== 'all' && f.id !== 'draft' && f.id !== 'active' && f.id !== 'closed'
        );
        
        if (customFolders.length > 0) {
            const divider = document.createElement('div');
            divider.style.height = '1px';
            divider.style.background = '#e0e0e0';
            divider.style.margin = '1rem 0';
            folderList.appendChild(divider);

            customFolders.forEach(folder => {
                const count = countSurveysByFolder(folder.id);
                const folderEl = createFolderElement(folder, count);
                folderList.appendChild(folderEl);
            });
        }
    }

    function createFolderElement(folder, count) {
        const el = document.createElement('div');
        el.className = 'folder-item';
        if (state.selectedFolder === folder.id) {
            el.classList.add('active');
        }

        el.innerHTML = `
            <div class="folder-icon">${folder.icon}</div>
            <div class="folder-info">
                <div class="folder-name">${folder.name}</div>
                <div class="folder-count">${count}개 설문</div>
            </div>
            <div class="folder-actions">
                ${folder.id !== 'all' && folder.id !== 'draft' && folder.id !== 'active' && folder.id !== 'closed' 
                    ? `<button class="btn-icon-small" onclick="renameFolder('${folder.id}')" title="이름 변경">✏️</button>
                       <button class="btn-icon-small" onclick="deleteFolder('${folder.id}')" title="삭제">🗑️</button>`
                    : ''}
            </div>
        `;

        el.addEventListener('click', (e) => {
            if (!e.target.closest('.folder-actions')) {
                selectFolder(folder.id);
            }
        });

        return el;
    }

    function countSurveysByStatus(status) {
        if (status === 'all') return state.surveys.length;
        return state.surveys.filter(s => (s.status || 'draft') === status).length;
    }

    function countSurveysByFolder(folderId) {
        return state.surveys.filter(s => s.folderId === folderId).length;
    }

    function selectFolder(folderId) {
        state.selectedFolder = folderId;
        state.currentFilter = folderId;
        renderFolders();
        renderSurveys();
    }

    function renderSurveys() {
        const surveyGrid = document.getElementById('surveyListContainer');
        const emptyState = document.getElementById('emptyState');
        
        let filtered = state.surveys;

        // Apply folder filter
        if (state.selectedFolder !== 'all') {
            if (['draft', 'active', 'closed'].includes(state.selectedFolder)) {
                filtered = filtered.filter(s => s.status === state.selectedFolder);
            } else {
                filtered = filtered.filter(s => s.folderId === state.selectedFolder);
            }
        }

        // Apply sort
        filtered = sortSurveys(filtered, state.currentSort);

        surveyGrid.innerHTML = '';

        if (filtered.length === 0) {
            emptyState.style.display = 'block';
            return;
        }

        emptyState.style.display = 'none';

        filtered.forEach(survey => {
            const card = createSurveyCard(survey);
            surveyGrid.appendChild(card);
        });
    }

    function createSurveyCard(survey) {
        const responseCount = state.resultCounts.get(survey.id) || 0;
        const completionRate = calculateCompletionRate(survey, responseCount);

        const card = document.createElement('div');
        card.className = 'survey-card';
        card.draggable = true;
        card.setAttribute('data-survey-id', survey.id);

        const statusText = survey.status === 'draft' ? '작성 중' : 
                          survey.status === 'active' ? '배포 중' : '응답 종료';
        const statusClass = `status-${survey.status}`;

        card.innerHTML = `
            <div class="survey-card-header">
                <span class="survey-status ${statusClass}">${statusText}</span>
                <button class="btn-icon-small" onclick="openSurveyMenu('${survey.id}')" title="메뉴">⋮</button>
            </div>
            <div class="survey-title">${truncateText(survey.title, 50)}</div>
            <div class="survey-meta">
                <div class="meta-item">📝 ${survey.questions?.length || 0}개 문항</div>
                <div class="meta-item">📅 ${formatDate(survey.createdAt)}</div>
                <div class="meta-item">✏️ ${formatDate(survey.updatedAt || survey.createdAt)}</div>
                <div class="meta-item">💬 응답 ${responseCount}건</div>
            </div>
            <div class="survey-progress">
                <div class="progress-label">
                    <span>응답 진행률</span>
                    <span>${completionRate}%</span>
                </div>
                <div class="progress-bar">
                    <div class="progress-fill" style="width: ${completionRate}%"></div>
                </div>
            </div>
            <div class="survey-actions">
                <button class="btn-survey-action" onclick="editSurvey('${survey.id}')">편집</button>
                <button class="btn-survey-action" onclick="viewResults('${survey.id}')">결과</button>
                <button class="btn-survey-action" onclick="shareSurvey('${survey.id}')">공유</button>
            </div>
        `;

        // Drag and drop
        card.addEventListener('dragstart', (e) => {
            card.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('surveyId', survey.id);
        });

        card.addEventListener('dragend', () => {
            card.classList.remove('dragging');
        });

        // Prevent drag/propagation on interactive buttons inside the card
        const kebabBtn = card.querySelector('.survey-card-header .btn-icon-small');
        const actionBtns = card.querySelectorAll('.survey-actions .btn-survey-action');
        [kebabBtn, ...actionBtns].forEach(btn => {
            if (!btn) return;
            btn.addEventListener('mousedown', (e) => {
                e.stopPropagation();
            });
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
            });
        });

        return card;
    }

    function calculateCompletionRate(survey, responseCount) {
        // 상세 응답 데이터가 없으므로 보수적으로 0%로 표시
        if (!responseCount) return 0;
        return 0;
    }

    function sortSurveys(surveys, sortType) {
        const sorted = [...surveys];
        
        switch (sortType) {
            case 'recent':
                return sorted.sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
            case 'oldest':
                return sorted.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
            case 'responses':
                return sorted.sort((a, b) => {
                    const aResponses = state.resultCounts.get(a.id) || 0;
                    const bResponses = state.resultCounts.get(b.id) || 0;
                    return bResponses - aResponses;
                });
            case 'title':
                return sorted.sort((a, b) => a.title.localeCompare(b.title, 'ko'));
            default:
                return sorted;
        }
    }

    function updateAnalytics() {
        let totalResponses = 0;
        let surveyCountWithResponses = 0;
        const allDropoffData = [];

        state.surveys.forEach(survey => {
            const count = state.resultCounts.get(survey.id) || 0;
            if (count > 0) {
                surveyCountWithResponses++;
                totalResponses += count;
            }
            // 상세 드롭오프 계산은 API 응답 스키마 확인 후 확장
        });

        document.getElementById('totalResponsesValue').textContent = totalResponses.toString();
        document.getElementById('completionRateValue').textContent = '0%';
        document.getElementById('dropoffRateValue').textContent = '0%';

        if (allDropoffData.length > 0) {
            renderDropoffAnalysis(allDropoffData);
        }
    }

    function calculateQuestionDropoff(survey, responses) {
        const dropoffData = [];
        // API 스키마에 따라 확장 필요
        
        return dropoffData;
    }

    function renderDropoffAnalysis(allDropoffData) {
        const container = document.getElementById('dropoffContainer');
        const details = document.getElementById('dropoffDetails');
        const analysisEmptyState = document.getElementById('analysisEmptyState');

        if (allDropoffData.length === 0) {
            container.style.display = 'none';
            analysisEmptyState.style.display = 'block';
            return;
        }

        container.style.display = 'block';
        analysisEmptyState.style.display = 'none';

        // Sort by dropoff rate
        const sorted = allDropoffData.sort((a, b) => b.dropoffRate - a.dropoffRate);

        // Render chart
        renderDropoffChart(sorted);

        // Render details
        details.innerHTML = '';
        sorted.slice(0, 10).forEach(item => {
            const el = document.createElement('div');
            el.className = 'question-dropoff-item';
            if (item.dropoffRate > 20) {
                el.classList.add('high-dropoff');
            }

            el.innerHTML = `
                <div class="question-number">Q${item.questionNumber}</div>
                <div style="flex: 1;">
                    <div class="question-text">${truncateText(item.questionText, 60)}</div>
                    <div class="dropoff-stats">
                        <span class="dropoff-rate">이탈률: ${item.dropoffRate}%</span>
                        <span class="response-count">응답: ${item.respondedCount}/${item.totalCount}</span>
                    </div>
                </div>
            `;

            details.appendChild(el);
        });
    }

    function renderDropoffChart(dropoffData) {
        const ctx = document.getElementById('dropoffChart');
        if (!ctx) return;

        if (state.chartInstance) {
            state.chartInstance.destroy();
        }

        const labels = dropoffData.slice(0, 10).map(d => `Q${d.questionNumber}`);
        const data = dropoffData.slice(0, 10).map(d => d.dropoffRate);

        state.chartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: '이탈률 (%)',
                    data: data,
                    backgroundColor: data.map(rate => 
                        rate > 30 ? 'rgba(245, 87, 108, 0.7)' :
                        rate > 15 ? 'rgba(255, 193, 7, 0.7)' :
                        'rgba(76, 175, 80, 0.7)'
                    ),
                    borderColor: data.map(rate => 
                        rate > 30 ? 'rgba(245, 87, 108, 1)' :
                        rate > 15 ? 'rgba(255, 193, 7, 1)' :
                        'rgba(76, 175, 80, 1)'
                    ),
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: false
                    },
                    datalabels: {
                        display: true,
                        color: '#333',
                        anchor: 'end',
                        align: 'top',
                        font: {
                            weight: 'bold'
                        },
                        formatter: (value) => `${value}%`
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        max: 100,
                        ticks: {
                            callback: (value) => `${value}%`
                        }
                    }
                }
            },
            plugins: [ChartDataLabels]
        });
    }

    function filterSurveys(filter) {
        state.currentFilter = filter;
        selectFolder(filter);
        
        // Update filter buttons
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        event.target.classList.add('active');
    }

    function updateSurveySort() {
        state.currentSort = document.getElementById('sortSelect').value;
        renderSurveys();
    }

    function openAddFolderModal() {
        document.getElementById('addFolderModal').classList.add('active');
        document.getElementById('folderNameInput').focus();
    }

    function closeAddFolderModal() {
        document.getElementById('addFolderModal').classList.remove('active');
        document.getElementById('folderNameInput').value = '';
    }

    function createFolder() {
        const name = document.getElementById('folderNameInput').value.trim();
        if (!name) {
            alert('폴더 이름을 입력해주세요.');
            return;
        }

        const folder = {
            id: generateId('folder'),
            name: name,
            icon: '📁',
            color: '#4a6baf'
        };

        state.folders.push(folder);
        state.folderMap.set(folder.id, folder);
        saveFolders();
        renderFolders();
        closeAddFolderModal();
    }

    function renameFolder(folderId) {
        const folder = state.folderMap.get(folderId);
        if (!folder) return;

        const newName = prompt('새 폴더 이름:', folder.name);
        if (newName && newName.trim()) {
            folder.name = newName.trim();
            saveFolders();
            renderFolders();
        }
    }

    function deleteFolder(folderId) {
        if (!confirm('이 폴더를 삭제하시겠습니까? (폴더 내 설문은 유지됩니다)')) {
            return;
        }

        state.folders = state.folders.filter(f => f.id !== folderId);
        state.folderMap.delete(folderId);
        
        // Move surveys in this folder to 'all'
        state.surveys.forEach(survey => {
            if (survey.folderId === folderId) {
                survey.folderId = null;
            }
        });

        saveFolders();
        renderFolders();
        renderSurveys();
    }

    function editSurvey(surveyId) {
        window.location.href = `survey.html?surveyId=${surveyId}`;
    }

    function viewResults(surveyId) {
        window.location.href = `analytics.html?surveyId=${surveyId}`;
    }

    // Build a short share URL: /s/:id -> redirected to /survey.html?surveyId=:id by Netlify
    function createShareUrl(survey) {
        const surveyId = survey.id;
        const url = `${window.location.origin}/s/${surveyId}`;
        return url;
    }

    function shareSurvey(surveyId) {
        const survey = state.surveyMap.get(surveyId);
        if (!survey) return;

        const shareUrl = createShareUrl(survey);

        // Populate and show dashboard share modal (same UX as completion modal)
        const overlay = document.getElementById('shareModal');
        const input = document.getElementById('shareLinkInputDash');
        const qr = document.getElementById('shareQrDash');
        const copyBtn = document.getElementById('copyShareLinkBtn');
        const closeBtn = document.getElementById('closeShareModalBtn');

        if (overlay && input && qr && copyBtn && closeBtn) {
            input.value = shareUrl;
            qr.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(shareUrl)}`;
            qr.style.display = 'inline-block';
            overlay.classList.add('active');

            // Handlers (rebind safely)
            copyBtn.onclick = async () => {
                try {
                    if (navigator.clipboard?.writeText) {
                        await navigator.clipboard.writeText(shareUrl);
                        alert('링크가 복사되었습니다!');
                    } else {
                        input.select();
                        document.execCommand('copy');
                        alert('링크가 복사되었습니다!');
                    }
                } catch {
                    prompt('설문 링크를 복사하세요:', shareUrl);
                }
            };
            closeBtn.onclick = () => overlay.classList.remove('active');
            overlay.onclick = (e) => { if (e.target === overlay) overlay.classList.remove('active'); };
        } else {
            // Fallback to native share / prompt if modal elements missing
            if (navigator.share) {
                navigator.share({ title: survey.title, text: '이 설문에 참여해주세요!', url: shareUrl })
                    .catch(() => prompt('설문 링크를 복사하세요:', shareUrl));
            } else {
                prompt('설문 링크를 복사하세요:', shareUrl);
            }
        }
    }

    function openSurveyMenu(surveyId) {
        // Placeholder for context menu
        // Simple alert menu for now
        const choice = prompt('작업 선택:\n1. 편집\n2. 결과 보기\n3. 공유\n4. 삭제');
        if (choice === '1') editSurvey(surveyId);
        else if (choice === '2') viewResults(surveyId);
        else if (choice === '3') shareSurvey(surveyId);
        else if (choice === '4') deleteSurvey(surveyId);
    }

    async function deleteSurvey(surveyId) {
        if (!confirm('이 설문을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.')) return;
        try {
            await API.deleteSurvey(surveyId);
            await refreshSurveys();
            renderSurveys();
            updateAnalytics();
        } catch (e) {
            alert('설문 삭제 중 오류가 발생했습니다.');
            console.error(e);
        }
    }

    // Legacy export functions removed in DB-only mode

    function navigateTo(page) {
        window.location.href = page;
    }

    // Expose functions for inline onclick (kebab, share, navigation, filters)
    window.openSurveyMenu = openSurveyMenu;
    window.shareSurvey = shareSurvey;
    window.editSurvey = editSurvey;
    window.viewResults = viewResults;
    window.filterSurveys = filterSurveys;
    window.updateSurveySort = updateSurveySort;
    window.navigateTo = navigateTo;
    window.openAddFolderModal = openAddFolderModal;
    window.closeAddFolderModal = closeAddFolderModal;
    window.createFolder = createFolder;
    window.renameFolder = renameFolder;
    window.deleteFolder = deleteFolder;
    // exports removed

    // Utility functions (reduced)

    function formatDate(date) {
        if (!date) return '-';
        const d = new Date(date);
        if (Number.isNaN(d.getTime())) return '-';
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    function truncateText(text, length) {
        if (!text) return '';
        return text.length > length ? `${text.slice(0, length)}…` : text;
    }

    function generateId(prefix) {
        return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    }

    // Close modal on overlay click
    document.getElementById('addFolderModal').addEventListener('click', (e) => {
        if (e.target.id === 'addFolderModal') {
            closeAddFolderModal();
        }
    });

    // Enter key to create folder
    document.getElementById('folderNameInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            createFolder();
        }
    });

    /**
     * 특정 설문 카드를 찾아 스크롤하고 하이라이트 효과를 줍니다.
     * @param {string} surveyId - 하이라이트할 설문의 ID
     */
    function highlightSurveyCard(surveyId) {
        const surveyCard = document.querySelector(`.survey-card[data-survey-id="${surveyId}"]`);
        if (surveyCard) {
            surveyCard.scrollIntoView({ behavior: 'smooth', block: 'center' });

            // Add a temporary highlight effect
            surveyCard.style.transition = 'all 0.3s ease-in-out';
            surveyCard.style.boxShadow = '0 0 0 3px rgba(74, 107, 175, 0.5), 0 4px 12px rgba(0,0,0,0.12)';
            surveyCard.style.transform = 'scale(1.02)';

            setTimeout(() => {
                surveyCard.style.boxShadow = '';
                surveyCard.style.transform = '';
            }, 2000); // Highlight for 2 seconds
        }
    }
});
