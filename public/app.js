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
                        <button class="btn btn-secondary" onclick="openTOSDetails()">
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

function openTOSDetails() {
    const fullTOS = `
        <div class="tos-full-content" style="max-width: 800px; padding: 20px;">
            <h2 style="text-align: center; margin-bottom: 30px; color: var(--tg-accent-color);">📜 ПОЛЬЗОВАТЕЛЬСКОЕ СОГЛАШЕНИЕ</h2>
            
            <div style="background: var(--tg-input-bg); border-radius: 10px; padding: 20px; margin-bottom: 20px;">
                <h3 style="color: var(--tg-text-color); margin-bottom: 15px;">1. Общие положения</h3>
                <p>1.1. Настоящее Пользовательское соглашение регулирует отношения между администрацией сервиса "Анонимные вопросы" и пользователями.</p>
                <p>1.2. Используя сервис, вы подтверждаете, что вам исполнилось 16 лет.</p>
                <p>1.3. Сервис предоставляет возможность отправки и получения анонимных вопросов.</p>
            </div>
            
            <div style="background: var(--tg-input-bg); border-radius: 10px; padding: 20px; margin-bottom: 20px;">
                <h3 style="color: var(--tg-text-color); margin-bottom: 15px;">2. Права и обязанности пользователя</h3>
                <p>2.1. Пользователь обязуется:</p>
                <ul style="padding-left: 20px; margin-bottom: 15px;">
                    <li>Не нарушать законодательство РФ</li>
                    <li>Не отправлять угрозы, оскорбления и материалы экстремистского содержания</li>
                    <li>Не распространять спам, вирусы и вредоносное ПО</li>
                    <li>Не выдавать себя за других лиц</li>
                    <li>Не нарушать права интеллектуальной собственности</li>
                </ul>
                <p>2.2. Пользователь имеет право:</p>
                <ul style="padding-left: 20px;">
                    <li>Отправлять анонимные вопросы другим пользователям</li>
                    <li>Получать и отвечать на вопросы</li>
                    <li>Удалять свои вопросы и ответы</li>
                    <li>Подавать жалобы на нарушителей</li>
                </ul>
            </div>
            
            <div style="background: var(--tg-input-bg); border-radius: 10px; padding: 20px; margin-bottom: 20px;">
                <h3 style="color: var(--tg-text-color); margin-bottom: 15px;">3. Анонимность и конфиденциальность</h3>
                <p>3.1. Отправители вопросов остаются полностью анонимными для получателей.</p>
                <p>3.2. Администрация видит статистику использования, но не имеет доступа к содержимому приватных сообщений.</p>
                <p>3.3. Вопросы и ответы хранятся на сервере для обеспечения работы сервиса и модерации.</p>
                <p>3.4. Администрация обязуется не передавать персональные данные третьим лицам.</p>
            </div>
            
            <div style="background: var(--tg-input-bg); border-radius: 10px; padding: 20px; margin-bottom: 20px;">
                <h3 style="color: var(--tg-text-color); margin-bottom: 15px;">4. Модерация и блокировки</h3>
                <p>4.1. Администрация имеет право блокировать пользователей за нарушения правил.</p>
                <p>4.2. Блокировка может быть временной (от 1 часа до 30 дней) или постоянной.</p>
                <p>4.3. Пользователи могут подавать жалобы на вопросы или других пользователей.</p>
                <p>4.4. Администрация оставляет за собой право удалять контент без предупреждения.</p>
            </div>
            
            <div style="background: var(--tg-input-bg); border-radius: 10px; padding: 20px; margin-bottom: 20px;">
                <h3 style="color: var(--tg-text-color); margin-bottom: 15px;">5. Ответственность</h3>
                <p>5.1. Пользователь несет полную ответственность за содержание своих вопросов и ответов.</p>
                <p>5.2. Администрация не несет ответственности за контент, созданный пользователями.</p>
                <p>5.3. Сервис предоставляется "как есть" без гарантий стабильной работы.</p>
            </div>
            
            <div style="background: rgba(46, 141, 230, 0.1); border-radius: 10px; padding: 20px; border-left: 4px solid var(--tg-accent-color);">
                <h3 style="color: var(--tg-accent-color); margin-bottom: 10px;">⚠️ Важное примечание:</h3>
                <p>Нажимая "Принять соглашение", вы подтверждаете, что ознакомились со всеми пунктами и согласны с ними.</p>
                <p>Соглашение может быть изменено администрацией. Актуальная версия всегда доступна в приложении.</p>
            </div>
        </div>
    `;
    
    // Создаем модальное окно с полным текстом соглашения
    const modalHTML = `
        <div id="tosFullModal" class="modal" style="display: flex;">
            <div class="modal-content" style="max-width: 800px; max-height: 80vh;">
                <div class="modal-header">
                    <h3><span>📜</span> Полный текст соглашения</h3>
                    <button class="btn-close" onclick="closeModal('tosFullModal')">×</button>
                </div>
                <div class="modal-body" style="padding: 0;">
                    <div style="height: 60vh; overflow-y: auto; padding: 20px;">
                        ${fullTOS}
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" onclick="closeModal('tosFullModal')">
                        Закрыть
                    </button>
                    <button class="btn btn-primary" onclick="acceptTOS(); closeModal('tosFullModal');">
                        ✅ Принять соглашение
                    </button>
                </div>
            </div>
        </div>
    `;
    
    // Добавляем модалку в DOM
    if (!document.getElementById('tosFullModal')) {
        document.body.insertAdjacentHTML('beforeend', modalHTML);
    } else {
        document.getElementById('tosFullModal').style.display = 'flex';
    }
    
    // Показываем модалку
    setTimeout(() => {
        document.getElementById('tosFullModal').classList.add('active');
    }, 10);
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
            
            <div class="admin-section">
                <h3><span>👑</span> Действия суперадмина</h3>
                <div class="admin-actions">
                    <button class="btn btn-primary" onclick="openUserManagementModal()">
                        👤 Управление пользователями
                    </button>
                    <button class="btn btn-warning" onclick="openMassQuestionModal()">
                        📢 Анонимный вопрос всем
                    </button>
                    <button class="btn btn-danger" onclick="openDataDeletionModal()">
                        🗑️ Удаление данных
                    </button>
                </div>
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
                        
                        const displayName = (user.username || user.first_name || 'Пользователь');
                        const escapedName = displayName.replace(/'/g, "\\'");
                        
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
                                        ${displayName.charAt(0).toUpperCase()}
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
                                <div style="display: flex; gap: 5px; flex-wrap: wrap;">
                                    ${isSuperAdmin ? `
                                    <button class="btn-action" onclick="${isBlocked ? 'unblockUser(' + user.telegram_id + ')' : 'openBlockUserModal(' + user.telegram_id + ', \\'' + escapedName + '\\')'}" 
                                            style="background: ${isBlocked ? 'var(--tg-success)' : 'var(--tg-danger)'}; color: white; padding: 6px 12px; border-radius: 6px; font-size: 12px; border: none; cursor: pointer; margin: 2px;">
                                        ${isBlocked ? '✅ Разблокировать' : '🚫 Блокировать'}
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

function renderReportsList(reports) {
    if (!reports || reports.length === 0) {
        return '<p style="color: var(--tg-secondary-text);">Нет жалоб</p>';
    }
    
    return `
        <div class="reports-list">
            ${reports.map(report => {
                const statusColor = report.status === 'pending' ? 'var(--tg-warning)' : 
                                 report.status === 'resolved' ? 'var(--tg-success)' : 'var(--tg-danger)';
                
                const reportedName = report.reported_username || report.reported_first_name || 'Пользователь';
                const escapedName = reportedName.replace(/'/g, "\\'");
                
                return `
                <div class="report-item" style="
                    background: var(--tg-input-bg);
                    border: 1px solid var(--tg-border-color);
                    border-radius: 10px;
                    padding: 15px;
                    margin-bottom: 15px;
                ">
                    <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 10px;">
                        <div>
                            <strong>Жалоба #${report.id}</strong>
                            <span style="
                                padding: 2px 6px;
                                border-radius: 12px;
                                font-size: 11px;
                                background: ${statusColor}20;
                                color: ${statusColor};
                                margin-left: 8px;
                            ">${report.status}</span>
                        </div>
                        <div style="font-size: 12px; color: var(--tg-secondary-text);">
                            ${formatDate(report.created_at)}
                        </div>
                    </div>
                    
                    ${report.question_text ? `
                    <div style="margin: 10px 0; padding: 10px; background: rgba(0,0,0,0.1); border-radius: 6px;">
                        <strong>Вопрос:</strong> ${report.question_text.substring(0, 100)}${report.question_text.length > 100 ? '...' : ''}
                        ${report.question_id ? `<div style="font-size: 11px; color: var(--tg-secondary-text); margin-top: 5px;">ID вопроса: ${report.question_id}</div>` : ''}
                    </div>
                    ` : ''}
                    
                    <div style="font-size: 13px; margin-bottom: 10px;">
                        <div><strong>Причина:</strong> ${getReasonLabel(report.reason)}</div>
                        ${report.details ? `<div><strong>Детали:</strong> ${report.details}</div>` : ''}
                        <div><strong>Жалобу отправил:</strong> ${report.reporter_username || `ID: ${report.reporter_id}`}</div>
                        <div><strong>На пользователя:</strong> ${report.reported_username || report.reported_first_name || `ID: ${report.reported_user_id || 'не указан'}`}</div>
                    </div>
                    
                    ${report.status === 'pending' && (isSuperAdmin || isAdmin) ? `
                    <div style="display: flex; gap: 8px; margin-top: 15px; flex-wrap: wrap;">
                        <button class="btn btn-success" style="flex: 1; padding: 8px; font-size: 12px;" 
                                onclick="updateReportStatus(${report.id}, 'resolved', 'Жалоба рассмотрена')">
                            ✅ Решено
                        </button>
                        ${isSuperAdmin && report.reported_user_id ? `
                        <button class="btn btn-danger" style="flex: 1; padding: 8px; font-size: 12px;" 
                                onclick="openBlockFromReportModal(${report.id}, ${report.reported_user_id}, '${escapedName}')">
                            🚫 Блокировать
                        </button>
                        ` : ''}
                        <button class="btn btn-secondary" style="flex: 1; padding: 8px; font-size: 12px;" 
                                onclick="updateReportStatus(${report.id}, 'rejected', 'Жалоба отклонена')">
                            ❌ Отклонить
                        </button>
                    </div>
                    ` : ''}
                    
                    ${report.admin_notes ? `
                    <div style="margin-top: 10px; padding: 8px; background: rgba(46, 141, 230, 0.1); border-radius: 6px; font-size: 12px;">
                        <strong>Заметки админа:</strong> ${report.admin_notes}
                    </div>
                    ` : ''}
                </div>
                `;
            }).join('')}
        </div>
    `;
}

function getReasonLabel(reason) {
    const reasons = {
        'spam': 'Спам',
        'harassment': 'Оскорбления',
        'threats': 'Угрозы',
        'hate_speech': 'Разжигание ненависти',
        'sexual_content': 'Сексуальный контент',
        'scam': 'Мошенничество',
        'other': 'Другое'
    };
    return reasons[reason] || reason;
}

// ========== МОДАЛЬНЫЕ ОКНА АДМИН-ПАНЕЛИ ==========

function openUserManagementModal() {
    document.getElementById('userManagementModal').style.display = 'flex';
    setTimeout(() => document.getElementById('userManagementModal').classList.add('active'), 10);
}

function openDataDeletionModal() {
    document.getElementById('dataDeletionModal').style.display = 'flex';
    setTimeout(() => document.getElementById('dataDeletionModal').classList.add('active'), 10);
}

function openBlockUserModal(targetUserId, targetUsername) {
    document.getElementById('blockUserId').value = targetUserId;
    document.getElementById('blockUsername').textContent = targetUsername;
    document.getElementById('blockUserModal').style.display = 'flex';
    setTimeout(() => document.getElementById('blockUserModal').classList.add('active'), 10);
    
    // Сбрасываем значения
    const blockTypeTemporary = document.querySelector('input[name="blockType"][value="temporary"]');
    const blockTypePermanent = document.querySelector('input[name="blockType"][value="permanent"]');
    
    if (blockTypeTemporary) blockTypeTemporary.checked = true;
    if (blockTypePermanent) blockTypePermanent.checked = false;
    
    document.getElementById('blockDuration').value = '24';
    document.getElementById('blockReason').value = '';
}

function openBlockFromReportModal(reportId, targetUserId, targetUsername) {
    // Проверка прав
    if (!isSuperAdmin) {
        showNotification('❌ Недостаточно прав. Требуется суперадмин.', 'error');
        return;
    }
    
    if (!targetUserId) {
        showNotification('❌ Не указан ID пользователя для блокировки', 'error');
        return;
    }
    
    document.getElementById('blockReportId').value = reportId;
    document.getElementById('blockFromReportUserId').value = targetUserId;
    document.getElementById('blockFromReportUsername').textContent = targetUsername;
    document.getElementById('blockFromReportModal').style.display = 'flex';
    setTimeout(() => document.getElementById('blockFromReportModal').classList.add('active'), 10);
    
    // Сбрасываем значения
    const blockTypeTemporary = document.querySelector('input[name="blockFromReportType"][value="temporary"]');
    const blockTypePermanent = document.querySelector('input[name="blockFromReportType"][value="permanent"]');
    
    if (blockTypeTemporary) blockTypeTemporary.checked = true;
    if (blockTypePermanent) blockTypePermanent.checked = false;
    
    document.getElementById('blockFromReportDuration').value = '24';
    document.getElementById('blockFromReportReason').value = '';
}

async function updateReportStatus(reportId, status, notes) {
    try {
        showNotification('📤 Обновление статуса...', 'info');
        
        const response = await fetch('/api/admin/update-report', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                adminId: userId,
                reportId: reportId,
                status: status,
                adminNotes: notes || ''
            })
        });
        
        if (response.ok) {
            showNotification('✅ Статус обновлен', 'success');
            await loadAdminPanel();
        } else {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Ошибка сервера');
        }
    } catch (error) {
        console.error('Ошибка обновления статуса:', error);
        showNotification('❌ ' + error.message, 'error');
    }
}

async function blockUser() {
    // Проверка прав
    if (!isSuperAdmin) {
        showNotification('❌ Недостаточно прав. Требуется суперадмин.', 'error');
        return;
    }
    
    const targetUserId = document.getElementById('blockUserId').value;
    const durationHours = document.getElementById('blockDuration').value;
    const reason = document.getElementById('blockReason').value;
    
    // Проверяем тип блокировки
    const blockTypeTemporary = document.querySelector('input[name="blockType"][value="temporary"]:checked');
    const blockTypePermanent = document.querySelector('input[name="blockType"][value="permanent"]:checked');
    
    const isPermanent = blockTypePermanent ? true : false;
    
    if (!reason) {
        showNotification('Укажите причину блокировки', 'warning');
        return;
    }
    
    if (!isPermanent && (!durationHours || durationHours < 1)) {
        showNotification('Укажите длительность блокировки', 'warning');
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

async function unblockUser(targetUserId) {
    // Проверка прав
    if (!isSuperAdmin) {
        showNotification('❌ Недостаточно прав. Требуется суперадмин.', 'error');
        return;
    }
    
    if (!confirm('Вы уверены, что хотите разблокировать пользователя?')) {
        return;
    }
    
    try {
        showNotification('🔄 Разблокировка пользователя...', 'info');
        
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

async function blockFromReport() {
    // Проверка прав
    if (!isSuperAdmin) {
        showNotification('❌ Недостаточно прав. Требуется суперадмин.', 'error');
        return;
    }
    
    const reportId = document.getElementById('blockReportId').value;
    const targetUserId = document.getElementById('blockFromReportUserId').value;
    const durationHours = document.getElementById('blockFromReportDuration').value;
    const reason = document.getElementById('blockFromReportReason').value;
    
    // Проверяем тип блокировки
    const blockTypeTemporary = document.querySelector('input[name="blockFromReportType"][value="temporary"]:checked');
    const blockTypePermanent = document.querySelector('input[name="blockFromReportType"][value="permanent"]:checked');
    
    const isPermanent = blockTypePermanent ? true : false;
    
    if (!reason) {
        showNotification('Укажите причину блокировки', 'warning');
        return;
    }
    
    if (!isPermanent && (!durationHours || durationHours < 1)) {
        showNotification('Укажите длительность блокировки', 'warning');
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
            // Обновляем статус жалобы
            await updateReportStatus(reportId, 'resolved', `Пользователь заблокирован. Причина: ${reason}`);
            
            showNotification('✅ Пользователь заблокирован, жалоба обработана', 'success');
            closeModal('blockFromReportModal');
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

async function deleteUserData() {
    // Проверка прав
    if (!isSuperAdmin) {
        showNotification('❌ Недостаточно прав. Требуется суперадмин.', 'error');
        return;
    }
    
    const targetUserId = document.getElementById('deleteUserId').value;
    const deleteType = document.getElementById('deleteType').value;
    
    if (!targetUserId || !deleteType) {
        showNotification('Заполните все поля', 'warning');
        return;
    }
    
    if (!confirm(`Вы уверены, что хотите удалить данные типа "${deleteType}" для пользователя ${targetUserId}?`)) {
        return;
    }
    
    try {
        showNotification('🗑️ Удаление данных...', 'info');
        
        const response = await fetch('/api/admin/delete-data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                adminId: userId,
                userId: targetUserId,
                deleteType: deleteType
            })
        });
        
        if (response.ok) {
            showNotification('✅ Данные удалены', 'success');
            closeModal('dataDeletionModal');
            await loadAdminPanel();
        } else {
            const error = await response.json();
            throw new Error(error.error || 'Ошибка сервера');
        }
    } catch (error) {
        console.error('Ошибка удаления данных:', error);
        showNotification('❌ ' + error.message, 'error');
    }
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('active');
        setTimeout(() => modal.style.display = 'none', 300);
    }
}

// ========== СИСТЕМА ЖАЛОБ ==========

async function openReportModal(questionId = null, reportedUserId = null) {
    try {
        // Загружаем причины жалоб
        const response = await fetch('/api/report/reasons');
        const data = await response.json();
        
        if (!data.success || !data.reasons) {
            throw new Error('Не удалось загрузить причины жалоб');
        }
        
        const modal = document.getElementById('reportModal');
        const reasonsList = document.getElementById('reportReasonsList');
        
        // Очищаем список
        reasonsList.innerHTML = '';
        
        // Добавляем причины
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
            reasonItem.onclick = () => {
                document.querySelectorAll('.report-reason-item').forEach(item => {
                    item.classList.remove('selected');
                });
                reasonItem.classList.add('selected');
                document.getElementById('reportReason').value = reason.id;
            };
            reasonsList.appendChild(reasonItem);
        });
        
        // Сбрасываем форму
        const questionIdInput = document.getElementById('reportQuestionId');
        const detailsInput = document.getElementById('reportDetails');
        
        if (questionIdInput) questionIdInput.value = questionId || '';
        if (detailsInput) detailsInput.value = '';
        
        // УДАЛЯЕМ ПОЛЕ ДЛЯ ID ПОЛЬЗОВАТЕЛЯ ИЗ ФОРМЫ - теперь система сама определяет
        // Удаляем поле для ID пользователя или скрываем его
        const userIdInput = document.getElementById('reportUserId');
        if (userIdInput) {
            userIdInput.style.display = 'none';
            userIdInput.disabled = true;
        }
        
        modal.style.display = 'flex';
        setTimeout(() => modal.classList.add('active'), 10);
        
    } catch (error) {
        console.error('Ошибка открытия модалки жалобы:', error);
        showNotification('Не удалось загрузить форму жалобы', 'error');
    }
}

async function submitReport() {
    const questionId = document.getElementById('reportQuestionId')?.value;
    const reason = document.getElementById('reportReason')?.value;
    const details = document.getElementById('reportDetails')?.value;
    
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
        
        // ДОБАВЛЯЕМ: получаем ID пользователя из вопроса если есть
        let reportedUserId = null;
        if (questionId) {
            try {
                const questionResponse = await fetch(`/api/question/${questionId}`);
                if (questionResponse.ok) {
                    const question = await questionResponse.json();
                    if (question.from_user_id) {
                        reportedUserId = question.from_user_id;
                    }
                }
            } catch (error) {
                console.error('Ошибка получения данных вопроса:', error);
            }
        }
        
        const response = await fetch('/api/user/report', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: userId,
                reportedUserId: reportedUserId,
                questionId: questionId || null,
                reason: reason,
                details: details || null
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

// ========== КНОПКИ ДЛЯ ОТПРАВКИ ВОПРОСОВ ==========

function openReportActionModal(questionId = null, reportedUserId = null) {
    currentQuestionId = questionId;
    currentReportedUserId = reportedUserId;
    
    // ИСПРАВЛЕНИЕ: Открываем форму жалобы сразу для обычных пользователей
    if (!isAdmin && !isSuperAdmin) {
        openReportModal(questionId, reportedUserId);
        return;
    }
    
    const modal = document.getElementById('reportActionModal');
    if (modal) {
        modal.style.display = 'flex';
        setTimeout(() => modal.classList.add('active'), 10);
    }
}

function closeReportActionModal() {
    const modal = document.getElementById('reportActionModal');
    if (modal) {
        modal.classList.remove('active');
        setTimeout(() => modal.style.display = 'none', 300);
    }
}

function openQuickBlockModal() {
    closeReportActionModal();
    
    document.getElementById('quickBlockUserId').value = currentReportedUserId || '';
    document.getElementById('quickBlockQuestionId').value = currentQuestionId || '';
    
    const modal = document.getElementById('quickBlockModal');
    if (modal) {
        modal.style.display = 'flex';
        setTimeout(() => modal.classList.add('active'), 10);
    }
}

function closeQuickBlockModal() {
    const modal = document.getElementById('quickBlockModal');
    if (modal) {
        modal.classList.remove('active');
        setTimeout(() => modal.style.display = 'none', 300);
    }
}

function setQuickBlockDuration(hours, permanent = false) {
    const durationInput = document.getElementById('quickBlockDuration');
    const buttons = document.querySelectorAll('#quickBlockModal .btn-secondary, #quickBlockModal .btn-danger');
    
    buttons.forEach(btn => btn.classList.remove('active'));
    
    if (permanent) {
        durationInput.value = 'permanent';
        event.target.classList.add('active');
    } else {
        durationInput.value = hours;
        event.target.classList.add('active');
    }
}

async function submitQuickBlock() {
    // Проверка прав
    if (!isSuperAdmin) {
        showNotification('❌ Недостаточно прав. Требуется суперадмин.', 'error');
        return;
    }
    
    const targetUserId = document.getElementById('quickBlockUserId').value;
    const questionId = document.getElementById('quickBlockQuestionId').value;
    const reason = document.getElementById('quickBlockReason').value;
    const duration = document.getElementById('quickBlockDuration').value;
    
    if (!targetUserId && !questionId) {
        showNotification('Не указан пользователь или вопрос для блокировки', 'warning');
        return;
    }
    
    const isPermanent = duration === 'permanent';
    const durationHours = isPermanent ? null : parseInt(duration);
    
    try {
        showNotification('🚫 Блокировка пользователя...', 'info');
        
        let userIdToBlock = targetUserId;
        
        if (!userIdToBlock && questionId) {
            userIdToBlock = await getUserIdFromQuestion(questionId);
        }
        
        if (!userIdToBlock) {
            showNotification('Не удалось определить пользователя для блокировки', 'error');
            return;
        }
        
        const response = await fetch('/api/admin/block-user', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                adminId: userId,
                userId: userIdToBlock,
                durationHours: durationHours,
                isPermanent: isPermanent,
                reason: reason
            })
        });
        
        if (response.ok) {
            showNotification('✅ Пользователь заблокирован', 'success');
            closeQuickBlockModal();
            await loadAllData();
        } else {
            const error = await response.json();
            throw new Error(error.error || 'Ошибка сервера');
        }
    } catch (error) {
        console.error('Ошибка быстрой блокировки:', error);
        showNotification('❌ ' + error.message, 'error');
    }
}

async function getUserIdFromQuestion(questionId) {
    try {
        const response = await fetch(`/api/question/${questionId}`);
        if (response.ok) {
            const question = await response.json();
            return question.from_user_id;
        }
        return null;
    } catch (error) {
        return null;
    }
}

// ========== МАССОВЫЙ ВОПРОС ВСЕМ ПОЛЬЗОВАТЕЛЯМ ==========

function openMassQuestionModal() {
    // Загружаем количество пользователей
    loadUserCount();
    
    document.getElementById('massQuestionModal').style.display = 'flex';
    setTimeout(() => document.getElementById('massQuestionModal').classList.add('active'), 10);
}

async function loadUserCount() {
    try {
        const response = await fetch(`/api/admin/stats?userId=${userId}`);
        if (response.ok) {
            const data = await response.json();
            const totalUsersCount = document.getElementById('totalUsersCount');
            if (totalUsersCount) {
                totalUsersCount.textContent = data.stats.totalUsers || '0';
            }
        }
    } catch (error) {
        console.error('Ошибка загрузки количества пользователей:', error);
    }
}

async function sendMassQuestion() {
    const questionText = document.getElementById('massQuestionText').value.trim();
    
    if (!questionText) {
        showNotification('Введите текст вопроса', 'warning');
        return;
    }
    
    if (questionText.length < 5) {
        showNotification('Вопрос слишком короткий (минимум 5 символов)', 'warning');
        return;
    }
    
    if (questionText.length > 1000) {
        showNotification('Вопрос слишком длинный (максимум 1000 символов)', 'warning');
        return;
    }
    
    try {
        // Загружаем актуальное количество пользователей
        const statsResponse = await fetch(`/api/admin/stats?userId=${userId}`);
        let userCount = 'неизвестно';
        if (statsResponse.ok) {
            const stats = await statsResponse.json();
            userCount = stats.stats.totalUsers || 'неизвестно';
        }
        
        if (!confirm(`Вы уверены, что хотите отправить этот вопрос ВСЕМ ${userCount} пользователям?\n\nВопрос будет отправлен анонимно от имени системы.`)) {
            return;
        }
    
        showNotification('📤 Отправка массового вопроса...', 'info');
        
        const response = await fetch('/api/admin/send-mass-question', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                adminId: userId,
                questionText: questionText
            })
        });
        
        if (response.ok) {
            const data = await response.json();
            showNotification(`✅ Массовый вопрос отправлен! ${data.stats?.successCount || 0} пользователей получили вопрос`, 'success');
            closeModal('massQuestionModal');
            // Очищаем поле
            document.getElementById('massQuestionText').value = '';
        } else {
            const error = await response.json();
            throw new Error(error.error || 'Ошибка сервера');
        }
    } catch (error) {
        console.error('Ошибка отправки массового вопроса:', error);
        showNotification('❌ ' + error.message, 'error');
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
        
        const hasAccess = await showAccessRestrictions();
        if (!hasAccess) return;
        
        await initUI();
        await loadAllData();
        
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
    
    // Сохраняем userId глобально
    window.userId = userId;
    window.currentUserId = userId;
    
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
    
    if (isAdmin || isSuperAdmin) {
        addAdminTab();
        addAdminModals();
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
                                <input type="radio" name="blockType" value="temporary" checked>
                                Временная
                            </label>
                            <label style="display: flex; align-items: center; gap: 5px;">
                                <input type="radio" name="blockType" value="permanent">
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
        
        <!-- Модалка блокировки из жалобы -->
        <div id="blockFromReportModal" class="modal" style="display: none;">
            <div class="modal-content" style="max-width: 500px;">
                <div class="modal-header">
                    <h3>🚫 Блокировка из жалобы</h3>
                    <button class="btn-close" onclick="closeModal('blockFromReportModal')">×</button>
                </div>
                <div class="modal-body">
                    <p>Пользователь: <strong id="blockFromReportUsername"></strong></p>
                    <input type="hidden" id="blockFromReportUserId">
                    <input type="hidden" id="blockReportId">
                    
                    <div style="margin: 20px 0;">
                        <label style="display: block; margin-bottom: 10px;">Тип блокировки:</label>
                        <div style="display: flex; gap: 15px; margin-bottom: 20px;">
                            <label style="display: flex; align-items: center; gap: 5px;">
                                <input type="radio" name="blockFromReportType" value="temporary" checked>
                                Временная
                            </label>
                            <label style="display: flex; align-items: center; gap: 5px;">
                                <input type="radio" name="blockFromReportType" value="permanent">
                                Навсегда
                            </label>
                        </div>
                        
                        <div id="durationFromReportField" style="margin-bottom: 20px;">
                            <label style="display: block; margin-bottom: 5px;">Длительность (часы):</label>
                            <input type="number" id="blockFromReportDuration" value="24" min="1" max="720" 
                                   style="width: 100%; padding: 10px; border: 1px solid var(--tg-border-color); border-radius: 8px; background: var(--tg-input-bg); color: var(--tg-text-color);">
                        </div>
                        
                        <div>
                            <label style="display: block; margin-bottom: 5px;">Причина блокировки:</label>
                            <textarea id="blockFromReportReason" 
                                      style="width: 100%; padding: 10px; border: 1px solid var(--tg-border-color); border-radius: 8px; background: var(--tg-input-bg); color: var(--tg-text-color); min-height: 80px;"
                                      placeholder="Укажите причину блокировки..."></textarea>
                        </div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" onclick="closeModal('blockFromReportModal')">
                        Отмена
                    </button>
                    <button class="btn btn-danger" onclick="blockFromReport()">
                        🚫 Заблокировать
                    </button>
                </div>
            </div>
        </div>
        
        <!-- Модалка удаления данных -->
        <div id="dataDeletionModal" class="modal" style="display: none;">
            <div class="modal-content" style="max-width: 500px;">
                <div class="modal-header">
                    <h3>🗑️ Удаление данных</h3>
                    <button class="btn-close" onclick="closeModal('dataDeletionModal')">×</button>
                </div>
                <div class="modal-body">
                    <div style="margin-bottom: 20px;">
                        <label style="display: block; margin-bottom: 5px;">ID пользователя:</label>
                        <input type="number" id="deleteUserId" 
                               style="width: 100%; padding: 10px; border: 1px solid var(--tg-border-color); border-radius: 8px; background: var(--tg-input-bg); color: var(--tg-text-color);"
                               placeholder="Введите ID пользователя">
                    </div>
                    
                    <div style="margin-bottom: 20px;">
                        <label style="display: block; margin-bottom: 5px;">Тип удаления:</label>
                        <select id="deleteType" 
                                style="width: 100%; padding: 10px; border: 1px solid var(--tg-border-color); border-radius: 8px; background: var(--tg-input-bg); color: var(--tg-text-color);">
                            <option value="questions">Удалить все вопросы пользователя</option>
                            <option value="account">Полностью удалить аккаунт и все данные</option>
                        </select>
                    </div>
                    
                    <div style="background: rgba(229, 57, 53, 0.1); padding: 15px; border-radius: 8px; border: 1px solid rgba(229, 57, 53, 0.3);">
                        <strong>⚠️ Внимание!</strong>
                        <p style="margin-top: 5px; font-size: 14px;">
                            Это действие нельзя отменить. Все данные будут удалены безвозвратно.
                        </p>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" onclick="closeModal('dataDeletionModal')">
                        Отмена
                    </button>
                    <button class="btn btn-danger" onclick="deleteUserData()">
                        🗑️ Удалить
                    </button>
                </div>
            </div>
        </div>
        
        <!-- Модалка управления пользователями -->
        <div id="userManagementModal" class="modal" style="display: none;">
            <div class="modal-content" style="max-width: 500px;">
                <div class="modal-header">
                    <h3>👤 Управление пользователями</h3>
                    <button class="btn-close" onclick="closeModal('userManagementModal')">×</button>
                </div>
                <div class="modal-body">
                    <div style="text-align: center; padding: 40px 20px;">
                        <div style="font-size: 48px; margin-bottom: 20px;">👑</div>
                        <h3 style="margin-bottom: 15px;">Функции суперадмина</h3>
                        <p style="color: var(--tg-secondary-text); margin-bottom: 30px;">
                            Доступно только суперадмину
                        </p>
                        
                        <div style="display: flex; flex-direction: column; gap: 15px;">
                            <button class="btn btn-primary" onclick="openDataDeletionModal()">
                                🗑️ Удалить данные пользователя
                            </button>
                            <button class="btn btn-secondary" onclick="closeModal('userManagementModal')">
                                Закрыть
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        
        <!-- Модалка массового вопроса -->
        <div id="massQuestionModal" class="modal" style="display: none;">
            <div class="modal-content" style="max-width: 500px;">
                <div class="modal-header">
                    <h3><span>📢</span> Анонимный вопрос всем</h3>
                    <button class="btn-close" onclick="closeModal('massQuestionModal')">×</button>
                </div>
                <div class="modal-body">
                    <div style="margin-bottom: 20px;">
                        <label style="display: block; margin-bottom: 10px; color: var(--tg-text-color); font-weight: 600;">
                            Текст вопроса для всех пользователей:
                        </label>
                        <textarea id="massQuestionText" 
                                  style="width: 100%; padding: 12px; border: 1px solid var(--tg-border-color); border-radius: 10px; background: var(--tg-input-bg); color: var(--tg-text-color); min-height: 120px;"
                                  placeholder="Введите вопрос, который будет отправлен всем пользователям..."></textarea>
                        <div style="display: flex; justify-content: space-between; margin-top: 8px; font-size: 13px; color: var(--tg-secondary-text);">
                            <span id="massQuestionCharCount">0</span>/1000 символов
                        </div>
                    </div>
                    
                    <div style="background: rgba(46, 141, 230, 0.1); padding: 15px; border-radius: 10px; margin-bottom: 20px; border-left: 3px solid var(--tg-accent-color);">
                        <div style="display: flex; align-items: flex-start; gap: 10px;">
                            <div style="
                                width: 28px;
                                height: 28px;
                                background: var(--tg-accent-color);
                                border-radius: 50%;
                                display: flex;
                                align-items: center;
                                justify-content: center;
                                color: white;
                                font-size: 14px;
                                flex-shrink: 0;
                            ">💡</div>
                            <div style="font-size: 13px; color: #93c5fd;">
                                <strong>Важно:</strong> Вопрос будет отправлен анонимно от имени системы всем активным пользователей. Используйте для новостей, опросов или поддержания интереса к боту.
                            </div>
                        </div>
                    </div>
                    
                    <div style="text-align: center; padding: 10px; background: rgba(255, 152, 0, 0.1); border-radius: 8px; margin-bottom: 15px;">
                        <div style="font-size: 14px; color: var(--tg-warning);">
                            Всего пользователей: <span id="totalUsersCount" style="font-weight: bold;">0</span>
                        </div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" onclick="closeModal('massQuestionModal')">
                        Отмена
                    </button>
                    <button class="btn btn-warning" onclick="sendMassQuestion()">
                        📢 Отправить всем
                    </button>
                </div>
            </div>
        </div>
        
        <!-- Модалка для кнопки "Пожаловаться" (только для админов) -->
        ${(isAdmin || isSuperAdmin) ? `
        <div id="reportActionModal" class="modal" style="display: none;">
            <div class="modal-content" style="max-width: 400px;">
                <div class="modal-header">
                    <h3>⚠️ Отправить жалобу</h3>
                    <button class="btn-close" onclick="closeReportActionModal()">×</button>
                </div>
                <div class="modal-body">
                    <div class="report-options">
                        <button class="btn btn-secondary" onclick="openReportModal(currentQuestionId, currentReportedUserId); closeReportActionModal();" style="width: 100%; margin-bottom: 10px;">
                            📋 Заполнить форму жалобы
                        </button>
                        ${isSuperAdmin ? `
                        <button class="btn btn-danger" onclick="openQuickBlockModal()" style="width: 100%;">
                            🚫 Быстрая блокировка пользователя
                        </button>
                        ` : ''}
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" onclick="closeReportActionModal()">
                        Отмена
                    </button>
                </div>
            </div>
        </div>
        
        <!-- Модалка быстрой блокировки -->
        <div id="quickBlockModal" class="modal" style="display: none;">
            <div class="modal-content" style="max-width: 400px;">
                <div class="modal-header">
                    <h3>🚫 Быстрая блокировка</h3>
                    <button class="btn-close" onclick="closeQuickBlockModal()">×</button>
                </div>
                <div class="modal-body">
                    <input type="hidden" id="quickBlockUserId">
                    <input type="hidden" id="quickBlockQuestionId">
                    
                    <div style="margin-bottom: 20px;">
                        <label style="display: block; margin-bottom: 10px;">Причина блокировки:</label>
                        <select id="quickBlockReason" style="width: 100%; padding: 10px; border-radius: 8px; background: var(--tg-input-bg); color: var(--tg-text-color); border: 1px solid var(--tg-border-color);">
                            <option value="spam">Спам</option>
                            <option value="harassment">Оскорбления</option>
                            <option value="threats">Угрозы</option>
                            <option value="hate_speech">Разжигание ненависти</option>
                            <option value="other">Другое</option>
                        </select>
                    </div>
                    
                    <div>
                        <label style="display: block; margin-bottom: 10px;">Длительность:</label>
                        <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                            <button class="btn btn-secondary" onclick="setQuickBlockDuration(24)" style="flex: 1; min-width: 60px;">24ч</button>
                            <button class="btn btn-secondary" onclick="setQuickBlockDuration(168)" style="flex: 1; min-width: 60px;">7д</button>
                            <button class="btn btn-secondary" onclick="setQuickBlockDuration(720)" style="flex: 1; min-width: 60px;">30д</button>
                            <button class="btn btn-danger" onclick="setQuickBlockDuration(null, true)" style="flex: 1; min-width: 80px;">Навсегда</button>
                        </div>
                        <input type="hidden" id="quickBlockDuration" value="24">
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" onclick="closeQuickBlockModal()">
                        Отмена
                    </button>
                    <button class="btn btn-danger" onclick="submitQuickBlock()">
                        🚫 Заблокировать
                    </button>
                </div>
            </div>
        </div>
        ` : ''}
    `;
    
    document.body.insertAdjacentHTML('beforeend', modals);
    
    // Добавляем обработчик для счетчика символов в массовом вопросе
    const massQuestionText = document.getElementById('massQuestionText');
    const massQuestionCharCount = document.getElementById('massQuestionCharCount');
    
    if (massQuestionText && massQuestionCharCount) {
        massQuestionText.addEventListener('input', function() {
            massQuestionCharCount.textContent = this.value.length;
        });
    }
}

function setupReportHandlers() {
    document.addEventListener('click', function(e) {
        // ИСПРАВЛЕНИЕ: правильный селектор для кнопок "Пожаловаться"
        if (e.target.matches('.report-btn, .report-btn *')) {
            e.preventDefault();
            e.stopPropagation();
            
            const btn = e.target.closest('.report-btn') || e.target;
            const questionId = btn.getAttribute('data-question-id');
            
            console.log('Кнопка "Пожаловаться" нажата:', { 
                questionId
            });
            
            // Открываем модалку жалобы
            if (isAdmin || isSuperAdmin) {
                openReportActionModal(questionId, null);
            } else {
                openReportModal(questionId, null);
            }
            return;
        }
        
        // Обработка отправки жалобы
        if (e.target.id === 'submitReportBtn' || e.target.closest('#submitReportBtn')) {
            e.preventDefault();
            submitReport();
            return;
        }
        
        // Обработка закрытия модалок жалоб
        if (e.target.classList.contains('close-btn') && e.target.closest('#reportModal')) {
            e.preventDefault();
            closeReportModal();
            return;
        }
        
        if (e.target.classList.contains('close-btn') && e.target.closest('#reportActionModal')) {
            e.preventDefault();
            closeReportActionModal();
            return;
        }
    });
    
    // ИСПРАВЛЕНИЕ: Добавляем обработчик для кнопки "Пожаловаться" в модалке отчетов
    const submitReportBtn = document.getElementById('submitReportBtn');
    if (submitReportBtn) {
        submitReportBtn.addEventListener('click', submitReport);
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
                    ${q.report_count && q.report_count > 0 ? `<span style="color: var(--tg-warning); margin-left: 5px;">⚠️ ${q.report_count}</span>` : ''}
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
                            data-question-id="${q.id}">
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
                            data-question-id="${q.id}">
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
                            data-question-id="${q.id}">
                        ⚠️ Пожаловаться
                    </button>
                    <button class="btn btn-danger" onclick="deleteQuestion(${q.id})">
                        🗑️ Удалить вопрос
                    </button>
                </div>
            ` : `
                <div class="btn-group">
                    <button class="btn btn-secondary report-btn" 
                            data-question-id="${q.id}">
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
window.openTOSDetails = openTOSDetails;
window.openUserManagementModal = openUserManagementModal;
window.openDataDeletionModal = openDataDeletionModal;
window.openBlockUserModal = openBlockUserModal;
window.openBlockFromReportModal = openBlockFromReportModal;
window.openMassQuestionModal = openMassQuestionModal;
window.sendMassQuestion = sendMassQuestion;
window.blockUser = blockUser;
window.unblockUser = unblockUser;
window.blockFromReport = blockFromReport;
window.updateReportStatus = updateReportStatus;
window.deleteUserData = deleteUserData;
window.closeModal = closeModal;
window.openReportActionModal = openReportActionModal;
window.closeReportActionModal = closeReportActionModal;
window.openQuickBlockModal = openQuickBlockModal;
window.closeQuickBlockModal = closeQuickBlockModal;
window.setQuickBlockDuration = setQuickBlockDuration;
window.submitQuickBlock = submitQuickBlock;