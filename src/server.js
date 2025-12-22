require('dotenv').config();
const express = require('express');
const { Telegraf } = require('telegraf');
const path = require('path');
const { Client } = require('pg');
const cors = require('cors');
const { createCanvas } = require('canvas');
const crypto = require('crypto');

const app = express();
const bot = new Telegraf(process.env.BOT_TOKEN);
const WEB_APP_URL = process.env.WEB_APP_URL || 'https://ваш-проект.onrender.com';
let BOT_USERNAME = process.env.BOT_USERNAME || null; // опционально через env

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
app.get('/api/share-image/:questionId', async (req, res) => {
    try {
        const questionId = req.params.questionId;
        
        // 1. Проверяем, есть ли уже картинка в БД
        const existingImage = await db.query(
            `SELECT qi.image_base64 
             FROM question_images qi 
             WHERE qi.question_id = $1`,
            [questionId]
        );
        
        // 2. Если есть — возвращаем её
        if (existingImage.rows.length > 0) {
            console.log(`✅ Картинка из кэша для вопроса ${questionId}`);
            return res.json({
                success: true,
                imageBase64: existingImage.rows[0].image_base64,
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
        const imageBase64 = imageBuffer.toString('base64');
        
        // 5. Сохраняем в БД как Base64
        await db.query(
            `INSERT INTO question_images (question_id, image_base64) 
             VALUES ($1, $2)`,
            [questionId, imageBase64]
        );
        
        console.log(`✅ Картинка сохранена в БД как Base64 для вопроса ${questionId}`);
        
        // 6. Возвращаем результат
        res.json({
            success: true,
            imageBase64: imageBase64,
            cached: false
        });
        
    } catch (error) {
        console.error('❌ Ошибка генерации картинки:', error);
        res.status(500).json({ error: 'Failed to generate image' });
    }
});

app.post('/api/share-to-chat', async (req, res) => {
  try {
    const { userId, questionId } = req.body;
    if (!userId || !questionId) {
      return res.status(400).json({ error: 'Не указаны параметры' });
    }

    // 1) Получаем вопрос и проверяем владельца
    const qRes = await db.query(
      `SELECT q.*, u.username as from_username 
       FROM questions q
       LEFT JOIN users u ON q.from_user_id = u.telegram_id
       WHERE q.id = $1`,
      [questionId]
    );
    if (qRes.rows.length === 0) {
      return res.status(404).json({ error: 'Question not found' });
    }
    const question = qRes.rows[0];
    if (String(question.to_user_id) !== String(userId)) {
      return res.status(403).json({ error: 'Нет доступа к этому вопросу' });
    }

    // 2) Берём картинку из кэша или генерируем
    let imageBase64;
    const imgRes = await db.query(
      `SELECT image_base64 FROM question_images WHERE question_id = $1`,
      [questionId]
    );
    if (imgRes.rows.length > 0) {
      imageBase64 = imgRes.rows[0].image_base64;
    } else {
      const buf = await generateChatImage(question);
      imageBase64 = buf.toString('base64');
      await db.query(
        `INSERT INTO question_images (question_id, image_base64) VALUES ($1, $2)`,
        [questionId, imageBase64]
      );
    }

    // 3) Текст + кнопка
    const username = BOT_USERNAME || (bot.botInfo && bot.botInfo.username) || 'your_bot';
    const userLink = `https://t.me/${username}?start=ask_${userId}`;

    const qShort = question.text.length > 100 ? question.text.slice(0, 100) + '…' : question.text;
    const aShort = question.answer ? (question.answer.length > 160 ? question.answer.slice(0, 160) + '…' : question.answer) : null;

    let messageText = `✨ *Мой ответ на анонимный вопрос!*\n\n`;
    messageText += `📌 *Вопрос:*\n"${qShort}"\n\n`;
    if (aShort) messageText += `💡 *Мой ответ:*\n"${aShort}"\n\n`;
    messageText += `🎯 *Хочешь так же?*\nЗадай и мне анонимный вопрос!\n\n👉 ${userLink}`;

    // 4) Отправляем
    try {
      const imageBuffer = Buffer.from(imageBase64, 'base64');
      await bot.telegram.sendPhoto(userId, { source: imageBuffer }, {
        caption: messageText,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[{ text: '✍️ Задать мне вопрос', url: userLink }]]
        }
      });
      return res.json({ success: true, message: '✅ Ответ отправлен в ваш чат с ботом!' });
    } catch (e) {
      console.error('Telegram sendPhoto error:', e.message);
      await bot.telegram.sendMessage(userId, messageText, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '✍️ Задать мне вопрос', url: userLink }]] }
      });
      return res.json({ success: true, message: '✅ Текст отправлен. Картинка не загрузилась.' });
    }
  } catch (error) {
    console.error('❌ Ошибка шеринга:', error);
    res.status(500).json({ error: 'Failed to share image' });
  }
});

