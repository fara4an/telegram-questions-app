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

// ========== УВЕДОМЛЕНИЯ ==========

// Функция отправки уведомления о новом вопросе
async function sendQuestionNotification(questionId) {
    try {
        // Получаем информацию о вопросе и получателе
        const questionResult = await db.query(
            `SELECT q.*, u.telegram_id, u.username, u.first_name 
             FROM questions q
             JOIN users u ON q.to_user_id = u.telegram_id
             WHERE q.id = $1`,
            [questionId]
        );
        
        if (questionResult.rows.length === 0) return;
        
        const question = questionResult.rows[0];
        const toUserId = question.telegram_id;
        const questionText = question.text.length > 100 ? 
            question.text.substring(0, 100) + '...' : question.text;
        
        // Формируем текст уведомления
        const messageText = `📥 *Новый анонимный вопрос!*\n\n` +
                          `💬 *Вопрос:*\n"${questionText}"\n\n` +
                          `👇 *Открой приложение, чтобы ответить:*`;
        
        // Ссылка на приложение
        const appUrl = `${WEB_APP_URL}?notification=question`;
        
        try {
            await bot.telegram.sendMessage(toUserId, messageText, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[
                        {
                            text: '📱 ОТКРЫТЬ ПРИЛОЖЕНИЕ',
                            web_app: { url: appUrl }
                        }
                    ]]
                }
            });
            
            console.log(`✅ Уведомление о вопросе отправлено пользователю ${toUserId}`);
        } catch (error) {
            console.error('❌ Ошибка отправки уведомления о вопросе:', error.message);
        }
        
    } catch (error) {
        console.error('❌ Ошибка в sendQuestionNotification:', error);
    }
}

// Функция отправки уведомления об ответе
async function sendAnswerNotification(questionId) {
    try {
        // Получаем информацию о вопросе и отправителе (если не аноним)
        const questionResult = await db.query(
            `SELECT q.*, 
                    from_user.telegram_id as from_telegram_id,
                    from_user.username as from_username,
                    from_user.first_name as from_first_name,
                    to_user.telegram_id as to_telegram_id
             FROM questions q
             LEFT JOIN users from_user ON q.from_user_id = from_user.telegram_id
             JOIN users to_user ON q.to_user_id = to_user.telegram_id
             WHERE q.id = $1 AND q.is_answered = TRUE`,
            [questionId]
        );
        
        if (questionResult.rows.length === 0) return;
        
        const question = questionResult.rows[0];
        
        // Если вопрос был задан не анонимно (есть from_user_id)
        if (question.from_telegram_id && question.from_user_id) {
            const fromUserId = question.from_telegram_id;
            const answerText = question.answer.length > 100 ? 
                question.answer.substring(0, 100) + '...' : question.answer;
            
            // Формируем текст уведомления
            const messageText = `💬 *На твой вопрос ответили!*\n\n` +
                              `📌 *Твой вопрос:*\n"${question.text.substring(0, 80)}${question.text.length > 80 ? '...' : ''}"\n\n` +
                              `💡 *Ответ:*\n"${answerText}"\n\n` +
                              `👇 *Хочешь задать еще вопросы?*`;
            
            // Ссылка на приложение получателя
            const toUserLink = `https://t.me/${bot.botInfo.username}?start=ask_${question.to_user_id}`;
            
            try {
                await bot.telegram.sendMessage(fromUserId, messageText, {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [[
                            {
                                text: '✍️ Задать еще вопрос',
                                url: toUserLink
                            }
                        ]]
                    }
                });
                
                console.log(`✅ Уведомление об ответе отправлено пользователю ${fromUserId}`);
            } catch (error) {
                console.error('❌ Ошибка отправки уведомления об ответе:', error.message);
            }
        }
        
    } catch (error) {
        console.error('❌ Ошибка в sendAnswerNotification:', error);
    }
}

