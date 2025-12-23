require('dotenv').config();
const express = require('express');
const { Telegraf } = require('telegraf');
const path = require('path');
const { Client } = require('pg');
const cors = require('cors');

const app = express();
const bot = new Telegraf(process.env.BOT_TOKEN);
const WEB_APP_URL = process.env.WEB_APP_URL || 'https://telegram-questions-app.onrender.com';

// Конфигурация
const TELEGRAM_CHANNEL = '@questionstg';
const TELEGRAM_CHANNEL_ID = -1003508121284;
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
        
        // Создаем таблицы если они не существуют
        await db.query(`
            -- Таблица пользователей
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                telegram_id BIGINT UNIQUE NOT NULL,
                username VARCHAR(255),
                is_admin BOOLEAN DEFAULT FALSE,
                is_super_admin BOOLEAN DEFAULT FALSE,
                invited_by BIGINT,
                referral_code VARCHAR(50),
                agreed_tos BOOLEAN DEFAULT FALSE,
                subscribed_channel BOOLEAN DEFAULT FALSE,
                last_check TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                first_name VARCHAR(255),
                last_name VARCHAR(255),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                is_blocked BOOLEAN DEFAULT FALSE,
                blocked_until TIMESTAMP,
                block_reason TEXT,
                block_count INTEGER DEFAULT 0
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
                answered_at TIMESTAMP,
                is_anonymous BOOLEAN DEFAULT TRUE,
                is_deleted BOOLEAN DEFAULT FALSE,
                report_count INTEGER DEFAULT 0
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
            
            -- Таблица жалоб с причинами
            CREATE TABLE IF NOT EXISTS reports (
                id SERIAL PRIMARY KEY,
                reporter_id BIGINT NOT NULL,
                reported_user_id BIGINT,
                question_id INTEGER,
                reason VARCHAR(50) NOT NULL,
                details TEXT,
                status VARCHAR(20) DEFAULT 'pending',
                admin_id BIGINT,
                admin_notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                resolved_at TIMESTAMP,
                action_taken VARCHAR(50)
            );
            
            -- Таблица блокировок
            CREATE TABLE IF NOT EXISTS user_blocks (
                id SERIAL PRIMARY KEY,
                user_id BIGINT NOT NULL,
                admin_id BIGINT NOT NULL,
                reason VARCHAR(100) NOT NULL,
                duration_hours INTEGER,
                blocked_until TIMESTAMP,
                is_permanent BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        
        // ДОБАВЛЯЕМ КОЛОНКИ ЕСЛИ ОНИ НЕ СУЩЕСТВУЮТ
        try {
            await db.query(`
                DO $$ 
                BEGIN
                    -- Проверяем и добавляем колонки в таблицу users
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                                 WHERE table_name='users' AND column_name='is_blocked') THEN
                        ALTER TABLE users ADD COLUMN is_blocked BOOLEAN DEFAULT FALSE;
                    END IF;
                    
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                                 WHERE table_name='users' AND column_name='blocked_until') THEN
                        ALTER TABLE users ADD COLUMN blocked_until TIMESTAMP;
                    END IF;
                    
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                                 WHERE table_name='users' AND column_name='block_reason') THEN
                        ALTER TABLE users ADD COLUMN block_reason TEXT;
                    END IF;
                    
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                                 WHERE table_name='users' AND column_name='block_count') THEN
                        ALTER TABLE users ADD COLUMN block_count INTEGER DEFAULT 0;
                    END IF;
                    
                    -- Проверяем и добавляем колонки в таблицу questions
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                                 WHERE table_name='questions' AND column_name='is_deleted') THEN
                        ALTER TABLE questions ADD COLUMN is_deleted BOOLEAN DEFAULT FALSE;
                    END IF;
                    
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                                 WHERE table_name='questions' AND column_name='report_count') THEN
                        ALTER TABLE questions ADD COLUMN report_count INTEGER DEFAULT 0;
                    END IF;
                    
                    -- Проверяем и добавляем колонку details в таблицу reports
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                                 WHERE table_name='reports' AND column_name='details') THEN
                        ALTER TABLE reports ADD COLUMN details TEXT;
                    END IF;
                    
                    -- Проверяем и добавляем колонку admin_id в таблицу reports
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                                 WHERE table_name='reports' AND column_name='admin_id') THEN
                        ALTER TABLE reports ADD COLUMN admin_id BIGINT;
                    END IF;
                    
                    -- Проверяем и добавляем колонку admin_notes в таблицу reports
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                                 WHERE table_name='reports' AND column_name='admin_notes') THEN
                        ALTER TABLE reports ADD COLUMN admin_notes TEXT;
                    END IF;
                    
                    -- Проверяем и добавляем колонку action_taken в таблицу reports
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                                 WHERE table_name='reports' AND column_name='action_taken') THEN
                        ALTER TABLE reports ADD COLUMN action_taken VARCHAR(50);
                    END IF;
                END $$;
            `);
            console.log('✅ Дополнительные колонки проверены/добавлены');
        } catch (columnError) {
            console.log('ℹ️ Колонки уже существуют или ошибка:', columnError.message);
        }
        
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
                `INSERT INTO users (telegram_id, username, is_admin, is_super_admin, agreed_tos, subscribed_channel) 
                 VALUES ($1, $2, TRUE, TRUE, TRUE, TRUE)`,
                [MAIN_ADMIN_ID, 'zxc4an']
            );
            console.log('✅ Главный админ создан');
        } else {
            // Обновляем существующего админа, чтобы убедиться что он суперадмин
            await db.query(
                `UPDATE users SET is_admin = TRUE, is_super_admin = TRUE WHERE telegram_id = $1`,
                [MAIN_ADMIN_ID]
            );
        }
    } catch (error) {
        console.error('❌ Ошибка создания главного админа:', error.message);
    }
}

// ПРОВЕРКА ПОДПИСКИ НА КАНАЛ
async function checkChannelSubscription(userId) {
    try {
        console.log(`🔍 Проверяем подписку пользователя ${userId} на канал ${TELEGRAM_CHANNEL}...`);
        
        let isSubscribed = false;
        
        if (process.env.NODE_ENV === 'production') {
            try {
                const chatMember = await bot.telegram.getChatMember(TELEGRAM_CHANNEL_ID, userId);
                isSubscribed = ['member', 'administrator', 'creator'].includes(chatMember.status);
                console.log(`Статус подписки пользователя ${userId}: ${chatMember.status}`);
            } catch (error) {
                console.error('Ошибка проверки подписки через API:', error.message);
                isSubscribed = true;
            }
        } else {
            isSubscribed = true;
        }
        
        await db.query(
            `UPDATE users SET subscribed_channel = $1, last_check = CURRENT_TIMESTAMP WHERE telegram_id = $2`,
            [isSubscribed, userId]
        );
        
        console.log(`📢 Итоговый статус подписки пользователя ${userId}: ${isSubscribed}`);
        return isSubscribed;
    } catch (error) {
        console.error('Ошибка проверки подписки:', error.message);
        return false;
    }
}

async function checkTOSAgreement(userId) {
    try {
        const result = await db.query(
            `SELECT agreed_tos FROM users WHERE telegram_id = $1`,
            [userId]
        );
        
        if (result.rows.length === 0) {
            await db.query(
                `INSERT INTO users (telegram_id, agreed_tos, subscribed_channel) VALUES ($1, FALSE, FALSE)`,
                [userId]
            );
            return false;
        }
        
        return result.rows[0].agreed_tos || false;
    } catch (error) {
        console.error('Ошибка проверки TOS:', error.message);
        return false;
    }
}

async function verifyUserAccess(userId) {
    try {
        console.log(`🔐 Проверяем доступ пользователя ${userId}...`);
        
        // Создаем пользователя если не существует
        const userExists = await db.query(
            `SELECT telegram_id FROM users WHERE telegram_id = $1`,
            [userId]
        );
        
        if (userExists.rows.length === 0) {
            await db.query(
                `INSERT INTO users (telegram_id, agreed_tos, subscribed_channel) 
                 VALUES ($1, FALSE, FALSE)`,
                [userId]
            );
        }
        
        // Проверяем блокировку
        const blockedResult = await db.query(
            `SELECT is_blocked, blocked_until FROM users WHERE telegram_id = $1`,
            [userId]
        );
        
        if (blockedResult.rows.length > 0) {
            const user = blockedResult.rows[0];
            if (user.is_blocked && user.blocked_until) {
                if (new Date(user.blocked_until) > new Date()) {
                    return { 
                        isSubscribed: false, 
                        agreedTOS: false, 
                        isBlocked: true,
                        blockedUntil: user.blocked_until 
                    };
                } else {
                    // Разблокируем если время истекло
                    await db.query(
                        `UPDATE users SET is_blocked = FALSE, blocked_until = NULL WHERE telegram_id = $1`,
                        [userId]
                    );
                }
            }
        }
        
        // Проверяем подписку и TOS
        const [isSubscribed, agreedTOS] = await Promise.all([
            checkChannelSubscription(userId),
            checkTOSAgreement(userId)
        ]);
        
        return { isSubscribed, agreedTOS, isBlocked: false };
        
    } catch (error) {
        console.error('❌ Ошибка проверки доступа:', error.message);
        return { isSubscribed: false, agreedTOS: false, isBlocked: false };
    }
}

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
        `, [user.id, user.username || null, user.first_name || null, user.last_name || null]);
    } catch (error) {
        console.error('Ошибка сохранения пользователя:', error.message);
    }
}

