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
    document.getElementById('username').textContent = username;
    document.getElementById('userId').textContent = `ID: ${userId}`;
    document.getElementById('profileName').textContent = username;
    document.getElementById('profileId').textContent = userId;
    
    // Генерируем ссылку для вопросов
    const botUsername = 'dota2servicebot'; // ЗАМЕНИТЕ НАСТОЯЩИЙ USERNAME БОТА!
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
    }
}

// Загрузить входящие вопросы
async function loadIncomingQuestions() {
    try {
        const response = await fetch(`/api/questions/incoming/${userId}`);
        const questions = await response.json();
        
        renderIncomingQuestions(questions);
        updateBadge('incoming', questions.length);
    } catch (error) {
        console.error('Ошибка загрузки входящих:', error);
        document.getElementById('incoming-list').innerHTML = `
            <div class="empty-state">
                <div class="icon">⚠️</div>
                <p>Не удалось загрузить вопросы</p>
                <button class="btn btn-secondary" onclick="loadIncomingQuestions()">
                    Повторить
                </button>
            </div>
        `;
    }
}

// Загрузить отправленные вопросы
async function loadSentQuestions() {
    try {
        const response = await fetch(`/api/questions/sent/${userId}`);
        const questions = await response.json();
        
        renderSentQuestions(questions);
        updateBadge('sent', questions.length);
    } catch (error) {
        console.error('Ошибка загрузки отправленных:', error);
        document.getElementById('sent-list').innerHTML = `
            <div class="empty-state">
                <div class="icon">⚠️</div>
                <p>Не удалось загрузить отправленные вопросы</p>
                <button class="btn btn-secondary" onclick="loadSentQuestions()">
                    Повторить
                </button>
            </div>
        `;
    }
}

