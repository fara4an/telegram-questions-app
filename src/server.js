require('dotenv').config();
const express = require('express');
const { Telegraf } = require('telegraf');
const path = require('path');
const { Client } = require('pg');
const cors = require('cors');
const { createCanvas, loadImage } = require('canvas');
const crypto = require('crypto');

const app = express();
const bot = new Telegraf(process.env.BOT_TOKEN);
const WEB_APP_URL = process.env.WEB_APP_URL || 'https://ваш-проект.onrender.com';

// ========== БАЗА ДАННЫХ ==========
const db = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function initDB() {
    try {
        await db.connect();
        console.log('✅ База данных подключена');
        
        await db.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                telegram_id BIGINT UNIQUE NOT NULL,
                username VARCHAR(255),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            
            CREATE TABLE IF NOT EXISTS questions (
                id SERIAL PRIMARY KEY,
                from_user_id BIGINT,
                to_user_id BIGINT NOT NULL,
                text TEXT NOT NULL,
                answer TEXT,
                is_answered BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                answered_at TIMESTAMP
            );
            
            CREATE TABLE IF NOT EXISTS question_images (
                id SERIAL PRIMARY KEY,
                question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
                image_base64 TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(question_id)
            );
            
            CREATE INDEX IF NOT EXISTS idx_questions_to_user ON questions(to_user_id);
            CREATE INDEX IF NOT EXISTS idx_questions_from_user ON questions(from_user_id);
            CREATE INDEX IF NOT EXISTS idx_questions_answered ON questions(is_answered);
            CREATE INDEX IF NOT EXISTS idx_question_images_question ON question_images(question_id);
        `);
    } catch (error) {
        console.error('❌ Ошибка БД:', error);
        process.exit(1);
    }
}

// ========== МИДЛВАРЫ ==========
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// ========== ГЕНЕРАЦИЯ И СОХРАНЕНИЕ КАРТИНКИ ==========
app.post('/api/share-to-chat', async (req, res) => {
    try {
        const { userId, questionId } = req.body;
        if (!userId || !questionId) {
            return res.status(400).json({ error: 'Не указаны параметры' });
        }

        // 1. Получаем вопрос
        const questionResult = await db.query(
            `SELECT q.*, u.username as from_username 
             FROM questions q
             LEFT JOIN users u ON q.from_user_id = u.telegram_id
             WHERE q.id = $1 AND q.to_user_id = $2 AND q.is_answered = TRUE`,
            [questionId, userId]
        );
        
        if (questionResult.rows.length === 0) {
            return res.status(404).json({ error: 'Вопрос не найден или нет ответа' });
        }
        
        const question = questionResult.rows[0];
        
        // 2. Проверяем кэш в БД
        const cachedImage = await db.query(
            `SELECT image_base64 FROM question_images WHERE question_id = $1`,
            [questionId]
        );
        
        let imageBase64;
        if (cachedImage.rows.length > 0) {
            imageBase64 = cachedImage.rows[0].image_base64;
            console.log('✅ Используем кэшированную картинку');
        } else {
            // 3. Генерируем новую картинку
            const imageBuffer = await generateBeautifulImage(question);
            imageBase64 = imageBuffer.toString('base64');
            
            // 4. Сохраняем в БД
            await db.query(
                `INSERT INTO question_images (question_id, image_base64) 
                 VALUES ($1, $2) 
                 ON CONFLICT (question_id) 
                 DO UPDATE SET image_base64 = EXCLUDED.image_base64`,
                [questionId, imageBase64]
            );
            
            console.log('✅ Картинка сгенерирована и сохранена в БД');
        }
        
        // 5. Формируем текст сообщения
        const botInfo = await bot.telegram.getMe();
        const userLink = `https://t.me/${botInfo.username}?start=ask_${userId}`;
        
        const messageText = `🎯 *Мой ответ на анонимный вопрос!*\n\n` +
                           `💬 *Вопрос:*\n"${question.text.length > 100 ? question.text.substring(0, 100) + '...' : question.text}"\n\n` +
                           `💡 *Мой ответ:*\n"${question.answer.length > 100 ? question.answer.substring(0, 100) + '...' : question.answer}"\n\n` +
                           `👇 *Хочешь задать мне вопрос?*\n` +
                           `Нажми кнопку ниже!`;
        
        // 6. Отправляем картинку в чат
        try {
            const imageBuffer = Buffer.from(imageBase64, 'base64');
            await bot.telegram.sendPhoto(userId, { source: imageBuffer }, {
                caption: messageText,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[
                        { 
                            text: '✍️ Задать мне вопрос', 
                            url: userLink 
                        }
                    ]]
                }
            });
            
            return res.json({ 
                success: true, 
                message: '✅ Ответ отправлен в ваш чат с ботом!',
                userLink: userLink
            });
            
        } catch (error) {
            console.error('Ошибка отправки фото:', error);
            
            // Если не получилось с фото, отправляем текст
            await bot.telegram.sendMessage(userId, messageText, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[
                        { 
                            text: '✍️ Задать мне вопрос', 
                            url: userLink 
                        }
                    ]]
                }
            });
            
            return res.json({ 
                success: true, 
                message: '✅ Ответ отправлен (без картинки)',
                userLink: userLink
            });
        }
        
    } catch (error) {
        console.error('❌ Ошибка шеринга:', error);
        res.status(500).json({ error: 'Failed to share to chat' });
    }
});

