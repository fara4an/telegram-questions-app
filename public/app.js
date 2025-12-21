// Telegram Web App
let tg = window.Telegram?.WebApp;
let userId = null;
let username = null;
let currentQuestionId = null;

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
    const botUsername = 'ваш_бот_username'; // ЗАМЕНИТЕ НАСТОЯЩИЙ USERNAME БОТА!
    const shareLink = `https://t.me/${botUsername}?start=ask_${userId}`;
    document.getElementById('shareLink').textContent = shareLink;
    
    // Настраиваем вкладки
    setupTabs();
}

// ========== ЗАГРУЗКА ДАННЫХ ==========
async function loadAllData() {
    try {
        await Promise.all([
            loadIncomingQuestions(),
            loadSentQuestions(),
            updateStats()
        ]);
        
        updateStatus('🟢 Онлайн');
    } catch (error) {
        console.error('Ошибка загрузки:', error);
        updateStatus('🔴 Ошибка подключения');
        showNotification('Ошибка подключения к серверу', 'error');
    }
}

// Загрузить входящие вопросы
async function loadIncomingQuestions() {
    try {
        const response = await fetch(`/api/questions/incoming/${userId}`);
        if (!response.ok) throw new Error('Ошибка сервера');
        
        const questions = await response.json();
        renderIncomingQuestions(questions);
        updateBadge('incoming', questions.length);
    } catch (error) {
        console.error('Ошибка загрузки входящих:', error);
        document.getElementById('incoming-list').innerHTML = `
            <div class="empty-state">
                <div class="icon">⚠️</div>
                <h3>Не удалось загрузить</h3>
                <p>Проверьте подключение к интернету</p>
                <button class="btn btn-secondary" onclick="loadIncomingQuestions()" style="margin-top: 20px;">
                    🔄 Повторить
                </button>
            </div>
        `;
    }
}

// Загрузить отправленные вопросы
async function loadSentQuestions() {
    try {
        const response = await fetch(`/api/questions/sent/${userId}`);
        if (!response.ok) throw new Error('Ошибка сервера');
        
        const questions = await response.json();
        renderSentQuestions(questions);
        updateBadge('sent', questions.length);
    } catch (error) {
        console.error('Ошибка загрузки отправленных:', error);
        document.getElementById('sent-list').innerHTML = `
            <div class="empty-state">
                <div class="icon">⚠️</div>
                <h3>Не удалось загрузить</h3>
                <p>Попробуйте позже</p>
                <button class="btn btn-secondary" onclick="loadSentQuestions()" style="margin-top: 20px;">
                    🔄 Повторить
                </button>
            </div>
        `;
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
                <button class="btn btn-primary" onclick="shareToTelegram()" style="margin-top: 20px;">
                    📤 Поделиться ссылкой
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
                    <button class="btn btn-primary" onclick="shareAnswerAsImage(${question.id})">
                        🖼️ Поделиться картинкой
                    </button>
                    <button class="btn btn-secondary" onclick="copyAnswerText(${question.id})">
                        📋 Копировать
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
                    <button class="btn btn-primary" onclick="shareAnswerAsImage(${question.id})">
                        🖼️ Поделиться картинкой
                    </button>
                    <button class="btn btn-secondary" onclick="copyAnswerText(${question.id})">
                        📋 Копировать
                    </button>
                </div>
            ` : `
                <div class="btn-group">
                    <button class="btn btn-secondary" onclick="deleteQuestion(${question.id})" style="background: var(--tg-input-bg);">
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

// ========== ВЫЛОЖЕНИЕ ОТВЕТА - ИСПРАВЛЕННАЯ ВЕРСИЯ ==========
async function shareAnswerAsImage(questionId) {
    try {
        // Показываем прогресс
        const progressId = `progress-${Date.now()}`;
        showNotification('🖼️ Генерация картинки...', 'info', 0, progressId);
        
        // Добавляем прогресс бар в уведомление
        const notification = document.querySelector(`[data-id="${progressId}"]`);
        if (notification) {
            notification.innerHTML += `
                <div class="progress-bar" style="margin-top: 10px;">
                    <div class="progress-fill" id="progress-fill-${progressId}"></div>
                </div>
            `;
            
            // Анимируем прогресс
            let progress = 0;
            const interval = setInterval(() => {
                progress += 10;
                const fill = document.getElementById(`progress-fill-${progressId}`);
                if (fill) fill.style.width = `${progress}%`;
                if (progress >= 90) clearInterval(interval);
            }, 200);
        }
        
        // Генерируем изображение через сервер
        const response = await fetch(`/api/generate-image/${questionId}`);
        
        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error || 'Ошибка генерации изображения');
        }
        
        // Получаем blob картинки
        const blob = await response.blob();
        
        // Завершаем прогресс
        const fill = document.getElementById(`progress-fill-${progressId}`);
        if (fill) fill.style.width = '100%';
        
        // Создаем URL для изображения
        const url = URL.createObjectURL(blob);
        
        // Если в Telegram - используем sharePhoto
        if (tg && tg.sharePhoto) {
            // Создаем временную ссылку
            const tempUrl = URL.createObjectURL(blob);
            
            // Для Telegram Web App нужно использовать специальный метод
            try {
                // Показываем изображение в новом окне для скачивания
                showNotification('✅ Картинка готова! Нажмите, чтобы сохранить', 'success');
                
                // Открываем изображение в новой вкладке для скачивания
                setTimeout(() => {
                    const downloadLink = document.createElement('a');
                    downloadLink.href = tempUrl;
                    downloadLink.download = `question-answer-${questionId}.png`;
                    downloadLink.click();
                }, 1000);
                
            } catch (shareError) {
                console.log('Telegram share не доступен:', shareError);
                // Открываем в новой вкладке
                window.open(tempUrl, '_blank');
            }
            
        } else {
            // В браузере - скачиваем файл
            const downloadLink = document.createElement('a');
            downloadLink.href = url;
            downloadLink.download = `question-answer-${questionId}.png`;
            downloadLink.click();
            
            showNotification('✅ Картинка скачана!', 'success');
        }
        
        // Очищаем уведомление через 3 секунды
        setTimeout(() => {
            const notification = document.querySelector(`[data-id="${progressId}"]`);
            if (notification) notification.remove();
        }, 3000);
        
    } catch (error) {
        console.error('Ошибка генерации картинки:', error);
        showNotification(`❌ Ошибка: ${error.message}`, 'error');
    }
}

