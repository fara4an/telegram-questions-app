require('dotenv').config();
const express = require('express');
const path = require('path');
const { Client } = require('pg');
const cors = require('cors');
const { createCanvas, loadImage, registerFont } = require('canvas');
const { notifyNewQuestion, notifyNewAnswer } = require('./bot');

const app = express();

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
                answered_at TIMESTAMP,
                FOREIGN KEY (to_user_id) REFERENCES users(telegram_id)
            );
        `);
    } catch (error) {
        console.error('❌ Ошибка БД:', error);
    }
}

// ========== MIDDLEWARE ==========
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// ========== API ДЛЯ МИНИ-АПП ==========

// 1. Получить ВХОДЯЩИЕ вопросы (без ответов)
app.get('/api/questions/incoming/:userId', async (req, res) => {
    try {
        const result = await db.query(
            `SELECT q.*, u.username as from_username 
             FROM questions q
             LEFT JOIN users u ON q.from_user_id = u.telegram_id
             WHERE q.to_user_id = $1 AND q.is_answered = FALSE
             ORDER BY q.created_at DESC`,
            [req.params.userId]
        );
        res.json(result.rows);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// 2. Получить ОТПРАВЛЕННЫЕ вопросы (с ответами)
app.get('/api/questions/answered/:userId', async (req, res) => {
    try {
        const result = await db.query(
            `SELECT q.*, u.username as from_username 
             FROM questions q
             LEFT JOIN users u ON q.from_user_id = u.telegram_id
             WHERE q.to_user_id = $1 AND q.is_answered = TRUE
             ORDER BY q.answered_at DESC`,
            [req.params.userId]
        );
        res.json(result.rows);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// 3. Отправить новый вопрос
app.post('/api/questions', async (req, res) => {
    try {
        const { fromUserId, toUserId, text } = req.body;
        
        // Сохраняем в БД
        const result = await db.query(
            `INSERT INTO questions (from_user_id, to_user_id, text) 
             VALUES ($1, $2, $3) RETURNING *`,
            [fromUserId || null, toUserId, text]
        );
        
        // Отправляем уведомление
        await notifyNewQuestion(toUserId, result.rows[0].id);
        
        res.status(201).json({ 
            success: true, 
            question: result.rows[0] 
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// 4. Ответить на вопрос
app.post('/api/questions/:id/answer', async (req, res) => {
    try {
        const { id } = req.params;
        const { answer } = req.body;
        
        const result = await db.query(
            `UPDATE questions 
             SET answer = $1, is_answered = TRUE, answered_at = CURRENT_TIMESTAMP 
             WHERE id = $2 RETURNING *`,
            [answer, id]
        );
        
        if (result.rows[0]) {
            // Отправляем уведомление спрашивающему (если он не аноним)
            const question = result.rows[0];
            if (question.from_user_id) {
                await notifyNewAnswer(question.from_user_id, question.text);
            }
        }
        
        res.json({ success: true, question: result.rows[0] });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// 5. Генерация картинки с вопросом и ответом
app.get('/api/generate-image/:questionId', async (req, res) => {
    try {
        const result = await db.query(
            `SELECT q.*, 
                    u1.username as to_username,
                    u2.username as from_username
             FROM questions q
             LEFT JOIN users u1 ON q.to_user_id = u1.telegram_id
             LEFT JOIN users u2 ON q.from_user_id = u2.telegram_id
             WHERE q.id = $1`,
            [req.params.questionId]
        );
        
        if (!result.rows[0]) {
            return res.status(404).json({ error: 'Question not found' });
        }
        
        const question = result.rows[0];
        const imageBuffer = await generateChatImage(question);
        
        res.set('Content-Type', 'image/png');
        res.send(imageBuffer);
    } catch (error) {
        console.error('Error generating image:', error);
        res.status(500).json({ error: 'Image generation failed' });
    }
});

// ========== ГЕНЕРАЦИЯ КАРТИНКИ ==========
async function generateChatImage(question) {
    const width = 600;
    const padding = 20;
    const avatarSize = 40;
    const bubblePadding = 15;
    
    // Рассчитываем высоту
    const questionLines = splitText(question.text, 40);
    const answerLines = question.answer ? splitText(question.answer, 40) : [];
    
    const questionHeight = questionLines.length * 24 + bubblePadding * 2;
    const answerHeight = answerLines.length * 24 + bubblePadding * 2;
    const spacing = 30;
    
    const height = padding * 2 + questionHeight + answerHeight + spacing + avatarSize * 2;
    
    // Создаем canvas
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    
    // Фон
    ctx.fillStyle = '#e5ddd5';
    ctx.fillRect(0, 0, width, height);
    
    let y = padding;
    
    // ВОПРОС (слева)
    ctx.fillStyle = '#555';
    ctx.font = '14px Arial';
    ctx.fillText('Аноним', padding + avatarSize + 10, y + 16);
    
    // Аватар анонима
    ctx.fillStyle = '#666';
    ctx.beginPath();
    ctx.arc(padding + avatarSize/2, y + avatarSize/2, avatarSize/2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 18px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('?', padding + avatarSize/2, y + avatarSize/2 + 6);
    
    // Пузырь с вопросом
    const questionBubbleX = padding + avatarSize + 10;
    const questionBubbleY = y + 25;
    const questionBubbleWidth = width - questionBubbleX - padding - 100;
    
    // Рисуем пузырь
    ctx.fillStyle = '#ffffff';
    roundRect(ctx, questionBubbleX, questionBubbleY, questionBubbleWidth, questionHeight, 15, true, false);
    
    // Текст вопроса
    ctx.fillStyle = '#000';
    ctx.font = '16px Arial';
    ctx.textAlign = 'left';
    questionLines.forEach((line, i) => {
        ctx.fillText(line, questionBubbleX + bubblePadding, questionBubbleY + bubblePadding + 20 + i * 24);
    });
    
    y += questionHeight + spacing;
    
    // ОТВЕТ (справа) - только если есть
    if (question.answer) {
        ctx.fillStyle = '#555';
        ctx.textAlign = 'right';
        ctx.fillText(question.to_username || 'Вы', width - padding - avatarSize - 10, y + 16);
        
        // Аватар отвечающего
        ctx.fillStyle = '#0088cc';
        ctx.beginPath();
        ctx.arc(width - padding - avatarSize/2, y + avatarSize/2, avatarSize/2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 18px Arial';
        ctx.textAlign = 'center';
        const initial = (question.to_username || 'Y').charAt(0).toUpperCase();
        ctx.fillText(initial, width - padding - avatarSize/2, y + avatarSize/2 + 6);
        
        // Пузырь с ответом
        const answerBubbleWidth = width - padding * 2 - avatarSize - 100;
        const answerBubbleX = width - padding - answerBubbleWidth;
        const answerBubbleY = y + 25;
        
        // Рисуем пузырь
        ctx.fillStyle = '#dcf8c6';
        roundRect(ctx, answerBubbleX, answerBubbleY, answerBubbleWidth, answerHeight, 15, true, false);
        
        // Текст ответа
        ctx.fillStyle = '#000';
        ctx.font = '16px Arial';
        ctx.textAlign = 'left';
        answerLines.forEach((line, i) => {
            ctx.fillText(line, answerBubbleX + bubblePadding, answerBubbleY + bubblePadding + 20 + i * 24);
        });
    }
    
    return canvas.toBuffer('image/png');
}

function splitText(text, maxLength) {
    const words = text.split(' ');
    const lines = [];
    let currentLine = '';
    
    for (const word of words) {
        if ((currentLine + word).length > maxLength) {
            lines.push(currentLine.trim());
            currentLine = word + ' ';
        } else {
            currentLine += word + ' ';
        }
    }
    
    if (currentLine.trim()) {
        lines.push(currentLine.trim());
    }
    
    return lines;
}

function roundRect(ctx, x, y, width, height, radius, fill, stroke) {
    if (typeof radius === 'number') {
        radius = {tl: radius, tr: radius, br: radius, bl: radius};
    }
    
    ctx.beginPath();
    ctx.moveTo(x + radius.tl, y);
    ctx.lineTo(x + width - radius.tr, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius.tr);
    ctx.lineTo(x + width, y + height - radius.br);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius.br, y + height);
    ctx.lineTo(x + radius.bl, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius.bl);
    ctx.lineTo(x, y + radius.tl);
    ctx.quadraticCurveTo(x, y, x + radius.tl, y);
    ctx.closePath();
    
    if (fill) ctx.fill();
    if (stroke) ctx.stroke();
}

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
    await initDB();
    
    app.listen(PORT, () => {
        console.log(`🚀 Сервер запущен на порту ${PORT}`);
        console.log(`🌐 Web App: ${process.env.WEB_APP_URL}`);
        console.log(`📱 Мини-апп: ${process.env.WEB_APP_URL}/index.html`);
    });
}

startServer().catch(console.error);