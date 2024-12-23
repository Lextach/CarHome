const express = require('express');
const path = require('path');
const mysql = require('mysql2');


const app = express();

const connection = mysql.createConnection({
    host: 'MySQL-5.7',
    user: 'root',
    password: '',
    database: 'CarHome',
    multipleStatements: true 
});

connection.connect((err) => {
    if (err) {
        console.error('Помилка підключення до БД:', err);
        return;
    }
    console.log('Підключено до бази даних MySQL!');
});
app.set('view engine', 'pug');
app.set('views', path.join(__dirname, 'views')); 
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/jpg', express.static(path.join(__dirname, 'jpg')));

const bcrypt = require('bcrypt');

const session = require('express-session');

app.use(session({
    secret: 'mySecretKey',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
}));

// Middleware для передачі локальних змінних у шаблони
app.use((req, res, next) => {
    res.locals.user = req.session.user || null; // Передаємо користувача
    res.locals.isAdmin = req.session.user?.role === 'admin'; // Передаємо статус адміна
    next();
});

app.get('/', (req, res) => res.render('index'));
app.get('/register', (req, res) => res.render('register'));
app.get('/login', (req, res) => res.render('login'));
app.get('/car-filter', (req, res) => res.render('car-filter'));

app.post('/register', async (req, res) => {
    const { full_name, phone, email, password } = req.body;

    console.log('Отримано дані для реєстрації:', { full_name, phone, email });

    const checkUserQuery = 'SELECT * FROM users WHERE email = ? OR phone = ?';

    connection.query(checkUserQuery, [email, phone], async (err, results) => {
        if (err) {
            console.error('Помилка перевірки користувача:', err);
            return res.status(500).send('Помилка сервера');
        }

        if (results.length > 0) {
            const existingField = results[0].email === email ? 'поштою' : 'номером телефону';
            return res.status(400).send(`Користувач з таким ${existingField} вже існує!`);
        }

        try {
            const hashedPassword = await bcrypt.hash(password, 10);

            const insertQuery = `
                INSERT INTO users (full_name, phone, email, password) 
                VALUES (?, ?, ?, ?)`;

            connection.query(insertQuery, [full_name, phone, email, hashedPassword], (err) => {
                if (err) {
                    console.error('Помилка додавання користувача:', err);
                    return res.status(500).send('Помилка сервера');
                }

                console.log('Користувач успішно зареєстрований');
                res.redirect('/login');
            });
        } catch (error) {
            console.error('Помилка хешування пароля:', error);
            res.status(500).send('Помилка сервера');
        }
    });
});


app.post('/login', (req, res) => {
    const { email, password } = req.body;

    const query = 'SELECT * FROM users WHERE email = ?';
    connection.query(query, [email], async (err, results) => {
        if (err) {
            console.error('Помилка сервера при вході:', err);
            return res.status(500).send('Помилка сервера');
        }
        if (results.length === 0) {
            return res.status(401).send('Невірний email або пароль');
        }

        const user = results[0];
        const isPasswordValid = await bcrypt.compare(password, user.password);

        if (!isPasswordValid) {
            return res.status(401).send('Невірний email або пароль');
        }

        req.session.user = { id: user.id, email: user.email, role: user.role };
        console.log('Користувач увійшов:', req.session.user);

        res.redirect('/'); 
    });
});

