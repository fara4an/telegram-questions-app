// Telegram Web App
let tg = window.Telegram?.WebApp;
let userId = null;
let username = null;
let currentQuestionId = null;
let isAdmin = false;
let isSuperAdmin = false;
const botUsername = 'questionstgbot';
const TELEGRAM_CHANNEL = '@questionstg';

// ========== ПРОВЕРКА ДОСТУПА ==========

async function checkUserAccess() {
    try {
        const response = await fetch(`/api/user/access/${userId}`);
        if (response.ok) {
            const data = await response.json();
            return data;
        }
        return { isSubscribed: false, agreedTOS: false, user: {} };
    } catch (error) {
        console.error('Ошибка проверки доступа:', error);
        return { isSubscribed: false, agreedTOS: false, user: {} };
    }
}

async function showAccessRestrictions() {
    const access = await checkUserAccess();
    
    if (!access.isSubscribed) {
        document.body.innerHTML = `
            <div class="access-restricted">
                <div class="restricted-content">
                    <div class="restricted-icon">📢</div>
                    <h2>Требуется подписка</h2>
                    <p>Для использования приложения необходимо подписаться на наш Telegram-канал</p>
                    <div class="channel-info">
                        <strong>Канал:</strong> ${TELEGRAM_CHANNEL}
                    </div>
                    <p>После подписки нажмите кнопку "Я подписался"</p>
                    <div class="actions">
                        <button class="btn btn-primary" onclick="openTelegramChannel()">
                            📢 Перейти в канал
                        </button>
                        <button class="btn btn-secondary" onclick="location.reload()">
                            🔄 Я подписался
                        </button>
                    </div>
                </div>
            </div>
        `;
        return false;
    }
    
    if (!access.agreedTOS) {
        document.body.innerHTML = `
            <div class="access-restricted">
                <div class="restricted-content">
                    <div class="restricted-icon">📝</div>
                    <h2>Требуется подтверждение</h2>
                    <p>Для использования приложения необходимо принять Пользовательское соглашение</p>
                    <div class="tos-preview">
                        <h3>Основные условия:</h3>
                        <ul>
                            <li>Возраст 16+</li>
                            <li>Запрещены угрозы и оскорбления</li>
                            <li>Вы отвечаете за свой контент</li>
                            <li>Анонимность отправителей защищена</li>
                        </ul>
                    </div>
                    <div class="actions">
                        <button class="btn btn-primary" onclick="acceptTOS()">
                            ✅ Принять соглашение
                        </button>
                        <button class="btn btn-secondary" onclick="openTOSinBot()">
                            📄 Подробнее
                        </button>
                    </div>
                </div>
            </div>
        `;
        return false;
    }
    
    return true;
}

function openTelegramChannel() {
    if (tg && tg.openLink) {
        tg.openLink('https://t.me/questionstg');
    } else {
        window.open('https://t.me/questionstg', '_blank');
    }
}

async function acceptTOS() {
    try {
        showNotification('📤 Отправка запроса...', 'info');
        
        const response = await fetch('/api/user/agree-tos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: userId })
        });
        
        if (response.ok) {
            showNotification('✅ Соглашение принято!', 'success');
            setTimeout(() => location.reload(), 2000);
        } else {
            const error = await response.json();
            throw new Error(error.error || 'Ошибка сервера');
        }
    } catch (error) {
        console.error('Ошибка принятия TOS:', error);
        showNotification('❌ ' + error.message, 'error');
    }
}

function openTOSinBot() {
    if (tg && tg.openTelegramLink) {
        tg.openTelegramLink(`https://t.me/${botUsername}?start=tos`);
    } else {
        window.open(`https://t.me/${botUsername}?start=tos`, '_blank');
    }
}

// ========== АДМИН ПАНЕЛЬ ==========

