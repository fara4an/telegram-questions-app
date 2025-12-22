require('dotenv').config();
const express = require('express');
const { Telegraf } = require('telegraf');
const path = require('path');
const { Client } = require('pg');
const cors = require('cors');
const { createCanvas } = require('canvas');
const crypto = require('crypto');
const fs = require('fs');

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
                image_filename VARCHAR(255) UNIQUE NOT NULL,
                image_url TEXT NOT NULL,
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
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// ========== ГЕНЕРАЦИЯ И СОХРАНЕНИЕ КАРТИНКИ ==========
app.get('/api/share-image/:questionId', async (req, res) => {
    try {
        const questionId = req.params.questionId;
        
        // 1. Проверяем, есть ли уже картинка в БД
        const existingImage = await db.query(
            `SELECT qi.image_url, qi.image_filename 
             FROM question_images qi 
             WHERE qi.question_id = $1`,
            [questionId]
        );
        
        // 2. Если есть — возвращаем её
        if (existingImage.rows.length > 0) {
            console.log(`✅ Картинка из кэша для вопроса ${questionId}`);
            return res.json({
                success: true,
                imageUrl: existingImage.rows[0].image_url,
                filename: existingImage.rows[0].image_filename,
                cached: true
            });
        }
        
        // 3. Если нет — получаем вопрос и генерируем картинку
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
        
        // 4. Генерируем картинку
        const imageBuffer = await generateChatImage(question);
        
        // 5. Сохраняем картинку локально и в БД
        const filename = `question_${questionId}_${Date.now()}_${crypto.randomBytes(8).toString('hex')}.png`;
        const filePath = path.join(__dirname, '../uploads', filename);
        const imageUrl = `${WEB_APP_URL}/uploads/${filename}`;
        
        // Создаем папку uploads если её нет
        const uploadsDir = path.join(__dirname, '../uploads');
        if (!fs.existsSync(uploadsDir)) {
            fs.mkdirSync(uploadsDir, { recursive: true });
        }
        
        // Сохраняем файл
        fs.writeFileSync(filePath, imageBuffer);
        console.log(`💾 Картинка сохранена: ${filePath}`);
        
        // 6. Сохраняем в БД
        await db.query(
            `INSERT INTO question_images (question_id, image_filename, image_url) 
             VALUES ($1, $2, $3)`,
            [questionId, filename, imageUrl]
        );
        
        console.log(`✅ Картинка сохранена в БД для вопроса ${questionId}`);
        
        // 7. Возвращаем результат
        res.json({
            success: true,
            imageUrl: imageUrl,
            filename: filename,
            cached: false
        });
        
    } catch (error) {
        console.error('❌ Ошибка генерации картинки:', error);
        res.status(500).json({ error: 'Failed to generate image' });
    }
});

