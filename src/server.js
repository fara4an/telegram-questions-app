require('dotenv').config();
const express = require('express');
const { Telegraf } = require('telegraf');
const path = require('path');
const { Client } = require('pg');
const cors = require('cors');

const app = express();
const bot = new Telegraf(process.env.BOT_TOKEN);
const WEB_APP_URL = process.env.WEB_APP_URL || 'https://ваш-проект.onrender.com';

// Конфигурация
const TELEGRAM_CHANNEL = '@questionstg'; // Твой канал
const TELEGRAM_CHANNEL_ID = -1003508121284; // Твой ID канала
const MAIN_ADMIN_ID = 781166716;

// ========== БАЗА ДАННЫХ ==========
const db = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function initDB() {
    try {
        await db.connect();
        console.log('✅ База данных подключена');
        
        // Создаем таблицы с новой структурой
        await db.query(`
            -- Таблица пользователей
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                telegram_id BIGINT UNIQUE NOT NULL,
                username VARCHAR(255),
                first_name VARCHAR(255),
                last_name VARCHAR(255),
                is_admin BOOLEAN DEFAULT FALSE,
                is_super_admin BOOLEAN DEFAULT FALSE,
                agreed_tos BOOLEAN DEFAULT FALSE,
                subscribed_channel BOOLEAN DEFAULT FALSE,
                last_check TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                invited_by BIGINT,
                referral_code VARCHAR(50),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            
            -- Таблица вопросов
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
            
            -- Таблица реферальных ссылок
            CREATE TABLE IF NOT EXISTS referrals (
                id SERIAL PRIMARY KEY,
                admin_id BIGINT NOT NULL,
                referral_code VARCHAR(50) UNIQUE NOT NULL,
                max_uses INTEGER DEFAULT 100,
                used_count INTEGER DEFAULT 0,
                is_active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            
            -- Таблица жалоб
            CREATE TABLE IF NOT EXISTS reports (
                id SERIAL PRIMARY KEY,
                reporter_id BIGINT NOT NULL,
                reported_user_id BIGINT,
                question_id INTEGER,
                reason TEXT NOT NULL,
                status VARCHAR(20) DEFAULT 'pending',
                admin_notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                resolved_at TIMESTAMP
            );
        `);
        
        console.log('✅ Таблицы созданы/проверены');
        
        // Проверяем и создаем главного админа
        await ensureMainAdmin();
        
    } catch (error) {
        console.error('❌ Ошибка БД:', error.message);
    }
}

async function ensureMainAdmin() {
    try {
        const result = await db.query(
            `SELECT * FROM users WHERE telegram_id = $1`,
            [MAIN_ADMIN_ID]
        );
        
        if (result.rows.length === 0) {
            await db.query(
                `INSERT INTO users (telegram_id, username, first_name, is_admin, is_super_admin, agreed_tos, subscribed_channel) 
                 VALUES ($1, $2, $3, TRUE, TRUE, TRUE, TRUE)`,
                [MAIN_ADMIN_ID, 'zxc4an', 'Admin', true, true, true, true]
            );
            console.log('✅ Главный админ создан');
        }
    } catch (error) {
        console.error('❌ Ошибка создания главного админа:', error.message);
    }
}

// ========== ПОЛЬЗОВАТЕЛЬСКИЕ ФУНКЦИИ ==========

// Проверка подписки на канал
async function checkChannelSubscription(userId) {
    try {
        const member = await bot.telegram.getChatMember(TELEGRAM_CHANNEL_ID, userId);
        const isSubscribed = member.status === 'member' || member.status === 'administrator' || member.status === 'creator';
        
        // Обновляем статус в БД
        await db.query(
            `UPDATE users SET subscribed_channel = $1, last_check = CURRENT_TIMESTAMP WHERE telegram_id = $2`,
            [isSubscribed, userId]
        );
        
        return isSubscribed;
    } catch (error) {
        console.error('Ошибка проверки подписки:', error.message);
        await db.query(
            `UPDATE users SET subscribed_channel = FALSE, last_check = CURRENT_TIMESTAMP WHERE telegram_id = $1`,
            [userId]
        );
        return false;
    }
}

// Проверка согласия с TOS
async function checkTOSAgreement(userId) {
    try {
        const result = await db.query(
            `SELECT agreed_tos FROM users WHERE telegram_id = $1`,
            [userId]
        );
        
        if (result.rows.length === 0) {
            // Создаем нового пользователя
            await db.query(
                `INSERT INTO users (telegram_id, agreed_tos, subscribed_channel) VALUES ($1, FALSE, FALSE)`,
                [userId]
            );
            return false;
        }
        
        return result.rows[0].agreed_tos;
    } catch (error) {
        console.error('Ошибка проверки TOS:', error.message);
        return false;
    }
}

