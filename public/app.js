// Telegram Web App
let tg = window.Telegram?.WebApp;
let userId = null;
let username = null;
let currentQuestionId = null;
let shareImageUrl = null;

// ========== ОСНОВНЫЕ ФУНКЦИИ ==========

// Безопасное получение элемента
function getElement(id) {
    const element = document.getElementById(id);
    if (!element) {
        console.warn(`⚠️ Элемент ${id} не найден`);
    }
    return element;
}

// Безопасная установка текста
function setText(id, text) {
    const element = getElement(id);
    if (element) {
        element.textContent = text || '';
    }
}

// Инициализация
async function initApp() {
    console.log('🚀 Инициализация приложения');
    
    try {
        // Получаем данные пользователя
        await initUserData();
        
        // Инициализируем UI
        await initUI();
        
        // Загружаем данные
        await loadAllData();
        
        // Настраиваем автообновление
        setInterval(loadAllData, 30000);
        
        console.log('✅ Приложение инициализировано');
    } catch (error) {
        console.error('❌ Ошибка инициализации:', error);
        showNotification('Ошибка загрузки приложения', 'error');
    }
}

// Получение данных пользователя
async function initUserData() {
    console.log('Получение данных пользователя...');
    
    if (tg) {
        tg.ready();
        tg.expand();
        
        const initData = tg.initDataUnsafe || {};
        console.log('Данные Telegram:', initData);
        
        userId = initData.user?.id;
        username = initData.user?.username || initData.user?.first_name || 'Пользователь';
        
        if (!userId) {
            console.warn('⚠️ userId не найден в данных Telegram');
            // Пробуем получить из URL или использовать случайный ID
            userId = 'demo_' + Math.floor(Math.random() * 1000000);
        }
    } else {
        // Режим разработки
        console.warn('⚠️ Режим разработки - нет Telegram WebApp');
        userId = 'demo_' + Math.floor(Math.random() * 1000000);
        username = 'Демо пользователь';
    }
    
    console.log('Пользователь:', { userId, username });
    return { userId, username };
}

// Инициализация UI
async function initUI() {
    console.log('Инициализация UI...');
    
    // Обновляем информацию пользователя
    setText('username', username);
    setText('userId', `ID: ${userId}`);
    setText('profileName', username);
    setText('profileId', userId);
    
    // Аватар
    const avatar = getElement('userAvatar');
    if (avatar) {
        const firstLetter = username ? username.charAt(0).toUpperCase() : 'U';
        avatar.textContent = firstLetter;
    }
    
    // Ссылка для вопросов
    const botUsername = 'dota2servicebot';
    const shareLink = `https://t.me/${botUsername}?start=ask_${userId}`;
    setText('shareLink', shareLink);
    
    // Настраиваем вкладки
    setupTabs();
    
    console.log('✅ UI инициализирован');
}

// Загрузка всех данных
async function loadAllData() {
    console.log('📥 Загрузка данных...');
    updateStatus('🔄 Загрузка...');
    
    try {
        // Загружаем параллельно
        await Promise.allSettled([
            loadIncomingQuestions(),
            loadSentQuestions(),
            loadStats()
        ]);
        
        updateStatus('🟢 Онлайн');
        console.log('✅ Данные загружены');
    } catch (error) {
        console.error('❌ Ошибка загрузки данных:', error);
        updateStatus('🟡 Демо-режим');
        
        // Показываем тестовые данные
        await showTestData();
        showNotification('Используем тестовые данные', 'warning');
    }
}

// Показать тестовые данные
async function showTestData() {
    console.log('Показ тестовых данных...');
    
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
    
    // Статистика
    setText('statTotal', '2');
    setText('statReceived', '1');
    setText('statSent', '1');
    setText('statAnswered', '1');
}

// Загрузка входящих вопросов
async function loadIncomingQuestions() {
    try {
        console.log(`Запрос входящих вопросов для ${userId}`);
        const response = await fetch(`/api/questions/incoming/${userId}`);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const questions = await response.json();
        console.log(`Получено ${questions.length} входящих вопросов`);
        
        renderIncomingQuestions(questions);
        updateBadge('incoming', questions.length);
        
        return questions;
    } catch (error) {
        console.error('Ошибка загрузки входящих:', error);
        throw error;
    }
}

// Загрузка отправленных вопросов
async function loadSentQuestions() {
    try {
        console.log(`Запрос отправленных вопросов для ${userId}`);
        const response = await fetch(`/api/questions/sent/${userId}`);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const questions = await response.json();
        console.log(`Получено ${questions.length} отправленных вопросов`);
        
        renderSentQuestions(questions);
        updateBadge('sent', questions.length);
        
        return questions;
    } catch (error) {
        console.error('Ошибка загрузки отправленных:', error);
        throw error;
    }
}

