// Telegram Web App
let tg = window.Telegram?.WebApp;
let userId = null;
let username = null;
let currentQuestionId = null;
const botUsername = 'dota2servicebot';

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
    
    console.log('Пользователь:', { userId, username });
    return { userId, username };
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
    
    setupTabs();
    console.log('✅ UI инициализирован');
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
        
        updateStatus('🟢 Онлайн');
        console.log('✅ Данные загружены');
    } catch (error) {
        console.error('❌ Ошибка загрузки данных:', error);
        updateStatus('🟡 Демо-режим');
        await showTestData();
        showNotification('Используем тестовые данные', 'warning');
    }
}

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

// ========== РЕНДЕРИНГ ==========

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
                        📤 Поделиться в чат
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
                        📤 Поделиться в чат
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

// ========== КРАСИВАЯ МОДАЛКА ОТВЕТА ==========

function openAnswerModal(questionId) {
    currentQuestionId = questionId;
    const modal = getElement('answerModal');
    
    // Получаем текст вопроса для превью
    fetch(`/api/question/${questionId}`)
        .then(response => response.json())
        .then(question => {
            const previewElement = getElement('previewQuestionText');
            if (previewElement) {
                previewElement.textContent = question.text.length > 120 ? 
                    question.text.substring(0, 120) + '...' : question.text;
            }
        })
        .catch(error => {
            console.error('Ошибка загрузки вопроса:', error);
        });
    
    // Настраиваем счетчик символов
    const answerText = getElement('answerText');
    const charCount = getElement('answerCharCount');
    const progressBar = getElement('charProgressBar');
    const warning = getElement('charLimitWarning');
    
    if (answerText && charCount && progressBar && warning) {
        // Очищаем поле при открытии
        answerText.value = '';
        charCount.textContent = '0';
        progressBar.style.width = '0%';
        warning.style.display = 'none';
        
        answerText.addEventListener('input', function() {
            const length = this.value.length;
            charCount.textContent = length;
            
            // Обновляем прогресс-бар
            const percentage = (length / 1000) * 100;
            progressBar.style.width = `${Math.min(percentage, 100)}%`;
            
            // Меняем цвет при приближении к лимиту
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
            
            // Блокируем ввод при превышении лимита
            if (length > 1000) {
                this.value = this.value.substring(0, 1000);
                charCount.textContent = '1000';
                progressBar.style.width = '100%';
                progressBar.style.background = 'linear-gradient(90deg, #FF5722 0%, #F44336 100%)';
                showNotification('Достигнут лимит символов!', 'warning');
            }
        });
        
        // Фокус на поле ввода
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

// ========== ПРОСТОЙ ШЕРИНГ В ЧАТ ==========

async function openShareModal(questionId) {
    try {
        showNotification('🎨 Отправляем ответ в ваш чат с ботом...', 'info');
        
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
        
        if (data.success) {
            // Красивое уведомление об успехе
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
        } else {
            throw new Error(data.message || 'Неизвестная ошибка');
        }
        
    } catch (error) {
        console.error('❌ Ошибка шеринга:', error);
        showNotification(`❌ ${error.message}`, 'error', 5000);
    }
}

// Новая функция для уведомлений с кнопкой действия
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

function shareProfileToTelegram() {
    const inviteLink = `https://t.me/${botUsername}?start=ask_${userId}`;
    
    if (tg && tg.openTelegramLink) {
        const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(inviteLink)}&text=${encodeURIComponent('Задай мне анонимный вопрос!')}`;
        tg.openTelegramLink(shareUrl);
    } else {
        window.open(`https://t.me/share/url?url=${encodeURIComponent(inviteLink)}&text=${encodeURIComponent('Задай мне анонимный вопрос!')}`, '_blank');
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
window.openShareModal = openShareModal;
window.deleteQuestion = deleteQuestion;
window.showNotificationWithAction = showNotificationWithAction;