// ========== ШЕРИНГ КАРТИНКИ В ЧАТ ЧЕРЕЗ БОТА ==========
app.post('/api/share-to-chat', async (req, res) => {
    try {
        const { userId, questionId } = req.body;
        
        if (!userId || !questionId) {
            return res.status(400).json({ error: 'Не указаны параметры' });
        }
        
        console.log(`🔄 Шеринг вопроса ${questionId} для пользователя ${userId}`);
        
        // 1. Получаем или создаем картинку
        const imageResult = await db.query(
            `SELECT qi.image_url, qi.image_filename 
             FROM question_images qi 
             WHERE qi.question_id = $1`,
            [questionId]
        );
        
        let imageUrl;
        
        // Если картинки нет в БД - генерируем и сохраняем
        if (imageResult.rows.length === 0) {
            // Получаем вопрос
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
            
            // Генерируем картинку
            const imageBuffer = await generateChatImage(question);
            
            // Сохраняем картинку
            const filename = `question_${questionId}_${Date.now()}_${crypto.randomBytes(8).toString('hex')}.png`;
            const filePath = path.join(__dirname, '../uploads', filename);
            imageUrl = `${WEB_APP_URL}/uploads/${filename}`;
            
            // Создаем папку uploads если её нет
            const uploadsDir = path.join(__dirname, '../uploads');
            if (!fs.existsSync(uploadsDir)) {
                fs.mkdirSync(uploadsDir, { recursive: true });
            }
            
            fs.writeFileSync(filePath, imageBuffer);
            
            // Сохраняем в БД
            await db.query(
                `INSERT INTO question_images (question_id, image_filename, image_url) 
                 VALUES ($1, $2, $3)`,
                [questionId, filename, imageUrl]
            );
            
            console.log(`✅ Картинка сгенерирована и сохранена: ${imageUrl}`);
        } else {
            imageUrl = imageResult.rows[0].image_url;
            console.log(`✅ Картинка из кэша: ${imageUrl}`);
        }
        
        // 2. Получаем данные вопроса для текста
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
        
        // 3. Формируем текст сообщения (упрощённый, без Markdown)
        const userLink = `https://t.me/${bot.botInfo.username}?start=ask_${userId}`;
        const questionText = question.text.length > 80 ? 
            question.text.substring(0, 80) + '...' : question.text;
        
        let messageText = `💬 Ответил на анонимный вопрос!\n\n`;
        messageText += `📝 Вопрос: ${questionText}\n\n`;
        
        if (question.answer) {
            const answerText = question.answer.length > 100 ? 
                question.answer.substring(0, 100) + '...' : question.answer;
            messageText += `💡 Мой ответ: ${answerText}\n\n`;
        }
        
        messageText += `👇 Задай и мне анонимный вопрос!\n`;
        messageText += `${userLink}`;
        
        // 4. Отправляем картинку через бота
        try {
            // Пробуем отправить фото по URL
            await bot.telegram.sendPhoto(userId, imageUrl, {
                caption: messageText,
                reply_markup: {
                    inline_keyboard: [[
                        {
                            text: '✍️ Задать мне вопрос',
                            url: userLink
                        }
                    ]]
                }
            });
            
            console.log(`✅ Картинка отправлена пользователю ${userId}`);
            
            res.json({
                success: true,
                message: 'Картинка отправлена в ваш чат с ботом!',
                imageUrl: imageUrl
            });
            
        } catch (telegramError) {
            console.error('❌ Ошибка отправки фото через Telegram:', telegramError.message);
            
            // Если не удалось отправить фото, отправляем просто текст
            await bot.telegram.sendMessage(
                userId,
                messageText,
                {
                    reply_markup: {
                        inline_keyboard: [[
                            {
                                text: '✍️ Задать мне вопрос',
                                url: userLink
                            }
                        ]]
                    }
                }
            );
            
            res.json({
                success: true,
                message: 'Текст отправлен в чат',
                warning: 'Картинка не загрузилась, но текст отправлен'
            });
        }
        
    } catch (error) {
        console.error('❌ Ошибка шеринга:', error);
        res.status(500).json({ error: 'Failed to share image' });
    }
});

// ========== ФУНКЦИЯ ГЕНЕРАЦИИ КАРТИНКИ ==========
async function generateChatImage(question) {
    try {
        const width = 1080;
        const height = 1920;
        
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');
        
        // Градиентный фон
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

// ========== СТАТИСТИКА ==========
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

// ========== ОСТАЛЬНЫЕ API ==========

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        service: 'Telegram Questions API',
        uploads: '/uploads доступен'
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
        
        // Удаляем старую картинку (если есть)
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
        
        // Удаляем картинку
        const imageResult = await db.query(
            `SELECT image_filename FROM question_images WHERE question_id = $1`,
            [id]
        );
        
        if (imageResult.rows.length > 0) {
            const filename = imageResult.rows[0].image_filename;
            const filePath = path.join(__dirname, '../uploads', filename);
            
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
            
            await db.query(`DELETE FROM question_images WHERE question_id = $1`, [id]);
        }
        
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
        
        // Создаем папку uploads
        const uploadsDir = path.join(__dirname, '../uploads');
        if (!fs.existsSync(uploadsDir)) {
            fs.mkdirSync(uploadsDir, { recursive: true });
            console.log('📁 Папка uploads создана');
        }
        
        app.listen(PORT, async () => {
            console.log(`🚀 Сервер запущен на порту ${PORT}`);
            console.log(`🌐 Web App URL: ${WEB_APP_URL}`);
            console.log(`📁 Загрузки: ${WEB_APP_URL}/uploads`);
            
            if (process.env.NODE_ENV === 'production') {
                const webhookUrl = `${WEB_APP_URL}/bot${process.env.BOT_TOKEN}`;
                await bot.telegram.setWebhook(webhookUrl);
                console.log(`🤖 Вебхук установлен: ${webhookUrl}`);
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