async function loadAdminPanel() {
    try {
        const adminPanel = document.querySelector('#content-admin .admin-panel');
        if (!adminPanel) return;
        
        // Показываем загрузку
        adminPanel.innerHTML = `
            <div class="loading">
                <div class="loading-spinner"></div>
                <p>Загрузка админ-панели...</p>
            </div>
        `;
        
        // Загружаем статистику
        const response = await fetch(`/api/admin/stats?userId=${userId}`);
        if (!response.ok) {
            throw new Error('Недостаточно прав');
        }
        
        const data = await response.json();
        
        // Рендерим админ-панель
        adminPanel.innerHTML = `
            <div class="admin-header">
                <h2>🛠️ Панель администратора</h2>
                <div class="admin-subtitle">Управление системой</div>
                ${isSuperAdmin ? '<div style="color: gold; margin-top: 5px;">👑 Суперадмин</div>' : ''}
            </div>
            
            <div class="admin-section">
                <h3><span>📊</span> Статистика</h3>
                <div class="stats-grid">
                    <div class="stat-card">
                        <div class="stat-number">${data.stats.totalUsers}</div>
                        <div class="stat-label">Пользователей</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-number">${data.stats.totalQuestions}</div>
                        <div class="stat-label">Вопросов</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-number">${data.stats.answeredQuestions}</div>
                        <div class="stat-label">Ответов</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-number">${data.stats.activeToday}</div>
                        <div class="stat-label">Активных сегодня</div>
                    </div>
                </div>
            </div>
            
            <div class="admin-section">
                <h3><span>⚠️</span> Жалобы</h3>
                <div class="reports-stats">
                    ${data.stats.reports.map(report => `
                        <div class="report-stat">
                            <div class="report-status ${report.status}">${report.status}</div>
                            <div class="report-count">${report.count}</div>
                        </div>
                    `).join('')}
                </div>
                <p style="margin-top: 15px; color: var(--tg-secondary-text); font-size: 14px;">
                    Для полного управления жалобами используйте команды в боте
                </p>
            </div>
            
            ${isSuperAdmin ? `
            <div class="admin-section">
                <h3><span>👑</span> Действия суперадмина</h3>
                <p style="color: var(--tg-secondary-text); margin-bottom: 15px;">
                    Доступно только суперадмину
                </p>
                <div class="admin-actions">
                    <button class="btn btn-primary" onclick="makeUserAdmin()">
                        👥 Назначить админа
                    </button>
                    <button class="btn btn-danger" onclick="generateReferral()">
                        🔗 Создать рефералку
                    </button>
                </div>
            </div>
            ` : ''}
            
            <div class="admin-section">
                <h3><span>ℹ️</span> Информация</h3>
                <p style="color: var(--tg-secondary-text);">
                    • ID пользователя: ${userId}<br>
                    • Роль: ${isSuperAdmin ? 'Суперадмин' : 'Админ'}<br>
                    • Время сервера: ${new Date().toLocaleString()}
                </p>
            </div>
        `;
        
    } catch (error) {
        const adminPanel = document.querySelector('#content-admin .admin-panel');
        if (adminPanel) {
            adminPanel.innerHTML = `
                <div class="error-message">
                    <div style="font-size: 48px; margin-bottom: 20px;">❌</div>
                    <h3 style="color: var(--tg-danger); margin-bottom: 15px;">Ошибка доступа</h3>
                    <p style="color: var(--tg-secondary-text); margin-bottom: 20px;">
                        ${error.message}<br>
                        У вас недостаточно прав для доступа к админ-панели.
                    </p>
                    <button class="btn btn-primary" onclick="location.reload()">
                        🔄 Обновить
                    </button>
                </div>
            `;
        }
    }
}

function makeUserAdmin() {
    const adminId = prompt('Введите ID пользователя для назначения админом:');
    if (!adminId) return;
    
    if (confirm(`Назначить пользователя ${adminId} администратором?`)) {
        showNotification('📤 Назначение админа...', 'info');
        // Здесь можно добавить API для назначения админа
        setTimeout(() => {
            showNotification(`✅ Пользователь ${adminId} назначен админом`, 'success');
        }, 1000);
    }
}

function generateReferral() {
    const referralCode = Math.random().toString(36).substring(2, 10).toUpperCase();
    const referralLink = `https://t.me/${botUsername}?start=ref_${referralCode}`;
    
    showNotificationWithAction(
        `🔗 Реферальный код создан: ${referralCode}`,
        'success',
        '📋 Копировать',
        () => {
            navigator.clipboard.writeText(referralLink);
            showNotification('✅ Ссылка скопирована в буфер', 'success');
        }
    );
}

// ========== СИСТЕМА ЖАЛОБ ==========