// ========== ФУНКЦИЯ ГЕНЕРАЦИИ КРАСИВОЙ КАРТИНКИ ==========
async function generateBeautifulImage(question) {
    const width = 1080;
    const height = 1350;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    
    // 1. Фон - градиент
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#0f172a'); // темно-синий
    gradient.addColorStop(1, '#1e293b'); // немного светлее
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    
    // 2. Декоративные элементы
    // Маленькие точки
    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    for (let i = 0; i < 50; i++) {
        const x = Math.random() * width;
        const y = Math.random() * height;
        const radius = Math.random() * 3 + 1;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
    }
    
    // 3. Заголовок
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 60px "Arial"';
    ctx.textAlign = 'center';
    ctx.fillText('💬', width / 2, 120);
    
    ctx.font = 'bold 48px "Arial"';
    ctx.fillText('Ответ на вопрос', width / 2, 200);
    
    // 4. Разделитель
    ctx.strokeStyle = 'rgba(46, 141, 230, 0.5)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(width * 0.2, 250);
    ctx.lineTo(width * 0.8, 250);
    ctx.stroke();
    
    // 5. Карточка вопроса
    const cardWidth = width * 0.8;
    const cardHeight = 400;
    const cardX = (width - cardWidth) / 2;
    const cardY = 300;
    
    // Скругленные углы для карточки
    ctx.fillStyle = 'rgba(30, 41, 59, 0.8)';
    ctx.beginPath();
    ctx.roundRect(cardX, cardY, cardWidth, cardHeight, 20);
    ctx.fill();
    
    // Внутренняя рамка
    ctx.strokeStyle = 'rgba(46, 141, 230, 0.3)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(cardX + 2, cardY + 2, cardWidth - 4, cardHeight - 4, 18);
    ctx.stroke();
    
    // 6. Текст вопроса
    ctx.fillStyle = '#93c5fd';
    ctx.font = 'bold 32px "Arial"';
    ctx.textAlign = 'left';
    ctx.fillText('Вопрос:', cardX + 40, cardY + 60);
    
    ctx.fillStyle = '#e2e8f0';
    ctx.font = '28px "Arial"';
    wrapText(ctx, `"${question.text}"`, cardX + 40, cardY + 110, cardWidth - 80, 40, 4);
    
    // 7. Карточка ответа
    const answerCardY = cardY + cardHeight + 30;
    
    ctx.fillStyle = 'rgba(21, 128, 61, 0.8)';
    ctx.beginPath();
    ctx.roundRect(cardX, answerCardY, cardWidth, cardHeight, 20);
    ctx.fill();
    
    ctx.strokeStyle = 'rgba(34, 197, 94, 0.3)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(cardX + 2, answerCardY + 2, cardWidth - 4, cardHeight - 4, 18);
    ctx.stroke();
    
    // 8. Текст ответа
    ctx.fillStyle = '#86efac';
    ctx.font = 'bold 32px "Arial"';
    ctx.textAlign = 'left';
    ctx.fillText('Мой ответ:', cardX + 40, answerCardY + 60);
    
    ctx.fillStyle = '#f0fdf4';
    ctx.font = '28px "Arial"';
    wrapText(ctx, `"${question.answer}"`, cardX + 40, answerCardY + 110, cardWidth - 80, 40, 4);
    
    // 9. Призыв к действию
    const ctaY = answerCardY + cardHeight + 60;
    
    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 36px "Arial"';
    ctx.textAlign = 'center';
    ctx.fillText('👇 Задай и мне вопрос!', width / 2, ctaY);
    
    ctx.fillStyle = '#94a3b8';
    ctx.font = '24px "Arial"';
    ctx.fillText('t.me/dota2servicebot', width / 2, ctaY + 50);
    
    // 10. Водяной знак
    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.font = '20px "Arial"';
    ctx.fillText('Telegram Questions', width / 2, height - 40);
    
    return canvas.toBuffer('image/png');
}

