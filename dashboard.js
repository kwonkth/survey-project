document.addEventListener('DOMContentLoaded', () => {
    if (typeof Chart !== 'undefined' && typeof ChartDataLabels !== 'undefined') {
        Chart.register(ChartDataLabels);
    }

    function pickRandomOrder(surveyId) {
        const count = state.resultCounts.get(surveyId) || 0;
        if (!count || count <= 0) {
            alert('아직 응답이 없습니다. 응답이 수집된 후에 랜덤 번호를 뽑을 수 있습니다.');
            return;
        }
        const n = Math.floor(Math.random() * count) + 1; // 1 ~ count
        alert(`이 설문에 대한 랜덤 응답 순번은 \n\n${n}번째 참여자입니다.`);
    }

    let currentMoveSurveyId = null;

    function openMoveFolderModal(surveyId) {
        currentMoveSurveyId = surveyId;
        const modal = document.getElementById('moveFolderModal');
        const select = document.getElementById('moveFolderSelect');
        const info = document.getElementById('moveFolderInfo');
        if (!modal || !select || !info) return;

        // Populate folder options with custom folders only
        select.innerHTML = '';
        const customFolders = state.folders.filter(f => 
            f.id !== 'all' && f.id !== 'draft' && f.id !== 'active' && f.id !== 'closed'
        );

        if (customFolders.length === 0) {
            info.textContent = '이동할 수 있는 폴더가 없습니다. 먼저 새 폴더를 만들어 주세요.';
            select.style.display = 'none';
        } else {
            info.textContent = '이 설문을 이동할 폴더를 선택하세요.';
            select.style.display = 'block';
            customFolders.forEach(folder => {
                const opt = document.createElement('option');
                opt.value = folder.id;
                opt.textContent = folder.name;
                select.appendChild(opt);
            });

            const survey = state.surveyMap.get(surveyId);
            if (survey && survey.folderId) {
                select.value = survey.folderId;
            }
        }

        modal.classList.add('active');
    }

    function closeMoveFolderModal() {
        const modal = document.getElementById('moveFolderModal');
        if (modal) {
            modal.classList.remove('active');
        }
        currentMoveSurveyId = null;
    }

    async function applyMoveFolder() {
        if (!currentMoveSurveyId) {
            closeMoveFolderModal();
            return;
        }
        const select = document.getElementById('moveFolderSelect');
        if (!select || select.style.display === 'none') {
            closeMoveFolderModal();
            return;
        }
        const folderId = select.value;
        const survey = state.surveyMap.get(currentMoveSurveyId);
        if (survey) {
            const newFolderId = folderId || null;
            survey.folderId = newFolderId;
            renderFolders();
            renderSurveys();
            try {
                await API.updateSurveyFolder(survey.id, newFolderId);
            } catch (e) {
                console.error('설문 폴더 이동 중 오류', e);
                alert('설문 폴더를 이동하는 중 오류가 발생했습니다. 페이지를 새로고침해 주세요.');
            }
        }
        closeMoveFolderModal();
    }

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
        },
        async updateSurveyStatus(id, status) {
            const res = await fetch(`/api/surveys/${encodeURIComponent(id)}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status })
            });
            if (!res.ok) throw new Error(`PATCH /api/surveys/${id} ${res.status}`);
            return res.json();
        },
        async updateSurveyFolder(id, folderId) {
            const res = await fetch(`/api/surveys/${encodeURIComponent(id)}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ folder_id: folderId })
            });
            if (!res.ok) throw new Error(`PATCH /api/surveys/${id} ${res.status}`);
            return res.json();
        },
        async getFolders() {
            const res = await fetch('/api/folders', { method: 'GET' });
            if (!res.ok) throw new Error(`GET /api/folders ${res.status}`);
            return res.json();
        },
        async createFolder(folder) {
            const res = await fetch('/api/folders', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(folder)
            });
            if (!res.ok) throw new Error(`POST /api/folders ${res.status}`);
            return res.json();
        },
        async updateFolder(id, payload) {
            const res = await fetch(`/api/folders/${encodeURIComponent(id)}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!res.ok) throw new Error(`PATCH /api/folders/${id} ${res.status}`);
            return res.json();
        },
        async deleteFolder(id) {
            const res = await fetch(`/api/folders/${encodeURIComponent(id)}`, { method: 'DELETE' });
            if (!res.ok) throw new Error(`DELETE /api/folders/${id} ${res.status}`);
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
        await loadFolders();
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

    // Kick off initial load and rendering
    init();

    async function loadFolders() {
        state.folders = getDefaultFolders();
        state.folderMap.clear();
        state.folders.forEach(folder => state.folderMap.set(folder.id, folder));

        try {
            const remoteFolders = await API.getFolders();
            if (Array.isArray(remoteFolders)) {
                remoteFolders.forEach(row => {
                    if (!row?.id || state.folderMap.has(row.id)) return;
                    const f = {
                        id: row.id,
                        name: row.name,
                        icon: row.icon || '📁',
                        color: row.color || '#4a6baf'
                    };
                    state.folders.push(f);
                    state.folderMap.set(f.id, f);
                });
            }
        } catch (e) {
            console.error('폴더 목록을 불러오는 중 오류', e);
        }

        if (!state.folders || state.folders.length === 0) {
            state.folders = getDefaultFolders();
            state.folderMap.clear();
            state.folders.forEach(folder => state.folderMap.set(folder.id, folder));
        }
    }

    function getDefaultFolders() {
        return [
            { id: 'all', name: '모든 설문', icon: '📋', color: '#4a6baf' },
            { id: 'draft', name: '작성 중', icon: '✏️', color: '#f39c12' },
            { id: 'active', name: '배포 중', icon: '🚀', color: '#27ae60' }
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
                    status: row.status ?? 'draft',
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

    function saveFolders() { /* 폴더 수정은 개별 API 호출에서 처리하므로 여기서는 별도 동작 없음 */ }

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

        // Allow dropping survey cards onto custom folders to move them
        if (folder.id !== 'all' && folder.id !== 'draft' && folder.id !== 'active' && folder.id !== 'closed') {
            el.addEventListener('dragover', (e) => {
                e.preventDefault();
                el.classList.add('drag-over-folder');
            });
            el.addEventListener('dragleave', () => {
                el.classList.remove('drag-over-folder');
            });
            el.addEventListener('drop', async (e) => {
                e.preventDefault();
                el.classList.remove('drag-over-folder');
                const surveyId = e.dataTransfer.getData('surveyId');
                if (!surveyId) return;
                const survey = state.surveyMap.get(surveyId);
                if (!survey) return;
                survey.folderId = folder.id;
                renderFolders();
                renderSurveys();
                try {
                    await API.updateSurveyFolder(survey.id, folder.id);
                } catch (err) {
                    console.error('드래그 이동 중 설문 폴더 업데이트 오류', err);
                    alert('설문 폴더를 이동하는 중 오류가 발생했습니다. 페이지를 새로고침해 주세요.');
                }
            });
        }

        return el;
    }

    function countSurveysByStatus(status) {
        if (status === 'all') return state.surveys.length;
        return state.surveys.filter(s => {
            const st = s.status || 'draft';
            if (status === 'draft') return st === 'draft';
            if (status === 'active') return st === 'active' || st === 'published';
            if (status === 'closed') return st === 'inactive' || st === 'archived';
            return false;
        }).length;
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
                filtered = filtered.filter(s => {
                    const st = s.status || 'draft';
                    if (state.selectedFolder === 'draft') {
                        return st === 'draft';
                    }
                    if (state.selectedFolder === 'active') {
                        return st === 'active' || st === 'published';
                    }
                    if (state.selectedFolder === 'closed') {
                        return st === 'inactive' || st === 'archived';
                    }
                    return false;
                });
            } else {
                filtered = filtered.filter(s => s.folderId === state.selectedFolder);
            }
        }

        // Apply sort
        filtered = sortSurveys(filtered, state.currentSort);

        surveyGrid.innerHTML = '';

        if (filtered.length === 0) {
            // 설문이 없더라도 그리드 영역의 너비/높이를 유지하기 위해
            // 그리드 내부에 빈 상태 메시지를 표시합니다.
            emptyState.style.display = 'none';
            const msg = document.createElement('div');
            msg.className = 'survey-grid-empty';
            msg.textContent = '현재 선택한 조건에 맞는 설문이 없습니다.';
            surveyGrid.appendChild(msg);
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

        const card = document.createElement('div');
        card.className = 'survey-card';
        card.draggable = true;
        card.setAttribute('data-survey-id', survey.id);

        const rawStatus = survey.status || 'draft';
        const statusTextMap = {
            draft: '작성 중',
            active: '배포 중',
            published: '배포 중',
            inactive: '응답 종료',
            archived: '응답 종료'
        };
        const statusText = statusTextMap[rawStatus] || '작성 중';
        const statusClass = `status-${rawStatus}`;

        card.innerHTML = `
            <div class="survey-card-header">
                <span class="survey-status ${statusClass}">${statusText}</span>
                <button class="btn-icon-small" data-menu-btn title="메뉴">⋮</button>
            </div>
            <div class="survey-title">${truncateText(survey.title, 50)}</div>
            <div class="survey-meta">
                <div class="meta-item">📝 ${survey.questions?.length || 0}개 문항</div>
                <div class="meta-item">📅 ${formatDate(survey.createdAt)}</div>
                <div class="meta-item">✏️ ${formatDate(survey.updatedAt || survey.createdAt)}</div>
                <div class="meta-item">💬 응답 ${responseCount}건</div>
            </div>
            <div class="survey-actions">
                <button class="btn-survey-action" onclick="editSurvey('${survey.id}')">수정</button>
                <button class="btn-survey-action" onclick="shareSurvey('${survey.id}')">링크 확인</button>
                <button class="btn-survey-action" onclick="pickRandomOrder('${survey.id}')">추첨</button>
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

        if (kebabBtn) {
            kebabBtn.addEventListener('click', (e) => {
                e.preventDefault();
                toggleDropdownMenu(survey.id, kebabBtn);
            });
        }

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

    async function createFolder() {
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

        try {
            await API.createFolder(folder);
            state.folders.push(folder);
            state.folderMap.set(folder.id, folder);
            renderFolders();
            closeAddFolderModal();
        } catch (e) {
            console.error('폴더 생성 중 오류', e);
            alert('폴더를 생성하는 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
        }
    }

    async function renameFolder(folderId) {
        const folder = state.folderMap.get(folderId);
        if (!folder) return;

        const newName = prompt('새 폴더 이름:', folder.name);
        if (newName && newName.trim()) {
            const trimmed = newName.trim();
            folder.name = trimmed;
            try {
                await API.updateFolder(folderId, { name: trimmed });
                renderFolders();
            } catch (e) {
                console.error('폴더 이름 변경 중 오류', e);
                alert('폴더 이름을 변경하는 중 오류가 발생했습니다.');
            }
        }
    }

    async function deleteFolder(folderId) {
        if (!confirm('이 폴더를 삭제하시겠습니까? (폴더 내 설문은 유지됩니다)')) {
            return;
        }

        try {
            await API.deleteFolder(folderId);

            state.folders = state.folders.filter(f => f.id !== folderId);
            state.folderMap.delete(folderId);
            
            // Move surveys in this folder to 'all' (DB는 API에서 이미 NULL 처리)
            state.surveys.forEach(survey => {
                if (survey.folderId === folderId) {
                    survey.folderId = null;
                }
            });

            renderFolders();
            renderSurveys();
        } catch (e) {
            console.error('폴더 삭제 중 오류', e);
            alert('폴더를 삭제하는 중 오류가 발생했습니다.');
        }
    }

    function editSurvey(surveyId) {
        const survey = state.surveyMap.get(surveyId);
        if (survey) {
            const st = survey.status || 'draft';
            if (st === 'active' || st === 'published') {
                const proceed = confirm('주의: 배포 중인 설문을 수정하면 기존 응답 데이터에 영향을 줄 수 있습니다. 계속하시겠습니까?');
                if (!proceed) {
                    return;
                }
            }
        }
        // 메인 화면의 AI 설문 미리보기 & 편집 모달을 재사용하기 위해 index.html로 이동
        window.location.href = `index.html?surveyId=${encodeURIComponent(surveyId)}`;
    }

    function viewResults(surveyId) {
        window.location.href = `analytics.html?surveyId=${surveyId}`;
    }

    // Build a direct share URL to the survey page
    function createShareUrl(survey) {
        const surveyId = survey.id;
        const url = `${window.location.origin}/survey.html?surveyId=${encodeURIComponent(surveyId)}`;
        return url;
    }

    function shareSurvey(surveyId) {
        const survey = state.surveyMap.get(surveyId);
        if (!survey) return;

        const normalizedStatus = survey.status || 'draft';
        // 현재는 DB의 status가 항상 'draft'에서 제대로 갱신되지 않을 수 있으므로
        // 상태와 무관하게 공유를 허용한다. (향후 /api/surveys/:id PATCH 구현 후 다시 tighten 가능)

        const shareUrl = createShareUrl(survey);

        // Populate and show dashboard share modal (same UX as completion modal)
        const overlay = document.getElementById('shareModal');
        const input = document.getElementById('shareLinkInputDash');
        const qr = document.getElementById('shareQrDash');
        const copyBtn = document.getElementById('copyShareLinkBtn');
        const closeBtn = document.getElementById('closeShareModalBtn');
        const smallCopyBtn = document.getElementById('copyShareLinkIconBtn');

        if (overlay && input && qr && copyBtn && closeBtn) {
            input.value = shareUrl;
            qr.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(shareUrl)}`;
            qr.style.display = 'inline-block';
            overlay.classList.add('active');

            const doCopy = async () => {
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
            if (smallCopyBtn) {
                smallCopyBtn.onclick = doCopy;
            }

            copyBtn.onclick = () => {
                window.open(shareUrl, '_blank', 'noopener');
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
        const card = document.querySelector(`.survey-card[data-survey-id="${surveyId}"]`);
        if (!card) return;
        const btn = card.querySelector('[data-menu-btn]');
        if (!btn) return;
        toggleDropdownMenu(surveyId, btn);
    }

    async function deleteSurvey(surveyId) {
        const first = confirm('정말 이 설문을 삭제하시겠습니까?');
        if (!first) return;
        const second = confirm('삭제된 설문과 수집된 데이터는 복구할 수 없습니다. 계속하시겠습니까?');
        if (!second) return;
        let deleteOk = false;
        try {
            await API.deleteSurvey(surveyId);
            deleteOk = true;
            await refreshSurveys();
            renderSurveys();
            updateAnalytics();
            alert('설문이 성공적으로 삭제되었습니다.');
        } catch (e) {
            console.error(e);
            if (deleteOk) {
                // 삭제는 되었으나 목록/통계 새로고침 중 오류가 난 경우
                alert('설문은 삭제되었으나 목록 새로고침 중 오류가 발생했습니다. 페이지를 새로고침해 주세요.');
            } else {
                alert('설문 삭제 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
            }
        }
    }

    async function endDeployment(surveyId) {
        try {
            await API.updateSurveyStatus(surveyId, 'archived');
            const s = state.surveyMap.get(surveyId);
            if (s) {
                s.status = 'archived';
                s.updatedAt = new Date().toISOString();
            }
            renderFolders();
            renderSurveys();
            updateAnalytics();
        } catch (e) {
            alert('배포 종료 중 오류가 발생했습니다.');
            console.error(e);
        }
    }

    let currentMenuEl = null;
    function closeDropdownMenu() {
        if (currentMenuEl && currentMenuEl.parentNode) {
            currentMenuEl.parentNode.removeChild(currentMenuEl);
        }
        currentMenuEl = null;
        document.removeEventListener('click', handleOutsideClick, true);
    }

    function handleOutsideClick(e) {
        if (currentMenuEl && !currentMenuEl.contains(e.target)) {
            closeDropdownMenu();
        }
    }

    function toggleDropdownMenu(surveyId, anchorEl) {
        if (currentMenuEl) {
            closeDropdownMenu();
        }
        const menu = document.createElement('div');
        menu.style.position = 'absolute';
        menu.style.right = '0';
        menu.style.top = '36px';
        menu.style.background = '#fff';
        menu.style.border = '1px solid #e0e0e0';
        menu.style.borderRadius = '8px';
        menu.style.boxShadow = '0 8px 24px rgba(0,0,0,0.12)';
        menu.style.padding = '6px';
        menu.style.zIndex = '100';
        menu.innerHTML = `
            <button class="btn-survey-action" style="display:block; width:180px; text-align:left; margin:4px 2px;" onclick="editSurvey('${surveyId}')">수정</button>
            <button class="btn-survey-action" style="display:block; width:180px; text-align:left; margin:4px 2px;" onclick="shareSurvey('${surveyId}')">링크 확인</button>
            <button class="btn-survey-action" style="display:block; width:180px; text-align:left; margin:4px 2px;" onclick="openMoveFolderModal('${surveyId}')">폴더로 이동</button>
            <button class="btn-survey-action" style="display:block; width:180px; text-align:left; margin:4px 2px; color:#c0392b;" onclick="deleteSurvey('${surveyId}')">삭제</button>
        `;
        const header = anchorEl.closest('.survey-card-header');
        if (!header) return;
        header.style.position = 'relative';
        header.appendChild(menu);
        currentMenuEl = menu;
        setTimeout(() => {
            document.addEventListener('click', handleOutsideClick, true);
        }, 0);
    }

    // Legacy export functions removed in DB-only mode

    function navigateTo(page) {
        window.location.href = page;
    }

    async function setAllSurveysActive() {
        try {
            // 최신 데이터 보장
            await refreshSurveys();
            const ids = state.surveys.map(s => s.id);
            if (!ids.length) {
                alert('변경할 설문이 없습니다.');
                return;
            }

            const confirmMsg = `총 ${ids.length}개 설문을 모두 '배포 중' 상태로 변경하시겠습니까?`;
            const proceed = window.confirm(confirmMsg);
            if (!proceed) return;

            await Promise.all(ids.map(async (id) => {
                try {
                    await API.updateSurveyStatus(id, 'active');
                    const s = state.surveyMap.get(id);
                    if (s) {
                        s.status = 'active';
                        s.updatedAt = new Date().toISOString();
                    }
                } catch (e) {
                    console.error('상태 변경 실패:', id, e);
                }
            }));

            renderFolders();
            renderSurveys();
            updateAnalytics();

            alert(`총 ${ids.length}개 설문의 상태를 '배포 중'으로 변경했습니다.`);
        } catch (e) {
            console.error('전체 설문 상태 일괄 변경 중 오류', e);
            alert('전체 설문 상태를 변경하는 중 오류가 발생했습니다.');
        }
    }

    // Expose functions for inline onclick (kebab, share, navigation, filters)
    window.openSurveyMenu = openSurveyMenu;
    window.shareSurvey = shareSurvey;
    window.editSurvey = editSurvey;
    window.viewResults = viewResults;
    window.endDeployment = endDeployment;
    window.deleteSurvey = deleteSurvey;
    window.filterSurveys = filterSurveys;
    window.updateSurveySort = updateSurveySort;
    window.navigateTo = navigateTo;
    window.openAddFolderModal = openAddFolderModal;
    window.closeAddFolderModal = closeAddFolderModal;
    window.createFolder = createFolder;
    window.renameFolder = renameFolder;
    window.deleteFolder = deleteFolder;
    window.openMoveFolderModal = openMoveFolderModal;
    window.closeMoveFolderModal = closeMoveFolderModal;
    window.applyMoveFolder = applyMoveFolder;
    window.setAllSurveysActive = setAllSurveysActive;
    window.pickRandomOrder = pickRandomOrder;
    // exports removed

    // 배포 종료 / 재배포 버튼 클릭 처리 (이벤트 위임)
    document.addEventListener('click', async (e) => {
        const btn = e.target.closest('button[data-action]');
        if (!btn) return;

        const surveyId = btn.dataset.id;
        const action = btn.dataset.action;
        if (!surveyId || !action) return;

        try {
            if (action === 'publish') {
                await API.updateSurveyStatus(surveyId, 'active');
                const s = state.surveyMap.get(surveyId);
                if (s) {
                    s.status = 'active';
                    s.updatedAt = new Date().toISOString();
                }
                alert('설문 배포를 시작했습니다.');
            } else if (action === 'stop') {
                await API.updateSurveyStatus(surveyId, 'archived');
                const s = state.surveyMap.get(surveyId);
                if (s) {
                    s.status = 'archived';
                    s.updatedAt = new Date().toISOString();
                }
                alert('배포가 종료되었습니다.');
            } else if (action === 'republish') {
                await API.updateSurveyStatus(surveyId, 'published');
                const s = state.surveyMap.get(surveyId);
                if (s) {
                    s.status = 'published';
                    s.updatedAt = new Date().toISOString();
                }
                alert('설문이 다시 배포되었습니다!');
            }

            renderFolders();
            renderSurveys();
            updateAnalytics();
        } catch (err) {
            console.error(err);
            alert('설문 상태를 변경하는 중 오류가 발생했습니다.');
        }
    });

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