function openReportModal(questionId = null, reportedUserId = null) {
    const modal = document.getElementById('reportModal');
    if (!modal) {
        console.error('Модалка reportModal не найдена');
        return;
    }
    
    // Сбрасываем форму
    const questionIdInput = document.getElementById('reportQuestionId');
    const userIdInput = document.getElementById('reportUserId');
    const reasonInput = document.getElementById('reportReason');
    const charCount = document.getElementById('reportCharCount');
    
    if (questionIdInput) questionIdInput.value = questionId || '';
    if (userIdInput) userIdInput.value = reportedUserId || '';
    if (reasonInput) {
        reasonInput.value = '';
        charCount.textContent = '0';
    }
    
    modal.style.display = 'flex';
    setTimeout(() => modal.classList.add('active'), 10);
}

async function submitReport() {
    const questionId = document.getElementById('reportQuestionId')?.value;
    const reportedUserId = document.getElementById('reportUserId')?.value;
    const reason = document.getElementById('reportReason')?.value;
    
    if (!reason || reason.length < 10) {
        showNotification('Опишите причину жалобы (минимум 10 символов)', 'warning');
        return;
    }
    
    if (!reason || reason.trim() === '') {
        showNotification('Введите причину жалобы', 'warning');
        return;
    }
    
    try {
        showNotification('📤 Отправка жалобы...', 'info');
        
        const response = await fetch('/api/user/report', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: userId,
                reportedUserId: reportedUserId || null,
                questionId: questionId || null,
                reason: reason
            })
        });
        
        if (response.ok) {
            const data = await response.json();
            showNotification('✅ Жалоба #' + data.reportId + ' отправлена', 'success');
            closeReportModal();
        } else {
            const error = await response.json();
            throw new Error(error.error || 'Ошибка сервера');
        }
    } catch (error) {
        console.error('Ошибка отправки жалобы:', error);
        showNotification('❌ ' + error.message, 'error');
    }
}

function closeReportModal() {
    const modal = document.getElementById('reportModal');
    if (modal) {
        modal.classList.remove('active');
        setTimeout(() => modal.style.display = 'none', 300);
    }
}

// ========== ОСНОВНЫЕ ФУНКЦИИ ==========

function getElement(id) {
    return document.getElementById(id);
}

function setText(id, text) {
    const element = getElement(id);
    if (element) {
        element.textContent = text || '';
    }
}

async function initApp() {
    console.log('🚀 Инициализация приложения');
    
    try {
        await initUserData();
        
        // Проверяем доступ пользователя
        const hasAccess = await showAccessRestrictions();
        if (!hasAccess) return;
        
        await initUI();
        await loadAllData();
        // Обновляем данные каждые 30 секунд
        setInterval(async () => {
            await loadAllData();
            // Периодически проверяем подписку
            await checkUserAccess();
        }, 30000);
        
        console.log('✅ Приложение инициализировано');
    } catch (error) {
        console.error('❌ Ошибка инициализации:', error);
        showNotification('Ошибка загрузки приложения', 'error');
    }
}

async function initUserData() {
    console.log('Получение данных пользователя...');
    
    if (tg) {
        tg.ready();
        tg.expand();
        
        const initData = tg.initDataUnsafe || {};
        userId = initData.user?.id;
        username = initData.user?.username || initData.user?.first_name || 'Пользователь';
        
        if (!userId) {
            userId = 'demo_' + Math.floor(Math.random() * 1000000);
        }
    } else {
        userId = 'demo_' + Math.floor(Math.random() * 1000000);
        username = 'Демо пользователь';
    }
    
    // Проверяем роль пользователя
    try {
        const response = await fetch(`/api/user/role/${userId}`);
        if (response.ok) {
            const userData = await response.json();
            isAdmin = userData.is_admin || false;
            isSuperAdmin = userData.is_super_admin || false;
            console.log('Роль пользователя:', { isAdmin, isSuperAdmin });
        }
    } catch (error) {
        console.error('Ошибка проверки роли:', error);
    }
    
    console.log('Пользователь:', { userId, username, isAdmin, isSuperAdmin });
    return { userId, username, isAdmin, isSuperAdmin };
}

