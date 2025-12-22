require('dotenv').config();
const express = require('express');
const { Telegraf } = require('telegraf');
const path = require('path');
const { Client } = require('pg');
const cors = require('cors');

const app = express();
const bot = new Telegraf(process.env.BOT_TOKEN);
const WEB_APP_URL = process.env.WEB_APP_URL || 'https://ваш-проект.onrender.com';

// Главный админ
const MAIN_ADMIN_ID = 781166716;
const MAIN_ADMIN_USERNAME = 'zxc4an';

// ========== БАЗА ДАННЫХ ==========
const db = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function initDB() {
    try {
        await db.connect();
        console.log('✅ База данных подключена');
        
        // Создаем таблицы
        await db.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                telegram_id BIGINT UNIQUE NOT NULL,
                username VARCHAR(255),
                is_admin BOOLEAN DEFAULT FALSE,
                is_super_admin BOOLEAN DEFAULT FALSE,
                invited_by BIGINT,
                referral_code VARCHAR(50) UNIQUE,
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
            
            CREATE TABLE IF NOT EXISTS referrals (
                id SERIAL PRIMARY KEY,
                admin_id BIGINT NOT NULL,
                referral_code VARCHAR(50) UNIQUE NOT NULL,
                max_uses INTEGER DEFAULT 100,
                used_count INTEGER DEFAULT 0,
                is_active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            
            CREATE INDEX IF NOT EXISTS idx_questions_to_user ON questions(to_user_id);
            CREATE INDEX IF NOT EXISTS idx_questions_from_user ON questions(from_user_id);
            CREATE INDEX IF NOT EXISTS idx_questions_answered ON questions(is_answered);
            CREATE INDEX IF NOT EXISTS idx_users_admin ON users(is_admin);
            CREATE INDEX IF NOT EXISTS idx_users_invited_by ON users(invited_by);
            CREATE INDEX IF NOT EXISTS idx_referrals_admin ON referrals(admin_id);
        `);
        
        console.log('✅ Таблицы созданы/обновлены');
        
        // Проверяем и создаем главного админа
        await ensureMainAdmin();
        
    } catch (error) {
        console.error('❌ Ошибка БД:', error.message);
    }
}

// Создаем главного админа если его нет
async function ensureMainAdmin() {
    try {
        const result = await db.query(
            `SELECT * FROM users WHERE telegram_id = $1`,
            [MAIN_ADMIN_ID]
        );
        
        if (result.rows.length === 0) {
            await db.query(
                `INSERT INTO users (telegram_id, username, is_admin, is_super_admin) 
                 VALUES ($1, $2, TRUE, TRUE)`,
                [MAIN_ADMIN_ID, MAIN_ADMIN_USERNAME]
            );
            console.log('✅ Главный админ создан');
        } else {
            // Обновляем существующего пользователя до главного админа
            await db.query(
                `UPDATE users SET is_admin = TRUE, is_super_admin = TRUE, username = $2 
                 WHERE telegram_id = $1`,
                [MAIN_ADMIN_ID, MAIN_ADMIN_USERNAME]
            );
            console.log('✅ Главный админ обновлен');
        }
    } catch (error) {
        console.error('❌ Ошибка создания главного админа:', error.message);
    }
}

// ========== МИДЛВАРЫ ==========
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// ========== ПРОВЕРКА АДМИНА ==========
async function isSuperAdmin(userId) {
    try {
        const result = await db.query(
            `SELECT is_super_admin FROM users WHERE telegram_id = $1`,
            [userId]
        );
        return result.rows.length > 0 && result.rows[0].is_super_admin;
    } catch (error) {
        console.error('Ошибка проверки супер-админа:', error.message);
        return false;
    }
}

async function isAdmin(userId) {
    try {
        const result = await db.query(
            `SELECT is_admin FROM users WHERE telegram_id = $1`,
            [userId]
        );
        return result.rows.length > 0 && result.rows[0].is_admin;
    } catch (error) {
        console.error('Ошибка проверки админа:', error.message);
        return false;
    }
}

// ========== АДМИН API ==========

// Получить статистику для админа
app.get('/api/admin/stats', async (req, res) => {
    try {
        const userId = req.query.userId;
        
        if (!userId) {
            return res.status(400).json({ error: 'Не указан userId' });
        }
        
        // Проверяем права
        const isSuper = await isSuperAdmin(userId);
        const isAdm = await isAdmin(userId);
        
        if (!isSuper && !isAdm) {
            return res.status(403).json({ error: 'Доступ запрещен' });
        }
        
        // Общая статистика
        const totalUsers = await db.query(`SELECT COUNT(*) as count FROM users`);
        const totalQuestions = await db.query(`SELECT COUNT(*) as count FROM questions`);
        const answeredQuestions = await db.query(`SELECT COUNT(*) as count FROM questions WHERE is_answered = TRUE`);
        const activeToday = await db.query(`
            SELECT COUNT(DISTINCT from_user_id) as count 
            FROM questions 
            WHERE created_at >= CURRENT_DATE
            UNION ALL
            SELECT COUNT(DISTINCT to_user_id) 
            FROM questions 
            WHERE created_at >= CURRENT_DATE
        `);
        
        // Статистика по пользователям (только для супер-админа)
        let userStats = [];
        if (isSuper) {
            userStats = await db.query(`
                SELECT 
                    u.telegram_id,
                    u.username,
                    u.is_admin,
                    u.is_super_admin,
                    u.created_at,
                    COALESCE(q_sent.sent_count, 0) as questions_sent,
                    COALESCE(q_received.received_count, 0) as questions_received,
                    COALESCE(q_answered.answered_count, 0) as questions_answered,
                    COALESCE(r.invited_count, 0) as invited_users
                FROM users u
                LEFT JOIN (
                    SELECT from_user_id, COUNT(*) as sent_count 
                    FROM questions 
                    GROUP BY from_user_id
                ) q_sent ON u.telegram_id = q_sent.from_user_id
                LEFT JOIN (
                    SELECT to_user_id, COUNT(*) as received_count 
                    FROM questions 
                    GROUP BY to_user_id
                ) q_received ON u.telegram_id = q_received.to_user_id
                LEFT JOIN (
                    SELECT to_user_id, COUNT(*) as answered_count 
                    FROM questions 
                    WHERE is_answered = TRUE
                    GROUP BY to_user_id
                ) q_answered ON u.telegram_id = q_answered.to_user_id
                LEFT JOIN (
                    SELECT invited_by, COUNT(*) as invited_count 
                    FROM users 
                    WHERE invited_by IS NOT NULL
                    GROUP BY invited_by
                ) r ON u.telegram_id = r.invited_by
                ORDER BY u.created_at DESC
                LIMIT 100
            `);
        }
        
        // Статистика по рефералам (для всех админов)
        const referralStats = await db.query(`
            SELECT 
                r.*,
                u.username as admin_username,
                COUNT(ru.telegram_id) as used_count
            FROM referrals r
            JOIN users u ON r.admin_id = u.telegram_id
            LEFT JOIN users ru ON r.referral_code = ru.referral_code
            WHERE r.admin_id = $1 OR $2 = TRUE
            GROUP BY r.id, u.username
            ORDER BY r.created_at DESC
        `, [userId, isSuper]);
        
        res.json({
            success: true,
            stats: {
                totalUsers: parseInt(totalUsers.rows[0].count),
                totalQuestions: parseInt(totalQuestions.rows[0].count),
                answeredQuestions: parseInt(answeredQuestions.rows[0].count),
                activeToday: parseInt(activeToday.rows[0].count) + parseInt(activeToday.rows[1]?.count || 0),
                isSuperAdmin: isSuper,
                isAdmin: isAdm
            },
            userStats: userStats.rows,
            referralStats: referralStats.rows
        });
        
    } catch (error) {
        console.error('Error fetching admin stats:', error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Сделать пользователя админом
app.post('/api/admin/make-admin', async (req, res) => {
    try {
        const { userId, targetUserId } = req.body;
        
        if (!userId || !targetUserId) {
            return res.status(400).json({ error: 'Не указаны параметры' });
        }
        
        // Проверяем что только супер-админ может создавать админов
        const isSuper = await isSuperAdmin(userId);
        if (!isSuper) {
            return res.status(403).json({ error: 'Только главный админ может создавать админов' });
        }
        
        // Делаем пользователя админом
        await db.query(
            `UPDATE users SET is_admin = TRUE WHERE telegram_id = $1`,
            [targetUserId]
        );
        
        // Отправляем уведомление новому админу
        try {
            await bot.telegram.sendMessage(targetUserId, 
                `🎉 *Поздравляем!*\n\nВы были назначены админом в боте "Анонимные вопросы".\n\n` +
                `Теперь у вас есть доступ к админ-панели в приложении!`,
                { parse_mode: 'Markdown' }
            );
        } catch (error) {
            console.error('Ошибка отправки уведомления админу:', error.message);
        }
        
        res.json({ 
            success: true, 
            message: 'Пользователь назначен админом'
        });
        
    } catch (error) {
        console.error('Error making admin:', error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Создать реферальную ссылку
app.post('/api/admin/create-referral', async (req, res) => {
    try {
        const { userId, maxUses = 100 } = req.body;
        
        if (!userId) {
            return res.status(400).json({ error: 'Не указан userId' });
        }
        
        // Проверяем права
        const isAdm = await isAdmin(userId);
        if (!isAdm) {
            return res.status(403).json({ error: 'Доступ запрещен' });
        }
        
        // Генерируем уникальный код
        const referralCode = generateReferralCode();
        const botInfo = await bot.telegram.getMe();
        const referralLink = `https://t.me/${botInfo.username}?start=ref_${referralCode}`;
        
        // Сохраняем реферал
        await db.query(
            `INSERT INTO referrals (admin_id, referral_code, max_uses) 
             VALUES ($1, $2, $3)`,
            [userId, referralCode, maxUses]
        );
        
        res.json({ 
            success: true, 
            referralCode,
            referralLink,
            message: 'Реферальная ссылка создана'
        });
        
    } catch (error) {
        console.error('Error creating referral:', error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Генерация реферального кода
function generateReferralCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 8; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

// ========== УВЕДОМЛЕНИЯ ==========
async function sendQuestionNotification(questionId) {
    try {
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
        const questionText = question.text.length > 80 ? 
            question.text.substring(0, 80) + '...' : question.text;
        
        const messageText = `📥 *Новый анонимный вопрос!*\n\n` +
                          `💬 *Вопрос:*\n"${questionText}"\n\n` +
                          `👇 *Открой приложение, чтобы ответить:*`;
        
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
        } catch (error) {
            console.error('❌ Ошибка отправки уведомления о вопросе:', error.message);
        }
        
    } catch (error) {
        console.error('❌ Ошибка в sendQuestionNotification:', error.message);
    }
}

async function sendAnswerNotification(questionId) {
    try {
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
        
        if (question.from_telegram_id && question.from_user_id) {
            const fromUserId = question.from_telegram_id;
            const questionText = question.text.length > 60 ? 
                question.text.substring(0, 60) + '...' : question.text;
            
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
            } catch (error) {
                console.error('❌ Ошибка отправки уведомления об ответе:', error.message);
            }
        }
        
    } catch (error) {
        console.error('❌ Ошибка в sendAnswerNotification:', error.message);
    }
}

// ========== ШЕРИНГ ==========
app.post('/api/share-to-chat', async (req, res) => {
    try {
        const { userId, questionId } = req.body;
        if (!userId || !questionId) {
            return res.status(400).json({ error: 'Не указаны параметры' });
        }

        const questionResult = await db.query(
            `SELECT q.*, u.username as from_username 
             FROM questions q
             LEFT JOIN users u ON q.from_user_id = u.telegram_id
             WHERE q.id = $1 AND q.to_user_id = $2 AND q.is_answered = TRUE`,
            [questionId, userId]
        );
        
        if (questionResult.rows.length === 0) {
            return res.status(404).json({ error: 'Вопрос не найден или нет ответа' });
        }
        
        const question = questionResult.rows[0];
        
        let botInfo;
        try {
            botInfo = await bot.telegram.getMe();
        } catch (error) {
            botInfo = { username: 'dota2servicebot' };
        }
        
        const userLink = `https://t.me/${botInfo.username}?start=ask_${userId}`;
        
        const messageText = `🎯 *Мой ответ на анонимный вопрос!*\n\n` +
                           `💬 *Вопрос:*\n"${question.text.length > 80 ? question.text.substring(0, 80) + '...' : question.text}"\n\n` +
                           `💡 *Мой ответ:*\n"${question.answer.length > 80 ? question.answer.substring(0, 80) + '...' : question.answer}"\n\n` +
                           `👇 *Хочешь задать мне вопрос?*\n` +
                           `Нажми кнопку ниже!`;
        
        try {
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
            
            return res.json({ 
                success: true, 
                message: '✅ Ответ отправлен в ваш чат с ботом!',
                userLink: userLink
            });
            
        } catch (sendError) {
            console.error('❌ Ошибка отправки в Telegram:', sendError.message);
            
            try {
                const simpleText = `🎯 Мой ответ на анонимный вопрос!\n\n` +
                                 `💬 Вопрос:\n"${question.text.substring(0, 80)}${question.text.length > 80 ? '...' : ''}"\n\n` +
                                 `💡 Мой ответ:\n"${question.answer.substring(0, 80)}${question.answer.length > 80 ? '...' : ''}"\n\n` +
                                 `👇 Хочешь задать мне вопрос?\n` +
                                 `Нажми: ${userLink}`;
                
                await bot.telegram.sendMessage(userId, simpleText);
                
                return res.json({ 
                    success: true, 
                    message: '✅ Ответ отправлен!',
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

// ========== ОБЩИЕ API ==========

// Проверить права пользователя
app.get('/api/user/role/:userId', async (req, res) => {
    try {
        const result = await db.query(
            `SELECT telegram_id, username, is_admin, is_super_admin 
             FROM users WHERE telegram_id = $1`,
            [req.params.userId]
        );
        
        if (result.rows.length > 0) {
            res.json(result.rows[0]);
        } else {
            res.json({
                telegram_id: req.params.userId,
                username: null,
                is_admin: false,
                is_super_admin: false
            });
        }
    } catch (error) {
        console.error('Error fetching user role:', error.message);
        res.json({
            telegram_id: req.params.userId,
            username: null,
            is_admin: false,
            is_super_admin: false
        });
    }
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
        const { from_user_id, to_user_id, text, referral_code } = req.body;
        
        if (!to_user_id || !text) {
            return res.status(400).json({ error: 'Не указан получатель или текст вопроса' });
        }
        
        // Если есть реферальный код, находим админа
        let invitedBy = null;
        if (referral_code) {
            const referralResult = await db.query(
                `SELECT admin_id FROM referrals WHERE referral_code = $1 AND is_active = TRUE`,
                [referral_code]
            );
            if (referralResult.rows.length > 0) {
                invitedBy = referralResult.rows[0].admin_id;
                // Увеличиваем счетчик использований
                await db.query(
                    `UPDATE referrals SET used_count = used_count + 1 WHERE referral_code = $1`,
                    [referral_code]
                );
            }
        }
        
        // Сохраняем отправителя в БД если он не аноним
        if (from_user_id) {
            try {
                await db.query(
                    `INSERT INTO users (telegram_id, username, invited_by, referral_code) 
                     VALUES ($1, $2, $3, $4) 
                     ON CONFLICT (telegram_id) 
                     DO UPDATE SET username = EXCLUDED.username, 
                                   invited_by = COALESCE(users.invited_by, EXCLUDED.invited_by),
                                   referral_code = COALESCE(users.referral_code, EXCLUDED.referral_code)`,
                    [from_user_id, `user_${from_user_id}`, invitedBy, referral_code]
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
        
        const [incomingRes, sentRes, answeredRes, invitedRes] = await Promise.all([
            db.query(`SELECT COUNT(*) as count FROM questions WHERE to_user_id = $1`, [userId]),
            db.query(`SELECT COUNT(*) as count FROM questions WHERE from_user_id = $1`, [userId]),
            db.query(`SELECT COUNT(*) as count FROM questions WHERE to_user_id = $1 AND is_answered = TRUE`, [userId]),
            db.query(`SELECT COUNT(*) as count FROM users WHERE invited_by = $1`, [userId])
        ]);
        
        const total = parseInt(incomingRes.rows[0].count) + parseInt(sentRes.rows[0].count);
        const received = parseInt(incomingRes.rows[0].count);
        const sent = parseInt(sentRes.rows[0].count);
        const answered = parseInt(answeredRes.rows[0].count);
        const invited = parseInt(invitedRes.rows[0].count);
        
        res.json({
            total,
            received,
            sent,
            answered,
            invited
        });
        
    } catch (error) {
        console.error('Error fetching stats:', error.message);
        res.json({
            total: 0,
            received: 0,
            sent: 0,
            answered: 0,
            invited: 0
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
    
    let invitedBy = null;
    let referralCode = null;
    
    // Проверяем реферальную ссылку
    if (ctx.startPayload && ctx.startPayload.startsWith('ref_')) {
        referralCode = ctx.startPayload.replace('ref_', '');
        
        // Находим админа по реферальному коду
        const referralResult = await db.query(
            `SELECT admin_id FROM referrals 
             WHERE referral_code = $1 AND is_active = TRUE 
             AND (max_uses IS NULL OR used_count < max_uses)`,
            [referralCode]
        );
        
        if (referralResult.rows.length > 0) {
            invitedBy = referralResult.rows[0].admin_id;
            
            // Увеличиваем счетчик использований
            await db.query(
                `UPDATE referrals SET used_count = used_count + 1 WHERE referral_code = $1`,
                [referralCode]
            );
        }
    }
    
    // Сохраняем пользователя
    try {
        await db.query(
            `INSERT INTO users (telegram_id, username, invited_by, referral_code) 
             VALUES ($1, $2, $3, $4) 
             ON CONFLICT (telegram_id) 
             DO UPDATE SET username = EXCLUDED.username, 
                           invited_by = COALESCE(users.invited_by, EXCLUDED.invited_by),
                           referral_code = COALESCE(users.referral_code, EXCLUDED.referral_code)`,
            [userId, username || `user_${userId}`, invitedBy, referralCode]
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
        
        let welcomeText = `👋 Привет, ${firstName}!\n\nЯ бот для анонимных вопросов.\n\n🔗 *Твоя персональная ссылка:*\n\`${userLink}\`\n\n📤 *Отправь эту ссылку друзьям!*\nОни смогут задать тебе вопрос *анонимно*!`;
        
        // Если пользователь админ, показываем дополнительную информацию
        const userRole = await db.query(
            `SELECT is_admin, is_super_admin FROM users WHERE telegram_id = $1`,
            [userId]
        );
        
        if (userRole.rows.length > 0 && (userRole.rows[0].is_admin || userRole.rows[0].is_super_admin)) {
            welcomeText += `\n\n🎯 *Вы являетесь администратором!*\nОткройте приложение для доступа к админ-панели.`;
        }
        
        await ctx.reply(welcomeText, {
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
        });
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

// Команда для админов
bot.command('admin', async (ctx) => {
    const userId = ctx.from.id;
    
    const userRole = await db.query(
        `SELECT is_admin, is_super_admin FROM users WHERE telegram_id = $1`,
        [userId]
    );
    
    if (userRole.rows.length === 0 || (!userRole.rows[0].is_admin && !userRole.rows[0].is_super_admin)) {
        return ctx.reply('⛔ У вас нет прав доступа к админ-панели.');
    }
    
    ctx.reply(
        `🛠️ *Админ-панель*\n\n` +
        `Вы являетесь администратором бота.\n` +
        `Для доступа к статистике и управлению откройте приложение.\n\n` +
        `*Доступные функции:*\n` +
        `📊 - Просмотр статистики\n` +
        `👥 - Управление пользователями\n` +
        `🔗 - Создание реферальных ссылок\n` +
        `👑 - Назначение админов (только для главного админа)`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[
                    {
                        text: '📱 ОТКРЫТЬ АДМИН-ПАНЕЛЬ',
                        web_app: { url: WEB_APP_URL }
                    }
                ]]
            }
        }
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