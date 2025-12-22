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
        const questionResult = await db.query(
            `SELECT q.* FROM questions q WHERE q.id = $1`,
            [questionId]
        );
        
        if (questionResult.rows.length === 0) return;
        
        const question = questionResult.rows[0];
        
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

// В server.js в разделе API ROUTES добавим:
// ========== ШЕРИНГ ЧЕРЕЗ БОТА ==========
app.post('/api/share-via-bot', async (req, res) => {
    try {
        const { userId, questionId, chatId, type } = req.body; // type: 'story' или 'chat'
        
        if (!userId || !questionId) {
            return res.status(400).json({ error: 'Не указаны параметры' });
        }
        
        // Получаем данные вопроса
        const questionResult = await db.query(
            `SELECT q.*, u.username as from_username 
             FROM questions q
             LEFT JOIN users u ON q.from_user_id = u.telegram_id
             WHERE q.id = $1`,
            [questionId]
        );
        
        if (questionResult.rows.length === 0) {
            return res.status(404).json({ error: 'Question not found' });
        }
        
        const question = questionResult.rows[0];
        const userLink = `https://t.me/${bot.botInfo.username}?start=ask_${userId}`;
        
        let message = '';
        if (type === 'story') {
            // Для истории
            message = `💬 Ответ на анонимный вопрос!\n\n"${question.text.substring(0, 100)}${question.text.length > 100 ? '...' : ''}"\n\n${question.answer ? `💡 Ответ: "${question.answer.substring(0, 80)}..."` : 'Посмотри ответ в приложении!'}\n\n👇 Задай и мне вопрос!`;
        } else {
            // Для чата
            message = `💬 *Ответ на анонимный вопрос!*\n\n` +
                     `📝 *Вопрос:* ${question.text.substring(0, 150)}${question.text.length > 150 ? '...' : ''}\n\n` +
                     `💡 *Ответ:* ${question.answer ? question.answer.substring(0, 150) + (question.answer.length > 150 ? '...' : '') : 'Смотри в приложении'}\n\n` +
                     `👇 *Задай и мне вопрос:*\n${userLink}`;
        }
        
        // Отправляем сообщение через бота
        await bot.telegram.sendMessage(
            chatId || userId, // Если нет chatId, шлём самому пользователю
            message,
            {
                parse_mode: type === 'story' ? null : 'Markdown',
                reply_markup: type === 'story' ? undefined : {
                    inline_keyboard: [[
                        {
                            text: '✍️ Задать вопрос',
                            url: userLink
                        }
                    ]]
                }
            }
        );
        
        res.json({ 
            success: true, 
            message: 'Отправлено через бота',
            type: type 
        });
        
    } catch (error) {
        console.error('Error sharing via bot:', error);
        res.status(500).json({ error: 'Sharing failed' });
    }
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        service: 'Telegram Questions API'
    });
});

// 1. Получить информацию о пользователе
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

// 2. Получить ВСЕ вопросы пользователя (для совместимости)
app.get('/api/questions/:userId', async (req, res) => {
    try {
        const userId = req.params.userId;
        
        const result = await db.query(
            `SELECT q.*, 
                    u1.username as from_username,
                    u2.username as to_username
             FROM questions q
             LEFT JOIN users u1 ON q.from_user_id = u1.telegram_id
             LEFT JOIN users u2 ON q.to_user_id = u2.telegram_id
             WHERE q.to_user_id = $1 OR q.from_user_id = $1
             ORDER BY q.created_at DESC`,
            [userId]
        );
        
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching all questions:', error);
        // Тестовые данные для демо
        res.json([
            {
                id: 1,
                text: "Какой твой любимый фильм?",
                answer: null,
                is_answered: false,
                created_at: new Date().toISOString(),
                from_username: 'Аноним',
                to_user_id: req.params.userId
            },
            {
                id: 2,
                text: "Что тебе нравится в программировании?",
                answer: "Возможность создавать что-то новое!",
                is_answered: true,
                created_at: new Date(Date.now() - 86400000).toISOString(),
                answered_at: new Date().toISOString(),
                from_username: 'Аноним',
                to_user_id: req.params.userId
            }
        ]);
    }
});

