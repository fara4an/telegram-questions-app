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

async function openShareModal(questionId) {
    try {
        showNotification('Подготавливаем ответ...', 'info');
        
        const response = await fetch(`/api/question/${questionId}`);
        if (!response.ok) throw new Error('Вопрос не найден');
        
        const question = await response.json();
        
        // Показываем простую модалку
        showSimpleShareModal(question);
        
    } catch (error) {
        console.error('Ошибка открытия шеринга:', error);
        showNotification('Ошибка загрузки вопроса', 'error');
    }
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

// ========== ШЕРИНГ ОТВЕТОВ ==========

let shareImageBlob = null;
let shareQuestionData = null;

// Открыть модалку шеринга ответа
async function openShareAnswerModal(questionId) {
    try {
        console.log('Открытие модалки шеринга для вопроса:', questionId);
        currentQuestionId = questionId;
        
        // Показываем загрузку
        const modal = getElement('shareAnswerModal');
        if (!modal) {
            console.error('Модалка шеринга не найдена');
            return;
        }
        
        modal.classList.add('active');
        
        // Получаем данные вопроса
        const response = await fetch(`/api/question/${questionId}`);
        if (!response.ok) throw new Error('Вопрос не найден');
        
        shareQuestionData = await response.json();
        
        // Показываем превью вопроса
        const preview = getElement('shareQuestionPreview');
        if (preview) {
            preview.innerHTML = `
                <div style="font-size: 13px; color: var(--tg-secondary-text); margin-bottom: 5px;">Вопрос:</div>
                <div style="font-size: 15px; color: var(--tg-text-color);">
                    ${escapeHtml(shareQuestionData.text.substring(0, 150))}${shareQuestionData.text.length > 150 ? '...' : ''}
                </div>
            `;
        }
        
        // Генерируем картинку
        const imageResponse = await fetch(`/api/generate-image/${questionId}`);
        if (!imageResponse.ok) {
            console.warn('API генерации недоступен, используем тестовую картинку');
            // Используем тестовую картинку
            shareImageBlob = await createTestImage(shareQuestionData);
        } else {
            shareImageBlob = await imageResponse.blob();
        }
        
        const imageUrl = URL.createObjectURL(shareImageBlob);
        
        // Показываем превью картинки
        const imagePreview = getElement('shareImagePreview');
        if (imagePreview) {
            imagePreview.innerHTML = `
                <img src="${imageUrl}" style="max-width: 100%; border-radius: 8px; border: 2px solid var(--tg-border-color);" alt="Превью ответа">
                <p style="margin-top: 10px; color: var(--tg-secondary-text); font-size: 12px;">Картинка готова!</p>
            `;
        }
        
        // Генерируем текст для поста
        const userLink = `https://t.me/dota2servicebot?start=ask_${userId}`;
        const shareText = `💬 Мой ответ на анонимный вопрос!\n\n"${shareQuestionData.text.substring(0, 100)}${shareQuestionData.text.length > 100 ? '...' : ''}"\n\n👇 Задай и мне анонимный вопрос!\n\n${userLink}`;
        
        const shareTextArea = getElement('shareText');
        if (shareTextArea) {
            shareTextArea.value = shareText;
        }
        
    } catch (error) {
        console.error('Ошибка шеринга:', error);
        showNotification('Не удалось подготовить ответ для шеринга', 'error');
        closeShareAnswerModal();
    }
}

// Закрыть модалку шеринга
function closeShareAnswerModal() {
    const modal = getElement('shareAnswerModal');
    if (modal) modal.classList.remove('active');
    
    if (shareImageBlob) {
        URL.revokeObjectURL(URL.createObjectURL(shareImageBlob));
        shareImageBlob = null;
    }
    shareQuestionData = null;
}

// Копировать текст для поста
function copyShareText() {
    const textArea = getElement('shareText');
    if (!textArea) return;
    
    textArea.select();
    textArea.setSelectionRange(0, 99999); // Для мобильных
    document.execCommand('copy');
    
    // Показываем уведомление
    showNotification('Текст скопирован в буфер обмена!', 'success');
}

// Скачать картинку и текст
function downloadAndShare() {
    if (!shareImageBlob) {
        showNotification('Картинка не загружена!', 'error');
        return;
    }
    
    try {
        // Скачиваем картинку
        const url = URL.createObjectURL(shareImageBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ответ-на-вопрос-${shareQuestionData?.id || Date.now()}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        
        // Предлагаем скопировать текст
        copyShareText();
        
        closeShareAnswerModal();
        showNotification('✅ Картинка скачана! Текст скопирован в буфер обмена.', 'success');
        
    } catch (error) {
        console.error('Ошибка скачивания:', error);
        showNotification('Ошибка скачивания картинки', 'error');
    }
}

// Создать тестовую картинку
async function createTestImage(question) {
    return new Promise((resolve) => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        canvas.width = 800;
        canvas.height = 400;
        
        // Фон
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(0, 0, 800, 400);
        
        // Текст
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 24px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('💬 Анонимный вопрос', 400, 100);
        
        ctx.font = '18px Arial';
        ctx.fillText('Вопрос:', 400, 150);
        
        ctx.font = '16px Arial';
        const questionText = question.text.substring(0, 50) + (question.text.length > 50 ? '...' : '');
        ctx.fillText(`"${questionText}"`, 400, 180);
        
        ctx.fillStyle = '#2e8de6';
        ctx.font = 'bold 20px Arial';
        ctx.fillText('Ответ успешно отправлен!', 400, 250);
        
        ctx.fillStyle = '#aaaaaa';
        ctx.font = '14px Arial';
        ctx.fillText('t.me/anonymous_questions_bot', 400, 350);
        
        canvas.toBlob(resolve, 'image/png');
    });
}

// ========== ФУНКЦИИ ШЕРИНГА ==========

// Открыть модалку шеринга
async function openShareModal(questionId) {
    await shareAnswer(questionId);
}

// ========== ШЕРИНГ ОТВЕТОВ ==========

async function openShareModal(questionId) {
    try {
        console.log('Начинаем шеринг вопроса:', questionId);
        
        // Показываем выбор типа шеринга
        const modalHTML = `
            <div class="modal active" id="shareModal">
                <div class="modal-content">
                    <div class="modal-header">
                        <h3>🖼️ Поделиться ответом</h3>
                        <button class="btn-close" onclick="closeShareModal()">×</button>
                    </div>
                    <div class="modal-body">
                        <p style="text-align: center; color: var(--tg-secondary-text); margin-bottom: 20px;">
                            Как вы хотите поделиться ответом?
                        </p>
                        
                        <div class="share-options" style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin: 20px 0;">
                            <div class="share-option" onclick="shareToStory(${questionId})" style="
                                background: var(--tg-input-bg);
                                border: 2px solid var(--tg-border-color);
                                border-radius: 12px;
                                padding: 20px;
                                text-align: center;
                                cursor: pointer;
                                transition: all 0.2s;
                            ">
                                <div style="font-size: 32px; margin-bottom: 10px;">📱</div>
                                <div style="font-weight: 600; margin-bottom: 5px;">В историю</div>
                                <div style="font-size: 12px; color: var(--tg-secondary-text);">Поделиться в Stories</div>
                            </div>
                            
                            <div class="share-option" onclick="shareToChats(${questionId})" style="
                                background: var(--tg-input-bg);
                                border: 2px solid var(--tg-border-color);
                                border-radius: 12px;
                                padding: 20px;
                                text-align: center;
                                cursor: pointer;
                                transition: all 0.2s;
                            ">
                                <div style="font-size: 32px; margin-bottom: 10px;">💬</div>
                                <div style="font-weight: 600; margin-bottom: 5px;">В чаты</div>
                                <div style="font-size: 12px; color: var(--tg-secondary-text);">Отправить друзьям</div>
                            </div>
                        </div>
                        
                        <div id="shareProgress" style="display: none; text-align: center;">
                            <div class="loading-spinner" style="width: 40px; height: 40px; margin: 0 auto;"></div>
                            <p style="margin-top: 15px; color: var(--tg-accent-color);">Генерируем картинку...</p>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        // Добавляем модалку
        const existingModal = document.getElementById('shareModal');
        if (existingModal) existingModal.remove();
        document.body.insertAdjacentHTML('beforeend', modalHTML);
        
    } catch (error) {
        console.error('Ошибка открытия модалки:', error);
        showNotification('Ошибка открытия модалки шеринга', 'error');
    }
}

function closeShareModal() {
    const modal = document.getElementById('shareModal');
    if (modal) modal.remove();
}

// Шеринг в историю (Stories)
async function shareToStory(questionId) {
    try {
        // Показываем прогресс
        const progress = document.getElementById('shareProgress');
        if (progress) progress.style.display = 'block';
        
        // Получаем данные вопроса
        const question = await fetchQuestionData(questionId);
        
        // Генерируем картинку
        const imageUrl = await generateAnswerImage(question);
        
        // Готовим текст для шеринга
        const shareText = createShareText(question);
        
        // Используем Telegram API для шеринга в историю
        if (tg && tg.sharePhoto) {
            // Telegram WebApp API для шеринга фото
            tg.sharePhoto(imageUrl, shareText);
            showNotification('Открываем шеринг в историю...', 'success');
        } else {
            // Альтернатива для браузера
            downloadImageAndShare(imageUrl, shareText, 'story');
        }
        
        closeShareModal();
        
    } catch (error) {
        console.error('Ошибка шеринга в историю:', error);
        showNotification('Ошибка шеринга в историю', 'error');
        
        const progress = document.getElementById('shareProgress');
        if (progress) progress.style.display = 'none';
    }
}

// Шеринг в чаты
async function shareToChats(questionId) {
    try {
        // Показываем прогресс
        const progress = document.getElementById('shareProgress');
        if (progress) progress.style.display = 'block';
        
        // Получаем данные вопроса
        const question = await fetchQuestionData(questionId);
        
        // Генерируем картинку
        const imageUrl = await generateAnswerImage(question);
        
        // Готовим текст для шеринга
        const shareText = createShareText(question);
        
        // Используем Telegram API для шеринга в чаты
        if (tg && tg.openTelegramLink) {
            // Формируем ссылку для шеринга в Telegram
            const encodedText = encodeURIComponent(shareText);
            const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(window.location.origin)}&text=${encodedText}`;
            
            tg.openTelegramLink(shareUrl);
            showNotification('Открываем шеринг в чаты...', 'success');
        } else {
            // Альтернатива для браузера
            downloadImageAndShare(imageUrl, shareText, 'chats');
        }
        
        closeShareModal();
        
    } catch (error) {
        console.error('Ошибка шеринга в чаты:', error);
        showNotification('Ошибка шеринга в чаты', 'error');
        
        const progress = document.getElementById('shareProgress');
        if (progress) progress.style.display = 'none';
    }
}

