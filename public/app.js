// Telegram Web App
let tg = window.Telegram?.WebApp;
let userId = null;
let username = null;
let currentQuestionId = null;
let shareImageUrl = null;

// ========== ИНИЦИАЛИЗАЦИЯ ==========
document.addEventListener('DOMContentLoaded', async function() {
    console.log('🚀 Мини-апп запущен');
    
    if (tg) {
        tg.ready();
        tg.expand();
        
        const initData = tg.initDataUnsafe;
        userId = initData.user?.id;
        username = initData.user?.username || `user_${userId}`;
        
        console.log('Пользователь:', userId, username);
    } else {
        // Демо-режим
        userId = '123456';
        username = 'Демо пользователь';
    }
    
    // Инициализация UI
    initUI();
    
    // Загружаем данные
    await loadAllData();
    
    // Автообновление каждые 30 секунд
    setInterval(loadAllData, 30000);
});

// ========== ИНИЦИАЛИЗАЦИЯ UI ==========
function initUI() {
    // Обновляем информацию пользователя
    document.getElementById('username').textContent = username || 'Пользователь';
    document.getElementById('userId').textContent = `ID: ${userId}`;
    document.getElementById('profileName').textContent = username || 'Пользователь';
    document.getElementById('profileId').textContent = userId;
    
    // Создаем иконку для аватара
    const avatarIcon = document.getElementById('userAvatar');
    if (avatarIcon) {
        const firstLetter = username ? username.charAt(0).toUpperCase() : 'U';
        avatarIcon.textContent = firstLetter;
    }
    
    // Генерируем ссылку для вопросов
    const botUsername = 'dota2servicebot';
    const shareLink = `https://t.me/${botUsername}?start=ask_${userId}`;
    document.getElementById('shareLink').textContent = shareLink;
    
    // Настраиваем вкладки
    setupTabs();
}

// ========== ЗАГРУЗКА ДАННЫХ ==========
async function loadAllData() {
    try {
        updateStatus('🔄 Загрузка...');
        
        // Пробуем загрузить с сервера
        try {
            await Promise.all([
                loadIncomingQuestions(),
                loadSentQuestions(),
                updateStats()
            ]);
            updateStatus('🟢 Онлайн');
        } catch (error) {
            console.log('Сервер не отвечает, используем тестовые данные');
            await loadTestData();
            updateStatus('🟡 Демо-режим');
            showNotification('Используем тестовые данные', 'warning');
        }
        
    } catch (error) {
        console.error('Критическая ошибка загрузки:', error);
        updateStatus('🔴 Ошибка');
    }
}

// Загрузить тестовые данные
async function loadTestData() {
    try {
        // Тестовые входящие вопросы
        const testIncomingQuestions = [
            {
                id: 1,
                text: "Какой твой любимый герой в Dota 2?",
                answer: null,
                is_answered: false,
                created_at: new Date().toISOString(),
                from_username: 'Аноним'
            },
            {
                id: 2,
                text: "Что тебе нравится в программировании?",
                answer: "Возможность создавать что-то новое и полезное!",
                is_answered: true,
                created_at: new Date(Date.now() - 86400000).toISOString(),
                answered_at: new Date(Date.now() - 43200000).toISOString(),
                from_username: 'Аноним'
            }
        ];
        
        // Тестовые отправленные вопросы
        const testSentQuestions = [
            {
                id: 3,
                text: "Как дела?",
                answer: "Всё отлично, спасибо!",
                is_answered: true,
                created_at: new Date(Date.now() - 345600000).toISOString(),
                to_user_id: 987654,
                to_username: 'friend_user'
            }
        ];
        
        renderIncomingQuestions(testIncomingQuestions);
        renderSentQuestions(testSentQuestions);
        updateBadge('incoming', testIncomingQuestions.length);
        updateBadge('sent', testSentQuestions.length);
        
        // Обновляем статистику
        const answeredCount = testIncomingQuestions.filter(q => q.is_answered).length + 
                            testSentQuestions.filter(q => q.is_answered).length;
        const totalQuestions = testIncomingQuestions.length + testSentQuestions.length;
        
        document.getElementById('statTotal').textContent = totalQuestions;
        document.getElementById('statReceived').textContent = testIncomingQuestions.length;
        document.getElementById('statSent').textContent = testSentQuestions.length;
        document.getElementById('statAnswered').textContent = answeredCount;
        
    } catch (error) {
        console.error('Ошибка загрузки тестовых данных:', error);
    }
}

