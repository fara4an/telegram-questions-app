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
        
        // Создаем таблицы с обновленной структурой
        await db.query(`
            -- Удаляем старые таблицы если нужно
            DROP TABLE IF EXISTS question_images CASCADE;
            DROP TABLE IF EXISTS questions CASCADE;
            DROP TABLE IF EXISTS users CASCADE;
            
            -- Создаем таблицу пользователей
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                telegram_id BIGINT UNIQUE NOT NULL,
                username VARCHAR(255),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            
            -- Создаем таблицу вопросов
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
            
            -- Создаем таблицу для кэширования картинок
            CREATE TABLE IF NOT EXISTS question_images (
                id SERIAL PRIMARY KEY,
                question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
                image_base64 TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(question_id)
            );
            
            -- Создаем индексы
            CREATE INDEX IF NOT EXISTS idx_questions_to_user ON questions(to_user_id);
            CREATE INDEX IF NOT EXISTS idx_questions_from_user ON questions(from_user_id);
            CREATE INDEX IF NOT EXISTS idx_questions_answered ON questions(is_answered);
            CREATE INDEX IF NOT EXISTS idx_question_images_question ON question_images(question_id);
        `);
        
        console.log('✅ Таблицы созданы/обновлены');
        
    } catch (error) {
        console.error('❌ Ошибка БД:', error.message);
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
            `SELECT q.*, u.telegram_id, u.username
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
        const appUrl = `${WEB_APP_URL}`;
        
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
        console.error('❌ Ошибка в sendQuestionNotification:', error.message);
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
            const questionText = question.text.length > 80 ? 
                question.text.substring(0, 80) + '...' : question.text;
            
            // Формируем текст уведомления (НЕ показываем ответ!)
            const messageText = `💬 *На твой вопрос ответили!*\n\n` +
                              `📌 *Твой вопрос:*\n"${questionText}"\n\n` +
                              `👇 *Загляни в приложение, чтобы увидеть ответ!*`;
            
            try {
                await bot.telegram.sendMessage(fromUserId, messageText, {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [[
                            {
                                text: '📱 ОТКРЫТЬ ПРИЛОЖЕНИЕ',
                                web_app: { url: WEB_APP_URL }
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
        console.error('❌ Ошибка в sendAnswerNotification:', error.message);
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
        
        // 2. Проверяем кэш в БД (если таблица существует)
        let imageBase64 = null;
        try {
            const cachedImage = await db.query(
                `SELECT image_base64 FROM question_images WHERE question_id = $1`,
                [questionId]
            );
            
            if (cachedImage.rows.length > 0) {
                imageBase64 = cachedImage.rows[0].image_base64;
                console.log('✅ Используем кэшированную картинку');
            }
        } catch (cacheError) {
            console.log('ℹ️ Таблица question_images не доступна, генерируем новую картинку');
        }
        
        // 3. Генерируем новую картинку если нет в кэше
        if (!imageBase64) {
            try {
                console.log('🎨 Генерируем новую картинку...');
                const imageBuffer = await generateBeautifulImage(question);
                imageBase64 = imageBuffer.toString('base64');
                
                // 4. Сохраняем в БД (если таблица существует)
                try {
                    await db.query(
                        `INSERT INTO question_images (question_id, image_base64) 
                         VALUES ($1, $2) 
                         ON CONFLICT (question_id) 
                         DO UPDATE SET image_base64 = EXCLUDED.image_base64`,
                        [questionId, imageBase64]
                    );
                    console.log('✅ Картинка сохранена в БД');
                } catch (saveError) {
                    console.log('ℹ️ Не удалось сохранить картинку в БД, используем без кэша');
                }
                
            } catch (genError) {
                console.error('❌ Ошибка генерации картинки:', genError.message);
                // Продолжаем без картинки
                imageBase64 = null;
            }
        }
        
        // 5. Получаем информацию о боте
        let botInfo;
        try {
            botInfo = await bot.telegram.getMe();
        } catch (error) {
            console.error('❌ Ошибка получения информации о боте:', error.message);
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
        console.error('❌ Критическая ошибка шеринга:', error.message);
        res.status(500).json({ 
            error: 'Failed to share to chat',
            details: error.message 
        });
    }
});

// ========== ФУНКЦИЯ ГЕНЕРАЦИИ КАРТИНКИ (ИСПРАВЛЕННАЯ) ==========
async function generateBeautifulImage(question) {
    try {
        const width = 1200;
        const height = 1600;
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');
        
        // 1. Фон - сплошной темный цвет
        ctx.fillStyle = '#0a0a0a';
        ctx.fillRect(0, 0, width, height);
        
        // 2. Добавляем градиент сверху
        const gradient = ctx.createLinearGradient(0, 0, width, 0);
        gradient.addColorStop(0, '#2e8de6');
        gradient.addColorStop(1, '#6c5ce7');
        
        // 3. Верхняя плашка с заголовком
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, 300);
        
        // 4. Заголовок
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 70px "Arial"';
        ctx.textAlign = 'center';
        ctx.fillText('💬', width / 2, 120);
        
        ctx.font = 'bold 50px "Arial"';
        ctx.fillText('Ответ на вопрос', width / 2, 220);
        
        // 5. Карточка вопроса
        const cardWidth = width * 0.85;
        const cardHeight = 350;
        const cardX = (width - cardWidth) / 2;
        const cardY = 350;
        
        // Скругленные углы (простая реализация)
        ctx.fillStyle = '#1a1a1a';
        ctx.beginPath();
        ctx.roundRect = function(x, y, w, h, r) {
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
        
        ctx.roundRect(cardX, cardY, cardWidth, cardHeight, 30);
        ctx.fill();
        
        // Граница карточки
        ctx.strokeStyle = '#2e8de6';
        ctx.lineWidth = 3;
        ctx.stroke();
        
        // 6. Текст вопроса
        ctx.fillStyle = '#2e8de6';
        ctx.font = 'bold 36px "Arial"';
        ctx.textAlign = 'left';
        ctx.fillText('❓ ВОПРОС:', cardX + 40, cardY + 70);
        
        ctx.fillStyle = '#ffffff';
        ctx.font = '28px "Arial"';
        wrapText(ctx, `"${question.text}"`, cardX + 40, cardY + 130, cardWidth - 80, 35, 4);
        
        // 7. Карточка ответа
        const answerCardY = cardY + cardHeight + 40;
        
        ctx.fillStyle = '#1a1a1a';
        ctx.roundRect(cardX, answerCardY, cardWidth, cardHeight, 30);
        ctx.fill();
        
        // Граница карточки ответа
        ctx.strokeStyle = '#4CAF50';
        ctx.lineWidth = 3;
        ctx.stroke();
        
        // 8. Текст ответа
        ctx.fillStyle = '#4CAF50';
        ctx.font = 'bold 36px "Arial"';
        ctx.textAlign = 'left';
        ctx.fillText('💡 ОТВЕТ:', cardX + 40, answerCardY + 70);
        
        ctx.fillStyle = '#ffffff';
        ctx.font = '28px "Arial"';
        wrapText(ctx, `"${question.answer}"`, cardX + 40, answerCardY + 130, cardWidth - 80, 35, 4);
        
        // 9. Призыв к действию (нижняя часть)
        const ctaY = answerCardY + cardHeight + 80;
        
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 40px "Arial"';
        ctx.textAlign = 'center';
        ctx.fillText('👇 Задай и мне вопрос!', width / 2, ctaY);
        
        // 10. Ссылка на бота
        ctx.fillStyle = '#2e8de6';
        ctx.font = 'bold 36px "Arial"';
        ctx.fillText('t.me/dota2servicebot', width / 2, ctaY + 70);
        
        // 11. Водяной знак
        ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.font = '24px "Arial"';
        ctx.fillText('Telegram Questions App', width / 2, height - 50);
        
        return canvas.toBuffer('image/png');
    } catch (error) {
        console.error('❌ Ошибка генерации изображения:', error.message);
        // Создаем простую картинку-заглушку
        const canvas = createCanvas(800, 600);
        const ctx = canvas.getContext('2d');
        
        ctx.fillStyle = '#0a0a0a';
        ctx.fillRect(0, 0, 800, 600);
        
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 40px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('💬 Ответ на анонимный вопрос', 400, 200);
        
        ctx.font = '24px Arial';
        ctx.fillText('Задай мне вопрос:', 400, 300);
        
        ctx.fillStyle = '#2e8de6';
        ctx.font = 'bold 28px Arial';
        ctx.fillText('t.me/dota2servicebot', 400, 400);
        
        return canvas.toBuffer('image/png');
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
        console.error('❌ Ошибка в wrapText:', error.message);
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
        console.error('Error fetching user:', error.message);
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
        console.error('Error fetching incoming questions:', error.message);
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
        console.error('Error fetching sent questions:', error.message);
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
        console.error('Error fetching question:', error.message);
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
                await db.query(
                    `INSERT INTO users (telegram_id, username) 
                     VALUES ($1, $2) 
                     ON CONFLICT (telegram_id) 
                     DO UPDATE SET username = EXCLUDED.username`,
                    [from_user_id, `user_${from_user_id}`]
                );
            } catch (error) {
                console.error('Ошибка сохранения отправителя:', error.message);
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
        console.error('Error creating question:', error.message);
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
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Вопрос не найден' });
        }
        
        const question = result.rows[0];
        
        // Удаляем старую картинку из кэша (если таблица существует)
        try {
            await db.query(
                `DELETE FROM question_images WHERE question_id = $1`,
                [id]
            );
        } catch (error) {
            // Игнорируем ошибки если таблицы нет
        }
        
        // Отправляем уведомление отправителю вопроса (если не аноним)
        setTimeout(() => {
            sendAnswerNotification(id).catch(console.error);
        }, 1000);
        
        res.json({ 
            success: true, 
            question: question 
        });
        
    } catch (error) {
        console.error('Error answering question:', error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Удалить вопрос
app.delete('/api/questions/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        // Удаляем картинку из кэша (если таблица существует)
        try {
            await db.query(`DELETE FROM question_images WHERE question_id = $1`, [id]);
        } catch (error) {
            // Игнорируем ошибки
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
        console.error('Error deleting question:', error.message);
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
        console.error('Error fetching stats:', error.message);
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
            `INSERT INTO users (telegram_id, username) 
             VALUES ($1, $2) 
             ON CONFLICT (telegram_id) 
             DO UPDATE SET username = EXCLUDED.username`,
            [userId, username || `user_${userId}`]
        );
    } catch (error) {
        console.error('Ошибка сохранения пользователя:', error.message);
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
                console.error('❌ Ошибка получения информации о боте:', error.message);
            }

            if (process.env.NODE_ENV === 'production' || WEB_APP_URL.includes('render.com')) {
                try {
                    const webhookUrl = `${WEB_APP_URL}/bot${process.env.BOT_TOKEN}`;
                    await bot.telegram.setWebhook(webhookUrl);
                    console.log(`✅ Вебхук установлен: ${webhookUrl}`);
                } catch (error) {
                    console.error('❌ Ошибка установки вебхука:', error.message);
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