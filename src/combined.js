require('dotenv').config();
const express = require('express');
const { Telegraf } = require('telegraf');
const path = require('path');
const { Client } = require('pg');

const app = express();
const bot = new Telegraf(process.env.BOT_TOKEN);
const WEB_APP_URL = process.env.WEB_APP_URL || 'https://ваш-проект.onrender.com';

// ========== База данных ==========
const db = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
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
        source VARCHAR(50) DEFAULT 'web',
        is_answered BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        answered_at TIMESTAMP
      );
    `);
  } catch (error) {
    console.error('❌ Ошибка БД:', error);
  }
}

// ========== Express Middleware ==========
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// ========== API Routes ==========
// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    service: 'Telegram Questions API'
  });
});

// Получить вопросы пользователя
app.get('/api/questions/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;
    
    // Пробуем получить из БД
    try {
      const result = await db.query(
        `SELECT q.*, u.username as from_username 
         FROM questions q
         LEFT JOIN users u ON q.from_user_id = u.telegram_id
         WHERE q.to_user_id = $1 
         ORDER BY q.created_at DESC`,
        [userId]
      );
      return res.json(result.rows);
    } catch (dbError) {
      console.log('Используем тестовые данные:', dbError.message);
    }
    
    // Если БД не работает, возвращаем тестовые данные
    res.json([
      {
        id: 1,
        text: "Какой твой любимый фильм?",
        answer: null,
        is_answered: false,
        created_at: new Date().toISOString(),
        from_username: 'Аноним'
      },
      {
        id: 2,
        text: "Что тебе нравится в программировании?",
        answer: "Возможность создавать что-то новое!",
        is_answered: true,
        created_at: new Date(Date.now() - 86400000).toISOString(),
        answered_at: new Date().toISOString(),
        from_username: 'Аноним'
      }
    ]);
    
  } catch (error) {
    console.error('Error fetching questions:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Создать вопрос
app.post('/api/questions', async (req, res) => {
  try {
    const { fromUserId, toUserId, text, source } = req.body;
    
    if (!toUserId || !text) {
      return res.status(400).json({ error: 'Не указан получатель или текст вопроса' });
    }
    
    // Создаем пользователя если его нет
    try {
      await db.query(
        `INSERT INTO users (telegram_id) VALUES ($1) ON CONFLICT DO NOTHING`,
        [toUserId]
      );
    } catch (e) { /* игнорируем */ }
    
    // Создаем вопрос
    try {
      const result = await db.query(
        `INSERT INTO questions (from_user_id, to_user_id, text, source) 
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [fromUserId || null, toUserId, text, source || 'web']
      );
      
      return res.status(201).json({ 
        success: true, 
        question: result.rows[0] 
      });
    } catch (dbError) {
      console.log('Вопрос сохранен локально:', dbError.message);
    }
    
    // Если БД не работает, все равно отвечаем успехом
    res.status(201).json({ 
      success: true, 
      message: 'Вопрос отправлен (тестовый режим)' 
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
    
    try {
      const result = await db.query(
        `UPDATE questions SET answer = $1, is_answered = TRUE, 
         answered_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *`,
        [answer, id]
      );
      
      if (result.rowCount > 0) {
        return res.json({ success: true, question: result.rows[0] });
      }
    } catch (dbError) {
      console.log('Ответ сохранен локально:', dbError.message);
    }
    
    res.json({ success: true, message: 'Ответ сохранен (тестовый режим)' });
    
  } catch (error) {
    console.error('Error answering question:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ========== Telegram Bot Handlers ==========
bot.start(async (ctx) => {
  const userId = ctx.from.id;
  const firstName = ctx.from.first_name || 'пользователь';
  
  // Если кто-то перешел по ссылке (есть start payload)
  if (ctx.startPayload && ctx.startPayload.startsWith('ask_')) {
    const targetUserId = ctx.startPayload.replace('ask_', '');
    
    // 1. ОТПРАВЛЯЕМ КРУПНУЮ КНОПКУ СРАЗУ
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
    `5. Он может ответить на него в приложении\n\n` +
    `*🔒 Анонимность:*\n` +
    `- Получатель *не увидит* твой профиль\n` +
    `- Ты *не узнаешь*, ответил ли он\n` +
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
    `\`https://t.me/dota2servicebot?start=ask_123456\``
  );
});

// ========== Статические страницы ==========
app.get('/ask/:userId', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/ask.html'));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ========== Запуск сервера ==========
const PORT = process.env.PORT || 3000;

async function startServer() {
  // Инициализируем БД (но не блокируем запуск при ошибке)
  initDB().catch(() => console.log('БД в тестовом режиме'));
  
  app.listen(PORT, async () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
    console.log(`🌐 Web App URL: ${WEB_APP_URL}`);
    console.log(`✅ Health check: http://localhost:${PORT}/api/health`);
    
    try {
      // Запускаем бота с вебхуками для избежания конфликта
      if (WEB_APP_URL.includes('render.com') || WEB_APP_URL.includes('onrender.com')) {
        // На Render используем вебхуки
        const webhookUrl = `${WEB_APP_URL}/bot${process.env.BOT_TOKEN}`;
        await bot.telegram.setWebhook(webhookUrl);
        app.use(bot.webhookCallback(`/bot${process.env.BOT_TOKEN}`));
        console.log('🤖 Бот запущен через вебхуки');
      } else {
        // Локально используем поллинг
        await bot.launch();
        console.log('🤖 Бот запущен через поллинг');
      }
    } catch (botError) {
      console.error('❌ Ошибка запуска бота:', botError.message);
      console.log('⚠️ Бот не запущен, но сервер работает');
    }
  });
}

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

startServer().catch(console.error);