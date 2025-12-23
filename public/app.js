// Telegram Web App
let tg = window.Telegram?.WebApp;
let userId = null;
let username = null;
let currentQuestionId = null;
let isAdmin = false;
let isSuperAdmin = false;
const botUsername = 'questionstgbot';

// ========== ОСНОВНЫЕ ФУНКЦИИ ==========

function getElement(id) {
    const element = document.getElementById(id);
    if (!element) {
        console.warn(`⚠️ Элемент ${id} не найден`);
    }
    return element;
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
        await initUI();
        await loadAllData();
        setInterval(loadAllData, 30000);
        
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
    if (isAdmin) {
        addAdminTab();
    }
    
    setupTabs();
    console.log('✅ UI инициализирован');
}

function addAdminTab() {
    const tabsContainer = document.querySelector('.tabs');
    if (!tabsContainer) return;
    
    // Проверяем, нет ли уже вкладки админа
    if (document.getElementById('tab-admin')) return;
    
    const adminTab = document.createElement('button');
    adminTab.className = 'tab';
    adminTab.id = 'tab-admin';
    adminTab.setAttribute('data-tab', 'admin');
    adminTab.innerHTML = `🛠️ Админ ${isSuperAdmin ? '👑' : ''}`;
    
    tabsContainer.appendChild(adminTab);
    
    // Добавляем контент для админ-панели
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

async function loadAllData() {
    console.log('📥 Загрузка данных...');
    updateStatus('🔄 Загрузка...');
    
    try {
        await Promise.allSettled([
            loadIncomingQuestions(),
            loadSentQuestions(),
            loadStats()
        ]);
        
        // Загружаем админ-панель если пользователь админ
        if (isAdmin) {
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

// ========== АДМИН-ПАНЕЛЬ ==========

async function loadAdminPanel() {
    try {
        const response = await fetch(`/api/admin/stats?userId=${userId}`);
        
        if (!response.ok) {
            if (response.status === 403) {
                console.log('Доступ к админ-панели запрещен');
                return;
            }
            throw new Error(`HTTP ${response.status}`);
        }
        
        const data = await response.json();
        renderAdminPanel(data);
        
    } catch (error) {
        console.error('Ошибка загрузки админ-панели:', error);
        showNotification('Ошибка загрузки админ-панели', 'error');
    }
}

function renderAdminPanel(data) {
    const adminPanel = document.querySelector('.admin-panel');
    if (!adminPanel) return;
    
    const { stats, userStats, referralStats } = data;
    
    adminPanel.innerHTML = `
        <div class="admin-header">
            <h2>🛠️ Админ-панель ${stats.isSuperAdmin ? '👑' : ''}</h2>
            <p class="admin-subtitle">${stats.isSuperAdmin ? 'Главный администратор' : 'Администратор'}</p>
        </div>
        
        <div class="stats-grid admin-stats">
            <div class="stat-card">
                <div class="stat-number">${stats.totalUsers}</div>
                <div class="stat-label">Всего пользователей</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${stats.totalQuestions}</div>
                <div class="stat-label">Всего вопросов</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${stats.answeredQuestions}</div>
                <div class="stat-label">Отвечено</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${stats.activeToday}</div>
                <div class="stat-label">Активных сегодня</div>
            </div>
        </div>
        
        ${stats.isSuperAdmin ? `
        <div class="admin-section">
            <h3>👥 Пользователи</h3>
            <div class="users-table-container">
                <table class="users-table">
                    <thead>
                        <tr>
                            <th>ID</th>
                            <th>Username</th>
                            <th>Роль</th>
                            <th>Вопросы</th>
                            <th>Приглашено</th>
                            <th>Дата</th>
                        </tr>
                    </thead>
                    <tbody id="usersTableBody">
                        ${userStats.map(user => `
                            <tr>
                                <td><code>${user.telegram_id}</code></td>
                                <td>${user.username || '-'}</td>
                                <td>
                                    ${user.is_super_admin ? '👑 Супер-админ' : user.is_admin ? '🛠️ Админ' : '👤 Пользователь'}
                                </td>
                                <td>${user.questions_sent} отправ. / ${user.questions_received} получ. / ${user.questions_answered} ответ.</td>
                                <td>${user.invited_users}</td>
                                <td>${new Date(user.created_at).toLocaleDateString()}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>
        
        <div class="admin-section">
            <h3>👑 Назначение админов</h3>
            <div class="make-admin-form">
                <input type="number" id="adminUserId" placeholder="ID пользователя" class="admin-input">
                <button onclick="makeAdmin()" class="btn btn-primary">Сделать админом</button>
            </div>
        </div>
        ` : ''}
        
        <div class="admin-section">
            <h3>🔗 Реферальные ссылки</h3>
            <div class="referral-actions">
                <button onclick="createReferralLink()" class="btn btn-primary">
                    🔗 Создать реферальную ссылку
                </button>
            </div>
            
            ${referralStats.length > 0 ? `
            <div class="referrals-list">
                <h4>Ваши реферальные ссылки:</h4>
                ${referralStats.map(ref => `
                    <div class="referral-item">
                        <div class="referral-code">
                            <strong>Код:</strong> <code>${ref.referral_code}</code>
                        </div>
                        <div class="referral-link">
                            <strong>Ссылка:</strong> 
                            <code>https://t.me/${botUsername}?start=ref_${ref.referral_code}</code>
                        </div>
                        <div class="referral-stats">
                            <span>Использовано: ${ref.used_count}/${ref.max_uses}</span>
                            <span>Создал: ${ref.admin_username || 'админ'}</span>
                            <span>Статус: ${ref.is_active ? '✅ Активна' : '❌ Не активна'}</span>
                        </div>
                    </div>
                `).join('')}
            </div>
            ` : '<p class="empty-message">У вас нет реферальных ссылок</p>'}
        </div>
        
        <div class="admin-actions">
            <button onclick="refreshAdminPanel()" class="btn btn-secondary">
                🔄 Обновить
            </button>
            ${stats.isSuperAdmin ? `
            <button onclick="exportData()" class="btn btn-primary">
                📊 Экспорт данных
            </button>
            ` : ''}
        </div>
    `;
}

async function makeAdmin() {
    const targetUserId = document.getElementById('adminUserId')?.value;
    
    if (!targetUserId) {
        showNotification('Введите ID пользователя', 'warning');
        return;
    }
    
    try {
        const response = await fetch('/api/admin/make-admin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: userId,
                targetUserId: targetUserId
            })
        });
        
        if (response.ok) {
            const data = await response.json();
            showNotification('✅ Пользователь назначен админом', 'success');
            document.getElementById('adminUserId').value = '';
            await loadAdminPanel();
        } else {
            const error = await response.json();
            throw new Error(error.error || 'Ошибка сервера');
        }
    } catch (error) {
        console.error('Ошибка назначения админа:', error);
        showNotification('❌ ' + error.message, 'error');
    }
}

async function createReferralLink() {
    try {
        const response = await fetch('/api/admin/create-referral', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: userId })
        });
        
        if (response.ok) {
            const data = await response.json();
            
            // Копируем ссылку в буфер обмена
            navigator.clipboard.writeText(data.referralLink).then(() => {
                showNotification('✅ Реферальная ссылка создана и скопирована!', 'success');
            }).catch(() => {
                showNotification(`✅ Реферальная ссылка создана: ${data.referralLink}`, 'success');
            });
            
            await loadAdminPanel();
        } else {
            const error = await response.json();
            throw new Error(error.error || 'Ошибка сервера');
        }
    } catch (error) {
        console.error('Ошибка создания реферальной ссылки:', error);
        showNotification('❌ ' + error.message, 'error');
    }
}

function refreshAdminPanel() {
    loadAdminPanel();
}

function exportData() {
    showNotification('Экспорт данных в разработке', 'info');
}

// ========== ОСТАЛЬНЫЕ ФУНКЦИИ ==========

async function showTestData() {
    const testIncoming = [
        {
            id: 1,
            text: "Тестовый вопрос 1?",
            answer: null,
            is_answered: false,
            created_at: new Date().toISOString(),
            from_username: 'Аноним'
        }
    ];
    
    const testSent = [
        {
            id: 2,
            text: "Тестовый отправленный вопрос?",
            answer: "Тестовый ответ",
            is_answered: true,
            created_at: new Date(Date.now() - 86400000).toISOString(),
            to_user_id: 123456,
            to_username: 'test_user'
        }
    ];
    
    renderIncomingQuestions(testIncoming);
    renderSentQuestions(testSent);
    updateBadge('incoming', testIncoming.length);
    updateBadge('sent', testSent.length);
    
    setText('statTotal', '2');
    setText('statReceived', '1');
    setText('statSent', '1');
    setText('statAnswered', '1');
}

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

async function loadStats() {
    try {
        const response = await fetch(`/api/stats/${userId}`);
        
        if (response.ok) {
            const stats = await response.json();
            setText('statTotal', stats.total || '0');
            setText('statReceived', stats.received || '0');
            setText('statSent', stats.sent || '0');
            setText('statAnswered', stats.answered || '0');
            
            // Обновляем количество приглашенных если есть
            if (stats.invited !== undefined) {
                const invitedElement = document.getElementById('statInvited');
                if (invitedElement) {
                    invitedElement.textContent = stats.invited;
                }
            }
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
                    ${q.from_username ? `@${q.from_username}` : '👤 Аноним'}
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
                    <button class="btn btn-danger" onclick="deleteQuestion(${q.id})">
                        🗑️ Удалить
                    </button>
                </div>
            ` : `
                <div class="btn-group">
                    <button class="btn btn-success" onclick="openAnswerModal(${q.id})">
                        ✍️ Ответить
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
                    👤 Кому: ${q.to_username ? `@${q.to_username}` : `ID ${q.to_user_id}`}
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
            
            // Если выбрана вкладка админа, обновляем данные
            if (tabId === 'admin' && isAdmin) {
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
            (${actionCallback.toString().replace('function ', 'function ')})();
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

// ========== ОБРАБОТКА ОТВЕТОВ ==========

function openAnswerModal(questionId) {
    currentQuestionId = questionId;
    const modal = getElement('answerModal');
    
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
    
    if (modal) modal.classList.add('active');
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
        showNotification('❌ Ошибка: ' + error.message, 'error');
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
window.makeAdmin = makeAdmin;
window.createReferralLink = createReferralLink;
window.refreshAdminPanel = refreshAdminPanel;
window.showNotificationWithAction = showNotificationWithAction;