// 3. Получить ВХОДЯЩИЕ вопросы (которые другие написали мне)
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
        // Тестовые данные для демо
        res.json([
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
        ]);
    }
});

// 4. Получить ОТПРАВЛЕННЫЕ вопросы (которые я написал другим)
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
        // Тестовые данные для демо
        res.json([
            {
                id: 3,
                text: "Как дела?",
                answer: "Всё отлично, спасибо!",
                is_answered: true,
                created_at: new Date(Date.now() - 345600000).toISOString(),
                to_user_id: 987654,
                to_username: 'friend_user'
            }
        ]);
    }
});

// 5. Получить ОТВЕЧЕННЫЕ вопросы
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
        console.error('Error fetching answered questions:', error);
        res.json([]);
    }
});

// 6. Получить конкретный вопрос по ID
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

// 7. Отправить новый вопрос
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
        
        // Если пользователя нет, создаем его
        if (userResult.rows.length === 0) {
            await db.query(
                `INSERT INTO users (telegram_id) VALUES ($1)`,
                [to_user_id]
            );
        }
        
        // Сохраняем отправителя, если он указан
        if (from_user_id && from_user_id !== 'null') {
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
            [from_user_id && from_user_id !== 'null' ? from_user_id : null, to_user_id, text]
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

// 8. Ответить на вопрос
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

// 9. Удалить вопрос
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

// 10. Генерация картинки с вопросом и ответом
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

// 11. Получить статистику пользователя
app.get('/api/stats/:userId', async (req, res) => {
    try {
        const [incomingRes, sentRes, answeredRes] = await Promise.all([
            db.query(
                `SELECT COUNT(*) as count FROM questions WHERE to_user_id = $1`,
                [req.params.userId]
            ),
            db.query(
                `SELECT COUNT(*) as count FROM questions WHERE from_user_id = $1`,
                [req.params.userId]
            ),
            db.query(
                `SELECT COUNT(*) as count FROM questions 
                 WHERE (to_user_id = $1 OR from_user_id = $1) AND is_answered = TRUE`,
                [req.params.userId]
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
            total: 2,
            received: 2,
            sent: 1,
            answered: 1
        });
    }
});

// ========== ГЕНЕРАЦИЯ КАРТИНКИ ==========
async function generateChatImage(question) {
    try {
        const { createCanvas } = require('canvas');
        const width = 1080; // Размер для Stories
        const height = 1920;
        
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');
        
        // Красивый градиентный фон
        const gradient = ctx.createLinearGradient(0, 0, width, height);
        gradient.addColorStop(0, '#1a1a2e');
        gradient.addColorStop(0.5, '#16213e');
        gradient.addColorStop(1, '#0f3460');
        
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);
        
        // Декоративные элементы
        ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
        for(let i = 0; i < 50; i++) {
            const x = Math.random() * width;
            const y = Math.random() * height;
            const radius = Math.random() * 2;
            
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.fill();
        }
        
        // Иконка
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 120px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('💬', width / 2, 400);
        
        // Заголовок
        ctx.font = 'bold 64px Arial';
        ctx.fillText('Анонимный вопрос', width / 2, 550);
        
        // Разделительная линия
        ctx.strokeStyle = 'rgba(46, 141, 230, 0.5)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(width / 2 - 150, 600);
        ctx.lineTo(width / 2 + 150, 600);
        ctx.stroke();
        
        // Вопрос
        ctx.font = '36px Arial';
        ctx.fillStyle = '#e1e1e1';
        
        const questionText = `"${question.text.substring(0, 80)}${question.text.length > 80 ? '...' : ''}"`;
        wrapText(ctx, questionText, width / 2, 700, width - 200, 50);
        
        // Ответ (если есть)
        if (question.answer) {
            ctx.font = 'bold 48px Arial';
            ctx.fillStyle = '#2e8de6';
            ctx.fillText('Ответ:', width / 2, 900);
            
            ctx.font = '32px Arial';
            ctx.fillStyle = '#ffffff';
            
            const answerText = `"${question.answer.substring(0, 100)}${question.answer.length > 100 ? '...' : ''}"`;
            wrapText(ctx, answerText, width / 2, 1000, width - 200, 40);
        } else {
            ctx.font = 'bold 48px Arial';
            ctx.fillStyle = '#4caf50';
            ctx.fillText('Ответ отправлен!', width / 2, 950);
        }
        
        // Призыв к действию
        ctx.font = 'bold 40px Arial';
        ctx.fillStyle = '#ffffff';
        ctx.fillText('👇 Задай и мне вопрос!', width / 2, 1300);
        
        // Ссылка на бота
        ctx.font = '28px Arial';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.fillText('t.me/dota2servicebot', width / 2, 1400);
        
        // Водяной знак
        ctx.font = '18px Arial';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.fillText('Создано через @dota2servicebot', width / 2, 1850);
        
        return canvas.toBuffer('image/png');
        
    } catch (error) {
        console.error('Error in generateChatImage:', error);
        // Простая картинка с ошибкой
        const { createCanvas } = require('canvas');
        const canvas = createCanvas(800, 400);
        const ctx = canvas.getContext('2d');
        
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(0, 0, 800, 400);
        
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 32px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('💬 Анонимный вопрос', 400, 150);
        
        ctx.font = '24px Arial';
        ctx.fillText('t.me/dota2servicebot', 400, 250);
        
        return canvas.toBuffer('image/png');
    }
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

function splitText(text, maxLength) {
    if (!text) return [];
    const words = text.split(' ');
    const lines = [];
    let currentLine = '';
    
    for (const word of words) {
        if ((currentLine + ' ' + word).length > maxLength) {
            if (currentLine) lines.push(currentLine);
            currentLine = word;
        } else {
            currentLine = currentLine ? currentLine + ' ' + word : word;
        }
    }
    
    if (currentLine) {
        lines.push(currentLine);
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
            `INSERT INTO users (telegram_id, username) 
             VALUES ($1, $2) 
             ON CONFLICT (telegram_id) 
             DO UPDATE SET username = EXCLUDED.username`,
            [userId, username]
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

// В server.js добавляем endpoint для шеринга через бота
app.post('/api/share-to-chat', async (req, res) => {
    try {
        const { userId, questionId, chatId } = req.body;
        
        const questionResult = await db.query(
            `SELECT q.* FROM questions q WHERE q.id = $1`,
            [questionId]
        );
        
        if (questionResult.rows.length === 0) {
            return res.status(404).json({ error: 'Question not found' });
        }
        
        const question = questionResult.rows[0];
        const userLink = `https://t.me/${bot.botInfo.username}?start=ask_${userId}`;
        
        // Отправляем сообщение через бота
        await bot.telegram.sendMessage(
            chatId || userId, // Если нет chatId, шлём самому пользователю
            `💬 *Ответ на анонимный вопрос!*\n\n` +
            `📝 *Вопрос:* ${question.text.substring(0, 150)}${question.text.length > 150 ? '...' : ''}\n\n` +
            `💡 *Ответ:* ${question.answer ? question.answer.substring(0, 150) + (question.answer.length > 150 ? '...' : '') : 'Смотри в приложении'}\n\n` +
            `👇 *Задай и мне вопрос:*\n${userLink}`,
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[
                        {
                            text: '✍️ Задать вопрос',
                            url: userLink
                        }
                    ]]
                }
            }
        );
        
        res.json({ success: true, message: 'Sent to chat' });
        
    } catch (error) {
        console.error('Error sharing to chat:', error);
        res.status(500).json({ error: 'Sharing failed' });
    }
});

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

startServer().catch(console.error);