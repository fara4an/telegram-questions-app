require('dotenv').config();
const express = require('express');
const { Telegraf } = require('telegraf');
const path = require('path');
const { Client } = require('pg');
const cors = require('cors');
const { createCanvas } = require('canvas');

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
                first_name VARCHAR(255),
                last_name VARCHAR(255),
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
            
            CREATE INDEX IF NOT EXISTS idx_questions_to_user ON questions(to_user_id);
            CREATE INDEX IF NOT EXISTS idx_questions_from_user ON questions(from_user_id);
            CREATE INDEX IF NOT EXISTS idx_questions_answered ON questions(is_answered);
        `);
    } catch (error) {
        console.error('❌ Ошибка БД:', error);
        process.exit(1);
    }
}

// ========== УВЕДОМЛЕНИЯ ==========
async function notifyNewQuestion(toUserId, questionId) {
    try {
        // Получаем информацию о вопросе
        const questionResult = await db.query(
            `SELECT q.* FROM questions q WHERE q.id = $1`,
            [questionId]
        );
        
        if (questionResult.rows.length === 0) return;
        
        const question = questionResult.rows[0];
        
        // Отправляем уведомление получателю
        const userLink = `https://t.me/${bot.botInfo.username}?start=app`;
        
        await bot.telegram.sendMessage(
            toUserId,
            `📨 *Новый анонимный вопрос!*\n\n` +
            `🔒 *От: Аноним*\n\n` +
            `📝 *Вопрос:*\n${question.text.substring(0, 200)}${question.text.length > 200 ? '...' : ''}\n\n` +
            `👉 *Открой приложение, чтобы ответить:*`,
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[
                        {
                            text: '📱 ОТКРЫТЬ ПРИЛОЖЕНИЕ',
                            web_app: { url: WEB_APP_URL }
                        }
                    ]]
                }
            }
        );
        
        console.log(`✅ Уведомление отправлено пользователю ${toUserId}`);
    } catch (error) {
        console.error('❌ Ошибка отправки уведомления:', error.message);
    }
}

async function notifyNewAnswer(fromUserId, questionText) {
    try {
        // Отправляем уведомление спрашивающему, что на его вопрос ответили
        if (fromUserId) {
            await bot.telegram.sendMessage(
                fromUserId,
                `✅ *На ваш вопрос ответили!*\n\n` +
                `📝 *Ваш вопрос:*\n${questionText.substring(0, 150)}${questionText.length > 150 ? '...' : ''}\n\n` +
                `👉 *Открой приложение, чтобы увидеть ответ:*`,
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [[
                            {
                                text: '📱 ОТКРЫТЬ ПРИЛОЖЕНИЕ',
                                web_app: { url: WEB_APP_URL }
                            }
                        ]]
                    }
                }
            );
        }
    } catch (error) {
        console.error('❌ Ошибка отправки уведомления об ответе:', error.message);
    }
}