// ========== ФУНКЦИЯ ГЕНЕРАЦИИ КАРТИНКИ ==========
async function generateChatImage(question) {
  const width = 1080;
  const height = 1920;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Фон: градиент + легкий шум
  const g = ctx.createLinearGradient(0, 0, width, height);
  g.addColorStop(0, '#0f172a'); // slate-900
  g.addColorStop(1, '#111827'); // gray-900
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, height);

  // Полупрозрачные круги
  for (let i = 0; i < 40; i++) {
    const r = 60 + Math.random() * 120;
    const x = Math.random() * width;
    const y = Math.random() * height;
    ctx.beginPath();
    ctx.fillStyle = `rgba(46, 141, 230, ${0.05 + Math.random() * 0.05})`;
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Функция скруглённого прямоугольника
  const roundRect = (x, y, w, h, r = 28) => {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  };

  // Центральная карточка
  const cardW = width - 160;
  const cardH = height - 480;
  const cardX = (width - cardW) / 2;
  const cardY = 180;

  ctx.save();
  roundRect(cardX, cardY, cardW, cardH, 36);
  ctx.fillStyle = 'rgba(17, 24, 39, 0.8)'; // gray-900/80
  ctx.fill();
  ctx.restore();

  // Заголовок
  ctx.fillStyle = '#e5e7eb';
  ctx.font = 'bold 56px Arial';
  ctx.textAlign = 'center';
  ctx.fillText('Ответ на анонимный вопрос', width / 2, cardY + 90);

  // Разделитель
  ctx.strokeStyle = 'rgba(46,141,230,0.35)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cardX + 60, cardY + 120);
  ctx.lineTo(cardX + cardW - 60, cardY + 120);
  ctx.stroke();

  // Вопрос — “пузырь”
  const bubbleMargin = 60;
  const qBoxX = cardX + bubbleMargin;
  const qBoxY = cardY + 170;
  const qBoxW = cardW - bubbleMargin * 2;
  const qBoxH = 320;

  ctx.save();
  roundRect(qBoxX, qBoxY, qBoxW, qBoxH, 28);
  ctx.fillStyle = 'rgba(30, 58, 138, 0.4)'; // indigo-800/40
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = '#93c5fd'; // light blue
  ctx.font = 'bold 40px Arial';
  ctx.textAlign = 'left';
  ctx.fillText('Вопрос', qBoxX + 32, qBoxY + 64);

  ctx.fillStyle = '#e5e7eb';
  ctx.font = '34px Arial';
  drawMultiline(ctx, `“${question.text}”`, qBoxX + 32, qBoxY + 118, qBoxW - 64, 48, 7);

  // Ответ — “пузырь”
  const aBoxY = qBoxY + qBoxH + 40;
  const aBoxH = 360;

  ctx.save();
  roundRect(qBoxX, aBoxY, qBoxW, aBoxH, 28);
  ctx.fillStyle = 'rgba(16, 185, 129, 0.35)'; // emerald-500/35
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = '#86efac';
  ctx.font = 'bold 40px Arial';
  ctx.fillText(question.answer ? 'Мой ответ' : 'Ответ отправлен', qBoxX + 32, aBoxY + 64);

  ctx.fillStyle = '#f8fafc';
  ctx.font = '34px Arial';
  const answerText = question.answer ? `“${question.answer}”` : 'Спасибо за вопрос!';
  drawMultiline(ctx, answerText, qBoxX + 32, aBoxY + 118, qBoxW - 64, 48, 7);

  // CTA
  ctx.fillStyle = '#e5e7eb';
  ctx.font = 'bold 40px Arial';
  ctx.textAlign = 'center';
  ctx.fillText('👇 Задай и мне анонимный вопрос!', width / 2, cardY + cardH - 140);

  ctx.fillStyle = 'rgba(229, 231, 235, 0.7)';
  ctx.font = '28px Arial';
  const botHandle = BOT_USERNAME ? `t.me/${BOT_USERNAME}` : 't.me/your_bot';
  ctx.fillText(botHandle, width / 2, cardY + cardH - 90);

  // Водяной знак
  ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
  ctx.font = '20px Arial';
  ctx.fillText('Создано в Telegram Questions', width / 2, height - 40);

  return canvas.toBuffer('image/png');
}

function drawMultiline(ctx, text, x, y, maxWidth, lineHeight, maxLines = 8) {
  const words = (text || '').split(/\s+/);
  let line = '';
  let lines = [];
  for (let n = 0; n < words.length; n++) {
    const testLine = line + words[n] + ' ';
    const w = ctx.measureText(testLine).width;
    if (w > maxWidth && n > 0) {
      lines.push(line.trim());
      line = words[n] + ' ';
      if (lines.length === maxLines - 1) {
        // Обрезаем последнюю строку с многоточием
        let last = '';
        for (let i = n; i < words.length; i++) {
          const t = last + words[i] + ' ';
          if (ctx.measureText(t + '…').width > maxWidth) break;
          last = t;
        }
        lines.push((last.trim() || words[n]).replace(/\s+$/, '') + '…');
        break;
      }
    } else {
      line = testLine;
    }
  }
  if (lines.length < maxLines && line) lines.push(line.trim());

  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], x, y + i * lineHeight);
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
        
        // Удаляем картинку из БД
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

    app.listen(PORT, async () => {
      console.log(`🚀 Сервер запущен на порту ${PORT}`);
      console.log(`🌐 Web App URL: ${WEB_APP_URL}`);

      if (process.env.NODE_ENV === 'production') {
        const webhookUrl = `${WEB_APP_URL}/bot${process.env.BOT_TOKEN}`;
        await bot.telegram.setWebhook(webhookUrl);
        // получить username бота
        if (!BOT_USERNAME) {
          const me = await bot.telegram.getMe();
          BOT_USERNAME = me.username;
        }
        console.log(`🤖 Вебхук установлен: ${webhookUrl}`);
      } else {
        await bot.launch();
        if (!BOT_USERNAME) {
          const me = await bot.telegram.getMe();
          BOT_USERNAME = me.username;
        }
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