// Проверка доступа пользователя
async function verifyUserAccess(userId) {
    const [isSubscribed, agreedTOS] = await Promise.all([
        checkChannelSubscription(userId),
        checkTOSAgreement(userId)
    ]);
    
    return { isSubscribed, agreedTOS };
}

// Сохранение пользователя
async function saveUser(user) {
    try {
        await db.query(`
            INSERT INTO users (telegram_id, username, first_name, last_name) 
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (telegram_id) 
            DO UPDATE SET 
                username = EXCLUDED.username,
                first_name = EXCLUDED.first_name,
                last_name = EXCLUDED.last_name,
                last_check = CURRENT_TIMESTAMP
        `, [user.id, user.username, user.first_name, user.last_name]);
    } catch (error) {
        console.error('Ошибка сохранения пользователя:', error.message);
    }
}

// ========== МИДЛВАРЫ ==========
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// ========== АДМИН API ==========

// Получить статистику для админа
app.get('/api/admin/stats', async (req, res) => {
    try {
        const userId = req.query.userId;
        
        if (!userId) {
            return res.status(400).json({ error: 'Не указан userId' });
        }
        
        // Проверяем права
        const result = await db.query(
            `SELECT is_super_admin, is_admin FROM users WHERE telegram_id = $1`,
            [userId]
        );
        
        if (result.rows.length === 0 || (!result.rows[0].is_super_admin && !result.rows[0].is_admin)) {
            return res.status(403).json({ error: 'Доступ запрещен' });
        }
        
        // Общая статистика
        const [totalUsers, totalQuestions, answeredQuestions, activeToday, reportsStats] = await Promise.all([
            db.query(`SELECT COUNT(*) as count FROM users`),
            db.query(`SELECT COUNT(*) as count FROM questions`),
            db.query(`SELECT COUNT(*) as count FROM questions WHERE is_answered = TRUE`),
            db.query(`SELECT COUNT(DISTINCT from_user_id) as count FROM questions WHERE created_at >= CURRENT_DATE`),
            db.query(`SELECT status, COUNT(*) as count FROM reports GROUP BY status`)
        ]);
        
        res.json({
            success: true,
            stats: {
                totalUsers: parseInt(totalUsers.rows[0].count),
                totalQuestions: parseInt(totalQuestions.rows[0].count),
                answeredQuestions: parseInt(answeredQuestions.rows[0].count),
                activeToday: parseInt(activeToday.rows[0].count),
                reports: reportsStats.rows
            }
        });
        
    } catch (error) {
        console.error('Error fetching admin stats:', error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Получить жалобы
app.get('/api/admin/reports', async (req, res) => {
    try {
        const userId = req.query.userId;
        
        if (!userId) {
            return res.status(400).json({ error: 'Не указан userId' });
        }
        
        // Проверяем права админа
        const result = await db.query(
            `SELECT is_super_admin, is_admin FROM users WHERE telegram_id = $1`,
            [userId]
        );
        
        if (result.rows.length === 0 || (!result.rows[0].is_super_admin && !result.rows[0].is_admin)) {
            return res.status(403).json({ error: 'Доступ запрещен' });
        }
        
        const reports = await db.query(`
            SELECT r.*, 
                   u1.username as reporter_username,
                   u2.username as reported_username
            FROM reports r
            LEFT JOIN users u1 ON r.reporter_id = u1.telegram_id
            LEFT JOIN users u2 ON r.reported_user_id = u2.telegram_id
            ORDER BY r.created_at DESC
            LIMIT 50
        `);
        
        res.json({
            success: true,
            reports: reports.rows
        });
        
    } catch (error) {
        console.error('Error fetching reports:', error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Обработать жалобу
app.post('/api/admin/reports/:id/process', async (req, res) => {
    try {
        const { userId, action, notes } = req.body;
        const reportId = req.params.id;
        
        if (!userId || !action) {
            return res.status(400).json({ error: 'Не указаны параметры' });
        }
        
        // Проверяем права админа
        const result = await db.query(
            `SELECT is_super_admin, is_admin FROM users WHERE telegram_id = $1`,
            [userId]
        );
        
        if (result.rows.length === 0 || (!result.rows[0].is_super_admin && !result.rows[0].is_admin)) {
            return res.status(403).json({ error: 'Доступ запрещен' });
        }
        
        // Обновляем статус жалобы
        await db.query(
            `UPDATE reports SET status = $1, admin_notes = $2, resolved_at = CURRENT_TIMESTAMP WHERE id = $3`,
            [action, notes, reportId]
        );
        
        res.json({
            success: true,
            message: 'Жалоба обработана'
        });
        
    } catch (error) {
        console.error('Error processing report:', error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ========== ПОЛЬЗОВАТЕЛЬСКИЕ API ==========

// Проверить доступ пользователя
app.get('/api/user/access/:userId', async (req, res) => {
    try {
        const userId = req.params.userId;
        const access = await verifyUserAccess(userId);
        
        // Получаем данные пользователя
        const userResult = await db.query(
            `SELECT username, first_name, agreed_tos, subscribed_channel FROM users WHERE telegram_id = $1`,
            [userId]
        );
        
        const userData = userResult.rows.length > 0 ? userResult.rows[0] : {
            username: null,
            first_name: null,
            agreed_tos: false,
            subscribed_channel: false
        };
        
        res.json({
            ...access,
            user: userData
        });
        
    } catch (error) {
        console.error('Error checking user access:', error.message);
        res.json({
            isSubscribed: false,
            agreedTOS: false,
            user: {
                username: null,
                first_name: null,
                agreed_tos: false,
                subscribed_channel: false
            }
        });
    }
});

// Принять пользовательское соглашение
app.post('/api/user/agree-tos', async (req, res) => {
    try {
        const { userId } = req.body;
        
        if (!userId) {
            return res.status(400).json({ error: 'Не указан userId' });
        }
        
        await db.query(
            `UPDATE users SET agreed_tos = TRUE WHERE telegram_id = $1`,
            [userId]
        );
        
        res.json({
            success: true,
            message: 'Пользовательское соглашение принято'
        });
        
    } catch (error) {
        console.error('Error agreeing to TOS:', error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Отправить жалобу
app.post('/api/user/report', async (req, res) => {
    try {
        const { userId, reportedUserId, questionId, reason } = req.body;
        
        if (!userId || !reason) {
            return res.status(400).json({ error: 'Не указаны обязательные параметры' });
        }
        
        // Проверяем, может ли пользователь отправлять жалобы
        const access = await verifyUserAccess(userId);
        if (!access.isSubscribed || !access.agreedTOS) {
            return res.status(403).json({ error: 'Доступ запрещен. Проверьте подписку и соглашение.' });
        }
        
        // Сохраняем жалобу
        const result = await db.query(`
            INSERT INTO reports (reporter_id, reported_user_id, question_id, reason) 
            VALUES ($1, $2, $3, $4) 
            RETURNING id
        `, [userId, reportedUserId || null, questionId || null, reason]);
        
        // Уведомляем админов
        const admins = await db.query(
            `SELECT telegram_id FROM users WHERE is_admin = TRUE OR is_super_admin = TRUE`
        );
        
        for (const admin of admins.rows) {
            try {
                await bot.telegram.sendMessage(admin.telegram_id,
                    `⚠️ *Новая жалоба #${result.rows[0].id}*\n\n` +
                    `👤 Отправитель: ${userId}\n` +
                    `👥 На пользователя: ${reportedUserId || 'не указан'}\n` +
                    `📝 Вопрос: ${questionId || 'не указан'}\n` +
                    `📄 Причина: ${reason}\n\n` +
                    `🕐 ${new Date().toLocaleString()}`,
                    { parse_mode: 'Markdown' }
                );
            } catch (error) {
                console.error('Ошибка уведомления админа:', error.message);
            }
        }
        
        res.json({
            success: true,
            reportId: result.rows[0].id,
            message: 'Жалоба отправлена на рассмотрение'
        });
        
    } catch (error) {
        console.error('Error submitting report:', error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Получить пользовательское соглашение
app.get('/api/tos', (req, res) => {
    res.json({
        title: 'Пользовательское соглашение',
        content: `
            1. Общие положения
            1.1. Настоящее Пользовательское соглашение регулирует отношения между вами и ботом «Анонимные вопросы».
            
            2. Условия использования
            2.1. Для использования бота необходимо:
            - Быть старше 16 лет
            - Подписаться на канал @questionstg
            - Принять настоящее соглашение
            
            3. Обязанности пользователя
            3.1. Запрещается:
            - Отправлять угрозы, оскорбления
            - Распространять незаконный контент
            - Нарушать права других пользователей
            
            4. Конфиденциальность
            4.1. Ваши данные защищены и не передаются третьим лицам.
            
            5. Ответственность
            5.1. Вы несете ответственность за отправляемый контент.
            
            Полная версия доступна в боте по команде /fulltos
        `,
        version: '1.0',
        date: '2024-12-23'
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

// Сделать пользователя админом
app.post('/api/admin/make-admin', async (req, res) => {
    try {
        const { userId, targetUserId } = req.body;
        
        if (!userId || !targetUserId) {
            return res.status(400).json({ error: 'Не указаны параметры' });
        }
        
        // Проверяем что только супер-админ может создавать админов
        const result = await db.query(
            `SELECT is_super_admin FROM users WHERE telegram_id = $1`,
            [userId]
        );
        if (result.rows.length === 0 || !result.rows[0].is_super_admin) {
            return res.status(403).json({ error: 'Только главный админ может создавать админов' });
        }
        
        // Делаем пользователя админом
        await db.query(
            `UPDATE users SET is_admin = TRUE WHERE telegram_id = $1`,
            [targetUserId]
        );
        
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
        const result = await db.query(
            `SELECT is_admin, is_super_admin FROM users WHERE telegram_id = $1`,
            [userId]
        );
        
        if (result.rows.length === 0 || (!result.rows[0].is_admin && !result.rows[0].is_super_admin)) {
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

function generateReferralCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 8; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

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
        try {
            const questionText = question.text.length > 80 ? 
                question.text.substring(0, 80) + '...' : question.text;
            
            await bot.telegram.sendMessage(to_user_id,
                `📥 *Новый анонимный вопрос!*\n\n` +
                `💬 *Вопрос:*\n"${questionText}"\n\n` +
                `👇 *Открой приложение, чтобы ответить:*`,
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [[
                            {
                                text: '📱 ОТКРЫТЬ ПРИЛОЖЕНИЕ',
                                web_app: { url: WEB_APP_URL }
                            }
                        ]]
                    }
                }
            );
        } catch (error) {
            console.error('Ошибка отправки уведомления:', error.message);
        }
        
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
        if (question.from_user_id) {
            try {
                const questionText = question.text.length > 60 ? 
                    question.text.substring(0, 60) + '...' : question.text;
                
                await bot.telegram.sendMessage(question.from_user_id,
                    `💬 *На твой вопрос ответили!*\n\n` +
                    `📌 *Твой вопрос:*\n"${questionText}"\n\n` +
                    `👇 *Загляни в приложение, чтобы увидеть ответ!*`,
                    {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [[
                                {
                                    text: '📱 ОТКРЫТЬ ПРИЛОЖЕНИЕ',
                                    web_app: { url: WEB_APP_URL }
                                }
                            ]]
                        }
                    }
                );
            } catch (error) {
                console.error('Ошибка отправки уведомления:', error.message);
            }
        }
        
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

// ШЕРИНГ ответа в чат
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
        const botInfo = await bot.telegram.getMe();
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
            console.error('❌ Ошибка отправки:', sendError.message);
            return res.status(500).json({ 
                error: 'Не удалось отправить сообщение в Telegram'
            });
        }
        
    } catch (error) {
        console.error('❌ Критическая ошибка шеринга:', error.message);
        res.status(500).json({ 
            error: 'Failed to share to chat',
            details: error.message 
        });
    }
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        service: 'Telegram Questions API'
    });
});

// ========== TELEGRAM BOT ==========
app.post(`/bot${process.env.BOT_TOKEN}`, (req, res) => {
    bot.handleUpdate(req.body, res);
});

// Middleware для проверки доступа
bot.use(async (ctx, next) => {
    // Пропускаем команды /start, /help, /tos, /report, /fulltos без проверки
    const allowedCommands = ['start', 'help', 'tos', 'report', 'fulltos'];
    const command = ctx.message?.text?.split(' ')[0]?.replace('/', '');
    
    if (allowedCommands.includes(command)) {
        return next();
    }
    
    // Для всех других команд проверяем доступ
    const userId = ctx.from.id;
    const access = await verifyUserAccess(userId);
    
    if (!access.isSubscribed) {
        await ctx.reply(
            `❌ *Доступ ограничен*\n\n` +
            `Для использования бота необходимо подписаться на канал:\n` +
            `@questionstg\n\n` +
            `После подписки отправьте команду /start`,
            { parse_mode: 'Markdown' }
        );
        return;
    }
    
    if (!access.agreedTOS) {
        await ctx.reply(
            `📝 *Требуется подтверждение*\n\n` +
            `Для использования бота необходимо принять Пользовательское соглашение.\n\n` +
            `Отправьте команду /tos для ознакомления и подтверждения.`,
            { parse_mode: 'Markdown' }
        );
        return;
    }
    
    next();
});

// Команда /start
bot.start(async (ctx) => {
    const userId = ctx.from.id;
    const firstName = ctx.from.first_name || 'пользователь';
    
    // Сохраняем пользователя
    await saveUser(ctx.from);
    
    // Проверяем доступ
    const access = await verifyUserAccess(userId);
    
    // Если кто-то перешел по ссылке для вопроса
    if (ctx.startPayload && ctx.startPayload.startsWith('ask_')) {
        const targetUserId = ctx.startPayload.replace('ask_', '');
        
        // Проверяем доступ спрашивающего
        if (!access.isSubscribed) {
            await ctx.reply(
                `👋 *${firstName}, привет!*\n\n` +
                `Ты перешёл по ссылке, чтобы задать *анонимный вопрос*.\n\n` +
                `📢 *Для отправки вопросов необходимо:*\n` +
                `1. Подписаться на наш канал:\n` +
                `@questionstg\n\n` +
                `2. После подписки нажми кнопку ниже 👇`,
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [
                                {
                                    text: '✅ Я подписался',
                                    callback_data: 'check_subscription_ask'
                                }
                            ],
                            [
                                {
                                    text: '📢 Перейти в канал',
                                    url: `https://t.me/questionstg`
                                }
                            ]
                        ]
                    }
                }
            );
            return;
        }
        
        if (!access.agreedTOS) {
            await ctx.reply(
                `✅ *Отлично! Вы подписаны на канал.*\n\n` +
                `📝 *Последний шаг:*\n` +
                `Для отправки вопросов необходимо принять Пользовательское соглашение.\n\n` +
                `Это важно для защиты ваших прав и прав других пользователей.`,
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [
                                {
                                    text: '📄 Ознакомиться с соглашением',
                                    callback_data: 'show_tos_ask'
                                }
                            ]
                        ]
                    }
                }
            );
            return;
        }
        
        // Если все проверки пройдены
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
        
    } else if (ctx.startPayload && ctx.startPayload.startsWith('ref_')) {
        // Реферальная ссылка
        const referralCode = ctx.startPayload.replace('ref_', '');
        
        await ctx.reply(
            `👋 *${firstName}, привет!*\n\n` +
            `Ты перешёл по реферальной ссылке.\n\n` +
            `📢 *Для начала использования:*\n` +
            `1. Подпишитесь на наш канал:\n` +
            `@questionstg\n\n` +
            `2. Примите Пользовательское соглашение\n\n` +
            `После этого ты получишь доступ ко всем функциям бота!`,
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [
                            {
                                text: '✅ Я подписался',
                                callback_data: 'check_subscription'
                            }
                        ],
                        [
                            {
                                text: '📢 Перейти в канал',
                                url: `https://t.me/questionstg`
                            }
                        ]
                    ]
                }
            }
        );
        
    } else {
        // Обычный старт
        // Если пользователь не подписан на канал
        if (!access.isSubscribed) {
            await ctx.reply(
                `👋 *Привет, ${firstName}!*\n\n` +
                `Добро пожаловать в бот «Анонимные вопросы»!\n\n` +
                `📢 *Для начала использования:*\n` +
                `1. Подпишитесь на наш канал:\n` +
                `@questionstg\n\n` +
                `2. После подписки нажмите кнопку ниже 👇\n\n` +
                `📄 Затем вам нужно будет принять Пользовательское соглашение.`,
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [
                                {
                                    text: '✅ Я подписался',
                                    callback_data: 'check_subscription'
                                }
                            ],
                            [
                                {
                                    text: '📢 Перейти в канал',
                                    url: `https://t.me/questionstg`
                                }
                            ]
                        ]
                    }
                }
            );
            return;
        }
        
        // Если пользователь не принял соглашение
        if (!access.agreedTOS) {
            await ctx.reply(
                `✅ *Отлично! Вы подписаны на канал.*\n\n` +
                `📝 *Последний шаг:*\n` +
                `Для использования бота необходимо принять Пользовательское соглашение.\n\n` +
                `Это важно для защиты ваших прав и прав других пользователей.`,
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [
                                {
                                    text: '📄 Ознакомиться с соглашением',
                                    callback_data: 'show_tos'
                                }
                            ]
                        ]
                    }
                }
            );
            return;
        }
        
        // Если все проверки пройдены
        const userLink = `https://t.me/${ctx.botInfo.username}?start=ask_${userId}`;
        
        await ctx.reply(
            `🎉 *Добро пожаловать, ${firstName}!*\n\n` +
            `✅ Вы успешно прошли все проверки.\n\n` +
            `🔗 *Ваша персональная ссылка для вопросов:*\n\`${userLink}\`\n\n` +
            `📤 *Поделитесь ссылкой с друзьями,* чтобы получать анонимные вопросы!`,
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

// Команда /tos
bot.command('tos', async (ctx) => {
    const userId = ctx.from.id;
    
    // Проверяем, принял ли пользователь уже соглашение
    const access = await verifyUserAccess(userId);
    
    if (access.agreedTOS) {
        await ctx.reply(
            `✅ *Вы уже приняли Пользовательское соглашение.*\n\n` +
            `Для просмотра полной версии отправьте команду /fulltos\n\n` +
            `📱 *Для работы с вопросами откройте приложение:*`,
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[
                        {
                            text: '📱 ОТКРЫТЬ ПРИЛОЖЕНИЕ',
                            web_app: { url: WEB_APP_URL }
                        }
                    ]]
                }
            }
        );
        return;
    }
    
    // Если не принял - показываем соглашение
    await ctx.reply(
        `📝 *ПОЛЬЗОВАТЕЛЬСКОЕ СОГЛАШЕНИЕ*\n\n` +
        `Пожалуйста, внимательно ознакомьтесь с условиями использования бота:\n\n` +
        `✅ *Основные правила:*\n` +
        `• Вам должно быть 16 лет или больше\n` +
        `• Запрещены угрозы, оскорбления, спам\n` +
        `• Вы несете ответственность за свой контент\n` +
        `• Анонимность отправителей защищена\n\n` +
        `📢 *Обязательное условие:*\n` +
        `• Подписка на канал @questionstg\n\n` +
        `*Продолжая использование, вы соглашаетесь с условиями.*`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [
                        {
                            text: '✅ ПРИНЯТЬ СОГЛАШЕНИЕ',
                            callback_data: 'accept_tos'
                        }
                    ],
                    [
                        {
                            text: '📄 ПОЛНАЯ ВЕРСИЯ',
                            callback_data: 'full_tos'
                        }
                    ],
                    [
                        {
                            text: '❌ ОТКЛОНИТЬ',
                            callback_data: 'reject_tos'
                        }
                    ]
                ]
            }
        }
    );
});

// Команда /fulltos
bot.command('fulltos', async (ctx) => {
    await ctx.reply(
        `📚 *ПОЛНОЕ ПОЛЬЗОВАТЕЛЬСКОЕ СОГЛАШЕНИЕ*\n\n` +
        `1. *ОБЩИЕ ПОЛОЖЕНИЯ*\n` +
        `1.1. Бот «Анонимные вопросы» предоставляет услуги по обмену анонимными вопросами.\n` +
        `1.2. Используя бота, вы подтверждаете, что вам исполнилось 16 лет.\n\n` +
        `2. *УСЛОВИЯ ИСПОЛЬЗОВАНИЯ*\n` +
        `2.1. Для доступа к функциям бота необходимо:\n` +
        `• Подписаться на канал @questionstg\n` +
        `• Принять настоящее соглашение\n` +
        `2.2. Подписка на канал проверяется регулярно.\n\n` +
        `3. *ОГРАНИЧЕНИЯ*\n` +
        `3.1. Запрещено:\n` +
        `• Отправлять угрозы, оскорбления\n` +
        `• Распространять незаконный контент\n` +
        `• Спамить или рекламировать\n` +
        `• Нарушать права других\n` +
        `3.2. За нарушения доступ может быть ограничен.\n\n` +
        `4. *КОНФИДЕНЦИАЛЬНОСТЬ*\n` +
        `4.1. Ваши данные защищены.\n` +
        `4.2. Анонимность отправителей гарантируется.\n\n` +
        `5. *ОТВЕТСТВЕННОСТЬ*\n` +
        `5.1. Вы отвечаете за отправляемый контент.\n` +
        `5.2. Администрация не несет ответственности за вопросы пользователей.\n\n` +
        `6. *ЖАЛОБЫ*\n` +
        `6.1. Для жалоб используйте /report\n` +
        `6.2. Жалобы рассматриваются в течение 72 часов.\n\n` +
        `📅 *Дата вступления в силу: 23.12.2024*\n\n` +
        `Для подтверждения соглашения отправьте /tos`,
        { parse_mode: 'Markdown' }
    );
});

// Команда /report
bot.command('report', async (ctx) => {
    const userId = ctx.from.id;
    
    // Проверяем доступ
    const access = await verifyUserAccess(userId);
    if (!access.isSubscribed || !access.agreedTOS) {
        await ctx.reply(
            `❌ *Доступ запрещен*\n\n` +
            `Для отправки жалоб необходимо:\n` +
            `1. Подписаться на канал @questionstg\n` +
            `2. Принять Пользовательское соглашение\n\n` +
            `Отправьте /start для проверки доступа.`,
            { parse_mode: 'Markdown' }
        );
        return;
    }
    
    await ctx.reply(
        `📢 *СИСТЕМА ЖАЛОБ*\n\n` +
        `Используйте эту команду для сообщения о нарушениях.\n\n` +
        `*Как отправить жалобу:*\n` +
        `1. Отправьте команду /report\n` +
        `2. В следующем сообщении укажите:\n` +
        `   • ID пользователя (если знаете)\n` +
        `   • ID вопроса (если есть)\n` +
        `   • Подробное описание нарушения\n\n` +
        `*Пример:*\n` +
        `Пользователь 123456 прислал угрозы в вопросе #789\`\n\n` +
        `⚠️ *Важно:*\n` +
        `• Не отправляйте личные данные\n` +
        `• Ложные жалобы наказываются\n` +
        `• Рассмотрение - до 72 часов\n\n` +
        `📱 *Для удобства можно использовать приложение,* там есть специальная форма для жалоб.`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[
                    {
                        text: '📱 ОТКРЫТЬ ПРИЛОЖЕНИЕ',
                        web_app: { url: WEB_APP_URL }
                    }
                ]]
            }
        }
    );
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

// Команда /help
bot.command('help', (ctx) => {
    ctx.replyWithMarkdown(
        `🆘 *ПОМОЩЬ*\n\n` +
        `*Основные команды:*\n` +
        `/start - Начать работу с ботом\n` +
        `/app - Открыть веб-приложение\n` +
        `/tos - Пользовательское соглашение\n` +
        `/report - Отправить жалобу\n` +
        `/help - Эта справка\n\n` +
        `*Частые вопросы:*\n` +
        `❓ *Как получить свою ссылку?*\n` +
        `Отправьте /start и пройдите проверки\n\n` +
        `❓ *Почему бот не отвечает?*\n` +
        `1. Проверьте подписку на канал @questionstg\n` +
        `2. Примите соглашение командой /tos\n\n` +
        `❓ *Как задать вопрос?*\n` +
        `Перейдите по ссылке друга и нажмите "Написать вопрос"\n\n` +
        `📞 *Поддержка:*\n` +
        `Для сложных вопросов используйте команду /report`
    );
});

// Команда /app
bot.command('app', async (ctx) => {
    const userId = ctx.from.id;
    
    // Проверяем доступ
    const access = await verifyUserAccess(userId);
    
    if (!access.isSubscribed) {
        await ctx.reply(
            `❌ *Доступ к приложению ограничен*\n\n` +
            `Для использования приложения необходимо подписаться на канал:\n` +
            `@questionstg\n\n` +
            `После подписки отправьте /start`,
            { parse_mode: 'Markdown' }
        );
        return;
    }
    
    if (!access.agreedTOS) {
        await ctx.reply(
            `❌ *Требуется подтверждение*\n\n` +
            `Для использования приложения необходимо принять Пользовательское соглашение.\n\n` +
            `Отправьте команду /tos`,
            { parse_mode: 'Markdown' }
        );
        return;
    }
    
    await ctx.reply('Нажмите кнопку ниже, чтобы открыть приложение:', {
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

// Обработка callback-кнопок
bot.on('callback_query', async (ctx) => {
    const callbackData = ctx.callbackQuery.data;
    const userId = ctx.from.id;
    const messageId = ctx.callbackQuery.message?.message_id;
    
    try {
        await ctx.answerCbQuery();
        
        switch (callbackData) {
            case 'check_subscription':
            case 'check_subscription_ask':
                const isSubscribed = await checkChannelSubscription(userId);
                
                if (isSubscribed) {
                    await ctx.editMessageText(
                        `✅ *Отлично! Вы подписаны на канал.*\n\n` +
                        `📝 *Следующий шаг:*\n` +
                        `Ознакомьтесь с Пользовательским соглашением и примите его.`,
                        {
                            parse_mode: 'Markdown',
                            reply_markup: {
                                inline_keyboard: [[
                                    {
                                        text: '📄 ОЗНАКОМИТЬСЯ С СОГЛАШЕНИЕМ',
                                        callback_data: callbackData === 'check_subscription_ask' ? 'show_tos_ask' : 'show_tos'
                                    }
                                ]]
                            }
                        }
                    );
                } else {
                    await ctx.editMessageText(
                        `❌ *Подписка не обнаружена*\n\n` +
                        `Пожалуйста, подпишитесь на канал:\n` +
                        `@questionstg\n\n` +
                        `И нажмите кнопку "✅ Я подписался" снова.`,
                        {
                            parse_mode: 'Markdown',
                            reply_markup: {
                                inline_keyboard: [
                                    [
                                        {
                                            text: '🔄 ПРОВЕРИТЬ СНОВА',
                                            callback_data: callbackData
                                        }
                                    ],
                                    [
                                        {
                                            text: '📢 ПЕРЕЙТИ В КАНАЛ',
                                            url: `https://t.me/questionstg`
                                        }
                                    ]
                                ]
                            }
                        }
                    );
                }
                break;
                
            case 'show_tos':
            case 'show_tos_ask':
                await ctx.editMessageText(
                    `📝 *ПОЛЬЗОВАТЕЛЬСКОЕ СОГЛАШЕНИЕ*\n\n` +
                    `Для использования бота необходимо принять следующие условия:\n\n` +
                    `✅ *Основные правила:*\n` +
                    `• Возраст 16+\n` +
                    `• Запрещены угрозы и оскорбления\n` +
                    `• Анонимность отправителей защищена\n` +
                    `• Вы отвечаете за свой контент\n\n` +
                    `*Продолжая, вы соглашаетесь с условиями.*`,
                    {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [
                                [
                                    {
                                        text: '✅ ПРИНЯТЬ СОГЛАШЕНИЕ',
                                        callback_data: callbackData === 'show_tos_ask' ? 'accept_tos_ask' : 'accept_tos'
                                    }
                                ],
                                [
                                    {
                                        text: '📄 ПОЛНАЯ ВЕРСИЯ',
                                        callback_data: 'full_tos'
                                    }
                                ]
                            ]
                        }
                    }
                );
                break;
                
            case 'accept_tos':
            case 'accept_tos_ask':
                await db.query(
                    `UPDATE users SET agreed_tos = TRUE WHERE telegram_id = $1`,
                    [userId]
                );
                
                if (callbackData === 'accept_tos_ask') {
                    await ctx.editMessageText(
                        `🎉 *Поздравляем!*\n\n` +
                        `Вы успешно приняли Пользовательское соглашение.\n\n` +
                        `Теперь вы можете отправлять анонимные вопросы!\n\n` +
                        `Нажмите кнопку ниже, чтобы написать вопрос:`,
                        {
                            parse_mode: 'Markdown',
                            reply_markup: {
                                inline_keyboard: [[
                                    {
                                        text: '✍️ НАПИСАТЬ ВОПРОС',
                                        web_app: { 
                                            url: `${WEB_APP_URL}/ask/${ctx.callbackQuery.message?.text?.match(/ask_(\d+)/)?.[1] || ''}?from=telegram&asker=${userId}` 
                                        }
                                    }
                                ]]
                            }
                        }
                    );
                } else {
                    const userLink = `https://t.me/${ctx.botInfo.username}?start=ask_${userId}`;
                    
                    await ctx.editMessageText(
                        `🎉 *Поздравляем!*\n\n` +
                        `Вы успешно приняли Пользовательское соглашение.\n\n` +
                        `Теперь вы можете полноценно использовать бота:\n` +
                        `• Получить свою ссылку для вопросов\n` +
                        `• Отвечать на вопросы в приложении\n` +
                        `• Отправлять жалобы\n\n` +
                        `🔗 *Ваша персональная ссылка:*\n\`${userLink}\``,
                        {
                            parse_mode: 'Markdown',
                            reply_markup: {
                                inline_keyboard: [
                                    [
                                        {
                                            text: '🚀 НАЧАТЬ РАБОТУ',
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
                break;
                
            case 'full_tos':
                await ctx.editMessageText(
                    `📚 *ПОЛНАЯ ВЕРСИЯ СОГЛАШЕНИЯ*\n\n` +
                    `(Здесь полный текст соглашения...)\n\n` +
                    `Для подтверждения нажмите кнопку ниже:`,
                    {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [[
                                {
                                    text: '✅ ПРИНЯТЬ СОГЛАШЕНИЕ',
                                    callback_data: 'accept_tos'
                                }
                            ]]
                        }
                    }
                );
                break;
                
            case 'reject_tos':
                await ctx.editMessageText(
                    `😔 *Очень жаль*\n\n` +
                    `Без принятия Пользовательского соглашения использование бота невозможно.\n\n` +
                    `Если вы передумаете, просто отправьте команду /start\n\n` +
                    `Спасибо за внимание!`
                );
                break;
        }
        
    } catch (error) {
        console.error('Ошибка обработки callback:', error.message);
        await ctx.reply('❌ Произошла ошибка. Попробуйте еще раз.');
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
            console.log(`📢 Канал: @questionstg`);

            try {
                const botInfo = await bot.telegram.getMe();
                console.log(`🤖 Бот: @${botInfo.username}`);
                
                // Устанавливаем вебхук для продакшена
                if (process.env.NODE_ENV === 'production' || WEB_APP_URL.includes('render.com')) {
                    const webhookUrl = `${WEB_APP_URL}/bot${process.env.BOT_TOKEN}`;
                    await bot.telegram.setWebhook(webhookUrl);
                    console.log(`✅ Вебхук установлен: ${webhookUrl}`);
                } else {
                    await bot.launch();
                    console.log('🤖 Бот запущен через поллинг');
                }
            } catch (error) {
                console.error('❌ Ошибка запуска бота:', error.message);
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