app.get('/account', (req, res) => {
    if (!req.session.user) {
        return res.redirect('/login'); // Перенаправлення на сторінку входу, якщо користувач не авторизований
    }

    const user_id = req.session.user.id;

    // Запит для отримання інформації про користувача
    const userQuery = 'SELECT full_name, phone, email FROM users WHERE id = ?';
    
    // Паралельно запитуємо і тест-драйви користувача
    const testDrivesQuery = `
        SELECT td.id, td.date, b.name AS brand_name, m.name AS model_name, c.release_year, c.price 
        FROM test_drive td
        JOIN car c ON td.car_id = c.id
        JOIN model m ON c.model_id = m.id
        JOIN brand b ON m.brand_id = b.id
        WHERE td.user_id = ? 
        ORDER BY td.date ASC
    `;

    // Виконуємо обидва запити в один блок
    connection.query(userQuery, [user_id], (err, userResults) => {
        if (err) {
            console.error('Помилка отримання даних профілю:', err);
            return res.status(500).send('Помилка сервера');
        }
        if (userResults.length === 0) {
            return res.status(404).send('Користувача не знайдено');
        }

        // Отримуємо тест-драйви користувача після отримання даних профілю
        connection.query(testDrivesQuery, [user_id], (err, testDrives) => {
            if (err) {
                console.error('Помилка при отриманні тест-драйвів користувача:', err);
                return res.status(500).send('Помилка сервера');
            }

            // Відправляємо дані користувача та тест-драйви в шаблон
            res.render('account', { user: userResults[0], testDrives });
        });
    });
});