// ========== ГЕНЕРАЦИЯ И СОХРАНЕНИЕ КАРТИНКИ ==========
app.post('/api/share-to-chat', async (req, res) => {
    try {
        const { userId, questionId } = req.body;
        if (!userId || !questionId) {
            return res.status(400).json({ error: 'Не указаны параметры' });
        }

        console.log(`🔄 Шеринг вопроса ${questionId} для пользователя ${userId}`);

        // 1. Получаем вопрос
        const questionResult = await db.query(
            `SELECT q.*, u.username as from_username 
             FROM questions q
             LEFT JOIN users u ON q.from_user_id = u.telegram_id
             WHERE q.id = $1 AND q.to_user_id = $2 AND q.is_answered = TRUE`,
            [questionId, userId]
        );
        
        if (questionResult.rows.length === 0) {
            console.log(`❌ Вопрос ${questionId} не найден или нет ответа`);
            return res.status(404).json({ error: 'Вопрос не найден или нет ответа' });
        }
        
        const question = questionResult.rows[0];
        console.log(`✅ Найден вопрос: "${question.text.substring(0, 50)}..."`);
        
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
            try {
                console.log('🎨 Генерируем новую картинку...');
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
            } catch (genError) {
                console.error('❌ Ошибка генерации картинки:', genError);
                // Продолжаем без картинки
                imageBase64 = null;
            }
        }
        
        // 5. Получаем информацию о боте
        let botInfo;
        try {
            botInfo = await bot.telegram.getMe();
        } catch (error) {
            console.error('❌ Ошибка получения информации о боте:', error);
            botInfo = { username: 'dota2servicebot' };
        }
        
        const userLink = `https://t.me/${botInfo.username}?start=ask_${userId}`;
        
        // 6. Формируем текст сообщения
        const messageText = `🎯 *Мой ответ на анонимный вопрос!*\n\n` +
                           `💬 *Вопрос:*\n"${question.text.length > 100 ? question.text.substring(0, 100) + '...' : question.text}"\n\n` +
                           `💡 *Мой ответ:*\n"${question.answer.length > 100 ? question.answer.substring(0, 100) + '...' : question.answer}"\n\n` +
                           `👇 *Хочешь задать мне вопрос?*\n` +
                           `Нажми кнопку ниже!`;
        
        // 7. Отправляем в чат
        try {
            if (imageBase64) {
                // Отправляем с картинкой
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
                console.log('✅ Картинка отправлена в чат');
            } else {
                // Отправляем только текст
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
                console.log('✅ Текст отправлен в чат (без картинки)');
            }
            
            return res.json({ 
                success: true, 
                message: '✅ Ответ отправлен в ваш чат с ботом!',
                userLink: userLink
            });
            
        } catch (sendError) {
            console.error('❌ Ошибка отправки в Telegram:', sendError.message);
            
            // Пробуем отправить простой текст без форматирования
            try {
                const simpleText = `Мой ответ на анонимный вопрос!\n\n` +
                                 `Вопрос: "${question.text.substring(0, 80)}${question.text.length > 80 ? '...' : ''}"\n\n` +
                                 `Мой ответ: "${question.answer.substring(0, 80)}${question.answer.length > 80 ? '...' : ''}"\n\n` +
                                 `Задай мне вопрос: ${userLink}`;
                
                await bot.telegram.sendMessage(userId, simpleText);
                console.log('✅ Простой текст отправлен в чат');
                
                return res.json({ 
                    success: true, 
                    message: '✅ Ответ отправлен (упрощенный формат)',
                    userLink: userLink
                });
            } catch (simpleError) {
                console.error('❌ Ошибка отправки простого текста:', simpleError.message);
                return res.status(500).json({ 
                    error: 'Не удалось отправить сообщение в Telegram',
                    details: simpleError.message 
                });
            }
        }
        
    } catch (error) {
        console.error('❌ Критическая ошибка шеринга:', error);
        res.status(500).json({ 
            error: 'Failed to share to chat',
            details: error.message 
        });
    }
});

// ========== ФУНКЦИЯ ГЕНЕРАЦИИ КРАСИВОЙ КАРТИНКИ ==========
async function generateBeautifulImage(question) {
    try {
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
        
        // Скругленные углы для карточки (вручную)
        const roundRect = (ctx, x, y, width, height, radius) => {
            if (radius > width/2) radius = width/2;
            if (radius > height/2) radius = height/2;
            
            ctx.beginPath();
            ctx.moveTo(x + radius, y);
            ctx.lineTo(x + width - radius, y);
            ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
            ctx.lineTo(x + width, y + height - radius);
            ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
            ctx.lineTo(x + radius, y + height);
            ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
            ctx.lineTo(x, y + radius);
            ctx.quadraticCurveTo(x, y, x + radius, y);
            ctx.closePath();
        };
        
        // Рисуем карточку вопроса
        ctx.fillStyle = 'rgba(30, 41, 59, 0.8)';
        roundRect(ctx, cardX, cardY, cardWidth, cardHeight, 20);
        ctx.fill();
        
        // Внутренняя рамка
        ctx.strokeStyle = 'rgba(46, 141, 230, 0.3)';
        ctx.lineWidth = 2;
        roundRect(ctx, cardX + 2, cardY + 2, cardWidth - 4, cardHeight - 4, 18);
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
        roundRect(ctx, cardX, answerCardY, cardWidth, cardHeight, 20);
        ctx.fill();
        
        ctx.strokeStyle = 'rgba(34, 197, 94, 0.3)';
        ctx.lineWidth = 2;
        roundRect(ctx, cardX + 2, answerCardY + 2, cardWidth - 4, cardHeight - 4, 18);
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
    } catch (error) {
        console.error('❌ Ошибка генерации изображения:', error);
        throw error;
    }
}

