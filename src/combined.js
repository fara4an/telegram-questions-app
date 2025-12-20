require('dotenv').config();
const express = require('express');
const { Telegraf } = require('telegraf');
const path = require('path');

const app = express();
const bot = new Telegraf(process.env.BOT_TOKEN);
const WEB_APP_URL = process.env.WEB_APP_URL || 'https://ваш-проект.onrender.com';

// ========== Express Middleware ==========
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// ========== API Routes ==========
// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Главная страница Mini App
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ========== Telegram Bot Handlers ==========
// Команда /start
bot.start(async (ctx) => {
    const userId = ctx.from.id;
    const firstName = ctx.from.first_name || 'пользователь';
    
    // Если кто-то перешел по ссылке (есть start payload)
    if (ctx.startPayload && ctx.startPayload.startsWith('ask_')) {
        const targetUserId = ctx.startPayload.replace('ask_', '');
        
        // 1. Сразу открываем мини-апп с формой вопроса
        try {
            await ctx.reply(`✍️ Задать вопрос пользователю #${targetUserId}`, {
                reply_markup: {
                    inline_keyboard: [[
                        {
                            text: '📝 Задать вопрос сейчас',
                            web_app: { 
                                url: `${WEB_APP_URL}/ask/${targetUserId}?from=telegram&asker=${userId}` 
                            }
                        }
                    ]]
                }
            });
        } catch (error) {
            // 2. Если мини-апп не открылся, показываем альтернативу
            await ctx.reply(
                `✍️ *Задать анонимный вопрос*\n\n` +
                `Нажмите кнопку ниже, чтобы задать вопрос:`,
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [[
                            {
                                text: '📝 Задать вопрос',
                                web_app: { 
                                    url: `${WEB_APP_URL}/ask/${targetUserId}` 
                                }
                            }
                        ]]
                    }
                }
            );
        }
        
    } else {
        // Обычный старт - показываем профиль пользователя
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
        `3. Они нажмут на ссылку → откроется форма вопроса\n` +
        `4. Ты получишь вопрос в приложении (/app)\n\n` +
        `*Вопросы и поддержка:*\n` +
        `Если что-то не работает, напиши разработчику.`
    );
});

// ========== Server Startup ==========
const PORT = process.env.PORT || 3000;

async function startServer() {
    // Запускаем Express сервер
    app.listen(PORT, async () => {
        console.log(`🚀 Сервер запущен на порту ${PORT}`);
        console.log(`🌐 Web App URL: ${WEB_APP_URL}`);
        
        // Запускаем Telegram бота
        await bot.launch();
        console.log('🤖 Telegram бот запущен');
    });
}

// Graceful shutdown
process.once('SIGINT', () => {
    bot.stop('SIGINT');
    process.exit(0);
});

process.once('SIGTERM', () => {
    bot.stop('SIGTERM');
    process.exit(0);
});

startServer().catch(console.error);