// Добавьте эти маршруты в ваш server.js

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

// Создать вопрос (ОБНОВЛЕННЫЙ!)
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
        
        // Отправляем уведомление владельцу вопроса (если настроен бот)
        try {
            // Здесь можно добавить логику отправки уведомления через Telegram бота
            // Например: bot.telegram.sendMessage(toUserId, "У вас новый вопрос!");
        } catch (notifyError) {
            console.log('Notification not sent:', notifyError.message);
        }
        
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