// Загрузить входящие вопросы
async function loadIncomingQuestions() {
    try {
        const response = await fetch(`/api/questions/incoming/${userId}`);
        
        if (!response.ok) {
            throw new Error('Ошибка сервера');
        }
        
        const questions = await response.json();
        renderIncomingQuestions(questions);
        updateBadge('incoming', questions.length);
    } catch (error) {
        console.error('Ошибка загрузки входящих:', error);
        throw error;
    }
}

// Загрузить отправленные вопросы
async function loadSentQuestions() {
    try {
        const response = await fetch(`/api/questions/sent/${userId}`);
        
        if (!response.ok) {
            throw new Error('Ошибка сервера');
        }
        
        const questions = await response.json();
        renderSentQuestions(questions);
        updateBadge('sent', questions.length);
    } catch (error) {
        console.error('Ошибка загрузки отправленных:', error);
        throw error;
    }
}

// Обновить статистику
async function updateStats() {
    try {
        const [incomingRes, sentRes, answeredRes] = await Promise.all([
            fetch(`/api/questions/incoming/${userId}`),
            fetch(`/api/questions/sent/${userId}`),
            fetch(`/api/questions/answered/${userId}`)
        ]);
        
        const incoming = await incomingRes.json();
        const sent = await sentRes.json();
        const answered = await answeredRes.json();
        
        const totalQuestions = incoming.length + sent.length;
        const answeredCount = answered.length;
        
        document.getElementById('statTotal').textContent = totalQuestions;
        document.getElementById('statReceived').textContent = incoming.length;
        document.getElementById('statSent').textContent = sent.length;
        document.getElementById('statAnswered').textContent = answeredCount;
        
    } catch (error) {
        console.error('Ошибка статистики:', error);
        throw error;
    }
}

