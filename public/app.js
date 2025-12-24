// Telegram Web App
let tg = window.Telegram?.WebApp;
let userId = null;
let username = null;
let currentQuestionId = null;
let currentReportedUserId = null;
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
    
    if (access.isBlocked) {
        const blockedUntil = access.user.blocked_until;
        const blockedMessage = blockedUntil ? 
            `Ваш аккаунт заблокирован до ${new Date(blockedUntil).toLocaleString('ru-RU')}` :
            'Ваш аккаунт заблокирован навсегда';
        
        document.body.innerHTML = `
            <div class="access-restricted">
                <div class="restricted-content">
                    <div class="restricted-icon">🚫</div>
                    <h2>Аккаунт заблокирован</h2>
                    <p>${blockedMessage}</p>
                    <p style="color: var(--tg-danger); margin-top: 20px;">
                        Если вы считаете, что это ошибка, свяжитесь с администратором.
                    </p>
                    <div class="actions">
                        <button class="btn btn-primary" onclick="contactAdmin()">
                            📞 Связаться с админом
                        </button>
                    </div>
                </div>
            </div>
        `;
        return false;
    }
    
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
                        <button class="btn btn-secondary" onclick="openTOS()">
                            📄 Полное соглашение
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

function contactAdmin() {
    if (tg && tg.openTelegramLink) {
        tg.openTelegramLink(`https://t.me/${botUsername}`);
    } else {
        window.open(`https://t.me/${botUsername}`, '_blank');
    }
}

