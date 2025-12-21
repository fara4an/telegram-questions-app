require('dotenv').config();
const { Telegraf } = require('telegraf');

const bot = new Telegraf(process.env.BOT_TOKEN);
const WEB_APP_URL = process.env.WEB_APP_URL;

// ========== ФУНКЦИИ УВЕДОМЛЕНИЙ ==========

// Уведомление о новом вопросе
async function notifyNewQuestion(toUserId, questionId) {
    try {
        await bot.telegram.sendMessage(
            toUserId,
            `❓ *У вас новый анонимный вопрос!*\n\n` +
            `Откройте приложение, чтобы увидеть его и ответить 👇`,
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[
                        {
                            text: '📱 Открыть приложение',
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

// Уведомление о новом ответе
async function notifyNewAnswer(toUserId, questionText) {
    try {
        await bot.telegram.sendMessage(
            toUserId,
            `💬 *Кто-то ответил на ваш вопрос!*\n\n` +
            `"${questionText.substring(0, 50)}${questionText.length > 50 ? '...' : ''}"\n\n` +
            `Посмотреть ответ в приложении 👇`,
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[
                        {
                            text: '📱 Открыть приложение',
                            web_app: { url: WEB_APP_URL }
                        }
                    ]]
                }
            }
        );
    } catch (error) {
        console.error('Ошибка отправки уведомления об ответе:', error.message);
    }
}

// ========== КОМАНДЫ БОТА ==========

// /start - только ссылка
bot.start(async (ctx) => {
    const userId = ctx.from.id;
    const userLink = `https://t.me/${ctx.botInfo.username}?start=ask_${userId}`;
    
    await ctx.reply(
        `👋 *Ваша ссылка для вопросов:*\n\`${userLink}\`\n\n` +
        `Поделитесь этой ссылкой, чтобы получать анонимные вопросы.`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[
                    {
                        text: '📱 Открыть приложение',
                        web_app: { url: WEB_APP_URL }
                    }
                ]]
            }
        }
    );
});

// /app - открыть приложение
bot.command('app', (ctx) => {
    ctx.reply('Откройте приложение:', {
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

// ========== ЗАПУСК БОТА ==========
bot.launch().then(() => {
    console.log('🤖 Бот для уведомлений запущен!');
}).catch(console.error);

// Экспорт функций уведомлений
module.exports = {
    notifyNewQuestion,
    notifyNewAnswer,
    bot
};