app.get('/get-user', (req, res) => {
    if (req.session.user) {
        res.json(req.session.user);
    } else {
        res.status(401).send('Користувач не авторизований');
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

app.get('/test-drive', (req, res) => {
    if (!req.session.user) {
        return res.redirect('/login'); // Перенаправлення на сторінку входу
    }

    const query = `
        SELECT car.id, model.name AS model_name, brand.name AS brand_name, car.release_year, 
               car.price, color.name AS color_name, car.photo 
        FROM car
        JOIN model ON car.model_id = model.id
        JOIN brand ON model.brand_id = brand.id
        JOIN color ON car.color_id = color.id
        WHERE car.status = 'available'`;

    connection.query(query, (err, results) => {
        if (err) {
            console.error('Помилка отримання автомобілів для тест-драйву:', err);
            return res.status(500).send('Помилка сервера');
        }

        res.render('test-drive', { cars: results, user: req.session.user });
    });
});
app.post('/test-drive', (req, res) => {
    if (!req.session.user) {
        return res.status(401).send('Користувач не авторизований');
    }

    const { car_id, date } = req.body;
    const user_id = req.session.user.id;

    if (!car_id || !date) {
        return res.status(400).send('Необхідно вибрати автомобіль і дату');
    }

    // Перевірка на те, чи не вибрана минула дата
    const currentDate = new Date();
    const selectedDate = new Date(date);

    if (selectedDate < currentDate) {
        return res.status(400).send('Дата не може бути в минулому');
    }

    // Перевірка на наявність запису для цього користувача, автомобіля та дати
    const checkQuery = 'SELECT * FROM test_drive WHERE user_id = ? AND car_id = ? AND date = ?';
    connection.query(checkQuery, [user_id, car_id, date], (err, results) => {
        if (err) {
            console.error('Помилка при перевірці запису на тест-драйв:', err);
            return res.status(500).send('Помилка сервера');
        }

        if (results.length > 0) {
            // Якщо такий запис вже є, відправляємо повідомлення
            return res.status(409).send('Ви вже записані на цей тест-драйв для цієї машини на цю дату');
        }

        // Якщо такого запису немає, додаємо новий
        const query = 'INSERT INTO test_drive (car_id, user_id, date) VALUES (?, ?, ?)';
        connection.query(query, [car_id, user_id, date], (err) => {
            if (err) {
                console.error('Помилка запису на тест-драйв:', err);
                return res.status(500).send('Помилка сервера');
            }
            console.log('Успішно записано на тест-драйв');
            res.redirect('/account');
        });
    });
});
app.post('/cancel-test-drive', (req, res) => {
    if (!req.session.user) {
        return res.status(401).send('Користувач не авторизований');
    }

    const { testDriveId } = req.body;
    const user_id = req.session.user.id;

    // Перевірка, чи цей тест-драйв належить користувачу
    const checkQuery = 'SELECT * FROM test_drive WHERE id = ? AND user_id = ?';
    connection.query(checkQuery, [testDriveId, user_id], (err, results) => {
        if (err) {
            console.error('Помилка при перевірці тест-драйву:', err);
            return res.status(500).send('Помилка сервера');
        }

        if (results.length === 0) {
            return res.status(404).send('Тест-драйв не знайдено');
        }

        // Скасування тест-драйву
        const deleteQuery = 'DELETE FROM test_drive WHERE id = ?';
        connection.query(deleteQuery, [testDriveId], (err) => {
            if (err) {
                console.error('Помилка при скасуванні тест-драйву:', err);
                return res.status(500).send('Помилка сервера');
            }

            console.log('Тест-драйв успішно скасовано');
            res.redirect('/account');
        });
    });
});



app.get('/catalog', (req, res) => {
    const query = `
        SELECT car.id, model.name AS model_name, brand.name AS brand_name, car.release_year, 
               car.price, color.name AS color_name, car.photo 
        FROM car
        JOIN model ON car.model_id = model.id
        JOIN brand ON model.brand_id = brand.id
        JOIN color ON car.color_id = color.id`;

    connection.query(query, (err, results) => {
        if (err) {
            console.error('Помилка при отриманні даних автомобілів:', err);
            return res.status(500).send('Помилка сервера');
        }

        res.render('catalog', { cars: results });
    });
});

app.get('/car/:id', (req, res) => {
    const carId = req.params.id;

    const query = `
        SELECT car.id, model.name AS model_name, brand.name AS brand_name, car.release_year, 
               car.price, color.name AS color_name, car.photo, car.status, body_type.name AS body_type,
               engine_type.name AS engine_type, drive_type.name AS drive_type, model.engine_volume
        FROM car
        JOIN model ON car.model_id = model.id
        JOIN brand ON model.brand_id = brand.id
        JOIN color ON car.color_id = color.id
        JOIN body_type ON model.body_type_id = body_type.id
        JOIN engine_type ON model.engine_type_id = engine_type.id
        JOIN drive_type ON model.drive_type_id = drive_type.id
        WHERE car.id = ?`;

    connection.query(query, [carId], (err, results) => {
        if (err) {
            console.error('Помилка отримання даних автомобіля:', err);
            return res.status(500).send('Помилка сервера');
        }
        if (results.length === 0) {
            return res.status(404).send('Автомобіль не знайдено');
        }

        res.render('car-details', { car: results[0], user: req.session.user || null });
    });
});

app.post("/update-user", (req, res) => {
    const { name, phone } = req.body;

    if (!req.session.user) {
        return res.status(401).send("Користувач не авторизований");
    }

    const userId = req.session.user.id;

    const query = "UPDATE users SET full_name = ?, phone = ? WHERE id = ?";
    connection.query(query, [name, phone, userId], (err, result) => {
        if (err) {
            console.error("Помилка оновлення:", err.message);
            return res.status(500).send("Помилка оновлення даних");
        }
        console.log(`Користувача з ID ${userId} успішно оновлено.`);
        res.redirect("/account");
    });
});



app.post('/car-filter', (req, res) => {
    const { brand, color, body_type, engine_type, drive_type, year, price, search } = req.body;

    let query = `
        SELECT car.id, model.name AS model_name, brand.name AS brand_name, car.release_year, 
               car.price, color.name AS color_name, car.photo, car.status 
        FROM car
        JOIN model ON car.model_id = model.id
        JOIN brand ON model.brand_id = brand.id
        JOIN color ON car.color_id = color.id
        JOIN body_type ON model.body_type_id = body_type.id
        JOIN engine_type ON model.engine_type_id = engine_type.id
        JOIN drive_type ON model.drive_type_id = drive_type.id
        WHERE 1=1
    `;
    const params = [];

    if (brand) {
        query += ' AND (brand.name LIKE ? OR model.name LIKE ?)';
        params.push(`%${brand}%`, `%${brand}%`);
    }
    if (color) {
        query += ' AND color.name = ?';
        params.push(color);
    }
    if (body_type) {
        query += ' AND body_type.name = ?';
        params.push(body_type);
    }
    if (engine_type) {
        query += ' AND engine_type.name = ?';
        params.push(engine_type);
    }
    if (drive_type) {
        query += ' AND drive_type.name = ?';
        params.push(drive_type);
    }
    if (year) {
        query += ' AND car.release_year = ?';
        params.push(year);
    }
    if (price) {
        query += ' AND car.price <= ?';
        params.push(price);
    }
    if (search) {
        query += ' AND model.name LIKE ?';
        params.push(`%${search}%`);
    }

    connection.query(query, params, (err, results) => {
        if (err) {
            console.error('Помилка фільтрації:', err);
            return res.status(500).send('Помилка сервера');
        }

        res.render('car-filter-results', { cars: results });
    });
});
// Middleware для перевірки ролі адміністратора
const isAdmin = (req, res, next) => {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.status(403).send('Доступ заборонено. Ви не адміністратор.');
    }
    next();
};


app.put('/api/cars/:id', isAdmin, async (req, res) => {
    const { id } = req.params;
    const { name, model, price } = req.body;
  
    try {
        await Car.update({ name, model, price }, { where: { id } });
        res.status(200).json({ message: 'Автомобіль оновлено' });
    } catch (error) {
        res.status(500).json({ error: 'Помилка сервера' });
    }
});

app.get('/admin-panel', isAdmin, (req, res) => {
    const query = `
        SELECT car.id, model.name AS model_name, brand.name AS brand_name, car.release_year, 
               car.price, color.name AS color_name, car.status 
        FROM car
        JOIN model ON car.model_id = model.id
        JOIN brand ON model.brand_id = brand.id
        JOIN color ON car.color_id = color.id`;

    connection.query(query, (err, results) => {
        if (err) {
            console.error('Помилка при отриманні даних автомобілів:', err);
            return res.status(500).send('Помилка сервера');
        }

        res.render('admin-panel', { cars: results });
    });
});

app.get('/admin-panel/:section', isAdmin, (req, res) => {
    const section = req.params.section;
    let query = '';
    switch (section) {
        case 'cars':
            query = `
                SELECT car.id, model.name AS model_name, brand.name AS brand_name, car.release_year, 
                       car.price, color.name AS color_name, car.status 
                FROM car
                JOIN model ON car.model_id = model.id
                JOIN brand ON model.brand_id = brand.id
                JOIN color ON car.color_id = color.id`;
            break;
        case 'users':
            query = `SELECT id, full_name, email, role FROM users`;
            break;
        case 'test-drives':
            query = `
            SELECT 
                test_drive.id, 
                car.id AS car_id, 
                CONCAT(brand.name, ' ', model.name) AS car_name, 
                users.full_name AS user_name, 
                test_drive.date 
            FROM 
                test_drive
            JOIN car ON test_drive.car_id = car.id
            JOIN model ON car.model_id = model.id
            JOIN brand ON model.brand_id = brand.id
            JOIN users ON test_drive.user_id = users.id;`;
            break;
        default:
            return res.redirect('/admin-panel/cars');
    }

    connection.query(query, (err, results) => {
        if (err) {
            console.error('Помилка отримання даних для розділу:', err);
            return res.status(500).send('Помилка сервера');
        }

        res.render('admin-panel', { section, items: results });
    });
});

app.get('/add-car', isAdmin, (req, res) => {
    const queries = {
        brands: 'SELECT * FROM brand',
        colors: 'SELECT * FROM color'
    };

    connection.query(`${queries.brands}; ${queries.colors}`, (err, results) => {
        if (err) {
            console.error('Помилка отримання даних для форми:', err);
            return res.status(500).send('Помилка сервера');
        }

        res.render('add-car', {
            brands: results[0],
            colors: results[1]
        });
    });
});
app.post('/admin-panel/add-car', isAdmin, (req, res) => {
    const { 
        brand_name, model_name, body_type_id, engine_type_id, drive_type_id, engine_volume, 
        color_name, release_year, price, photo, status 
    } = req.body;

    // Додавання марки, якщо її немає
    const brandQuery = `INSERT INTO brand (name) VALUES (?) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)`;
    connection.query(brandQuery, [brand_name], (err, brandResults) => {
        if (err) {
            console.error('Помилка додавання марки:', err);
            return res.status(500).send('Помилка сервера');
        }

        const brandId = brandResults.insertId;

        // Додавання моделі
        const modelQuery = `
            INSERT INTO model (name, brand_id, body_type_id, engine_type_id, drive_type_id, engine_volume) 
            VALUES (?, ?, ?, ?, ?, ?) 
            ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)
        `;
        const modelParams = [model_name, brandId, body_type_id, engine_type_id, drive_type_id, engine_volume];
        connection.query(modelQuery, modelParams, (err, modelResults) => {
            if (err) {
                console.error('Помилка додавання моделі:', err);
                return res.status(500).send('Помилка сервера');
            }

            const modelId = modelResults.insertId;

            // Додавання кольору
            const colorQuery = `INSERT INTO color (name) VALUES (?) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)`;
            connection.query(colorQuery, [color_name], (err, colorResults) => {
                if (err) {
                    console.error('Помилка додавання кольору:', err);
                    return res.status(500).send('Помилка сервера');
                }

                const colorId = colorResults.insertId;

                // Додавання автомобіля
                const carQuery = `
                    INSERT INTO car (model_id, release_year, price, color_id, photo, status)
                    VALUES (?, ?, ?, ?, ?, ?)
                `;
                const carParams = [modelId, release_year, price, colorId, photo, status];
                connection.query(carQuery, carParams, (err) => {
                    if (err) {
                        console.error('Помилка додавання автомобіля:', err);
                        return res.status(500).send('Помилка сервера');
                    }

                    res.redirect('/admin-panel/cars');
                });
            });
        });
    });
});

app.get('/delete-car/:id', isAdmin, (req, res) => {
    const carId = req.params.id;
    const deleteCarQuery = `DELETE FROM car WHERE id = ?`;

    connection.query(deleteCarQuery, [carId], (err) => {
        if (err) {
            console.error('Помилка видалення автомобіля:', err);
            return res.status(500).send('Помилка сервера');
        }

        res.redirect('/admin-panel/cars');
    });
});

app.get('/delete-user/:id', isAdmin, (req, res) => {
    const userId = req.params.id;

    // Спочатку видаляємо тест-драйви
    const deleteTestDrivesQuery = `DELETE FROM test_drive WHERE user_id = ?`;
    connection.query(deleteTestDrivesQuery, [userId], (err) => {
        if (err) {
            console.error('Помилка видалення тест-драйвів:', err);
            return res.status(500).send('Помилка сервера');
        }

        // Потім видаляємо користувача
        const deleteUserQuery = `DELETE FROM users WHERE id = ?`;
        connection.query(deleteUserQuery, [userId], (err) => {
            if (err) {
                console.error('Помилка видалення користувача:', err);
                return res.status(500).send('Помилка сервера');
            }

            res.redirect('/admin-panel/users');
        });
    });
});

app.get('/delete-test-drive/:id', isAdmin, (req, res) => {
    const testDriveId = req.params.id;
    const deleteTestDriveQuery = `DELETE FROM test_drive WHERE id = ?`;

    connection.query(deleteTestDriveQuery, [testDriveId], (err) => {
        if (err) {
            console.error('Помилка видалення тест-драйву:', err);
            return res.status(500).send('Помилка сервера');
        }

        res.redirect('/admin-panel/test-drives');
    });
});

app.get('/edit-car/:id', isAdmin, (req, res) => {
    const carId = req.params.id;

    // Запит на отримання даних автомобіля
    const carQuery = `
        SELECT car.*, model.name AS model_name, brand.name AS brand_name, color.name AS color_name
        FROM car
        JOIN model ON car.model_id = model.id
        JOIN brand ON model.brand_id = brand.id
        JOIN color ON car.color_id = color.id
        WHERE car.id = ?`;

    const colorsQuery = `SELECT name FROM color`;
    const brandsQuery = `SELECT name FROM brand`;
    const modelsQuery = `SELECT name FROM model`;
    const bodyTypesQuery = `SELECT id, name FROM body_type`;
    const engineTypesQuery = `SELECT id, name FROM engine_type`;
    const driveTypesQuery = `SELECT id, name FROM drive_type`;

    connection.query(carQuery, [carId], (err, carResults) => {
        if (err || carResults.length === 0) {
            console.error('Помилка отримання автомобіля:', err);
            return res.status(404).send('Автомобіль не знайдено.');
        }

        connection.query(colorsQuery, (err, colorsResults) => {
            if (err) {
                console.error('Помилка отримання кольорів:', err);
                return res.status(500).send('Помилка сервера.');
            }

            connection.query(brandsQuery, (err, brandsResults) => {
                if (err) {
                    console.error('Помилка отримання брендів:', err);
                    return res.status(500).send('Помилка сервера.');
                }

                connection.query(modelsQuery, (err, modelsResults) => {
                    if (err) {
                        console.error('Помилка отримання моделей:', err);
                        return res.status(500).send('Помилка сервера.');
                    }

                    connection.query(bodyTypesQuery, (err, bodyTypesResults) => {
                        if (err) {
                            console.error('Помилка отримання типів кузова:', err);
                            return res.status(500).send('Помилка сервера.');
                        }

                        connection.query(engineTypesQuery, (err, engineTypesResults) => {
                            if (err) {
                                console.error('Помилка отримання типів двигуна:', err);
                                return res.status(500).send('Помилка сервера.');
                            }

                            connection.query(driveTypesQuery, (err, driveTypesResults) => {
                                if (err) {
                                    console.error('Помилка отримання типів приводу:', err);
                                    return res.status(500).send('Помилка сервера.');
                                }

                                res.render('edit-car', {
                                    car: carResults[0],
                                    colors: colorsResults.map(color => color.name),
                                    brands: brandsResults.map(brand => brand.name),
                                    models: modelsResults.map(model => model.name),
                                    body_types: bodyTypesResults,
                                    engine_types: engineTypesResults,
                                    drive_types: driveTypesResults
                                });
                            });
                        });
                    });
                });
            });
        });
    });
});


app.post('/edit-car', isAdmin, (req, res) => {
    const { id, model_name, brand_name, release_year, price, color_name, photo, status } = req.body;

    // Перевірка валідності вхідних даних
    if (!id || !model_name || !brand_name || !release_year || !price || !color_name || !status) {
        return res.status(400).send('Помилка: Усі поля повинні бути заповнені.');
    }

    // Перевірка існування моделі та бренду
    const checkModelQuery = `
        SELECT model.id 
        FROM model 
        JOIN brand ON model.brand_id = brand.id 
        WHERE model.name = ? AND brand.name = ?
        LIMIT 1
    `;

    const checkColorQuery = `
        SELECT id 
        FROM color 
        WHERE name = ?
        LIMIT 1
    `;

    connection.query(checkModelQuery, [model_name, brand_name], (err, modelResults) => {
        if (err) {
            console.error('Помилка пошуку моделі:', err);
            return res.status(500).send('Помилка сервера при перевірці моделі.');
        }

        if (modelResults.length === 0) {
            return res.status(404).send('Модель або бренд не знайдено.');
        }

        const modelId = modelResults[0].id;

        connection.query(checkColorQuery, [color_name], (err, colorResults) => {
            if (err) {
                console.error('Помилка пошуку кольору:', err);
                return res.status(500).send('Помилка сервера при перевірці кольору.');
            }

            if (colorResults.length === 0) {
                return res.status(404).send('Колір не знайдено.');
            }

            const colorId = colorResults[0].id;

            // Запит для оновлення автомобіля
            const updateCarQuery = `
                UPDATE car
                SET model_id = ?, 
                    release_year = ?, 
                    price = ?, 
                    color_id = ?, 
                    photo = ?, 
                    status = ?
                WHERE id = ?
            `;
            const params = [modelId, release_year, price, colorId, photo, status, id];

            connection.query(updateCarQuery, params, (err, results) => {
                if (err) {
                    console.error('Помилка оновлення автомобіля:', err);
                    return res.status(500).send('Помилка сервера при оновленні автомобіля.');
                }

                if (results.affectedRows === 0) {
                    return res.status(404).send('Автомобіль не знайдено для оновлення.');
                }

                res.redirect('/admin-panel/cars');
            });
        });
    });
});

app.get('/add-user', isAdmin, (req, res) => {
    res.render('add-user');
});

app.post('/add-user', isAdmin, (req, res) => {
    const { email, password, full_name, phone, role } = req.body;

    const query = `
        INSERT INTO users (email, password, full_name, phone, role)
        VALUES (?, ?, ?, ?, ?)
    `;
    const params = [email, password, full_name, phone, role];

    connection.query(query, params, (err) => {
        if (err) {
            console.error('Помилка додавання користувача:', err);
            return res.status(500).send('Помилка сервера');
        }

        res.redirect('/admin-panel/users');
    });
});

app.get('/edit-user/:id', isAdmin, (req, res) => {
    const userId = req.params.id;

    const query = `SELECT * FROM users WHERE id = ?`;
    connection.query(query, [userId], (err, results) => {
        if (err || results.length === 0) {
            console.error('Помилка отримання даних користувача:', err);
            return res.status(404).send('Користувача не знайдено');
        }

        res.render('edit-user', { user: results[0] });
    });
});


app.post('/edit-user/:id', isAdmin, (req, res) => {
    const userId = req.params.id;
    const { email, full_name, phone, role } = req.body;

    const query = `
        UPDATE users
        SET email = ?, full_name = ?, phone = ?, role = ?
        WHERE id = ?
    `;
    const params = [email, full_name, phone, role, userId];

    connection.query(query, params, (err) => {
        if (err) {
            console.error('Помилка редагування користувача:', err);
            return res.status(500).send('Помилка сервера');
        }

        res.redirect('/admin-panel/users');
    });
});
app.get('/edit-test-drive/:id', isAdmin, (req, res) => {
    const testDriveId = req.params.id;

    const queries = {
        testDrive: `
            SELECT 
                test_drive.*, 
                model.name AS car_name, 
                users.full_name AS user_name
            FROM test_drive
            JOIN car ON test_drive.car_id = car.id
            JOIN model ON car.model_id = model.id
            JOIN users ON test_drive.user_id = users.id
            WHERE test_drive.id = ?
        `,
        cars: `
            SELECT car.id, model.name AS name
            FROM car
            JOIN model ON car.model_id = model.id
        `,
        users: 'SELECT id, full_name FROM users'
    };
    

    const sql = `${queries.testDrive}; ${queries.cars}; ${queries.users}`;
    connection.query(sql, [testDriveId], (err, results) => {
        if (err || results[0].length === 0) {
            console.error('Помилка отримання даних тест-драйву:', err);
            return res.status(404).send('Тест-драйв не знайдено');
        }

        res.render('edit-test-drive', {
            testDrive: results[0][0],
            cars: results[1] || [], 
            users: results[2] || [] 
        });
        
    });
});

app.post('/edit-test-drive/:id', isAdmin, (req, res) => {
    const testDriveId = req.params.id;
    const { car_name, user_name, date } = req.body;

    const queries = {
        carId: `
            SELECT car.id 
            FROM car
            JOIN model ON car.model_id = model.id
            WHERE model.name = ?
        `,
        userId: 'SELECT id FROM users WHERE full_name = ?'
    };

    connection.query(queries.carId, [car_name], (err, carResults) => {
        if (err || carResults.length === 0) {
            console.error('Помилка пошуку автомобіля:', err);
            return res.status(404).send('Автомобіль не знайдено');
        }

        const carId = carResults[0].id;

        connection.query(queries.userId, [user_name], (err, userResults) => {
            if (err || userResults.length === 0) {
                console.error('Помилка пошуку користувача:', err);
                return res.status(404).send('Користувач не знайдений');
            }

            const userId = userResults[0].id;

            const updateQuery = `
                UPDATE test_drive
                SET car_id = ?, user_id = ?, date = ?
                WHERE id = ?
            `;
            const params = [carId, userId, date, testDriveId];

            connection.query(updateQuery, params, (err) => {
                if (err) {
                    console.error('Помилка оновлення тест-драйву:', err);
                    return res.status(500).send('Помилка сервера');
                }

                res.redirect('/admin-panel/test-drives');
            });
        });
    });
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server started: http://localhost:${PORT}`);
});