// ========== РЕНДЕРИНГ ==========
// Рендер входящих вопросов
function renderIncomingQuestions(questions) {
    const container = document.getElementById('incoming-list');
    
    if (!questions || questions.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="icon">💭</div>
                <h3>Нет вопросов</h3>
                <p>Поделитесь ссылкой, чтобы получать вопросы от друзей</p>
                <button class="btn btn-primary" onclick="shareProfileToTelegram()" style="margin-top: 20px;">
                    📤 Поделиться профилем
                </button>
            </div>
        `;
        return;
    }
    
    container.innerHTML = questions.map(question => {
        const isAnswered = question.is_answered;
        const cardClass = isAnswered ? 'question-card answered' : 'question-card';
        
        return `
        <div class="${cardClass}" data-id="${question.id}">
            <div class="question-meta">
                <div class="question-date">${formatDate(question.created_at)}</div>
                <div class="question-from">
                    ${question.from_username ? `@${question.from_username}` : 'Аноним'}
                </div>
            </div>
            <div class="question-text">${escapeHtml(question.text)}</div>
            ${isAnswered ? `
                <div class="answer-bubble">
                    <strong>Ваш ответ:</strong>
                    <div style="margin-top: 8px;">${escapeHtml(question.answer)}</div>
                </div>
                <div class="btn-group">
                    <button class="btn btn-primary" onclick="openShareModal(${question.id})">
                        🖼️ Поделиться
                    </button>
                    <button class="btn btn-danger" onclick="deleteQuestion(${question.id})">
                        🗑️ Удалить
                    </button>
                </div>
            ` : `
                <div class="btn-group">
                    <button class="btn btn-success" onclick="openAnswerModal(${question.id})">
                        ✍️ Ответить
                    </button>
                    <button class="btn btn-danger" onclick="deleteQuestion(${question.id})">
                        🗑️ Удалить
                    </button>
                </div>
            `}
        </div>
        `;
    }).join('');
}

// Рендер отправленных вопросов
function renderSentQuestions(questions) {
    const container = document.getElementById('sent-list');
    
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
    
    container.innerHTML = questions.map(question => {
        const isAnswered = question.is_answered;
        const cardClass = isAnswered ? 'question-card answered' : 'question-card sent';
        
        return `
        <div class="${cardClass}" data-id="${question.id}">
            <div class="question-meta">
                <div class="question-date">${formatDate(question.created_at)}</div>
                <div class="question-from">
                    Кому: ${question.to_username ? `@${question.to_username}` : `ID ${question.to_user_id}`}
                </div>
            </div>
            <div class="question-text">${escapeHtml(question.text)}</div>
            ${isAnswered ? `
                <div class="answer-bubble">
                    <strong>Ответ:</strong>
                    <div style="margin-top: 8px;">${escapeHtml(question.answer)}</div>
                </div>
                <div class="btn-group">
                    <button class="btn btn-primary" onclick="openShareModal(${question.id})">
                        🖼️ Поделиться
                    </button>
                </div>
            ` : `
                <div class="btn-group">
                    <button class="btn btn-danger" onclick="deleteQuestion(${question.id})">
                        🗑️ Удалить вопрос
                    </button>
                </div>
            `}
        </div>
        `;
    }).join('');
}

// ========== ОТВЕТ НА ВОПРОС ==========
function openAnswerModal(questionId) {
    currentQuestionId = questionId;
    
    // Находим вопрос
    const questionCard = document.querySelector(`.question-card[data-id="${questionId}"]`);
    if (!questionCard) {
        showNotification('Вопрос не найден', 'error');
        return;
    }
    
    const questionText = questionCard.querySelector('.question-text').textContent;
    
    // Показываем превью вопроса
    document.getElementById('questionPreview').innerHTML = `
        <div style="margin-bottom: 20px;">
            <div style="font-size: 14px; color: var(--tg-secondary-text); margin-bottom: 8px;">Вопрос:</div>
            <div style="background: var(--tg-input-bg); padding: 12px; border-radius: 8px; border-left: 3px solid var(--tg-accent-color);">
                ${questionText}
            </div>
        </div>
    `;
    
    // Открываем модалку
    document.getElementById('answerModal').classList.add('active');
    document.getElementById('answerText').focus();
}

function closeAnswerModal() {
    document.getElementById('answerModal').classList.remove('active');
    document.getElementById('answerText').value = '';
    currentQuestionId = null;
}

async function submitAnswer() {
    const answerText = document.getElementById('answerText').value.trim();
    
    if (!answerText) {
        showNotification('Введите ответ', 'warning');
        return;
    }
    
    if (answerText.length < 2) {
        showNotification('Ответ слишком короткий', 'warning');
        return;
    }
    
    if (!currentQuestionId) {
        showNotification('Ошибка: вопрос не выбран', 'error');
        return;
    }
    
    showNotification('Отправка ответа...', 'info', 0);
    
    try {
        const response = await fetch(`/api/questions/${currentQuestionId}/answer`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                answer: answerText
            })
        });
        
        if (response.ok) {
            closeAnswerModal();
            showNotification('✅ Ответ сохранен!', 'success');
            await loadAllData(); // Перезагружаем все данные
        } else {
            const error = await response.json();
            throw new Error(error.error || 'Ошибка сервера');
        }
    } catch (error) {
        console.error('Ошибка отправки ответа:', error);
        showNotification('❌ Ошибка сохранения ответа', 'error');
    }
}

// ========== ШЕРИНГ ==========
async function openShareModal(questionId) {
    currentQuestionId = questionId;
    
    // Создаем модалку выбора шеринга
    const shareModalHTML = `
        <div class="modal active share-modal" id="shareModal">
            <div class="modal-content">
                <div class="modal-header">
                    <h3>🖼️ Поделиться ответом</h3>
                    <button class="btn-close" onclick="closeShareModal()">×</button>
                </div>
                <div class="modal-body">
                    <p style="color: var(--tg-secondary-text); margin-bottom: 20px; text-align: center;">
                        Как вы хотите поделиться этим ответом?
                    </p>
                    
                    <div class="share-options">
                        <div class="share-option" onclick="generateAndShare('story')">
                            <div class="icon">📱</div>
                            <div class="label">В историю</div>
                            <div class="description">Поделиться в Stories</div>
                        </div>
                        
                        <div class="share-option" onclick="generateAndShare('chats')">
                            <div class="icon">💬</div>
                            <div class="label">В чаты</div>
                            <div class="description">Отправить друзьям</div>
                        </div>
                    </div>
                    
                    <div id="shareProgress" style="display: none; margin-top: 20px;">
                        <div style="text-align: center; margin-bottom: 10px;">
                            <div class="loading-spinner" style="width: 30px; height: 30px; margin: 0 auto;"></div>
                            <p style="margin-top: 10px; color: var(--tg-accent-color);">Генерируем картинку...</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    // Добавляем модалку в DOM
    const existingModal = document.getElementById('shareModal');
    if (existingModal) {
        existingModal.remove();
    }
    
    document.body.insertAdjacentHTML('beforeend', shareModalHTML);
}

function closeShareModal() {
    const shareModal = document.getElementById('shareModal');
    if (shareModal) {
        shareModal.remove();
    }
    shareImageUrl = null;
}

async function generateAndShare(type) {
    if (!currentQuestionId) {
        showNotification('Ошибка: вопрос не выбран', 'error');
        return;
    }
    
    const shareProgress = document.getElementById('shareProgress');
    if (shareProgress) {
        shareProgress.style.display = 'block';
    }
    
    try {
        // Показываем уведомление о генерации
        showNotification('🖼️ Генерируем картинку...', 'info', 0);
        
        // Получаем информацию о вопросе для текста
        let questionText = "Интересный вопрос";
        try {
            const questionResponse = await fetch(`/api/question/${currentQuestionId}`);
            if (questionResponse.ok) {
                const question = await questionResponse.json();
                questionText = question.text.substring(0, 100) + (question.text.length > 100 ? '...' : '');
            }
        } catch (error) {
            console.log('Не удалось получить информацию о вопросе:', error);
        }
        
        // Получаем ссылку для приглашения
        const inviteLink = `https://t.me/dota2servicebot?start=ask_${userId}`;
        
        // Текст для шеринга
        const shareText = `💬 Мой ответ на анонимный вопрос!\n\n"${questionText}"\n\n👇 Задай и мне анонимный вопрос!`;
        const fullText = `${shareText}\n\n${inviteLink}`;
        
        // Закрываем модалку выбора
        closeShareModal();
        
        // Генерируем картинку
        let imageUrl;
        try {
            const response = await fetch(`/api/generate-image/${currentQuestionId}`);
            if (response.ok) {
                const blob = await response.blob();
                imageUrl = URL.createObjectURL(blob);
            } else {
                throw new Error('Ошибка генерации');
            }
        } catch (error) {
            console.log('Используем тестовую картинку:', error);
            imageUrl = 'https://via.placeholder.com/800x400/1a1a2e/ffffff?text=Ответ+на+вопрос';
        }
        
        shareImageUrl = imageUrl;
        
        // В зависимости от типа шеринга
        if (tg) {
            if (type === 'story') {
                // Пробуем поделиться в историю
                try {
                    if (tg.sharePhoto) {
                        tg.sharePhoto(imageUrl, fullText);
                        showNotification('✅ Открываем шеринг в историю...', 'success');
                    } else {
                        downloadAndShare(imageUrl, fullText);
                    }
                } catch (error) {
                    console.log('Шеринг в историю не доступен:', error);
                    downloadAndShare(imageUrl, fullText);
                }
            } else if (type === 'chats') {
                // Пробуем поделиться в чаты
                try {
                    if (tg.openTelegramLink) {
                        const encodedText = encodeURIComponent(fullText);
                        const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(inviteLink)}&text=${encodedText}`;
                        tg.openTelegramLink(shareUrl);
                        showNotification('✅ Открываем шеринг в чаты...', 'success');
                    } else {
                        downloadAndShare(imageUrl, fullText);
                    }
                } catch (error) {
                    console.log('Шеринг в чаты не доступен:', error);
                    downloadAndShare(imageUrl, fullText);
                }
            }
        } else {
            // В браузере - просто скачиваем
            downloadAndShare(imageUrl, fullText);
        }
        
    } catch (error) {
        console.error('Ошибка генерации картинки:', error);
        showNotification(`❌ Ошибка: ${error.message}`, 'error');
        
        const shareProgress = document.getElementById('shareProgress');
        if (shareProgress) {
            shareProgress.style.display = 'none';
        }
    }
}

function downloadAndShare(imageUrl, text) {
    // Скачиваем изображение
    const downloadLink = document.createElement('a');
    downloadLink.href = imageUrl;
    downloadLink.download = `question-answer-${currentQuestionId}.png`;
    downloadLink.click();
    
    // Показываем текст для копирования
    showNotification(`✅ Картинка скачана!\n\nСкопируйте текст:\n${text}`, 'success', 5000);
    
    // Даем возможность скопировать текст
    setTimeout(() => {
        if (confirm('Скопировать текст для поста?')) {
            navigator.clipboard.writeText(text).then(() => {
                showNotification('✅ Текст скопирован!', 'success');
            });
        }
    }, 1000);
}

// ========== ШЕРИНГ ПРОФИЛЯ ==========
async function shareProfileToTelegram() {
    const inviteLink = `https://t.me/dota2servicebot?start=ask_${userId}`;
    const shareText = `💬 Задай мне анонимный вопрос!\n\nЯ буду отвечать на все вопросы здесь 👇\n\n${inviteLink}`;
    
    if (tg && tg.openTelegramLink) {
        const encodedText = encodeURIComponent(shareText);
        const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(inviteLink)}&text=${encodedText}`;
        tg.openTelegramLink(shareUrl);
    } else {
        // В браузере
        const fullUrl = `https://t.me/share/url?url=${encodeURIComponent(inviteLink)}&text=${encodeURIComponent('Задай мне анонимный вопрос!')}`;
        window.open(fullUrl, '_blank', 'noopener,noreferrer');
    }
}

// ========== УДАЛЕНИЕ ВОПРОСА ==========
async function deleteQuestion(questionId) {
    if (!confirm('Удалить этот вопрос?')) return;
    
    try {
        const response = await fetch(`/api/questions/${questionId}`, {
            method: 'DELETE'
        });
        
        if (response.ok) {
            showNotification('✅ Вопрос удалён', 'success');
            await loadAllData();
        } else {
            throw new Error('Ошибка сервера');
        }
    } catch (error) {
        console.error('Ошибка удаления:', error);
        showNotification('❌ Не удалось удалить вопрос', 'error');
    }
}

// ========== УВЕДОМЛЕНИЯ ==========
function showNotification(message, type = 'info', duration = 3000, id = null) {
    // Удаляем старые уведомления
    const oldNotifications = document.querySelectorAll('.notification');
    oldNotifications.forEach(n => {
        if (n.getAttribute('data-id') !== id) {
            n.remove();
        }
    });
    
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.setAttribute('data-id', id || `notification-${Date.now()}`);
    
    const icons = {
        success: '✅',
        error: '❌',
        warning: '⚠️',
        info: '💡'
    };
    
    // Разбиваем сообщение на строки
    const messageLines = message.split('\n').map(line => 
        `<div style="margin: 2px 0;">${line}</div>`
    ).join('');
    
    notification.innerHTML = `
        <div class="notification-icon">${icons[type] || '💡'}</div>
        <div style="flex: 1;">${messageLines}</div>
    `;
    
    document.body.appendChild(notification);
    
    if (duration > 0) {
        setTimeout(() => {
            if (notification.parentNode) {
                notification.remove();
            }
        }, duration);
    }
    
    return notification;
}

// ========== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==========
function setupTabs() {
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', function() {
            const tabId = this.getAttribute('data-tab');
            
            // Обновляем активные вкладки
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
            
            this.classList.add('active');
            document.getElementById(`content-${tabId}`).classList.add('active');
            
            // Прокручиваем к началу
            document.querySelector('.tab-content').scrollTop = 0;
        });
    });
}