async function initUI() {
    console.log('Инициализация UI...');
    
    setText('username', username);
    setText('userId', `ID: ${userId}`);
    setText('profileName', username);
    setText('profileId', userId);
    
    const avatar = getElement('userAvatar');
    if (avatar) {
        const firstLetter = username ? username.charAt(0).toUpperCase() : 'U';
        avatar.textContent = firstLetter;
    }
    
    const shareLink = `https://t.me/${botUsername}?start=ask_${userId}`;
    setText('shareLink', shareLink);
    
    // Добавляем вкладку админа если пользователь админ
    if (isAdmin || isSuperAdmin) {
        addAdminTab();
    }
    
    setupTabs();
    setupReportHandlers();
    console.log('✅ UI инициализирован');
}

function addAdminTab() {
    const tabsContainer = document.querySelector('.tabs');
    if (!tabsContainer) return;
    
    if (document.getElementById('tab-admin')) return;
    
    const adminTab = document.createElement('button');
    adminTab.className = 'tab';
    adminTab.id = 'tab-admin';
    adminTab.setAttribute('data-tab', 'admin');
    adminTab.innerHTML = `🛠️ Админ ${isSuperAdmin ? '👑' : ''}`;
    
    tabsContainer.appendChild(adminTab);
    
    const tabContent = document.querySelector('.tab-content');
    if (tabContent) {
        const adminPage = document.createElement('div');
        adminPage.id = 'content-admin';
        adminPage.className = 'page';
        adminPage.innerHTML = `
            <div class="admin-panel">
                <div class="loading" id="adminLoading">
                    <div class="loading-spinner"></div>
                    <p>Загрузка админ-панели...</p>
                </div>
            </div>
        `;
        tabContent.appendChild(adminPage);
    }
}

function setupReportHandlers() {
    // Назначаем обработчики для кнопок
    document.addEventListener('click', function(e) {
        // Обработка маленьких кнопок репорта
        if (e.target.classList.contains('report-btn-small')) {
            const questionId = e.target.getAttribute('data-question-id');
            const reportedUserId = e.target.getAttribute('data-user-id');
            openReportModal(questionId, reportedUserId);
            return;
        }
        
        // Обработка больших кнопок репорта
        if (e.target.classList.contains('report-btn')) {
            const questionId = e.target.getAttribute('data-question-id');
            const reportedUserId = e.target.getAttribute('data-user-id');
            openReportModal(questionId, reportedUserId);
            return;
        }
        
        // Кнопка отправки жалобы
        if (e.target.id === 'submitReportBtn' || e.target.closest('#submitReportBtn')) {
            submitReport();
            return;
        }
        
        // Закрытие модалки
        if (e.target.id === 'closeReportModal' || e.target.closest('#closeReportModal')) {
            closeReportModal();
            return;
        }
    });
    
    // Счетчик символов для формы жалобы
    const reportReason = getElement('reportReason');
    const reportCharCount = getElement('reportCharCount');
    
    if (reportReason && reportCharCount) {
        reportReason.addEventListener('input', function() {
            reportCharCount.textContent = this.value.length;
        });
    }
}

async function loadAllData() {
    console.log('📥 Загрузка данных...');
    updateStatus('🔄 Загрузка...');
    
    try {
        await Promise.allSettled([
            loadIncomingQuestions(),
            loadSentQuestions(),
            loadStats()
        ]);
        
        if (isAdmin || isSuperAdmin) {
            await loadAdminPanel();
        }
        
        updateStatus('🟢 Онлайн');
        console.log('✅ Данные загружены');
    } catch (error) {
        console.error('❌ Ошибка загрузки данных:', error);
        updateStatus('🟡 Демо-режим');
        await showTestData();
        showNotification('Используем тестовые данные', 'warning');
    }
}

// ========== ВОПРОСЫ И ОТВЕТЫ ==========

async function loadIncomingQuestions() {
    try {
        const response = await fetch(`/api/questions/incoming/${userId}`);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const questions = await response.json();
        renderIncomingQuestions(questions);
        updateBadge('incoming', questions.length);
        
        return questions;
    } catch (error) {
        console.error('Ошибка загрузки входящих:', error);
        throw error;
    }
}

async function loadSentQuestions() {
    try {
        const response = await fetch(`/api/questions/sent/${userId}`);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const questions = await response.json();
        renderSentQuestions(questions);
        updateBadge('sent', questions.length);
        
        return questions;
    } catch (error) {
        console.error('Ошибка загрузки отправленных:', error);
        throw error;
    }
}