// Функция для переноса текста
function wrapText(ctx, text, x, y, maxWidth, lineHeight, maxLines = 5) {
    try {
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
    } catch (error) {
        console.error('❌ Ошибка в wrapText:', error);
        // Просто выводим текст без переноса
        ctx.fillText(text.substring(0, 100) + (text.length > 100 ? '...' : ''), x, y);
    }
}

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
            `SELECT telegram_id, username, first_name FROM users WHERE telegram_id = $1`,
            [req.params.userId]
        );
        
        if (result.rows.length > 0) {
            res.json(result.rows[0]);
        } else {
            res.json({
                telegram_id: req.params.userId,
                username: null,
                first_name: null
            });
        }
    } catch (error) {
        console.error('Error fetching user:', error);
        res.json({
            telegram_id: req.params.userId,
            username: null,
            first_name: null
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
        
        // Сохраняем отправителя в БД если он не аноним
        if (from_user_id) {
            try {
                const userData = await fetchUserData(from_user_id);
                if (userData) {
                    await db.query(
                        `INSERT INTO users (telegram_id, username, first_name) 
                         VALUES ($1, $2, $3) 
                         ON CONFLICT (telegram_id) 
                         DO UPDATE SET username = EXCLUDED.username, first_name = EXCLUDED.first_name`,
                        [from_user_id, userData.username, userData.first_name]
                    );
                }
            } catch (error) {
                console.error('Ошибка сохранения отправителя:', error);
            }
        }
        
        // Сохраняем вопрос
        const result = await db.query(
            `INSERT INTO questions (from_user_id, to_user_id, text) 
             VALUES ($1, $2, $3) RETURNING *`,
            [from_user_id || null, to_user_id, text]
        );
        
        const question = result.rows[0];
        
        // Отправляем уведомление получателю
        setTimeout(() => {
            sendQuestionNotification(question.id).catch(console.error);
        }, 1000);
        
        res.status(201).json({ 
            success: true, 
            question: question 
        });
        
    } catch (error) {
        console.error('Error creating question:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Получить данные пользователя из Telegram
async function fetchUserData(userId) {
    try {
        // Пытаемся получить данные через API бота
        const user = await bot.telegram.getChat(userId);
        return {
            username: user.username,
            first_name: user.first_name
        };
    } catch (error) {
        console.error('Ошибка получения данных пользователя:', error);
        return null;
    }
}

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
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Вопрос не найден' });
        }
        
        const question = result.rows[0];
        
        // Удаляем старую картинку из кэша
        await db.query(
            `DELETE FROM question_images WHERE question_id = $1`,
            [id]
        ).catch(() => {}); // Игнорируем ошибки если записи нет
        
        // Отправляем уведомление отправителю вопроса (если не аноним)
        setTimeout(() => {
            sendAnswerNotification(id).catch(console.error);
        }, 1000);
        
        res.json({ 
            success: true, 
            question: question 
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
        await db.query(`DELETE FROM question_images WHERE question_id = $1`, [id]).catch(() => {});
        
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
    const username = ctx.from.username;
    
    // Сохраняем пользователя
    try {
        await db.query(
            `INSERT INTO users (telegram_id, username, first_name) 
             VALUES ($1, $2, $3) 
             ON CONFLICT (telegram_id) 
             DO UPDATE SET username = EXCLUDED.username, first_name = EXCLUDED.first_name`,
            [userId, username, firstName]
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
            `👋 Привет, ${firstName}!\n\nЯ бот для анонимных вопросов.\n\n🔗 *Твоя персональная ссылка:*\n\`${userLink}\`\n\n📤 *Отправь эту ссылку друзьям!*\nОни смогут задать тебе вопрос *анонимно*!`,
            {
                parse_mode: 'Markdown',
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
                                url: `https://t.me/share/url?url=${encodeURIComponent(userLink)}&text=Задай%20мне%20анонимный%20вопрос!%20👇`
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
        `/start - Начать работу, получить свою ссылку\n` +
        `/app - Открыть приложение\n` +
        `/help - Эта справка\n\n` +
        `💡 *Как задать вопрос:*\n` +
        `1. Получи ссылку друга командой /start\n` +
        `2. Перейди по его ссылке\n` +
        `3. Нажми "НАПИСАТЬ ВОПРОС"\n` +
        `4. Напиши вопрос и отправь\n\n` +
        `🔒 *Анонимность гарантирована!*`,
        { parse_mode: 'Markdown' }
    );
});

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
            try {
                const botInfo = await bot.telegram.getMe();
                console.log(`🤖 Бот: @${botInfo.username}`);
            } catch (error) {
                console.error('❌ Ошибка получения информации о боте:', error);
            }

            if (process.env.NODE_ENV === 'production' || WEB_APP_URL.includes('render.com')) {
                try {
                    const webhookUrl = `${WEB_APP_URL}/bot${process.env.BOT_TOKEN}`;
                    await bot.telegram.setWebhook(webhookUrl);
                    console.log(`✅ Вебхук установлен: ${webhookUrl}`);
                } catch (error) {
                    console.error('❌ Ошибка установки вебхука:', error);
                    console.log('🔄 Пытаемся запустить через поллинг...');
                    try {
                        await bot.launch();
                        console.log('🤖 Бот запущен через поллинг');
                    } catch (launchError) {
                        console.error('❌ Ошибка запуска бота:', launchError.message);
                    }
                }
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