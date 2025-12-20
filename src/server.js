require('dotenv').config();
const express = require('express');
const path = require('path');
const { Client } = require('pg');
const cors = require('cors');

// Инициализация Express приложения
const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// PostgreSQL подключение
const db = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Инициализация базы данных
async function initDB() {
  try {
    await db.connect();
    console.log('✅ Подключение к базе данных установлено');
    
    // Создаем таблицы если их нет
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
        answered_at TIMESTAMP,
        FOREIGN KEY (to_user_id) REFERENCES users(telegram_id)
      );
      
      CREATE INDEX IF NOT EXISTS idx_questions_to_user ON questions(to_user_id);
      CREATE INDEX IF NOT EXISTS idx_questions_is_answered ON questions(is_answered);
    `);
    
    console.log('✅ Таблицы базы данных созданы/проверены');
  } catch (error) {
    console.error('❌ Ошибка инициализации базы данных:', error);
  }
}

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
    const { userId } = req.params;
    const result = await db.query(
      `SELECT q.*, u.username as from_username 
       FROM questions q
       LEFT JOIN users u ON q.from_user_id = u.telegram_id
       WHERE q.to_user_id = $1 
       ORDER BY q.created_at DESC`,
      [userId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching questions:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Создать вопрос
app.post('/api/questions', async (req, res) => {
  try {
    const { fromUserId, toUserId, text, source } = req.body;
    
    // Валидация
    if (!toUserId || !text) {
      return res.status(400).json({ 
        error: 'Missing required fields: toUserId and text' 
      });
    }
    
    if (text.length < 5) {
      return res.status(400).json({ 
        error: 'Question too short (minimum 5 characters)' 
      });
    }
    
    // Создаем пользователя если его нет
    await db.query(
      `INSERT INTO users (telegram_id) 
       VALUES ($1) 
       ON CONFLICT (telegram_id) DO NOTHING`,
      [toUserId]
    );
    
    // Если есть fromUserId (не анонимный), тоже создаем пользователя
    if (fromUserId && fromUserId !== '0') {
      await db.query(
        `INSERT INTO users (telegram_id) 
         VALUES ($1) 
         ON CONFLICT (telegram_id) DO NOTHING`,
        [fromUserId]
      );
    }
    
    // Создаем вопрос
    const result = await db.query(
      `INSERT INTO questions (from_user_id, to_user_id, text, source) 
       VALUES ($1, $2, $3, $4) 
       RETURNING *`,
      [fromUserId || null, toUserId, text, source || 'web']
    );
    
    res.status(201).json({ 
      success: true, 
      message: 'Question sent successfully',
      question: result.rows[0] 
    });
    
  } catch (error) {
    console.error('Error creating question:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      details: error.message 
    });
  }
});

// Ответить на вопрос
app.post('/api/questions/:id/answer', async (req, res) => {
  try {
    const { id } = req.params;
    const { answer } = req.body;
    
    const result = await db.query(
      `UPDATE questions 
       SET answer = $1, is_answered = TRUE, answered_at = CURRENT_TIMESTAMP 
       WHERE id = $2 
       RETURNING *`,
      [answer, id]
    );
    
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Question not found' });
    }
    
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
    
    const result = await db.query(
      'DELETE FROM questions WHERE id = $1 RETURNING *',
      [id]
    );
    
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Question not found' });
    }
    
    res.json({ 
      success: true, 
      message: 'Question deleted'
    });
  } catch (error) {
    console.error('Error deleting question:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Страница для вопросов
app.get('/ask/:userId', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/ask.html'));
});

// Главная страница
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ========== Запуск сервера ==========
const PORT = process.env.PORT || 3000;

async function startServer() {
  await initDB();
  
  app.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
    console.log(`🌐 URL: http://localhost:${PORT}`);
    console.log(`✅ Health check: http://localhost:${PORT}/api/health`);
    console.log(`🤖 Бот работает через combined.js`);
  });
}

startServer().catch(console.error);