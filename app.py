# -*- coding: utf-8 -*-
"""命格体质测评网站 - 后端服务
功能：
1. 密码验证（每个密码可测3次，服务端控制，清缓存无法绕过）
2. 管理后台 /admin（生成密码、查看使用情况）
3. 分享链接无需密码
"""
import os
import sqlite3
import time
import uuid
import base64
import json
from flask import Flask, request, jsonify, render_template, abort

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, 'tokens.db')
ADMIN_PASSWORD = 'admin888'  # 管理后台密码，可在后台登录后修改

app = Flask(__name__, template_folder='templates', static_folder='static')
try:
    app.json.ensure_ascii = False  # Flask 2.3+
except Exception:
    app.config['JSON_AS_ASCII'] = False  # 兼容旧版
app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 0  # 静态文件不缓存，方便改版即时生效


@app.after_request
def add_no_cache(resp):
    if resp.mimetype in ('text/css', 'application/javascript', 'text/html'):
        resp.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    return resp


# ---------------- 数据库 ----------------
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()
    c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS tokens (
        code TEXT PRIMARY KEY,
        total INTEGER DEFAULT 3,
        used INTEGER DEFAULT 0,
        created_at REAL,
        note TEXT DEFAULT '',
        records TEXT DEFAULT '[]'
    )''')
    # 预置一个演示密码
    row = c.execute('SELECT COUNT(*) FROM tokens').fetchone()
    if row[0] == 0:
        c.execute('INSERT INTO tokens (code, total, used, created_at, note) VALUES (?, ?, ?, ?, ?)',
                  ('MINGE-TEST-001', 3, 0, time.time(), '演示密码'))
    conn.commit()
    conn.close()


init_db()


# ---------------- 工具函数 ----------------
def simplify_result(obj):
    """把用户答案压成短字符串，用于分享链接参数"""
    if not obj:
        return None
    try:
        raw = json.dumps(obj, ensure_ascii=False, separators=(',', ':'))
        return base64.urlsafe_b64encode(raw.encode('utf-8')).decode('ascii')
    except Exception:
        return None


def decode_result(s):
    try:
        raw = base64.urlsafe_b64decode(s.encode('ascii')).decode('utf-8')
        obj = json.loads(raw)
        if not isinstance(obj, dict):
            return None
        return obj
    except Exception:
        return None


# ---------------- 页面路由 ----------------
@app.route('/')
def index():
    return render_template('index.html')


@app.route('/admin')
def admin():
    return render_template('admin.html')


# ---------------- API ----------------
@app.route('/api/verify', methods=['POST'])
def verify():
    """验证密码。只验证不扣次；完成测试后调 /api/consume 才扣1次。"""
    data = request.get_json(silent=True) or {}
    code = (data.get('code') or '').strip().upper()
    if not code:
        return jsonify({'ok': False, 'msg': '请输入密码'}), 400
    conn = get_db()
    row = conn.execute('SELECT * FROM tokens WHERE code=?', (code,)).fetchone()
    if not row:
        conn.close()
        return jsonify({'ok': False, 'msg': '密码不存在，请联系商家'}), 404
    if row['used'] >= row['total']:
        conn.close()
        return jsonify({'ok': False, 'msg': '该密码的3次测试机会已用完，请联系商家获取新密码'}), 403
    left = row['total'] - row['used']
    conn.close()
    return jsonify({'ok': True, 'code': code, 'left': left,
                    'msg': '验证成功，剩余%d次机会' % left})


@app.route('/api/consume', methods=['POST'])
def consume():
    """完成一次测试，扣1次。同一密码同一会话内重复提交防重（以 finished 标记）。"""
    data = request.get_json(silent=True) or {}
    code = (data.get('code') or '').strip().upper()
    session_id = data.get('session_id') or ''
    conn = get_db()
    row = conn.execute('SELECT * FROM tokens WHERE code=?', (code,)).fetchone()
    if not row:
        conn.close()
        return jsonify({'ok': False, 'msg': '密码不存在'}), 404
    if row['used'] >= row['total']:
        conn.close()
        return jsonify({'ok': False, 'msg': '该密码的3次测试机会已用完，请联系商家获取新密码'}), 403
    conn.execute('UPDATE tokens SET used = used + 1 WHERE code=?', (code,))
    conn.commit()
    row = conn.execute('SELECT * FROM tokens WHERE code=?', (code,)).fetchone()
    left = row['total'] - row['used']
    conn.close()
    return jsonify({'ok': True, 'left': left})


@app.route('/api/save_result', methods=['POST'])
def save_result():
    """记录一次完成测试（统计用）+ 扣1次机会"""
    data = request.get_json(silent=True) or {}
    code = (data.get('code') or '').strip().upper()
    result = data.get('result') or {}
    ts = time.strftime('%Y-%m-%d %H:%M:%S')
    if not code:
        return jsonify({'ok': False}), 400
    conn = get_db()
    row = conn.execute('SELECT records FROM tokens WHERE code=?', (code,)).fetchone()
    if not row:
        conn.close()
        return jsonify({'ok': False, 'msg': '密码不存在'}), 404
    records = json.loads(row['records'] or '[]')
    records.append({'time': ts, 'main': result.get('mainName'),
                    'sub': result.get('subName'), 'score': result.get('scores')})
    conn.execute('UPDATE tokens SET records=?, used=used+1 WHERE code=?',
                 (json.dumps(records, ensure_ascii=False), code))
    conn.commit()
    row = conn.execute('SELECT total, used FROM tokens WHERE code=?', (code,)).fetchone()
    left = row['total'] - row['used']
    conn.close()
    return jsonify({'ok': True, 'left': left})


@app.route('/api/admin/login', methods=['POST'])
def admin_login():
    data = request.get_json(silent=True) or {}
    pwd = data.get('pwd') or ''
    if pwd == ADMIN_PASSWORD:
        return jsonify({'ok': True})
    return jsonify({'ok': False, 'msg': '管理密码错误'}), 401


@app.route('/api/admin/tokens', methods=['POST'])
def admin_tokens():
    data = request.get_json(silent=True) or {}
    if (data.get('pwd') or '') != ADMIN_PASSWORD:
        return jsonify({'ok': False, 'msg': '未授权'}), 401
    conn = get_db()
    rows = conn.execute('SELECT code, total, used, created_at, note, records FROM tokens ORDER BY created_at DESC').fetchall()
    conn.close()
    items = []
    for r in rows:
        items.append({
            'code': r['code'], 'total': r['total'], 'used': r['used'],
            'created': time.strftime('%Y-%m-%d %H:%M', time.localtime(r['created_at'])),
            'note': r['note'],
            'records': json.loads(r['records'] or '[]')
        })
    return jsonify({'ok': True, 'items': items})


@app.route('/api/admin/create', methods=['POST'])
def admin_create():
    data = request.get_json(silent=True) or {}
    if (data.get('pwd') or '') != ADMIN_PASSWORD:
        return jsonify({'ok': False, 'msg': '未授权'}), 401
    count = int(data.get('count') or 1)
    total = int(data.get('total') or 3)
    note = data.get('note') or ''
    if count < 1 or count > 200:
        return jsonify({'ok': False, 'msg': '数量需在1-200之间'}), 400
    if total < 1 or total > 99:
        return jsonify({'ok': False, 'msg': '每码次数需在1-99之间'}), 400
    codes = []
    conn = get_db()
    for i in range(count):
        code = 'MG-' + uuid.uuid4().hex[:8].upper()
        try:
            conn.execute('INSERT INTO tokens (code, total, used, created_at, note) VALUES (?,?,?, ?,?)',
                         (code, total, 0, time.time(), note))
            codes.append(code)
        except sqlite3.IntegrityError:
            continue
    conn.commit()
    conn.close()
    return jsonify({'ok': True, 'codes': codes})


@app.route('/api/admin/delete', methods=['POST'])
def admin_delete():
    data = request.get_json(silent=True) or {}
    if (data.get('pwd') or '') != ADMIN_PASSWORD:
        return jsonify({'ok': False, 'msg': '未授权'}), 401
    code = (data.get('code') or '').strip().upper()
    conn = get_db()
    conn.execute('DELETE FROM tokens WHERE code=?', (code,))
    conn.commit()
    conn.close()
    return jsonify({'ok': True})


@app.route('/api/admin/add', methods=['POST'])
def admin_add():
    """手动添加自定义密码"""
    data = request.get_json(silent=True) or {}
    if (data.get('pwd') or '') != ADMIN_PASSWORD:
        return jsonify({'ok': False, 'msg': '未授权'}), 401
    code = (data.get('code') or '').strip().upper()
    total = int(data.get('total') or 3)
    if not code:
        return jsonify({'ok': False, 'msg': '密码不能为空'}), 400
    conn = get_db()
    try:
        conn.execute('INSERT INTO tokens (code, total, used, created_at, note) VALUES (?,?,?, ?,?)',
                     (code, total, 0, time.time(), data.get('note') or ''))
        conn.commit()
        conn.close()
        return jsonify({'ok': True})
    except sqlite3.IntegrityError:
        conn.close()
        return jsonify({'ok': False, 'msg': '该密码已存在'}), 409


if __name__ == '__main__':
    init_db()
    print('=' * 46)
    print('  命格体质测评网站 已启动')
    print('  测试入口:  http://127.0.0.1:5000')
    print('  管理后台:  http://127.0.0.1:5000/admin  (管理密码 admin888)')
    print('=' * 46)
    import threading, webbrowser
    threading.Timer(1.2, lambda: webbrowser.open('http://127.0.0.1:5000')).start()
    app.run(host='0.0.0.0', port=5000, debug=False)