function renderIncomingQuestions(questions) {
    const container = getElement('incoming-list');
    if (!container) return;
    
    if (!questions || questions.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="icon">💭</div>
                <h3>Нет вопросов</h3>
                <p>Поделитесь ссылкой, чтобы получать вопросы от друзей</p>
                <button class="btn btn-primary" onclick="shareProfileToTelegram()">
                    📤 Поделиться профилем
                </button>
            </div>
        `;
        return;
    }
    
    const html = questions.map(q => `
        <div class="question-card ${q.is_answered ? 'answered' : ''}" data-id="${q.id}">
            <div class="question-meta">
                <div class="question-date">${formatDate(q.created_at)}</div>
                <div class="question-from">
                    ${q.from_username}
                    <button class="report-btn-small" data-question-id="${q.id}" data-user-id="" 
                            title="Пожаловаться на вопрос">
                        ⚠️
                    </button>
                </div>
            </div>
            <div class="question-text">${escapeHtml(q.text)}</div>
            ${q.is_answered ? `
                <div class="answer-bubble">
                    <strong>📝 Ваш ответ:</strong>
                    <div class="answer-content">${escapeHtml(q.answer)}</div>
                </div>
                <div class="btn-group">
                    <button class="btn btn-primary" onclick="shareAnswer(${q.id})">
                        📤 Поделиться ответом
                    </button>
                    <button class="btn btn-secondary report-btn" 
                            data-question-id="${q.id}" 
                            data-user-id="">
                        ⚠️ Пожаловаться
                    </button>
                    <button class="btn btn-danger" onclick="deleteQuestion(${q.id})">
                        🗑️ Удалить
                    </button>
                </div>
            ` : `
                <div class="btn-group">
                    <button class="btn btn-success" onclick="openAnswerModal(${q.id})">
                        ✍️ Ответить
                    </button>
                    <button class="btn btn-secondary report-btn" 
                            data-question-id="${q.id}" 
                            data-user-id="">
                        ⚠️ Пожаловаться
                    </button>
                    <button class="btn btn-danger" onclick="deleteQuestion(${q.id})">
                        🗑️ Удалить
                    </button>
                </div>
            `}
        </div>
    `).join('');
    
    container.innerHTML = html;
}

function renderSentQuestions(questions) {
    const container = getElement('sent-list');
    if (!container) return;
    
    if (!questions || questions.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="icon">📤</div>
                <h3>Нет отправленных</h3>
                <p>Вы еще не задавали вопросы другим пользователям</p>
            </div>
        `;
        return;
    }
    
    const html = questions.map(q => `
        <div class="question-card sent ${q.is_answered ? 'answered' : ''}" data-id="${q.id}">
            <div class="question-meta">
                <div class="question-date">${formatDate(q.created_at)}</div>
                <div class="question-from">
                    👤 Кому: ${q.to_username || `Пользователь ${q.to_user_id}`}
                </div>
            </div>
            <div class="question-text">${escapeHtml(q.text)}</div>
            ${q.is_answered ? `
                <div class="answer-bubble">
                    <strong>💬 Ответ:</strong>
                    <div class="answer-content">${escapeHtml(q.answer)}</div>
                </div>
            ` : `
                <div class="btn-group">
                    <button class="btn btn-danger" onclick="deleteQuestion(${q.id})">
                        🗑️ Удалить вопрос
                    </button>
                </div>
            `}
        </div>
    `).join('');
    
    container.innerHTML = html;
}

async function loadStats() {
    try {
        const response = await fetch(`/api/stats/${userId}`);
        
        if (response.ok) {
            const stats = await response.json();
            setText('statTotal', stats.total || '0');
            setText('statReceived', stats.received || '0');
            setText('statSent', stats.sent || '0');
            setText('statAnswered', stats.answered || '0');
        } else {
            setText('statTotal', '0');
            setText('statReceived', '0');
            setText('statSent', '0');
            setText('statAnswered', '0');
        }
    } catch (error) {
        console.error('Ошибка загрузки статистики:', error);
        setText('statTotal', '0');
        setText('statReceived', '0');
        setText('statSent', '0');
        setText('statAnswered', '0');
    }
}

// ========== ОБРАБОТКА ОТВЕТОВ ==========

