require('dotenv').config();
const express = require('express');
const { Telegraf } = require('telegraf');
const path = require('path');

const app = express();
const bot = new Telegraf(process.env.BOT_TOKEN);
const WEB_APP_URL = process.env.WEB_APP_URL || 'https://ваш-проект.onrender.com';

// Настройки Express из вашего server.js
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));
// ... остальной код вашего сервера (API маршруты) ...

// Команды бота из bot.js
bot.start((ctx) => {
    const userId = ctx.from.id;
    const link = `https://t.me/${ctx.botInfo.username}?start=ask_${userId}`;
    ctx.reply(`Ваша ссылка: ${link}`, {
        reply_markup: {
            inline_keyboard: [[{
                text: '📱 Открыть приложение',
                web_app: { url: WEB_APP_URL }
            }]]
        }
    });
});

// ... остальной код бота ...

const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
    await bot.launch();
    console.log('🤖 Telegram бот запущен');
    console.log(`🌐 Web App URL: ${WEB_APP_URL}`);
});