// Функция для переноса текста
function wrapText(ctx, text, x, y, maxWidth, lineHeight, maxLines = 5) {
    const words = text.split(' ');
    let line = '';
    let lines = [];
    let lineCount = 0;
    
    for (let n = 0; n < words.length; n++) {
        const testLine = line + words[n] + ' ';
        const metrics = ctx.measureText(testLine);
        const testWidth = metrics.width;
        
        if (testWidth > maxWidth && n > 0) {
            lines.push(line);
            line = words[n] + ' ';
            lineCount++;
            
            if (lineCount >= maxLines - 1) {
                // Обрезаем с многоточием
                let lastLine = '';
                for (let i = n; i < words.length; i++) {
                    const test = lastLine + words[i] + ' ';
                    if (ctx.measureText(test + '...').width > maxWidth) break;
                    lastLine = test;
                }
                lines.push(lastLine.trim() + '...');
                break;
            }
        } else {
            line = testLine;
        }
    }
    
    if (lineCount < maxLines && line.trim()) {
        lines.push(line.trim());
    }
    
    for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], x, y + (i * lineHeight));
    }
}

// Добавляем метод roundRect в CanvasRenderingContext2D
CanvasRenderingContext2D.prototype.roundRect = function(x, y, w, h, r) {
    if (w < 2 * r) r = w / 2;
    if (h < 2 * r) r = h / 2;
    this.beginPath();
    this.moveTo(x + r, y);
    this.arcTo(x + w, y, x + w, y + h, r);
    this.arcTo(x + w, y + h, x, y + h, r);
    this.arcTo(x, y + h, x, y, r);
    this.arcTo(x, y, x + w, y, r);
    this.closePath();
    return this;
};

// ========== ОСТАЛЬНЫЕ API ==========

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        service: 'Telegram Questions API'
    });
});

// Получить информацию о пользователе
app.get('/api/user/:userId', async (req, res) => {
    try {
        const result = await db.query(
            `SELECT telegram_id, username FROM users WHERE telegram_id = $1`,
            [req.params.userId]
        );
        
        if (result.rows.length > 0) {
            res.json(result.rows[0]);
        } else {
            res.json({
                telegram_id: req.params.userId,
                username: null
            });
        }
    } catch (error) {
        console.error('Error fetching user:', error);
        res.json({
            telegram_id: req.params.userId,
            username: null
        });
    }
});

// Получить ВХОДЯЩИЕ вопросы
app.get('/api/questions/incoming/:userId', async (req, res) => {
    try {
        const result = await db.query(
            `SELECT q.*, u.username as from_username 
             FROM questions q
             LEFT JOIN users u ON q.from_user_id = u.telegram_id
             WHERE q.to_user_id = $1 
             ORDER BY q.created_at DESC`,
            [req.params.userId]
        );
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching incoming questions:', error);
        res.json([]);
    }
});

