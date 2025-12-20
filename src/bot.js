require('dotenv').config();
const { Telegraf } = require('telegraf');

const bot = new Telegraf(process.env.BOT_TOKEN);
const WEB_APP_URL = process.env.WEB_APP_URL || 'https://your-app.onrender.com';

console.log('🤖 Инициализация Telegram бота...');

// Обработка команды /start
bot.start(async (ctx) => {
  const userId = ctx.from.id;
  const firstName = ctx.from.first_name || 'пользователь';
  
  // Если есть start payload (кто-то перешел по ссылке)
  if (ctx.startPayload && ctx.startPayload.startsWith('ask_')) {
    const targetUserId = ctx.startPayload.replace('ask_', '');
    
    await ctx.reply(
      `✍️ *Задать анонимный вопрос*\n\n` +
      `Привет! Ты можешь задать анонимный вопрос.`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: '📝 Задать вопрос',
                web_app: { url: `${WEB_APP_URL}/ask/${targetUserId}` }
              }
            ],
            [
              {
                text: '📱 Открыть своё приложение',
                web_app: { url: WEB_APP_URL }
              }
            ]
          ]
        }
      }
    );
  } else {
    // Обычный старт - показываем профиль
    const userLink = `https://t.me/${ctx.botInfo.username}?start=ask_${userId}`;
    
    await ctx.reply(
      `👋 *Привет, ${firstName}!*\n\n` +
      `Я бот для анонимных вопросов.\n\n` +
      `🔗 *Твоя персональная ссылка:*\n\`${userLink}\`\n\n` +
      `Поделись этой ссылкой с друзьями, чтобы они могли задавать тебе вопросы анонимно!\n\n` +
      `📱 *Управление вопросами:*`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: '📱 Открыть приложение',
                web_app: { url: WEB_APP_URL }
              }
            ],
            [
              {
                text: '📤 Поделиться ссылкой',
                url: `https://t.me/share/url?url=${encodeURIComponent(userLink)}&text=Задай%20мне%20анонимный%20вопрос!`
              }
            ]
          ]
        }
      }
    );
  }
});

// Команда /app
bot.command('app', (ctx) => {
  ctx.reply('Открой приложение для управления вопросами:', {
    reply_markup: {
      inline_keyboard: [[
        {
          text: '📱 Открыть приложение',
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
    `*/help* - Показать эту справку\n\n` +
    `*Как это работает:*\n` +
    `1. Получи свою ссылку командой /start\n` +
    `2. Поделись ссылкой с друзьями\n` +
    `3. Они смогут задать тебе вопрос анонимно\n` +
    `4. Ты получишь уведомление и сможешь ответить в приложении\n\n` +
    `*Вопросы и поддержка:*\n` +
    `Если что-то не работает, напиши разработчику.`
  );
});

// Обработка текстовых сообщений
bot.on('text', (ctx) => {
  // Игнорируем команды
  if (ctx.message.text.startsWith('/')) return;
  
  ctx.reply(
    'Я понимаю только команды. Используй:\n' +
    '/start - для начала работы\n' +
    '/app - чтобы открыть приложение\n' +
    '/help - для помощи'
  );
});

// Обработка ошибок
bot.catch((err, ctx) => {
  console.error(`Ошибка для ${ctx.updateType}:`, err);
  ctx.reply('Произошла ошибка. Попробуйте позже.');
});

// Запуск бота
bot.launch()
  .then(() => {
    console.log('✅ Telegram бот запущен!');
    console.log(`🌐 Web App URL: ${WEB_APP_URL}`);
  })
  .catch((err) => {
    console.error('❌ Ошибка запуска бота:', err);
    process.exit(1);
  });

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));