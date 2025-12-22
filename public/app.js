// Telegram Web App
let tg = window.Telegram?.WebApp;
let userId = null;
let username = null;
let currentQuestionId = null;

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
    // Очистка ресурсов если нужно
});

// ========== ФУНКЦИИ ДЛЯ ИНТЕРФЕЙСА ==========

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
    const answerText = document.getElementById('answerText');
    const answer = answerText?.value.trim();
    
    if (!answer) {
        showNotification('Введите текст ответа', 'warning');
        return;
    }
    
    if (answer.length < 2) {
        showNotification('Ответ слишком короткий', 'warning');
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
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                answer: answer
            })
        });
        
        if (response.ok) {
            closeAnswerModal();
            showNotification('✅ Ответ сохранен!', 'success');
            
            // Перезагружаем данные
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

// ========== ФУНКЦИИ ШЕРИНГА ==========

// Главная функция открытия модалки шеринга
async function openShareModal(questionId) {
    try {
        console.log('Открываем модалку шеринга для вопроса:', questionId);
        
        // Проверяем, есть ли глобальная функция из index.html
        if (typeof window.openShareModal === 'function') {
            // Вызываем функцию из index.html (обновленную версию)
            window.openShareModal(questionId);
        } else {
            // Запасной вариант - простой выбор
            await showSimpleShareChoice(questionId);
        }
        
    } catch (error) {
        console.error('Ошибка открытия модалки шеринга:', error);
        showNotification('Не удалось открыть модалку шеринга', 'error');
    }
}

// Простой выбор типа шеринга (запасной вариант)
async function showSimpleShareChoice(questionId) {
    const modalHTML = `
        <div class="modal active" id="simpleShareModal">
            <div class="modal-content" style="max-width: 400px;">
                <div class="modal-header">
                    <h3>📤 Поделиться ответом</h3>
                    <button class="btn-close" onclick="closeSimpleShareModal()">×</button>
                </div>
                <div class="modal-body">
                    <div style="text-align: center; margin-bottom: 25px;">
                        <div style="font-size: 48px; color: var(--tg-accent-color); margin-bottom: 15px;">💬</div>
                        <p style="color: var(--tg-secondary-text); font-size: 14px;">
                            Куда отправить ответ?
                        </p>
                    </div>
                    
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin: 20px 0;">
                        <button onclick="shareToTelegramStory(${questionId})" style="
                            background: var(--tg-input-bg);
                            border: 2px solid var(--tg-border-color);
                            border-radius: 12px;
                            padding: 20px;
                            text-align: center;
                            cursor: pointer;
                            transition: all 0.2s;
                            display: flex;
                            flex-direction: column;
                            align-items: center;
                            gap: 10px;
                        ">
                            <div style="font-size: 32px;">📱</div>
                            <div style="font-weight: 600; font-size: 15px;">В историю</div>
                            <div style="font-size: 12px; color: var(--tg-secondary-text);">Поделиться в Stories</div>
                        </button>
                        
                        <button onclick="shareToTelegramChat(${questionId})" style="
                            background: var(--tg-input-bg);
                            border: 2px solid var(--tg-border-color);
                            border-radius: 12px;
                            padding: 20px;
                            text-align: center;
                            cursor: pointer;
                            transition: all 0.2s;
                            display: flex;
                            flex-direction: column;
                            align-items: center;
                            gap: 10px;
                        ">
                            <div style="font-size: 32px;">💬</div>
                            <div style="font-weight: 600; font-size: 15px;">В чат</div>
                            <div style="font-size: 12px; color: var(--tg-secondary-text);">Отправить друзьям</div>
                        </button>
                    </div>
                    
                    <p style="text-align: center; color: var(--tg-secondary-text); font-size: 12px; margin-top: 20px;">
                        Ответ будет отправлен через Telegram бота
                    </p>
                </div>
            </div>
        </div>
    `;
    
    // Удаляем старую модалку если есть
    const oldModal = document.getElementById('simpleShareModal');
    if (oldModal) oldModal.remove();
    
    // Добавляем новую модалку
    document.body.insertAdjacentHTML('beforeend', modalHTML);
}

function closeSimpleShareModal() {
    const modal = document.getElementById('simpleShareModal');
    if (modal) modal.remove();
}

// Шеринг в историю (Stories)
async function shareToTelegramStory(questionId) {
    try {
        closeSimpleShareModal();
        showNotification('🖼️ Подготавливаем для истории...', 'info');
        
        // Получаем вопрос
        const response = await fetch(`/api/question/${questionId}`);
        if (!response.ok) throw new Error('Вопрос не найден');
        const question = await response.json();
        
        // Генерируем картинку
        const imageResponse = await fetch(`/api/generate-image/${questionId}`);
        let imageBlob;
        
        if (imageResponse.ok) {
            imageBlob = await imageResponse.blob();
        } else {
            imageBlob = await createSimpleShareImage(question);
        }
        
        // Скачиваем картинку
        const url = URL.createObjectURL(imageBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `вопрос-ответ-${questionId}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        // Отправляем через бота
        const botResponse = await fetch('/api/share-via-bot', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: userId,
                questionId: questionId,
                type: 'story'
            })
        });
        
        if (botResponse.ok) {
            showNotification('✅ Картинка скачана! Ответ отправлен в историю.', 'success');
        } else {
            showNotification('✅ Картинка скачана!', 'success');
        }
        
    } catch (error) {
        console.error('Ошибка шеринга в историю:', error);
        showNotification('Не удалось отправить в историю', 'error');
    }
}

// Шеринг в чат
async function shareToTelegramChat(questionId) {
    try {
        closeSimpleShareModal();
        showNotification('💬 Отправляем в чат...', 'info');
        
        const response = await fetch('/api/share-via-bot', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: userId,
                questionId: questionId,
                type: 'chat'
            })
        });
        
        if (response.ok) {
            showNotification('✅ Ответ отправлен в чат!', 'success');
        } else {
            throw new Error('Ошибка сервера');
        }
        
    } catch (error) {
        console.error('Ошибка шеринга в чат:', error);
        showNotification('Не удалось отправить в чат', 'error');
    }
}

// Создание простой картинки для шеринга
async function createSimpleShareImage(question) {
    return new Promise((resolve) => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        canvas.width = 1080;
        canvas.height = 1920;
        
        // Градиентный фон
        const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
        gradient.addColorStop(0, '#1a1a2e');
        gradient.addColorStop(1, '#0f3460');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // Иконка
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 80px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('💬', canvas.width / 2, 400);
        
        // Заголовок
        ctx.font = 'bold 48px Arial';
        ctx.fillText('Анонимный вопрос', canvas.width / 2, 500);
        
        // Вопрос
        ctx.font = '32px Arial';
        ctx.fillStyle = '#e1e1e1';
        const questionText = question.text.substring(0, 100) + (question.text.length > 100 ? '...' : '');
        wrapText(ctx, `"${questionText}"`, canvas.width / 2, 600, canvas.width - 100, 40);
        
        // Ответ
        if (question.answer) {
            ctx.font = 'bold 36px Arial';
            ctx.fillStyle = '#2e8de6';
            ctx.fillText('Ответ:', canvas.width / 2, 800);
            
            ctx.font = '28px Arial';
            ctx.fillStyle = '#ffffff';
            const answerText = question.answer.substring(0, 150) + (question.answer.length > 150 ? '...' : '');
            wrapText(ctx, `"${answerText}"`, canvas.width / 2, 900, canvas.width - 100, 35);
        }
        
        // Ссылка
        ctx.font = '24px Arial';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.fillText('t.me/dota2servicebot', canvas.width / 2, 1200);
        
        canvas.toBlob(resolve, 'image/png');
    });
}

// Функция для переноса текста
function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
    const words = text.split(' ');
    let line = '';
    
    for(let n = 0; n < words.length; n++) {
        const testLine = line + words[n] + ' ';
        const testWidth = ctx.measureText(testLine).width;
        
        if (testWidth > maxWidth && n > 0) {
            ctx.fillText(line, x, y);
            line = words[n] + ' ';
            y += lineHeight;
        } else {
            line = testLine;
        }
    }
    ctx.fillText(line, x, y);
}

// Удаление вопроса
async function deleteQuestion(questionId) {
    if (!confirm('Удалить вопрос?')) return;
    
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

// Делаем функции глобально доступными для HTML
window.shareProfileToTelegram = shareProfileToTelegram;
window.openAnswerModal = openAnswerModal;
window.closeAnswerModal = closeAnswerModal;
window.submitAnswer = submitAnswer;
window.openShareModal = openShareModal;
window.shareToTelegramStory = shareToTelegramStory;
window.shareToTelegramChat = shareToTelegramChat;
window.closeSimpleShareModal = closeSimpleShareModal;
window.deleteQuestion = deleteQuestion;