// Загрузка статистики
async function loadStats() {
    try {
        console.log(`Запрос статистики для ${userId}`);
        const response = await fetch(`/api/stats/${userId}`);
        
        if (response.ok) {
            const stats = await response.json();
            console.log('Статистика:', stats);
            
            setText('statTotal', stats.total || '0');
            setText('statReceived', stats.received || '0');
            setText('statSent', stats.sent || '0');
            setText('statAnswered', stats.answered || '0');
        } else {
            console.warn('Статистика недоступна');
            // Используем значения по умолчанию
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

// ========== РЕНДЕРИНГ ==========

// Рендер входящих вопросов
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
                    ${q.from_username ? `@${q.from_username}` : 'Аноним'}
                </div>
            </div>
            <div class="question-text">${escapeHtml(q.text)}</div>
            ${q.is_answered ? `
                <div class="answer-bubble">
                    <strong>Ваш ответ:</strong>
                    <div>${escapeHtml(q.answer)}</div>
                </div>
                <div class="btn-group">
                    <button class="btn btn-primary" onclick="openShareModal(${q.id})">
                        🖼️ Поделиться
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

// Рендер отправленных вопросов
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
                    Кому: ${q.to_username ? `@${q.to_username}` : `ID ${q.to_user_id}`}
                </div>
            </div>
            <div class="question-text">${escapeHtml(q.text)}</div>
            ${q.is_answered ? `
                <div class="answer-bubble">
                    <strong>Ответ:</strong>
                    <div>${escapeHtml(q.answer)}</div>
                </div>
                <div class="btn-group">
                    <button class="btn btn-primary" onclick="openShareModal(${q.id})">
                        🖼️ Поделиться
                    </button>
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
        
        // Обновляем точку статуса
        if (status.includes('🟢') || status.includes('✅')) {
            statusElement.innerHTML = '<span class="status-dot"></span> ' + status;
        } else if (status.includes('🔴') || status.includes('❌')) {
            statusElement.innerHTML = '<span class="status-dot error"></span> ' + status;
        } else if (status.includes('🟡') || status.includes('⚠️')) {
            statusElement.innerHTML = '<span class="status-dot loading"></span> ' + status;
        }
    }
}

function formatDate(dateString) {
    try {
        const date = new Date(dateString);
        const now = new Date();
        
        if (date.toDateString() === now.toDateString()) {
            return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        }
        
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        if (date.toDateString() === yesterday.toDateString()) {
            return 'вчера';
        }
        
        const diff = now - date;
        if (diff < 7 * 86400000) {
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

// ========== ОБРАБОТЧИКИ СОБЫТИЙ ==========

// Запуск приложения при полной загрузке страницы
document.addEventListener('DOMContentLoaded', function() {
    console.log('📄 DOM загружен, запускаем приложение...');
    setTimeout(initApp, 100); // Небольшая задержка для полной загрузки
});

// Очистка при разгрузке
window.addEventListener('beforeunload', () => {
    if (shareImageUrl) {
        URL.revokeObjectURL(shareImageUrl);
    }
});

// ========== ОСТАЛЬНЫЕ ФУНКЦИИ (мини-версии для теста) ==========

function shareProfileToTelegram() {
    const inviteLink = `https://t.me/dota2servicebot?start=ask_${userId}`;
    const shareText = `💬 Задай мне анонимный вопрос!\n\n${inviteLink}`;
    
    if (tg && tg.openTelegramLink) {
        const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(inviteLink)}&text=${encodeURIComponent(shareText)}`;
        tg.openTelegramLink(shareUrl);
    } else {
        window.open(`https://t.me/share/url?url=${encodeURIComponent(inviteLink)}&text=${encodeURIComponent('Задай мне анонимный вопрос!')}`, '_blank');
    }
}

function openAnswerModal(questionId) {
    currentQuestionId = questionId;
    const modal = getElement('answerModal');
    if (modal) modal.classList.add('active');
}

function closeAnswerModal() {
    const modal = getElement('answerModal');
    if (modal) modal.classList.remove('active');
}

async function submitAnswer() {
    showNotification('Функция в разработке', 'info');
}

function openShareModal(questionId) {
    showNotification('Функция шеринга в разработке', 'info');
}

function closeShareModal() {
    // placeholder
}

function generateAndShare(type) {
    showNotification('Генерация изображения в разработке', 'info');
}

async function deleteQuestion(questionId) {
    if (!confirm('Удалить вопрос?')) return;
    showNotification('Вопрос удален (демо)', 'success');
    await loadAllData();
}