function updateBadge(type, count) {
    const badge = document.getElementById(`${type}Badge`);
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
    const statusElement = document.getElementById('statusText');
    if (statusElement) {
        statusElement.textContent = status;
        
        // Обновляем цвет точки
        const statusDot = statusElement.querySelector('.status-dot');
        if (statusDot) {
            if (status.includes('🟢')) {
                statusDot.className = 'status-dot';
            } else if (status.includes('🔴')) {
                statusDot.className = 'status-dot error';
            } else if (status.includes('🟡')) {
                statusDot.className = 'status-dot loading';
            } else {
                statusDot.className = 'status-dot loading';
            }
        }
    }
}

function formatDate(dateString) {
    try {
        const date = new Date(dateString);
        const now = new Date();
        const diff = now - date;
        
        // Сегодня
        if (date.toDateString() === now.toDateString()) {
            return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        }
        
        // Вчера
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        if (date.toDateString() === yesterday.toDateString()) {
            return 'вчера';
        }
        
        // За последнюю неделю
        if (diff < 7 * 86400000) {
            const days = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'];
            return days[date.getDay()];
        }
        
        // Более недели назад
        return date.toLocaleDateString('ru-RU', {
            day: 'numeric',
            month: 'short'
        });
        
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

// Очистка URL при разгрузке страницы
window.addEventListener('beforeunload', () => {
    if (shareImageUrl) {
        URL.revokeObjectURL(shareImageUrl);
    }
});

// Инициализация при загрузке
window.addEventListener('load', () => {
    // Добавляем статус-точку
    const statusText = document.getElementById('statusText');
    if (statusText) {
        statusText.innerHTML = '<span class="status-dot"></span> ' + statusText.innerHTML;
    }
});