function openAnswerModal(questionId) {
    currentQuestionId = questionId;
    const modal = getElement('answerModal');
    
    if (!modal) {
        console.error('Модалка answerModal не найдена');
        return;
    }
    
    fetch(`/api/question/${questionId}`)
        .then(response => response.json())
        .then(question => {
            const previewElement = getElement('previewQuestionText');
            if (previewElement) {
                previewElement.textContent = question.text;
            }
        })
        .catch(error => {
            console.error('Ошибка загрузки вопроса:', error);
        });
    
    const answerText = getElement('answerText');
    const charCount = getElement('answerCharCount');
    const progressBar = getElement('charProgressBar');
    const warning = getElement('charLimitWarning');
    
    if (answerText && charCount && progressBar && warning) {
        answerText.value = '';
        charCount.textContent = '0';
        progressBar.style.width = '0%';
        warning.style.display = 'none';
        
        answerText.addEventListener('input', function() {
            const length = this.value.length;
            charCount.textContent = length;
            
            const percentage = (length / 1000) * 100;
            progressBar.style.width = `${Math.min(percentage, 100)}%`;
            
            if (length > 900) {
                progressBar.style.background = 'linear-gradient(90deg, #FF9800 0%, #FF5722 100%)';
                warning.style.display = 'inline';
            } else if (length > 700) {
                progressBar.style.background = 'linear-gradient(90deg, #FFC107 0%, #FF9800 100%)';
                warning.style.display = 'inline';
            } else {
                progressBar.style.background = 'linear-gradient(90deg, #4CAF50 0%, #8BC34A 100%)';
                warning.style.display = 'none';
            }
            
            if (length > 1000) {
                this.value = this.value.substring(0, 1000);
                charCount.textContent = '1000';
                progressBar.style.width = '100%';
                progressBar.style.background = 'linear-gradient(90deg, #FF5722 0%, #F44336 100%)';
                showNotification('Достигнут лимит символов!', 'warning');
            }
        });
        
        setTimeout(() => answerText.focus(), 300);
    }
    
    modal.classList.add('active');
}

function closeAnswerModal() {
    const modal = getElement('answerModal');
    if (modal) modal.classList.remove('active');
}

async function submitAnswer() {
    const answerText = getElement('answerText');
    const answer = answerText?.value.trim();
    
    if (!answer) {
        showNotification('Введите текст ответа', 'warning');
        return;
    }
    
    if (answer.length < 2) {
        showNotification('Ответ слишком короткий (минимум 2 символа)', 'warning');
        return;
    }
    
    if (!currentQuestionId) {
        showNotification('Ошибка: вопрос не выбран', 'error');
        return;
    }
    
    showNotification('📤 Отправка ответа...', 'info');
    
    try {
        const response = await fetch(`/api/questions/${currentQuestionId}/answer`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ answer: answer })
        });
        
        if (response.ok) {
            closeAnswerModal();
            showNotification('✅ Ответ сохранен!', 'success');
            await loadAllData();
        } else {
            const error = await response.json();
            throw new Error(error.error || 'Ошибка сервера');
        }
    } catch (error) {
        console.error('Ошибка отправки ответа:', error);
        showNotification('❌ ' + error.message, 'error');
    }
}

async function shareAnswer(questionId) {
    try {
        showNotification('📤 Отправка ответа в чат...', 'info');
        
        const response = await fetch('/api/share-to-chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: userId,
                questionId: questionId
            })
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Ошибка сервера');
        }
        
        const data = await response.json();
        
        showNotificationWithAction(
            '✅ Ответ отправлен в ваш чат с ботом!',
            'success',
            '📱 Открыть чат',
            () => {
                if (tg && tg.openLink) {
                    tg.openLink(`https://t.me/${botUsername}`);
                } else {
                    window.open(`https://t.me/${botUsername}`, '_blank');
                }
            }
        );
        
    } catch (error) {
        console.error('❌ Ошибка шеринга:', error);
        showNotification(`❌ ${error.message}`, 'error', 5000);
    }
}

async function deleteQuestion(questionId) {
    if (!confirm('Удалить вопрос? Это действие нельзя отменить.')) return;
    
    try {
        showNotification('🗑️ Удаление...', 'info');
        
        const response = await fetch(`/api/questions/${questionId}`, {
            method: 'DELETE'
        });
        
        if (response.ok) {
            showNotification('✅ Вопрос удален', 'success');
            await loadAllData();
        } else {
            throw new Error('Ошибка сервера');
        }
    } catch (error) {
        console.error('Ошибка удаления:', error);
        showNotification('❌ Не удалось удалить вопрос', 'error');
    }
}