function openTOS() {
    if (tg && tg.openTelegramLink) {
        tg.openTelegramLink(`https://t.me/${botUsername}?start=tos`);
    } else {
        window.open(`https://t.me/${botUsername}?start=tos`, '_blank');
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

// ========== СИСТЕМА ЖАЛОБ ==========

// Универсальная функция открытия модалки жалобы
function openReportModal(questionId = null, reportedUserId = null) {
    console.log('Открытие модалки жалобы:', { questionId, reportedUserId });
    
    currentQuestionId = questionId;
    currentReportedUserId = reportedUserId;
    
    // Сброс формы
    const reasonInput = document.getElementById('reportReason');
    const detailsInput = document.getElementById('reportDetails');
    const questionIdInput = document.getElementById('reportQuestionId');
    const userIdInput = document.getElementById('reportUserId');
    
    if (reasonInput) reasonInput.value = '';
    if (detailsInput) detailsInput.value = '';
    if (questionIdInput) questionIdInput.value = questionId || '';
    if (userIdInput) userIdInput.value = reportedUserId || '';
    
    // Сброс выбранных причин
    document.querySelectorAll('.report-reason-item').forEach(item => {
        item.classList.remove('selected');
    });
    
    // Показать модалку
    const modal = document.getElementById('reportModal');
    if (modal) {
        modal.style.display = 'flex';
        setTimeout(() => modal.classList.add('active'), 10);
    } else {
        console.error('Модалка reportModal не найдена');
        showNotification('Ошибка: форма жалобы не загружена', 'error');
    }
}

// Функция для отправки жалобы
async function submitReport() {
    console.log('Отправка жалобы...');
    
    const reason = document.getElementById('reportReason')?.value;
    const details = document.getElementById('reportDetails')?.value;
    const questionId = document.getElementById('reportQuestionId')?.value;
    const reportedUserId = document.getElementById('reportUserId')?.value;
    
    console.log('Данные жалобы:', { reason, details, questionId, reportedUserId });
    
    if (!reason) {
        showNotification('Выберите причину жалобы', 'warning');
        return;
    }
    
    if (reason === 'other' && (!details || details.trim().length < 10)) {
        showNotification('Опишите причину жалобы (минимум 10 символов)', 'warning');
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
                reason: reason,
                details: details || null
            })
        });
        
        if (response.ok) {
            const data = await response.json();
            showNotification('✅ Жалоба отправлена на рассмотрение', 'success');
            closeReportModal();
            
            // Перезагружаем данные
            await loadAllData();
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

// ========== АДМИН ПАНЕЛЬ ==========

async function loadAdminPanel() {
    try {
        const adminPanel = document.querySelector('#content-admin .admin-panel');
        if (!adminPanel) return;
        
        adminPanel.innerHTML = `
            <div class="loading">
                <div class="loading-spinner"></div>
                <p>Загрузка админ-панели...</p>
            </div>
        `;
        
        const response = await fetch(`/api/admin/stats?userId=${userId}`);
        if (!response.ok) {
            throw new Error('Недостаточно прав');
        }
        
        const data = await response.json();
        
        let usersListHTML = '';
        if (isSuperAdmin) {
            try {
                const usersResponse = await fetch(`/api/admin/users?adminId=${userId}`);
                if (usersResponse.ok) {
                    const usersData = await usersResponse.json();
                    usersListHTML = renderUsersList(usersData.users);
                }
            } catch (error) {
                console.error('Ошибка загрузки пользователей:', error);
                usersListHTML = '<p style="color: var(--tg-danger);">Ошибка загрузки пользователей</p>';
            }
        }
        
        let reportsListHTML = '';
        if (isAdmin || isSuperAdmin) {
            try {
                const reportsResponse = await fetch(`/api/admin/reports?adminId=${userId}`);
                if (reportsResponse.ok) {
                    const reportsData = await reportsResponse.json();
                    reportsListHTML = renderReportsList(reportsData.reports);
                }
            } catch (error) {
                console.error('Ошибка загрузки жалоб:', error);
                reportsListHTML = '<p style="color: var(--tg-danger);">Ошибка загрузки жалоб</p>';
            }
        }
        
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
                        <div class="stat-label">Активных</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-number">${data.stats.blockedUsers}</div>
                        <div class="stat-label">Заблокировано</div>
                    </div>
                </div>
            </div>
            
            ${reportsListHTML ? `
            <div class="admin-section">
                <h3><span>⚠️</span> Жалобы</h3>
                ${reportsListHTML}
            </div>
            ` : ''}
            
            ${isSuperAdmin ? `
            <div class="admin-section">
                <h3><span>👥</span> Пользователи системы</h3>
                ${usersListHTML || '<p style="color: var(--tg-secondary-text);">Загрузка списка пользователей...</p>'}
            </div>
            ` : ''}
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

function renderUsersList(users) {
    if (!users || users.length === 0) {
        return '<p style="color: var(--tg-secondary-text);">Нет пользователей</p>';
    }
    
    return `
        <div class="users-table-container">
            <table class="users-table">
                <thead>
                    <tr>
                        <th>ID</th>
                        <th>Имя</th>
                        <th>Статус</th>
                        <th>Действия</th>
                    </tr>
                </thead>
                <tbody>
                    ${users.map(user => {
                        const isBlocked = user.is_blocked && 
                            (!user.blocked_until || new Date(user.blocked_until) > new Date());
                        
                        return `
                        <tr>
                            <td><code>${user.telegram_id}</code></td>
                            <td>
                                <div style="display: flex; align-items: center; gap: 8px;">
                                    <div class="mini-avatar" style="
                                        width: 32px;
                                        height: 32px;
                                        background: ${isBlocked ? 'var(--tg-danger)' : 'linear-gradient(135deg, var(--tg-accent-color), #6c5ce7)'};
                                        border-radius: 50%;
                                        display: flex;
                                        align-items: center;
                                        justify-content: center;
                                        color: white;
                                        font-weight: 600;
                                        font-size: 14px;
                                    ">
                                        ${(user.username || user.first_name || 'U').charAt(0).toUpperCase()}
                                    </div>
                                    <div>
                                        ${user.username ? '@' + user.username : user.first_name || 'Пользователь'}
                                        ${user.is_super_admin ? '👑' : user.is_admin ? '🛠️' : ''}
                                    </div>
                                </div>
                            </td>
                            <td>
                                <span style="
                                    padding: 4px 8px;
                                    border-radius: 12px;
                                    font-size: 12px;
                                    font-weight: 600;
                                    background: ${isBlocked ? 'rgba(229, 57, 53, 0.2)' : 
                                        user.subscribed_channel && user.agreed_tos ? 'rgba(76, 175, 80, 0.2)' : 
                                        'rgba(255, 152, 0, 0.2)'};
                                    color: ${isBlocked ? 'var(--tg-danger)' : 
                                        user.subscribed_channel && user.agreed_tos ? 'var(--tg-success)' : 
                                        'var(--tg-warning)'};
                                ">
                                    ${isBlocked ? 'Заблокирован' : 
                                        user.subscribed_channel && user.agreed_tos ? 'Активен' : 'Не активен'}
                                </span>
                            </td>
                            <td>
                                <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                                    ${isSuperAdmin ? `
                                    <button class="btn-action" 
                                            onclick="handleUserAction(${user.telegram_id}, '${user.username || user.first_name || 'Пользователь'}', ${isBlocked})" 
                                            style="background: ${isBlocked ? 'var(--tg-success)' : 'var(--tg-danger)'}; 
                                                   color: white; 
                                                   padding: 8px 12px; 
                                                   border-radius: 6px; 
                                                   font-size: 12px; 
                                                   border: none; 
                                                   cursor: pointer;
                                                   white-space: nowrap;">
                                        ${isBlocked ? '✅ Разблокировать' : '🚫 Заблокировать'}
                                    </button>
                                    ` : ''}
                                </div>
                            </td>
                        </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        </div>
        <div style="margin-top: 10px; color: var(--tg-secondary-text); font-size: 12px;">
            Всего пользователей: ${users.length}
        </div>
    `;
}

// Новая функция для обработки действий с пользователем
async function handleUserAction(targetUserId, targetUsername, isBlocked) {
    if (isBlocked) {
        // Разблокировать пользователя
        if (confirm(`Разблокировать пользователя ${targetUsername} (ID: ${targetUserId})?`)) {
            await unblockUser(targetUserId, targetUsername);
        }
    } else {
        // Блокировать пользователя
        openBlockUserModal(targetUserId, targetUsername);
    }
}

// Функция блокировки пользователя
async function blockUser() {
    const targetUserId = document.getElementById('blockUserId').value;
    const durationHours = document.getElementById('blockDuration').value;
    const isPermanent = document.getElementById('blockPermanent')?.checked || false;
    const reason = document.getElementById('blockReason').value;
    
    if (!reason) {
        showNotification('Укажите причину блокировки', 'warning');
        return;
    }
    
    try {
        showNotification('🚫 Блокировка пользователя...', 'info');
        
        const response = await fetch('/api/admin/block-user', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                adminId: userId,
                userId: targetUserId,
                durationHours: isPermanent ? null : parseInt(durationHours),
                isPermanent: isPermanent,
                reason: reason
            })
        });
        
        if (response.ok) {
            showNotification('✅ Пользователь заблокирован', 'success');
            closeModal('blockUserModal');
            await loadAdminPanel();
        } else {
            const error = await response.json();
            throw new Error(error.error || 'Ошибка сервера');
        }
    } catch (error) {
        console.error('Ошибка блокировки:', error);
        showNotification('❌ ' + error.message, 'error');
    }
}

// Функция разблокировки пользователя
async function unblockUser(targetUserId, targetUsername) {
    if (!confirm(`Вы уверены, что хотите разблокировать пользователя ${targetUsername}?`)) {
        return;
    }
    
    try {
        showNotification('✅ Разблокировка пользователя...', 'info');
        
        const response = await fetch('/api/admin/unblock-user', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                adminId: userId,
                userId: targetUserId
            })
        });
        
        if (response.ok) {
            showNotification('✅ Пользователь разблокирован', 'success');
            await loadAdminPanel();
        } else {
            const error = await response.json();
            throw new Error(error.error || 'Ошибка сервера');
        }
    } catch (error) {
        console.error('Ошибка разблокировки:', error);
        showNotification('❌ ' + error.message, 'error');
    }
}

// Модалка блокировки пользователя
function openBlockUserModal(targetUserId, targetUsername) {
    document.getElementById('blockUserId').value = targetUserId;
    document.getElementById('blockUsername').textContent = targetUsername;
    
    // Сброс формы
    document.getElementById('blockDuration').value = '24';
    document.getElementById('blockReason').value = '';
    
    const modal = document.getElementById('blockUserModal');
    if (modal) {
        modal.style.display = 'flex';
        setTimeout(() => modal.classList.add('active'), 10);
    }
}

// ========== ОСНОВНЫЕ ФУНКЦИИ ==========

async function initApp() {
    console.log('🚀 Инициализация приложения');
    
    try {
        await initUserData();
        
        const hasAccess = await showAccessRestrictions();
        if (!hasAccess) return;
        
        await initUI();
        await loadAllData();
        
        // Установка обработчиков событий для жалоб
        setupReportHandlers();
        
        setInterval(async () => {
            await loadAllData();
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
    
    window.userId = userId;
    window.currentUserId = userId;
    
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
    
    if (isAdmin || isSuperAdmin) {
        addAdminTab();
        addAdminModals();
    }
    
    setupTabs();
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

function addAdminModals() {
    const modals = `
        <!-- Модалка блокировки пользователя -->
        <div id="blockUserModal" class="modal" style="display: none;">
            <div class="modal-content" style="max-width: 500px;">
                <div class="modal-header">
                    <h3>🚫 Блокировка пользователя</h3>
                    <button class="btn-close" onclick="closeModal('blockUserModal')">×</button>
                </div>
                <div class="modal-body">
                    <p>Пользователь: <strong id="blockUsername"></strong></p>
                    <input type="hidden" id="blockUserId">
                    
                    <div style="margin: 20px 0;">
                        <label style="display: block; margin-bottom: 10px;">Тип блокировки:</label>
                        <div style="display: flex; gap: 15px; margin-bottom: 20px;">
                            <label style="display: flex; align-items: center; gap: 5px;">
                                <input type="radio" name="blockType" value="temporary" checked onclick="toggleBlockDuration(true)">
                                Временная
                            </label>
                            <label style="display: flex; align-items: center; gap: 5px;">
                                <input type="radio" name="blockType" value="permanent" onclick="toggleBlockDuration(false)">
                                Навсегда
                            </label>
                        </div>
                        
                        <div id="durationField" style="margin-bottom: 20px;">
                            <label style="display: block; margin-bottom: 5px;">Длительность (часы):</label>
                            <input type="number" id="blockDuration" value="24" min="1" max="720" 
                                   style="width: 100%; padding: 10px; border: 1px solid var(--tg-border-color); border-radius: 8px; background: var(--tg-input-bg); color: var(--tg-text-color);">
                        </div>
                        
                        <div>
                            <label style="display: block; margin-bottom: 5px;">Причина блокировки:</label>
                            <textarea id="blockReason" 
                                      style="width: 100%; padding: 10px; border: 1px solid var(--tg-border-color); border-radius: 8px; background: var(--tg-input-bg); color: var(--tg-text-color); min-height: 80px;"
                                      placeholder="Укажите причину блокировки..."></textarea>
                        </div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" onclick="closeModal('blockUserModal')">
                        Отмена
                    </button>
                    <button class="btn btn-danger" onclick="blockUser()">
                        🚫 Заблокировать
                    </button>
                </div>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modals);
}

function toggleBlockDuration(show) {
    const durationField = document.getElementById('durationField');
    if (durationField) {
        durationField.style.display = show ? 'block' : 'none';
    }
}

function setupReportHandlers() {
    document.addEventListener('click', function(e) {
        // Обработка кнопки "Пожаловаться"
        if (e.target.classList.contains('report-btn') || 
            e.target.closest('.report-btn') || 
            e.target.classList.contains('report-btn-small') || 
            e.target.closest('.report-btn-small')) {
            
            const target = e.target.closest('.report-btn, .report-btn-small') || e.target;
            const questionId = target.getAttribute('data-question-id');
            const reportedUserId = target.getAttribute('data-user-id');
            
            console.log('Кнопка жалобы нажата:', { questionId, reportedUserId });
            
            // Загружаем причины жалоб и открываем модалку
            loadReportReasons().then(() => {
                openReportModal(questionId, reportedUserId);
            }).catch(error => {
                console.error('Ошибка загрузки причин жалоб:', error);
                showNotification('Не удалось загрузить форму жалобы', 'error');
            });
            
            return;
        }
        
        // Обработка выбора причины жалобы
        if (e.target.closest('.report-reason-item')) {
            const reasonItem = e.target.closest('.report-reason-item');
            const radioInput = reasonItem.querySelector('input[type="radio"]');
            
            if (radioInput) {
                // Убираем выделение у всех элементов
                document.querySelectorAll('.report-reason-item').forEach(item => {
                    item.classList.remove('selected');
                });
                
                // Добавляем выделение текущему элементу
                reasonItem.classList.add('selected');
                radioInput.checked = true;
                
                // Устанавливаем значение в скрытое поле
                const reasonInput = document.getElementById('reportReason');
                if (reasonInput) {
                    reasonInput.value = radioInput.value;
                }
            }
        }
    });
}

async function loadReportReasons() {
    const reasonsList = document.getElementById('reportReasonsList');
    if (!reasonsList) return;
    
    try {
        const response = await fetch('/api/report/reasons');
        const data = await response.json();
        
        if (!data.success || !data.reasons) {
            throw new Error('Не удалось загрузить причины жалоб');
        }
        
        reasonsList.innerHTML = '';
        
        data.reasons.forEach(reason => {
            const reasonItem = document.createElement('div');
            reasonItem.className = 'report-reason-item';
            reasonItem.innerHTML = `
                <input type="radio" name="reportReason" id="reason_${reason.id}" value="${reason.id}">
                <label for="reason_${reason.id}">
                    <strong>${reason.label}</strong>
                    <span style="font-size: 12px; color: var(--tg-secondary-text); display: block; margin-top: 2px;">
                        ${reason.description}
                    </span>
                </label>
            `;
            reasonsList.appendChild(reasonItem);
        });
        
    } catch (error) {
        console.error('Ошибка загрузки причин жалоб:', error);
        reasonsList.innerHTML = '<p style="color: var(--tg-danger); padding: 20px; text-align: center;">Не удалось загрузить причины жалоб</p>';
    }
}

// ========== ОБРАБОТКА ВОПРОСОВ ==========

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
                    ${q.report_count > 0 ? `<span style="color: var(--tg-warning); margin-left: 5px;">⚠️ ${q.report_count}</span>` : ''}
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
                <div class="btn-group">
                    <button class="btn btn-secondary report-btn" 
                            data-question-id="${q.id}" 
                            data-user-id="${q.to_user_id}">
                        ⚠️ Пожаловаться
                    </button>
                    <button class="btn btn-danger" onclick="deleteQuestion(${q.id})">
                        🗑️ Удалить вопрос
                    </button>
                </div>
            ` : `
                <div class="btn-group">
                    <button class="btn btn-secondary report-btn" 
                            data-question-id="${q.id}" 
                            data-user-id="${q.to_user_id}">
                        ⚠️ Пожаловаться
                    </button>
                    <button class="btn btn-danger" onclick="deleteQuestion(${q.id})">
                        🗑️ Удалить вопрос
                    </button>
                </div>
            `}
        </div>
    `).join('');
    
    container.innerHTML = html;
}