// Обновить статистику
async function updateStats() {
    try {
        const [incomingRes, sentRes] = await Promise.all([
            fetch(`/api/questions/incoming/${userId}`),
            fetch(`/api/questions/sent/${userId}`)
        ]);
        
        const incoming = await incomingRes.json();
        const sent = await sentRes.json();
        
        // Получаем отвеченные вопросы
        const answeredRes = await fetch(`/api/questions/answered/${userId}`);
        const answered = await answeredRes.json();
        
        document.getElementById('statTotal').textContent = incoming.length + sent.length;
        document.getElementById('statReceived').textContent = incoming.length;
        document.getElementById('statSent').textContent = sent.length;
        document.getElementById('statAnswered').textContent = answered.length;
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
                <div class="icon">📭</div>
                <h3>Нет новых вопросов</h3>
                <p>Поделитесь своей ссылкой, чтобы получать вопросы</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = questions.map(question => `
        <div class="question-card ${question.is_answered ? 'answered-question-card' : ''}" data-id="${question.id}">
            <div class="question-meta">
                <span>${formatDate(question.created_at)}</span>
                <span>${question.from_username ? `От: ${question.from_username}` : 'Аноним'}</span>
            </div>
            <div class="question-text">${escapeHtml(question.text)}</div>
            ${question.is_answered ? `
                <div class="answer-bubble">
                    <strong>Ваш ответ:</strong><br>
                    ${escapeHtml(question.answer)}
                </div>
                <div class="btn-group">
                    <button class="btn btn-info" onclick="shareAnswerAsImage(${question.id})">
                        🖼️ Выложить ответ
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
                        ❌ Удалить
                    </button>
                </div>
            `}
        </div>
    `).join('');
}

// Рендер отправленных вопросов
function renderSentQuestions(questions) {
    const container = document.getElementById('sent-list');
    
    if (!questions || questions.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="icon">📤</div>
                <h3>Нет отправленных вопросов</h3>
                <p>Задайте вопросы другим пользователям</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = questions.map(question => `
        <div class="question-card sent-question-card" data-id="${question.id}">
            <div class="question-meta">
                <span>${formatDate(question.created_at)}</span>
                <span>Кому: ${question.to_username || `ID ${question.to_user_id}`}</span>
            </div>
            <div class="question-text">${escapeHtml(question.text)}</div>
            ${question.is_answered ? `
                <div class="answer-bubble" style="background: #d4edda;">
                    <strong>Ответ:</strong><br>
                    ${escapeHtml(question.answer)}
                </div>
                <div class="btn-group">
                    <button class="btn btn-info" onclick="shareAnswerAsImage(${question.id})">
                        🖼️ Выложить ответ
                    </button>
                    <button class="btn btn-secondary" onclick="copyAnswerText(${question.id})">
                        📋 Копировать
                    </button>
                </div>
            ` : `
                <div class="btn-group">
                    <button class="btn btn-secondary" onclick="deleteQuestion(${question.id})">
                        ❌ Удалить вопрос
                    </button>
                </div>
            `}
        </div>
    `).join('');
}

// ========== ОТВЕТ НА ВОПРОС ==========
function openAnswerModal(questionId) {
    currentQuestionId = questionId;
    
    // Находим вопрос
    const questionCard = document.querySelector(`.question-card[data-id="${questionId}"]`);
    const questionText = questionCard.querySelector('.question-text').textContent;
    
    // Показываем превью вопроса
    document.getElementById('questionPreview').innerHTML = `
        <div class="question-preview">
            <strong>Вопрос:</strong>
            <div class="preview-text">${questionText}</div>
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
        alert('Введите ответ');
        return;
    }
    
    if (!currentQuestionId) {
        alert('Ошибка: вопрос не выбран');
        return;
    }
    
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
            alert('✅ Ответ сохранен!');
            closeAnswerModal();
            await loadAllData(); // Перезагружаем все данные
        } else {
            throw new Error('Ошибка сервера');
        }
    } catch (error) {
        console.error('Ошибка отправки ответа:', error);
        alert('❌ Ошибка сохранения ответа');
    }
}

// ========== ВЫЛОЖЕНИЕ ОТВЕТА ==========
async function shareAnswerAsImage(questionId) {
    try {
        updateStatus('🖼️ Генерация картинки...');
        
        const response = await fetch(`/api/generate-image/${questionId}`);
        
        if (!response.ok) {
            throw new Error('Ошибка генерации');
        }
        
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        
        if (tg) {
            const file = new File([blob], 'answer.png', { type: 'image/png' });
            tg.sharePhoto(url, 'Мой ответ на анонимный вопрос');
        } else {
            window.open(url, '_blank');
        }
        
        updateStatus('✅ Картинка сгенерирована');
        
    } catch (error) {
        console.error('Ошибка генерации картинки:', error);
        alert('❌ Не удалось сгенерировать картинку');
        updateStatus('🔴 Ошибка генерации');
    }
}

function copyAnswerText(questionId) {
    const questionCard = document.querySelector(`.question-card[data-id="${questionId}"]`);
    const questionText = questionCard.querySelector('.question-text').textContent;
    const answerText = questionCard.querySelector('.answer-bubble')?.textContent.replace('Ваш ответ:\n', '').replace('Ответ:\n', '').trim() || '';
    
    const fullText = answerText ? `Вопрос: ${questionText}\n\nОтвет: ${answerText}` : `Вопрос: ${questionText}`;
    
    navigator.clipboard.writeText(fullText).then(() => {
        alert('✅ Текст скопирован!');
    }).catch(() => {
        alert('❌ Не удалось скопировать');
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
            alert('❌ Вопрос удалён');
            await loadAllData();
        } else {
            throw new Error('Ошибка сервера');
        }
    } catch (error) {
        console.error('Ошибка удаления:', error);
        alert('❌ Не удалось удалить вопрос');
    }
}

// ========== ПРОФИЛЬ ==========
function copyShareLink() {
    const link = document.getElementById('shareLink').textContent;
    
    navigator.clipboard.writeText(link).then(() => {
        alert('✅ Ссылка скопирована!');
    }).catch(() => {
        alert('❌ Не удалось скопировать');
    });
}

function shareToTelegram() {
    const link = document.getElementById('shareLink').textContent;
    
    if (tg) {
        tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=Задай%20мне%20анонимный%20вопрос!`);
    } else {
        window.open(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=Задай%20мне%20анонимный%20вопрос!`, '_blank');
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
        });
    });
}

function updateBadge(type, count) {
    const badge = document.getElementById(`${type}Badge`);
    if (badge) {
        if (count > 0) {
            badge.textContent = count;
            badge.style.display = 'flex';
        } else {
            badge.style.display = 'none';
        }
    }
}

function updateStatus(status) {
    document.getElementById('statusText').textContent = status;
}

function formatDate(dateString) {
    try {
        const date = new Date(dateString);
        const now = new Date();
        const diff = now - date;
        
        if (diff < 60000) return 'только что';
        if (diff < 3600000) return `${Math.floor(diff / 60000)} мин назад`;
        if (diff < 86400000) return `${Math.floor(diff / 3600000)} ч назад`;
        
        return date.toLocaleDateString('ru-RU', {
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch {
        return 'недавно';
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}