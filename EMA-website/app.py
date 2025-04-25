from flask import Flask, render_template, request, redirect, url_for, session, flash
import sqlite3
from werkzeug.security import generate_password_hash, check_password_hash

import sqlite3
import re 

app = Flask(__name__)
app.secret_key = 'F92jsj39vfjQw7&$!Kmdslz38zPq'

def get_db():
    conn = sqlite3.connect('users.db', check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


 # at the top of app.py

@app.route('/signup', methods=['GET', 'POST'])
def signup():
    if request.method == 'POST':
        email = request.form['username'].strip().lower()
        password = request.form['password']
        full_name = request.form['full_name'].strip()
        phone = request.form['phone'].strip()

        # Validations
        if len(password) < 8:
            flash("Password must be at least 8 characters.")
            return render_template('signup.html')

        if not re.match(r'^[\w\.-]+@[\w\.-]+\.\w+$', email):
            flash("Invalid email format.")
            return render_template('signup.html')

        if not re.match(r'^\+\d{11,14}$', phone):
            flash("Invalid phone number format.")
            return render_template('signup.html')

        # Create new connection INSIDE the route
        conn = sqlite3.connect('users.db', check_same_thread=False)
        conn.row_factory = sqlite3.Row

        existing = conn.execute("SELECT * FROM users WHERE username = ?", (email,)).fetchone()
        if existing:
            flash('Email is already registered.')
            conn.close()
            return render_template('signup.html')

        hashed = generate_password_hash(password)
        conn.execute("INSERT INTO users (username, password, full_name, phone) VALUES (?, ?, ?, ?)",
                     (email, hashed, full_name, phone))
        conn.commit()
        conn.close()
        return redirect(url_for('login'))

    return render_template('signup.html')

@app.route('/home')
def dashboard():
    if 'user_id' not in session:
        return redirect(url_for('login'))

    conn = get_db()
    user = conn.execute("SELECT * FROM users WHERE id = ?", (session['user_id'],)).fetchone()
    conn.close()

    return render_template('home.html', user=user)

@app.route('/logout')
def logout():
    session.pop('user_id', None)
    return redirect(url_for('login'))


@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        username = request.form['username']
        password = request.form['password']

        conn = get_db()
        user = conn.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
        conn.close()

        if user and check_password_hash(user['password'], password):
            session['user_id'] = user['id']
            return redirect(url_for('dashboard'))  # or whatever you named the home route

        else:
            flash("Invalid credentials")
    return render_template('login.html')
@app.route('/')
def home():
    return render_template('index.html')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