// ========== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==========

function getElement(id) {
    return document.getElementById(id);
}

function setText(id, text) {
    const element = getElement(id);
    if (element) {
        element.textContent = text || '';
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
    }
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

function shareProfileToTelegram() {
    const inviteLink = `https://t.me/${botUsername}?start=ask_${userId}`;
    
    if (tg && tg.openTelegramLink) {
        const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(inviteLink)}&text=${encodeURIComponent('Задай мне анонимный вопрос! 👇')}`;
        tg.openTelegramLink(shareUrl);
    } else {
        window.open(`https://t.me/share/url?url=${encodeURIComponent(inviteLink)}&text=${encodeURIComponent('Задай мне анонимный вопрос! 👇')}`, '_blank');
    }
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('active');
        setTimeout(() => modal.style.display = 'none', 300);
    }
}

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
window.openTOS = openTOS;
window.contactAdmin = contactAdmin;
window.handleUserAction = handleUserAction;
window.blockUser = blockUser;
window.unblockUser = unblockUser;
window.openBlockUserModal = openBlockUserModal;
window.toggleBlockDuration = toggleBlockDuration;
window.closeModal = closeModal;

// ========== ОБРАБОТЧИКИ СОБЫТИЙ ==========

document.addEventListener('DOMContentLoaded', function() {
    console.log('📄 DOM загружен, запускаем приложение...');
    setTimeout(initApp, 100);
});