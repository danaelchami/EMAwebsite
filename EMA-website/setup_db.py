import sqlite3

conn = sqlite3.connect('users.db')
conn.execute('''
CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    username TEXT UNIQUE,
    password TEXT,
    full_name TEXT,
    phone TEXT
)
''')
conn.commit()
conn.close()

print("✅ New users.db created with full_name and phone columns.")