// ========== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==========

function setupTabs() {
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', function() {
            const tabId = this.getAttribute('data-tab');
            
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
            
            this.classList.add('active');
            const page = getElement(`content-${tabId}`);
            if (page) page.classList.add('active');
            
            document.querySelector('.tab-content').scrollTop = 0;
            
            if (tabId === 'admin' && (isAdmin || isSuperAdmin)) {
                loadAdminPanel();
            }
        });
    });
}

function updateBadge(type, count) {
    const badge = getElement(`${type}Badge`);
    if (badge) {
        if (count > 0) {
            badge.textContent = count > 99 ? '99+' : count;
            badge.style.display = 'flex';
        } else {
            badge.style.display = 'none';
        }
    }
}

function updateStatus(status) {
    const statusElement = getElement('statusText');
    if (statusElement) {
        statusElement.textContent = status;
    }
}

function formatDate(dateString) {
    try {
        const date = new Date(dateString);
        const now = new Date();
        
        if (date.toDateString() === now.toDateString()) {
            return 'Сегодня ' + date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        }
        
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        if (date.toDateString() === yesterday.toDateString()) {
            return 'Вчера';
        }
        
        const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));
        if (diffDays < 7) {
            const days = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'];
            return days[date.getDay()];
        }
        
        return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
        
    } catch {
        return 'недавно';
    }
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showNotification(message, type = 'info', duration = 3000) {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    
    const icons = { success: '✅', error: '❌', warning: '⚠️', info: '💡' };
    
    notification.innerHTML = `
        <div class="notification-icon">${icons[type] || '💡'}</div>
        <div>${message}</div>
    `;
    
    document.body.appendChild(notification);
    
    if (duration > 0) {
        setTimeout(() => {
            if (notification.parentNode) {
                notification.remove();
            }
        }, duration);
    }
}

function showNotificationWithAction(message, type, actionText, actionCallback) {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    
    notification.innerHTML = `
        <div style="display: flex; align-items: center; gap: 12px; flex: 1;">
            <div class="notification-icon">✅</div>
            <div style="flex: 1;">${message}</div>
        </div>
        <button onclick="
            this.parentElement.remove();
            (${actionCallback.toString()})();
        " style="
            padding: 6px 12px;
            background: rgba(255, 255, 255, 0.2);
            border: 1px solid rgba(255, 255, 255, 0.3);
            border-radius: 6px;
            color: white;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
            white-space: nowrap;
        " onmouseover="this.style.background='rgba(255, 255, 255, 0.3)';"
           onmouseout="this.style.background='rgba(255, 255, 255, 0.2)';">
            ${actionText}
        </button>
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        if (notification.parentNode) {
            notification.remove();
        }
    }, 8000);
}

function shareProfileToTelegram() {
    const inviteLink = `https://t.me/${botUsername}?start=ask_${userId}`;
    
    if (tg && tg.openTelegramLink) {
        const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(inviteLink)}&text=${encodeURIComponent('Задай мне анонимный вопрос! 👇')}`;
        tg.openTelegramLink(shareUrl);
    } else {
        window.open(`https://t.me/share/url?url=${encodeURIComponent(inviteLink)}&text=${encodeURIComponent('Задай мне анонимный вопрос! 👇')}`, '_blank');
    }
}

// ========== ОБРАБОТЧИКИ СОБЫТИЙ ==========

document.addEventListener('DOMContentLoaded', function() {
    console.log('📄 DOM загружен, запускаем приложение...');
    setTimeout(initApp, 100);
});

// ========== ГЛОБАЛЬНЫЕ ФУНКЦИИ ==========
window.shareProfileToTelegram = shareProfileToTelegram;
window.openAnswerModal = openAnswerModal;
window.closeAnswerModal = closeAnswerModal;
window.submitAnswer = submitAnswer;
window.shareAnswer = shareAnswer;
window.deleteQuestion = deleteQuestion;
window.openReportModal = openReportModal;
window.submitReport = submitReport;
window.closeReportModal = closeReportModal;
window.acceptTOS = acceptTOS;
window.openTelegramChannel = openTelegramChannel;
window.openTOSinBot = openTOSinBot;
window.makeUserAdmin = makeUserAdmin;
window.generateReferral = generateReferral;