// Вспомогательные функции
async function fetchQuestionData(questionId) {
    const response = await fetch(`/api/question/${questionId}`);
    if (!response.ok) throw new Error('Вопрос не найден');
    return await response.json();
}

async function generateAnswerImage(question) {
    try {
        // Пробуем получить сгенерированную картинку с сервера
        const response = await fetch(`/api/generate-image/${question.id}`);
        
        if (response.ok) {
            const blob = await response.blob();
            return URL.createObjectURL(blob);
        } else {
            // Создаем красивую картинку самостоятельно
            return await createBeautifulAnswerImage(question);
        }
    } catch (error) {
        console.warn('API генерации недоступен, создаем локальную картинку:', error);
        return await createBeautifulAnswerImage(question);
    }
}

async function createBeautifulAnswerImage(question) {
    return new Promise((resolve) => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        canvas.width = 1080; // Размер для Stories
        canvas.height = 1920;
        
        // Красивый градиентный фон
        const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
        gradient.addColorStop(0, '#1a1a2e');
        gradient.addColorStop(0.5, '#16213e');
        gradient.addColorStop(1, '#0f3460');
        
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // Добавляем декоративные элементы
        drawDecorativeElements(ctx, canvas.width, canvas.height);
        
        // Иконка в центре
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 120px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('💬', canvas.width / 2, 400);
        
        // Заголовок
        ctx.font = 'bold 64px Arial';
        ctx.fillText('Анонимный вопрос', canvas.width / 2, 550);
        
        // Разделительная линия
        ctx.strokeStyle = 'rgba(46, 141, 230, 0.5)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(canvas.width / 2 - 150, 600);
        ctx.lineTo(canvas.width / 2 + 150, 600);
        ctx.stroke();
        
        // Текст вопроса
        ctx.font = '36px Arial';
        ctx.fillStyle = '#e1e1e1';
        
        const questionText = `"${question.text.substring(0, 80)}${question.text.length > 80 ? '...' : ''}"`;
        wrapText(ctx, questionText, canvas.width / 2, 700, canvas.width - 200, 50);
        
        // Ответ (если есть)
        if (question.answer) {
            ctx.font = 'bold 48px Arial';
            ctx.fillStyle = '#2e8de6';
            ctx.fillText('Ответ:', canvas.width / 2, 900);
            
            ctx.font = '32px Arial';
            ctx.fillStyle = '#ffffff';
            
            const answerText = `"${question.answer.substring(0, 100)}${question.answer.length > 100 ? '...' : ''}"`;
            wrapText(ctx, answerText, canvas.width / 2, 1000, canvas.width - 200, 40);
        } else {
            ctx.font = 'bold 48px Arial';
            ctx.fillStyle = '#4caf50';
            ctx.fillText('Ответ отправлен!', canvas.width / 2, 950);
        }
        
        // Призыв к действию
        ctx.font = 'bold 40px Arial';
        ctx.fillStyle = '#ffffff';
        ctx.fillText('👇 Задай и мне вопрос!', canvas.width / 2, 1300);
        
        // Ссылка
        ctx.font = '28px Arial';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.fillText('t.me/dota2servicebot', canvas.width / 2, 1400);
        
        // Создаем Data URL
        const dataUrl = canvas.toDataURL('image/png');
        resolve(dataUrl);
    });
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
    const words = text.split(' ');
    let line = '';
    let testLine = '';
    let testWidth;
    
    for(let n = 0; n < words.length; n++) {
        testLine = line + words[n] + ' ';
        testWidth = ctx.measureText(testLine).width;
        
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

function drawDecorativeElements(ctx, width, height) {
    // Рисуем звезды/точки на фоне
    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    for(let i = 0; i < 50; i++) {
        const x = Math.random() * width;
        const y = Math.random() * height;
        const radius = Math.random() * 2;
        
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
    }
    
    // Рисуем градиентные круги
    const gradient1 = ctx.createRadialGradient(100, 300, 0, 100, 300, 200);
    gradient1.addColorStop(0, 'rgba(46, 141, 230, 0.1)');
    gradient1.addColorStop(1, 'transparent');
    
    ctx.fillStyle = gradient1;
    ctx.beginPath();
    ctx.arc(100, 300, 200, 0, Math.PI * 2);
    ctx.fill();
    
    const gradient2 = ctx.createRadialGradient(width - 100, height - 300, 0, width - 100, height - 300, 200);
    gradient2.addColorStop(0, 'rgba(76, 175, 80, 0.1)');
    gradient2.addColorStop(1, 'transparent');
    
    ctx.fillStyle = gradient2;
    ctx.beginPath();
    ctx.arc(width - 100, height - 300, 200, 0, Math.PI * 2);
    ctx.fill();
}

function createShareText(question) {
    const userLink = `https://t.me/dota2servicebot?start=ask_${userId}`;
    
    if (question.answer) {
        return `💬 Мой ответ на анонимный вопрос!\n\n"${question.text.substring(0, 100)}${question.text.length > 100 ? '...' : ''}"\n\nМой ответ: "${question.answer.substring(0, 80)}${question.answer.length > 80 ? '...' : ''}"\n\n👇 Задай и мне анонимный вопрос!\n\n${userLink}`;
    } else {
        return `💬 Ответил на анонимный вопрос!\n\n"${question.text.substring(0, 100)}${question.text.length > 100 ? '...' : ''}"\n\n👇 Задай и мне анонимный вопрос!\n\n${userLink}`;
    }
}

function downloadImageAndShare(imageUrl, text, type) {
    // Скачиваем картинку
    const a = document.createElement('a');
    a.href = imageUrl;
    a.download = `мой-ответ-${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    
    // Показываем текст для копирования
    showNotification(`✅ Картинка скачана!\n\nСкопируйте текст и опубликуйте ${type === 'story' ? 'в историю' : 'в чаты'}:\n\n${text}`, 'success', 5000);
    
    // Предлагаем скопировать текст
    setTimeout(() => {
        if (confirm('Скопировать текст для поста?')) {
            navigator.clipboard.writeText(text).then(() => {
                showNotification('✅ Текст скопирован!', 'success');
            });
        }
    }, 1000);
}