// ========== МИДЛВАРЫ ==========
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// ========== АДМИН API ==========

// Получение роли пользователя
app.get('/api/user/role/:userId', async (req, res) => {
    try {
        const result = await db.query(
            `SELECT is_admin, is_super_admin FROM users WHERE telegram_id = $1`,
            [req.params.userId]
        );
        
        if (result.rows.length > 0) {
            res.json({
                is_admin: result.rows[0].is_admin || false,
                is_super_admin: result.rows[0].is_super_admin || false
            });
        } else {
            res.json({ is_admin: false, is_super_admin: false });
        }
    } catch (error) {
        console.error('Error fetching user role:', error.message);
        res.json({ is_admin: false, is_super_admin: false });
    }
});

// Получение списка всех пользователей
app.get('/api/admin/users', async (req, res) => {
    try {
        const adminId = req.query.adminId;
        
        if (!adminId) {
            return res.status(400).json({ error: 'Не указан ID администратора' });
        }
        
        const adminResult = await db.query(
            `SELECT is_super_admin FROM users WHERE telegram_id = $1`,
            [adminId]
        );
        
        if (adminResult.rows.length === 0 || !adminResult.rows[0].is_super_admin) {
            return res.status(403).json({ error: 'Доступ запрещен. Требуются права суперадмина.' });
        }
        
        const usersResult = await db.query(`
            SELECT 
                telegram_id,
                username,
                first_name,
                last_name,
                is_admin,
                is_super_admin,
                agreed_tos,
                subscribed_channel,
                is_blocked,
                blocked_until,
                block_reason,
                created_at
            FROM users 
            ORDER BY created_at DESC
        `);
        
        res.json({
            success: true,
            users: usersResult.rows
        });
        
    } catch (error) {
        console.error('Error fetching users:', error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Получение статистики
app.get('/api/admin/stats', async (req, res) => {
    try {
        const adminId = req.query.userId;
        
        if (!adminId) {
            return res.status(400).json({ error: 'Не указан userId' });
        }
        
        const result = await db.query(
            `SELECT is_super_admin, is_admin FROM users WHERE telegram_id = $1`,
            [adminId]
        );
        
        if (result.rows.length === 0 || (!result.rows[0].is_super_admin && !result.rows[0].is_admin)) {
            return res.status(403).json({ error: 'Доступ запрещен' });
        }
        
        const [totalUsers, totalQuestions, answeredQuestions, activeToday, blockedUsers] = await Promise.all([
            db.query(`SELECT COUNT(*) as count FROM users`),
            db.query(`SELECT COUNT(*) as count FROM questions WHERE is_deleted = FALSE`),
            db.query(`SELECT COUNT(*) as count FROM questions WHERE is_answered = TRUE AND is_deleted = FALSE`),
            db.query(`SELECT COUNT(DISTINCT from_user_id) as count FROM questions WHERE created_at >= CURRENT_DATE`),
            db.query(`SELECT COUNT(*) as count FROM users WHERE is_blocked = TRUE`)
        ]);
        
        res.json({
            success: true,
            stats: {
                totalUsers: parseInt(totalUsers.rows[0].count),
                totalQuestions: parseInt(totalQuestions.rows[0].count),
                answeredQuestions: parseInt(answeredQuestions.rows[0].count),
                activeToday: parseInt(activeToday.rows[0].count),
                blockedUsers: parseInt(blockedUsers.rows[0].count)
            }
        });
        
    } catch (error) {
        console.error('Error fetching admin stats:', error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Получение жалоб
app.get('/api/admin/reports', async (req, res) => {
    try {
        const adminId = req.query.adminId;
        
        if (!adminId) {
            return res.status(400).json({ error: 'Не указан ID администратора' });
        }
        
        const adminResult = await db.query(
            `SELECT is_super_admin, is_admin FROM users WHERE telegram_id = $1`,
            [adminId]
        );
        
        if (adminResult.rows.length === 0 || (!adminResult.rows[0].is_super_admin && !adminResult.rows[0].is_admin)) {
            return res.status(403).json({ error: 'Доступ запрещен' });
        }
        
        const reportsResult = await db.query(`
            SELECT 
                r.id,
                r.reporter_id,
                r.reported_user_id,
                r.question_id,
                r.reason,
                r.details,
                r.status,
                r.admin_id,
                r.admin_notes,
                r.created_at,
                r.resolved_at,
                r.action_taken,
                q.text as question_text,
                ru.username as reported_username,
                ru.first_name as reported_first_name,
                ru.last_name as reported_last_name,
                rep.username as reporter_username,
                rep.first_name as reporter_first_name,
                rep.last_name as reporter_last_name
            FROM reports r
            LEFT JOIN questions q ON r.question_id = q.id AND q.is_deleted = FALSE
            LEFT JOIN users ru ON r.reported_user_id = ru.telegram_id
            LEFT JOIN users rep ON r.reporter_id = rep.telegram_id
            ORDER BY r.created_at DESC
            LIMIT 50
        `);
        
        res.json({
            success: true,
            reports: reportsResult.rows
        });
        
    } catch (error) {
        console.error('Error fetching reports:', error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Блокировка пользователя
app.post('/api/admin/block-user', async (req, res) => {
    try {
        const { adminId, userId: targetUserId, durationHours, isPermanent, reason } = req.body;
        
        console.log('Блокировка пользователя:', { adminId, targetUserId, durationHours, isPermanent, reason });
        
        if (!adminId || !targetUserId || !reason) {
            return res.status(400).json({ error: 'Не указаны обязательные параметры' });
        }
        
        const adminResult = await db.query(
            `SELECT is_super_admin FROM users WHERE telegram_id = $1`,
            [adminId]
        );
        
        if (adminResult.rows.length === 0 || !adminResult.rows[0].is_super_admin) {
            return res.status(403).json({ error: 'Доступ запрещен. Требуются права суперадмина.' });
        }
        
        let blockedUntil = null;
        if (!isPermanent && durationHours) {
            blockedUntil = new Date(Date.now() + durationHours * 60 * 60 * 1000);
        }
        
        // Обновляем статус пользователя
        await db.query(`
            UPDATE users 
            SET is_blocked = TRUE, 
                blocked_until = $1,
                block_reason = $2,
                block_count = COALESCE(block_count, 0) + 1
            WHERE telegram_id = $3
        `, [blockedUntil, reason, targetUserId]);
        
        // Записываем в историю блокировок
        await db.query(`
            INSERT INTO user_blocks (user_id, admin_id, reason, duration_hours, blocked_until, is_permanent)
            VALUES ($1, $2, $3, $4, $5, $6)
        `, [targetUserId, adminId, reason, durationHours || null, blockedUntil, isPermanent || false]);
        
        // Отправляем уведомление пользователю
        try {
            const blockMessage = isPermanent ? 
                `🚫 Ваш аккаунт был заблокирован навсегда.\nПричина: ${reason}` :
                `🚫 Ваш аккаунт был заблокирован до ${blockedUntil.toLocaleString('ru-RU')}.\nПричина: ${reason}`;
            
            await bot.telegram.sendMessage(targetUserId, blockMessage);
        } catch (error) {
            console.error('Ошибка отправки уведомления о блокировке:', error.message);
        }
        
        res.json({
            success: true,
            message: 'Пользователь заблокирован'
        });
        
    } catch (error) {
        console.error('Error blocking user:', error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Разблокировка пользователя
app.post('/api/admin/unblock-user', async (req, res) => {
    try {
        const { adminId, userId: targetUserId } = req.body;
        
        if (!adminId || !targetUserId) {
            return res.status(400).json({ error: 'Не указаны обязательные параметры' });
        }
        
        const adminResult = await db.query(
            `SELECT is_super_admin FROM users WHERE telegram_id = $1`,
            [adminId]
        );
        
        if (adminResult.rows.length === 0 || !adminResult.rows[0].is_super_admin) {
            return res.status(403).json({ error: 'Доступ запрещен. Требуются права суперадмина.' });
        }
        
        await db.query(`
            UPDATE users 
            SET is_blocked = FALSE, 
                blocked_until = NULL,
                block_reason = NULL
            WHERE telegram_id = $1
        `, [targetUserId]);
        
        try {
            await bot.telegram.sendMessage(targetUserId, '✅ Ваш аккаунт был разблокирован администратором.');
        } catch (error) {
            console.error('Ошибка отправки уведомления о разблокировке:', error.message);
        }
        
        res.json({
            success: true,
            message: 'Пользователь разблокирован'
        });
        
    } catch (error) {
        console.error('Error unblocking user:', error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Удаление данных
app.post('/api/admin/delete-data', async (req, res) => {
    try {
        const { adminId, userId: targetUserId, deleteType } = req.body;
        
        console.log('Удаление данных:', { adminId, targetUserId, deleteType });
        
        if (!adminId || !targetUserId || !deleteType) {
            return res.status(400).json({ error: 'Не указаны обязательные параметры' });
        }
        
        const adminResult = await db.query(
            `SELECT is_super_admin FROM users WHERE telegram_id = $1`,
            [adminId]
        );
        
        if (adminResult.rows.length === 0 || !adminResult.rows[0].is_super_admin) {
            return res.status(403).json({ error: 'Доступ запрещен. Требуются права суперадмина.' });
        }
        
        if (deleteType === 'questions') {
            // Удаляем все вопросы пользователя
            await db.query(
                `UPDATE questions SET is_deleted = TRUE WHERE from_user_id = $1 OR to_user_id = $1`,
                [targetUserId]
            );
            // Обновляем жалобы связанные с этим пользователем
            await db.query(
                `UPDATE reports SET status = 'resolved', admin_notes = 'Данные удалены' WHERE reported_user_id = $1 OR reporter_id = $1`,
                [targetUserId]
            );
        } else if (deleteType === 'account') {
            // Удаляем все данные пользователя
            await db.query(
                `DELETE FROM questions WHERE from_user_id = $1 OR to_user_id = $1`,
                [targetUserId]
            );
            await db.query(
                `DELETE FROM reports WHERE reporter_id = $1 OR reported_user_id = $1`,
                [targetUserId]
            );
            await db.query(
                `DELETE FROM users WHERE telegram_id = $1`,
                [targetUserId]
            );
        }
        
        res.json({
            success: true,
            message: `Данные типа '${deleteType}' удалены для пользователя ${targetUserId}`
        });
        
    } catch (error) {
        console.error('Error deleting data:', error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Обновление статуса жалобы
app.post('/api/admin/update-report', async (req, res) => {
    try {
        const { adminId, reportId, status, actionTaken, adminNotes } = req.body;
        
        if (!adminId || !reportId || !status) {
            return res.status(400).json({ error: 'Не указаны обязательные параметры' });
        }
        
        const adminResult = await db.query(
            `SELECT is_super_admin, is_admin FROM users WHERE telegram_id = $1`,
            [adminId]
        );
        
        if (adminResult.rows.length === 0 || (!adminResult.rows[0].is_super_admin && !adminResult.rows[0].is_admin)) {
            return res.status(403).json({ error: 'Доступ запрещен' });
        }
        
        await db.query(`
            UPDATE reports 
            SET status = $1, 
                admin_id = $2,
                action_taken = $3,
                admin_notes = $4,
                resolved_at = CASE WHEN $1 != 'pending' THEN CURRENT_TIMESTAMP ELSE NULL END
            WHERE id = $5
        `, [status, adminId, actionTaken || null, adminNotes || null, reportId]);
        
        res.json({
            success: true,
            message: 'Статус жалобы обновлен'
        });
        
    } catch (error) {
        console.error('Error updating report:', error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ========== ПОЛЬЗОВАТЕЛЬСКИЕ API ==========

app.get('/api/user/access/:userId', async (req, res) => {
    try {
        const userId = req.params.userId;
        const access = await verifyUserAccess(userId);
        
        const userResult = await db.query(
            `SELECT username, agreed_tos, subscribed_channel, is_blocked, blocked_until FROM users WHERE telegram_id = $1`,
            [userId]
        );
        
        const userData = userResult.rows.length > 0 ? userResult.rows[0] : {
            username: null,
            agreed_tos: false,
            subscribed_channel: false,
            is_blocked: false,
            blocked_until: null
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
            isBlocked: false,
            user: {
                username: null,
                agreed_tos: false,
                subscribed_channel: false,
                is_blocked: false,
                blocked_until: null
            }
        });
    }
});

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

// Получение причин для жалоб
app.get('/api/report/reasons', (req, res) => {
    res.json({
        success: true,
        reasons: [
            { id: 'spam', label: 'Спам', description: 'Бесполезные или повторяющиеся сообщения' },
            { id: 'harassment', label: 'Оскорбления', description: 'Оскорбительные или унижающие сообщения' },
            { id: 'threats', label: 'Угрозы', description: 'Угрозы физической расправы' },
            { id: 'hate_speech', label: 'Разжигание ненависти', description: 'Призывы к насилию или дискриминация' },
            { id: 'sexual_content', label: 'Сексуальный контент', description: 'Неуместный сексуальный контент' },
            { id: 'scam', label: 'Мошенничество', description: 'Попытки обмана или выманивания денег' },
            { id: 'other', label: 'Другое', description: 'Другая причина' }
        ]
    });
});

app.post('/api/user/report', async (req, res) => {
    try {
        const { userId, reportedUserId, questionId, reason, details } = req.body;
        
        if (!userId || !reason) {
            return res.status(400).json({ error: 'Не указаны обязательные параметры' });
        }
        
        // Проверяем доступ пользователя
        const access = await verifyUserAccess(userId);
        if (!access.isSubscribed || !access.agreedTOS) {
            return res.status(403).json({ error: 'Доступ запрещен. Проверьте подписку и соглашение.' });
        }
        
        // Увеличиваем счетчик жалоб для вопроса
        if (questionId) {
            try {
                await db.query(
                    `UPDATE questions SET report_count = COALESCE(report_count, 0) + 1 WHERE id = $1`,
                    [questionId]
                );
            } catch (error) {
                console.log('Не удалось обновить счетчик жалоб:', error.message);
            }
        }
        
        // Сохраняем жалобу
        const result = await db.query(`
            INSERT INTO reports (reporter_id, reported_user_id, question_id, reason, details) 
            VALUES ($1, $2, $3, $4, $5) 
            RETURNING id
        `, [userId, reportedUserId || null, questionId || null, reason, details || null]);
        
        // Уведомляем админов
        const admins = await db.query(
            `SELECT telegram_id FROM users WHERE (is_admin = TRUE OR is_super_admin = TRUE) AND telegram_id != $1`,
            [userId]
        );
        
        const reportId = result.rows[0].id;
        
        for (const admin of admins.rows) {
            try {
                await bot.telegram.sendMessage(admin.telegram_id,
                    `⚠️ *Новая жалоба #${reportId}*\n\n` +
                    `👤 Отправитель: ${userId}\n` +
                    `👥 На пользователя: ${reportedUserId || 'не указан'}\n` +
                    `📝 Вопрос: ${questionId || 'не указан'}\n` +
                    `📋 Причина: ${reason}\n` +
                    `📄 Детали: ${details || 'не указаны'}\n\n` +
                    `🕐 ${new Date().toLocaleString()}`,
                    { parse_mode: 'Markdown' }
                );
            } catch (error) {
                console.error('Ошибка уведомления админа:', error.message);
            }
        }
        
        res.json({
            success: true,
            reportId: reportId,
            message: 'Жалоба отправлена на рассмотрение'
        });
        
    } catch (error) {
        console.error('Error submitting report:', error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ========== API ДЛЯ ВОПРОСОВ ==========

app.get('/api/questions/incoming/:userId', async (req, res) => {
    try {
        const result = await db.query(`
            SELECT 
                q.id,
                q.text,
                q.answer,
                q.is_answered,
                q.created_at,
                q.answered_at,
                q.report_count,
                -- ВСЕГДА показываем "Аноним" для входящих вопросов
                '👤 Аноним' as from_username
            FROM questions q
            WHERE q.to_user_id = $1 
            AND (q.is_deleted = FALSE OR q.is_deleted IS NULL)
            ORDER BY q.created_at DESC
        `, [req.params.userId]);
        
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching incoming questions:', error.message);
        res.json([]);
    }
});

app.get('/api/questions/sent/:userId', async (req, res) => {
    try {
        const result = await db.query(`
            SELECT 
                q.id,
                q.text,
                q.answer,
                q.is_answered,
                q.created_at,
                q.answered_at,
                q.report_count,
                CASE 
                    WHEN u.username IS NOT NULL THEN '@' || u.username
                    WHEN u.first_name IS NOT NULL THEN u.first_name
                    ELSE '👤 Пользователь'
                END as to_username,
                q.to_user_id
            FROM questions q
            LEFT JOIN users u ON q.to_user_id = u.telegram_id
            WHERE q.from_user_id = $1 
            AND (q.is_deleted = FALSE OR q.is_deleted IS NULL)
            ORDER BY q.created_at DESC
        `, [req.params.userId]);
        
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching sent questions:', error.message);
        res.json([]);
    }
});

app.get('/api/question/:id', async (req, res) => {
    try {
        const result = await db.query(`
            SELECT 
                q.id,
                q.text,
                q.answer,
                q.is_answered,
                q.created_at,
                q.answered_at,
                q.from_user_id,
                -- ВСЕГДА показываем "Аноним"
                '👤 Аноним' as from_username
            FROM questions q
            WHERE q.id = $1
            AND (q.is_deleted = FALSE OR q.is_deleted IS NULL)
        `, [req.params.id]);
        
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

app.post('/api/questions', async (req, res) => {
    try {
        const { from_user_id, to_user_id, text, referral_code } = req.body;
        
        if (!to_user_id || !text) {
            return res.status(400).json({ error: 'Не указан получатель или текст вопроса' });
        }
        
        // Проверяем доступ отправителя если он не аноним
        if (from_user_id) {
            const access = await verifyUserAccess(from_user_id);
            if (!access.isSubscribed || !access.agreedTOS) {
                return res.status(403).json({ error: 'Отправитель не имеет доступа к сервису' });
            }
        }
        
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
        
        // Сохраняем пользователя если он не аноним
        if (from_user_id) {
            try {
                await db.query(
                    `INSERT INTO users (telegram_id, invited_by, referral_code) 
                     VALUES ($1, $2, $3) 
                     ON CONFLICT (telegram_id) 
                     DO UPDATE SET invited_by = COALESCE(users.invited_by, EXCLUDED.invited_by),
                                   referral_code = COALESCE(users.referral_code, EXCLUDED.referral_code)`,
                    [from_user_id, invitedBy, referral_code]
                );
            } catch (error) {
                console.error('Ошибка сохранения отправителя:', error.message);
            }
        }
        
        // Создаем вопрос (ВСЕГДА как анонимный)
        const result = await db.query(
            `INSERT INTO questions (from_user_id, to_user_id, text, is_anonymous) 
             VALUES ($1, $2, $3, TRUE) RETURNING id, text, created_at, is_anonymous`,
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
            question: question,
            message: 'Вопрос успешно отправлен'
        });
        
    } catch (error) {
        console.error('Error creating question:', error.message);
        res.status(500).json({ 
            error: 'Internal server error',
            details: error.message 
        });
    }
});

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
        
        // Уведомляем отправителя если он не аноним
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

app.delete('/api/questions/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const result = await db.query(
            `UPDATE questions SET is_deleted = TRUE WHERE id = $1 RETURNING *`,
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

app.get('/api/stats/:userId', async (req, res) => {
    try {
        const userId = req.params.userId;
        
        const [incomingRes, sentRes, answeredRes, invitedRes] = await Promise.all([
            db.query(`SELECT COUNT(*) as count FROM questions WHERE to_user_id = $1 AND (is_deleted = FALSE OR is_deleted IS NULL)`, [userId]),
            db.query(`SELECT COUNT(*) as count FROM questions WHERE from_user_id = $1 AND (is_deleted = FALSE OR is_deleted IS NULL)`, [userId]),
            db.query(`SELECT COUNT(*) as count FROM questions WHERE to_user_id = $1 AND is_answered = TRUE AND (is_deleted = FALSE OR is_deleted IS NULL)`, [userId]),
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

// ОБНОВЛЕННАЯ ФУНКЦИЯ: отправка полных вопросов и ответов в чат
app.post('/api/share-to-chat', async (req, res) => {
    try {
        const { userId, questionId } = req.body;
        if (!userId || !questionId) {
            return res.status(400).json({ error: 'Не указаны параметры' });
        }

        const questionResult = await db.query(`
            SELECT q.* 
            FROM questions q
            WHERE q.id = $1 AND q.to_user_id = $2 AND q.is_answered = TRUE AND (q.is_deleted = FALSE OR q.is_deleted IS NULL)`,
            [questionId, userId]
        );
        
        if (questionResult.rows.length === 0) {
            return res.status(404).json({ error: 'Вопрос не найден или нет ответа' });
        }
        
        const question = questionResult.rows[0];
        const botInfo = await bot.telegram.getMe();
        const userLink = `https://t.me/${botInfo.username}?start=ask_${userId}`;
        
        // ИЗМЕНЕНИЕ: Отправляем полный текст вопроса и ответа (без обрезания)
        const messageText = `🎯 *Мой ответ на анонимный вопрос!*\n\n` +
                           `💬 *Вопрос:*\n"${question.text}"\n\n` +
                           `💡 *Мой ответ:*\n"${question.answer}"\n\n` +
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

// БОТ С ПРОВЕРКОЙ ДОСТУПА
bot.start(async (ctx) => {
    const userId = ctx.from.id;
    const firstName = ctx.from.first_name || 'пользователь';
    
    await saveUser(ctx.from);
    
    if (ctx.startPayload && ctx.startPayload.startsWith('ask_')) {
        const targetUserId = ctx.startPayload.replace('ask_', '');
        
        // Проверяем доступ пользователя
        const access = await verifyUserAccess(userId);
        
        if (!access.isSubscribed) {
            await ctx.reply(
                `👋 *${firstName}, привет!*\n\n` +
                `Чтобы задать анонимный вопрос, нужно подписаться на наш канал:\n\n` +
                `📢 ${TELEGRAM_CHANNEL}\n\n` +
                `После подписки нажми /start`,
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [[
                            {
                                text: '📢 Подписаться на канал',
                                url: `https://t.me/questionstg`
                            }
                        ]]
                    }
                }
            );
            return;
        }
        
        if (!access.agreedTOS) {
            await ctx.reply(
                `👋 *${firstName}, привет!*\n\n` +
                `Для отправки вопросов необходимо принять Пользовательское соглашение.\n\n` +
                `Нажмите кнопку ниже, чтобы ознакомиться и принять:`,
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [[
                            {
                                text: '📝 Принять соглашение',
                                callback_data: 'accept_tos'
                            }
                        ]]
                    }
                }
            );
            return;
        }
        
        // Если доступ есть - показываем форму
        await ctx.reply(
            `👋 *${firstName}, привет!*\n\n` +
            `Ты перешёл по ссылке, чтобы задать *анонимный вопрос*.\n\n` +
            `Нажми кнопку ниже 👇 чтобы *сразу открыть форму* для вопроса:`,
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
        // Обычный старт
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

// Обработчик принятия TOS
bot.action('accept_tos', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        await db.query(
            `UPDATE users SET agreed_tos = TRUE WHERE telegram_id = $1`,
            [ctx.from.id]
        );
        
        await ctx.reply(
            `✅ *Пользовательское соглашение принято!*\n\n` +
            `Теперь вы можете задавать вопросы. Нажмите /start для продолжения.`,
            { parse_mode: 'Markdown' }
        );
    } catch (error) {
        console.error('Ошибка принятия TOS:', error.message);
        await ctx.answerCbQuery('❌ Ошибка, попробуйте позже');
    }
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

bot.command('help', (ctx) => {
    ctx.replyWithMarkdown(
        `🆘 *ПОМОЩЬ*\n\n` +
        `*Основные команды:*\n` +
        `/start - Начать работу с ботом\n` +
        `/app - Открыть веб-приложение\n` +
        `/help - Эта справка\n\n` +
        `*Как это работает:*\n` +
        `1. Получите свою ссылку командой /start\n` +
        `2. Отправьте ссылку друзьям\n` +
        `3. Друзья могут задать вам анонимные вопросы\n` +
        `4. Отвечайте на вопросы в приложении\n\n` +
        `*🔗 Пример вашей ссылки:*\n` +
        `\`https://t.me/questionstgbot?start=ask_123456\``
    );
});

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
        `- Ты *узнаешь*, ответил ли он\n` +
        `- Можно задавать сколько угодно вопросов`,
        { parse_mode: 'Markdown' }
    );
});

app.get('/ask/:userId', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/ask.html'));
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

const PORT = process.env.PORT || 3000;

async function startServer() {
    try {
        await initDB();

        app.listen(PORT, async () => {
            console.log(`🚀 Сервер запущен на порту ${PORT}`);
            console.log(`🌐 Web App URL: ${WEB_APP_URL}`);
            console.log(`📢 Канал: ${TELEGRAM_CHANNEL}`);

            try {
                const botInfo = await bot.telegram.getMe();
                console.log(`🤖 Бот: @${botInfo.username}`);
                
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