// ========== MIDDLEWARE ==========
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// ========== API ROUTES ==========

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
            `SELECT telegram_id, username, first_name, last_name 
             FROM users WHERE telegram_id = $1`,
            [req.params.userId]
        );
        
        if (result.rows.length > 0) {
            res.json(result.rows[0]);
        } else {
            res.status(404).json({ error: 'Пользователь не найден' });
        }
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// 1. Получить ВХОДЯЩИЕ вопросы (которые другие написали мне)
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
        console.error('Error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// 2. Получить ОТПРАВЛЕННЫЕ вопросы (которые я написал другим)
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
        console.error('Error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// 3. Получить ОТВЕЧЕННЫЕ вопросы
app.get('/api/questions/answered/:userId', async (req, res) => {
    try {
        const result = await db.query(
            `SELECT q.*, u.username as from_username 
             FROM questions q
             LEFT JOIN users u ON q.from_user_id = u.telegram_id
             WHERE q.to_user_id = $1 AND q.is_answered = TRUE
             ORDER BY q.answered_at DESC`,
            [req.params.userId]
        );
        res.json(result.rows);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// 4. Отправить новый вопрос
app.post('/api/questions', async (req, res) => {
    try {
        const { from_user_id, to_user_id, text } = req.body;
        
        if (!to_user_id || !text) {
            return res.status(400).json({ error: 'Не указан получатель или текст вопроса' });
        }
        
        // Проверяем, существует ли получатель
        const userResult = await db.query(
            `SELECT telegram_id FROM users WHERE telegram_id = $1`,
            [to_user_id]
        );
        
        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: 'Получатель не найден' });
        }
        
        // Сохраняем отправителя, если он указан
        if (from_user_id) {
            await db.query(
                `INSERT INTO users (telegram_id) VALUES ($1) 
                 ON CONFLICT (telegram_id) DO NOTHING`,
                [from_user_id]
            );
        }
        
        // Сохраняем вопрос
        const result = await db.query(
            `INSERT INTO questions (from_user_id, to_user_id, text) 
             VALUES ($1, $2, $3) RETURNING *`,
            [from_user_id || null, to_user_id, text]
        );
        
        const question = result.rows[0];
        
        // Отправляем уведомление получателю
        await notifyNewQuestion(to_user_id, question.id);
        
        res.status(201).json({ 
            success: true, 
            question: question 
        });
        
    } catch (error) {
        console.error('Error creating question:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 5. Ответить на вопрос
app.post('/api/questions/:id/answer', async (req, res) => {
    try {
        const { id } = req.params;
        const { answer } = req.body;
        
        if (!answer) {
            return res.status(400).json({ error: 'Не указан ответ' });
        }
        
        // Получаем вопрос для уведомления
        const questionResult = await db.query(
            `SELECT * FROM questions WHERE id = $1`,
            [id]
        );
        
        if (questionResult.rows.length === 0) {
            return res.status(404).json({ error: 'Вопрос не найден' });
        }
        
        const question = questionResult.rows[0];
        
        // Обновляем вопрос с ответом
        const result = await db.query(
            `UPDATE questions 
             SET answer = $1, is_answered = TRUE, answered_at = CURRENT_TIMESTAMP 
             WHERE id = $2 RETURNING *`,
            [answer, id]
        );
        
        // Отправляем уведомление спрашивающему
        if (question.from_user_id) {
            await notifyNewAnswer(question.from_user_id, question.text);
        }
        
        res.json({ 
            success: true, 
            question: result.rows[0] 
        });
        
    } catch (error) {
        console.error('Error answering question:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 6. Удалить вопрос
app.delete('/api/questions/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
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

// 7. Генерация картинки с вопросом и ответом
app.get('/api/generate-image/:questionId', async (req, res) => {
    try {
        const result = await db.query(
            `SELECT q.*, 
                    u1.username as to_username,
                    u2.username as from_username
             FROM questions q
             LEFT JOIN users u1 ON q.to_user_id = u1.telegram_id
             LEFT JOIN users u2 ON q.from_user_id = u2.telegram_id
             WHERE q.id = $1`,
            [req.params.questionId]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Question not found' });
        }
        
        const question = result.rows[0];
        const imageBuffer = await generateChatImage(question);
        
        res.set('Content-Type', 'image/png');
        res.send(imageBuffer);
        
    } catch (error) {
        console.error('Error generating image:', error);
        res.status(500).json({ error: 'Image generation failed' });
    }
});

// ========== ГЕНЕРАЦИЯ КАРТИНКИ ==========
async function generateChatImage(question) {
    const width = 600;
    const padding = 20;
    const avatarSize = 40;
    const bubblePadding = 15;
    
    // Рассчитываем высоту
    const questionLines = splitText(question.text, 40);
    const answerLines = question.answer ? splitText(question.answer, 40) : [];
    
    const questionHeight = questionLines.length * 24 + bubblePadding * 2;
    const answerHeight = answerLines.length * 24 + bubblePadding * 2;
    const spacing = 30;
    
    const height = padding * 2 + questionHeight + answerHeight + spacing + avatarSize * 2;
    
    // Создаем canvas
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    
    // Фон
    ctx.fillStyle = '#e5ddd5';
    ctx.fillRect(0, 0, width, height);
    
    let y = padding;
    
    // ВОПРОС (слева)
    ctx.fillStyle = '#555';
    ctx.font = '14px Arial';
    ctx.fillText('Аноним', padding + avatarSize + 10, y + 16);
    
    // Аватар анонима
    ctx.fillStyle = '#666';
    ctx.beginPath();
    ctx.arc(padding + avatarSize/2, y + avatarSize/2, avatarSize/2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 18px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('?', padding + avatarSize/2, y + avatarSize/2 + 6);
    
    // Пузырь с вопросом
    const questionBubbleX = padding + avatarSize + 10;
    const questionBubbleY = y + 25;
    const questionBubbleWidth = width - questionBubbleX - padding - 100;
    
    // Рисуем пузырь
    ctx.fillStyle = '#ffffff';
    roundRect(ctx, questionBubbleX, questionBubbleY, questionBubbleWidth, questionHeight, 15, true, false);
    
    // Текст вопроса
    ctx.fillStyle = '#000';
    ctx.font = '16px Arial';
    ctx.textAlign = 'left';
    questionLines.forEach((line, i) => {
        ctx.fillText(line, questionBubbleX + bubblePadding, questionBubbleY + bubblePadding + 20 + i * 24);
    });
    
    y += questionHeight + spacing;
    
    // ОТВЕТ (справа) - только если есть
    if (question.answer) {
        ctx.fillStyle = '#555';
        ctx.textAlign = 'right';
        const responderName = question.to_username ? `@${question.to_username}` : 'Вы';
        ctx.fillText(responderName, width - padding - avatarSize - 10, y + 16);
        
        // Аватар отвечающего
        ctx.fillStyle = '#0088cc';
        ctx.beginPath();
        ctx.arc(width - padding - avatarSize/2, y + avatarSize/2, avatarSize/2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 18px Arial';
        ctx.textAlign = 'center';
        const initial = responderName.charAt(0).toUpperCase();
        ctx.fillText(initial, width - padding - avatarSize/2, y + avatarSize/2 + 6);
        
        // Пузырь с ответом
        const answerBubbleWidth = width - padding * 2 - avatarSize - 100;
        const answerBubbleX = width - padding - answerBubbleWidth;
        const answerBubbleY = y + 25;
        
        // Рисуем пузырь
        ctx.fillStyle = '#dcf8c6';
        roundRect(ctx, answerBubbleX, answerBubbleY, answerBubbleWidth, answerHeight, 15, true, false);
        
        // Текст ответа
        ctx.fillStyle = '#000';
        ctx.font = '16px Arial';
        ctx.textAlign = 'left';
        answerLines.forEach((line, i) => {
            ctx.fillText(line, answerBubbleX + bubblePadding, answerBubbleY + bubblePadding + 20 + i * 24);
        });
    }
    
    return canvas.toBuffer('image/png');
}

function splitText(text, maxLength) {
    const words = text.split(' ');
    const lines = [];
    let currentLine = '';
    
    for (const word of words) {
        if ((currentLine + word).length > maxLength) {
            lines.push(currentLine.trim());
            currentLine = word + ' ';
        } else {
            currentLine += word + ' ';
        }
    }
    
    if (currentLine.trim()) {
        lines.push(currentLine.trim());
    }
    
    return lines;
}

function roundRect(ctx, x, y, width, height, radius, fill, stroke) {
    if (typeof radius === 'number') {
        radius = {tl: radius, tr: radius, br: radius, bl: radius};
    }
    
    ctx.beginPath();
    ctx.moveTo(x + radius.tl, y);
    ctx.lineTo(x + width - radius.tr, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius.tr);
    ctx.lineTo(x + width, y + height - radius.br);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius.br, y + height);
    ctx.lineTo(x + radius.bl, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius.bl);
    ctx.lineTo(x, y + radius.tl);
    ctx.quadraticCurveTo(x, y, x + radius.tl, y);
    ctx.closePath();
    
    if (fill) ctx.fill();
    if (stroke) ctx.stroke();
}

// ========== TELEGRAM BOT WEBHOOK ==========
app.post(`/bot${process.env.BOT_TOKEN}`, (req, res) => {
    bot.handleUpdate(req.body, res);
});

// ========== TELEGRAM BOT HANDLERS ==========
bot.start(async (ctx) => {
    const userId = ctx.from.id;
    const firstName = ctx.from.first_name || 'пользователь';
    const username = ctx.from.username;
    
    // Сохраняем пользователя в БД
    try {
        await db.query(
            `INSERT INTO users (telegram_id, username, first_name, last_name) 
             VALUES ($1, $2, $3, $4) 
             ON CONFLICT (telegram_id) 
             DO UPDATE SET username = EXCLUDED.username, first_name = EXCLUDED.first_name`,
            [userId, username, ctx.from.first_name, ctx.from.last_name]
        );
    } catch (error) {
        console.error('Ошибка сохранения пользователя:', error);
    }
    
    // Если кто-то перешел по ссылке для вопроса
    if (ctx.startPayload && ctx.startPayload.startsWith('ask_')) {
        const targetUserId = ctx.startPayload.replace('ask_', '');
        
        await ctx.reply(
            `👋 *${firstName}, привет!*\n\n` +
            `Ты перешёл по ссылке, чтобы задать *анонимный вопрос*.\n\n` +
            `Нажми на кнопку ниже 👇 чтобы *сразу открыть форму* для вопроса:`,
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [
                            {
                                text: '✍️ НАПИСАТЬ ВОПРОС',
                                web_app: { 
                                    url: `${WEB_APP_URL}/ask/${targetUserId}?from=telegram&asker=${userId}` 
                                }
                            }
                        ],
                        [
                            {
                                text: '❓ Как это работает?',
                                callback_data: 'how_it_works'
                            }
                        ]
                    ]
                }
            }
        );
        
    } else {
        // Обычный старт - показываем профиль пользователя
        const userLink = `https://t.me/${ctx.botInfo.username}?start=ask_${userId}`;
        
        await ctx.reply(
            `👋 *Привет, ${firstName}!*\n\n` +
            `Я бот для *анонимных вопросов*.\n\n` +
            `🔗 *Твоя персональная ссылка:*\n\`${userLink}\`\n\n` +
            `*Отправь эту ссылку друзьям* 👇\nОни смогут задать тебе вопрос *анонимно*!`,
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [
                            {
                                text: '📱 ОТКРЫТЬ МОЁ ПРИЛОЖЕНИЕ',
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

// Обработка кнопки "Как это работает?"
bot.action('how_it_works', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(
        `*📌 Как работает анонимный вопрос:*\n\n` +
        `1. Ты нажимаешь кнопку "НАПИСАТЬ ВОПРОС"\n` +
        `2. Открывается форма для ввода вопроса\n` +
        `3. Ты пишешь вопрос и нажимаешь "Отправить"\n` +
        `4. Вопрос *анонимно* приходит получателю\n` +
        `5. Он получает уведомление в Telegram\n` +
        `6. Он может ответить на вопрос в приложении\n\n` +
        `*🔒 Анонимность:*\n` +
        `- Получатель *не увидит* твой профиль\n` +
        `- Если он ответит, ты получишь уведомление\n` +
        `- Можно задавать сколько угодно вопросов`,
        { parse_mode: 'Markdown' }
    );
});

// Команда /app
bot.command('app', (ctx) => {
    ctx.reply('Нажми кнопку ниже, чтобы открыть приложение:', {
        reply_markup: {
            inline_keyboard: [[
                {
                    text: '📱 ОТКРЫТЬ ПРИЛОЖЕНИЕ',
                    web_app: { url: WEB_APP_URL }
                }
            ]]
        }
    });
});

// Команда /help
bot.command('help', (ctx) => {
    ctx.replyWithMarkdown(
        `*❓ Помощь*\n\n` +
        `*/start* - Начать работу, получить свою ссылку\n` +
        `*/app* - Открыть приложение\n` +
        `*/help* - Эта справка\n\n` +
        `*💡 Как задать вопрос:*\n` +
        `1. Получи ссылку друга командой /start\n` +
        `2. Перейди по его ссылке\n` +
        `3. Нажми "НАПИСАТЬ ВОПРОС"\n` +
        `4. Напиши вопрос и отправь\n\n` +
        `*🔗 Пример ссылки:*\n` +
        `\`https://t.me/${ctx.botInfo.username}?start=ask_123456\``
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
        
        // Запускаем сервер
        app.listen(PORT, async () => {
            console.log(`🚀 Сервер запущен на порту ${PORT}`);
            console.log(`🌐 Web App URL: ${WEB_APP_URL}`);
            console.log(`✅ Health check: http://localhost:${PORT}/api/health`);
            
            // Настраиваем вебхук для бота
            if (process.env.NODE_ENV === 'production') {
                const webhookUrl = `${WEB_APP_URL}/bot${process.env.BOT_TOKEN}`;
                await bot.telegram.setWebhook(webhookUrl);
                console.log(`🤖 Вебхук установлен: ${webhookUrl}`);
            } else {
                // Локально используем поллинг
                await bot.launch();
                console.log('🤖 Бот запущен через поллинг');
            }
        });
        
    } catch (error) {
        console.error('❌ Ошибка запуска сервера:', error);
        process.exit(1);
    }
}

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

startServer().catch(console.error);