function copyAnswerText(questionId) {
    const questionCard = document.querySelector(`.question-card[data-id="${questionId}"]`);
    if (!questionCard) {
        showNotification('Вопрос не найден', 'error');
        return;
    }
    
    const questionText = questionCard.querySelector('.question-text').textContent;
    const answerBubble = questionCard.querySelector('.answer-bubble');
    
    if (!answerBubble) {
        showNotification('Ответ не найден', 'warning');
        return;
    }
    
    const answerText = answerBubble.textContent
        .replace('Ваш ответ:', '')
        .replace('Ответ:', '')
        .trim();
    
    const fullText = `Вопрос: ${questionText}\n\nОтвет: ${answerText}`;
    
    navigator.clipboard.writeText(fullText).then(() => {
        showNotification('✅ Текст скопирован в буфер!', 'success');
    }).catch(() => {
        showNotification('❌ Не удалось скопировать', 'error');
    });
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

// ========== ПРОФИЛЬ ==========
function copyShareLink() {
    const link = document.getElementById('shareLink').textContent;
    
    navigator.clipboard.writeText(link).then(() => {
        showNotification('✅ Ссылка скопирована!', 'success');
    }).catch(() => {
        showNotification('❌ Не удалось скопировать', 'error');
    });
}

function shareToTelegram() {
    const link = document.getElementById('shareLink').textContent;
    
    if (tg && tg.openTelegramLink) {
        tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=Задай%20мне%20анонимный%20вопрос!`);
    } else {
        // Открываем в новом окне
        window.open(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=Задай%20мне%20анонимный%20вопрос!`, '_blank', 'noopener,noreferrer');
    }
}

// ========== УВЕДОМЛЕНИЯ ==========
function showNotification(message, type = 'info', duration = 3000, id = null) {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.setAttribute('data-id', id || `notification-${Date.now()}`);
    
    const icons = {
        success: '✅',
        error: '❌',
        warning: '⚠️',
        info: '💡'
    };
    
    notification.innerHTML = `
        <div class="notification-icon">${icons[type] || '💡'}</div>
        <div>${message}</div>
    `;
    
    document.body.appendChild(notification);
    
    if (duration > 0) {
        setTimeout(() => {
            notification.remove();
        }, duration);
    }
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

// Инициализация при загрузке
window.addEventListener('load', () => {
    // Добавляем статус-точку
    const statusText = document.getElementById('statusText');
    if (statusText) {
        statusText.innerHTML = '<span class="status-dot"></span> ' + statusText.innerHTML;
    }
});