// Получить ОТПРАВЛЕННЫЕ вопросы
app.get('/api/questions/sent/:userId', async (req, res) => {
    try {
        const result = await db.query(
            `SELECT q.*, u.username as to_username 
             FROM questions q
             LEFT JOIN users u ON q.to_user_id = u.telegram_id
             WHERE q.from_user_id = $1 
             ORDER BY q.created_at DESC`,
            [req.params.userId]
        );
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching sent questions:', error);
        res.json([]);
    }
});

// Получить конкретный вопрос по ID
app.get('/api/question/:id', async (req, res) => {
    try {
        const result = await db.query(
            `SELECT q.*, u.username as from_username 
             FROM questions q
             LEFT JOIN users u ON q.from_user_id = u.telegram_id
             WHERE q.id = $1`,
            [req.params.id]
        );
        
        if (result.rows.length > 0) {
            res.json(result.rows[0]);
        } else {
            res.status(404).json({ error: 'Вопрос не найден' });
        }
    } catch (error) {
        console.error('Error fetching question:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Отправить новый вопрос
app.post('/api/questions', async (req, res) => {
    try {
        const { from_user_id, to_user_id, text } = req.body;
        
        if (!to_user_id || !text) {
            return res.status(400).json({ error: 'Не указан получатель или текст вопроса' });
        }
        
        // Сохраняем вопрос
        const result = await db.query(
            `INSERT INTO questions (from_user_id, to_user_id, text) 
             VALUES ($1, $2, $3) RETURNING *`,
            [from_user_id || null, to_user_id, text]
        );
        
        const question = result.rows[0];
        
        res.status(201).json({ 
            success: true, 
            question: question 
        });
        
    } catch (error) {
        console.error('Error creating question:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Ответить на вопрос
app.post('/api/questions/:id/answer', async (req, res) => {
    try {
        const { id } = req.params;
        const { answer } = req.body;
        
        if (!answer) {
            return res.status(400).json({ error: 'Не указан ответ' });
        }
        
        // Обновляем вопрос с ответом
        const result = await db.query(
            `UPDATE questions 
             SET answer = $1, is_answered = TRUE, answered_at = CURRENT_TIMESTAMP 
             WHERE id = $2 RETURNING *`,
            [answer, id]
        );
        
        // Удаляем старую картинку из кэша
        await db.query(
            `DELETE FROM question_images WHERE question_id = $1`,
            [id]
        );
        
        res.json({ 
            success: true, 
            question: result.rows[0] 
        });
        
    } catch (error) {
        console.error('Error answering question:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Удалить вопрос
app.delete('/api/questions/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        // Удаляем картинку из кэша
        await db.query(`DELETE FROM question_images WHERE question_id = $1`, [id]);
        
        // Удаляем вопрос
        const result = await db.query(
            `DELETE FROM questions WHERE id = $1 RETURNING *`,
            [id]
        );
        
        if (result.rowCount > 0) {
            res.json({ success: true, message: 'Вопрос удален' });
        } else {
            res.status(404).json({ error: 'Вопрос не найден' });
        }
        
    } catch (error) {
        console.error('Error deleting question:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Получить статистику
app.get('/api/stats/:userId', async (req, res) => {
    try {
        const userId = req.params.userId;
        
        const [incomingRes, sentRes, answeredRes] = await Promise.all([
            db.query(
                `SELECT COUNT(*) as count FROM questions WHERE to_user_id = $1`,
                [userId]
            ),
            db.query(
                `SELECT COUNT(*) as count FROM questions WHERE from_user_id = $1`,
                [userId]
            ),
            db.query(
                `SELECT COUNT(*) as count FROM questions 
                 WHERE to_user_id = $1 AND is_answered = TRUE`,
                [userId]
            )
        ]);
        
        const total = parseInt(incomingRes.rows[0].count) + parseInt(sentRes.rows[0].count);
        const received = parseInt(incomingRes.rows[0].count);
        const sent = parseInt(sentRes.rows[0].count);
        const answered = parseInt(answeredRes.rows[0].count);
        
        res.json({
            total,
            received,
            sent,
            answered
        });
        
    } catch (error) {
        console.error('Error fetching stats:', error);
        res.json({
            total: 0,
            received: 0,
            sent: 0,
            answered: 0
        });
    }
});

// ========== TELEGRAM BOT ==========
app.post(`/bot${process.env.BOT_TOKEN}`, (req, res) => {
    bot.handleUpdate(req.body, res);
});

bot.start(async (ctx) => {
    const userId = ctx.from.id;
    const firstName = ctx.from.first_name || 'пользователь';
    
    // Сохраняем пользователя
    try {
        await db.query(
            `INSERT INTO users (telegram_id, username) 
             VALUES ($1, $2) 
             ON CONFLICT (telegram_id) 
             DO UPDATE SET username = EXCLUDED.username`,
            [userId, ctx.from.username]
        );
    } catch (error) {
        console.error('Ошибка сохранения пользователя:', error);
    }
    
    // Если перешли по ссылке для вопроса
    if (ctx.startPayload && ctx.startPayload.startsWith('ask_')) {
        const targetUserId = ctx.startPayload.replace('ask_', '');
        
        await ctx.reply(
            `👋 ${firstName}, привет!\n\nТы перешёл по ссылке, чтобы задать анонимный вопрос.\n\nНажми на кнопку ниже чтобы сразу написать вопрос:`,
            {
                reply_markup: {
                    inline_keyboard: [
                        [
                            {
                                text: '✍️ НАПИСАТЬ ВОПРОС',
                                web_app: { 
                                    url: `${WEB_APP_URL}/ask/${targetUserId}?from=telegram&asker=${userId}` 
                                }
                            }
                        ]
                    ]
                }
            }
        );
        
    } else {
        // Обычный старт
        const userLink = `https://t.me/${ctx.botInfo.username}?start=ask_${userId}`;
        
        await ctx.reply(
            `👋 Привет, ${firstName}!\n\nЯ бот для анонимных вопросов.\n\nТвоя ссылка для вопросов:\n${userLink}\n\nОтправь эту ссылку друзьям!`,
            {
                reply_markup: {
                    inline_keyboard: [
                        [
                            {
                                text: '📱 ОТКРЫТЬ ПРИЛОЖЕНИЕ',
                                web_app: { url: WEB_APP_URL }
                            }
                        ],
                        [
                            {
                                text: '📤 ПОДЕЛИТЬСЯ ССЫЛКОЙ',
                                url: `https://t.me/share/url?url=${encodeURIComponent(userLink)}&text=Задай%20мне%20анонимный%20вопрос!`
                            }
                        ]
                    ]
                }
            }
        );
    }
});

// Команда помощи
bot.command('help', (ctx) => {
    ctx.reply(
        `📚 *Помощь по боту*\n\n` +
        `/start - Начать работу\n` +
        `/app - Открыть приложение\n` +
        `/help - Эта справка\n\n` +
        `💡 *Как задать вопрос:*\n` +
        `1. Получи ссылку друга\n` +
        `2. Перейди по ссылке\n` +
        `3. Нажми "НАПИСАТЬ ВОПРОС"\n` +
        `4. Напиши вопрос и отправь\n\n` +
        `🔒 *Анонимность гарантирована!*`,
        { parse_mode: 'Markdown' }
    );
});

// ========== СТАТИЧЕСКИЕ СТРАНИЦЫ ==========
app.get('/ask/:userId', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/ask.html'));
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ========== ЗАПУСК СЕРВЕРА ==========
const PORT = process.env.PORT || 3000;

async function startServer() {
    try {
        await initDB();

        app.listen(PORT, async () => {
            console.log(`🚀 Сервер запущен на порту ${PORT}`);
            console.log(`🌐 Web App URL: ${WEB_APP_URL}`);

            // Получаем username бота
            const botInfo = await bot.telegram.getMe();
            console.log(`🤖 Бот: @${botInfo.username}`);

            if (process.env.NODE_ENV === 'production') {
                const webhookUrl = `${WEB_APP_URL}/bot${process.env.BOT_TOKEN}`;
                await bot.telegram.setWebhook(webhookUrl);
                console.log(`✅ Вебхук установлен: ${webhookUrl}`);
            } else {
                await bot.launch();
                console.log('🤖 Бот запущен через поллинг');
            }
        });
    } catch (error) {
        console.error('❌ Ошибка запуска сервера:', error);
        process.exit(1);
    }
}

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

startServer().catch(console.error);