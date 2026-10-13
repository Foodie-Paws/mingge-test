# -*- coding: utf-8 -*-
"""命格体质测评 · Supabase 管理脚本（商家本地使用）

用法（在项目目录打开命令行）：
  python manage.py gen 10          # 批量生成 10 个密码（每码默认 3 次）
  python manage.py gen 10 5        # 生成 10 个、每码 5 次
  python manage.py gen 10 3 "备注"  # 生成并备注
  python manage.py add VIP888 5    # 添加自定义密码
  python manage.py list             # 查看所有密码使用情况
  python manage.py del MG-XXXX      # 删除某个密码

配置：首次使用前，把 supabase_admin.json.example 复制为 supabase_admin.json，
填入 Supabase 项目的 Project URL 和 service_role key。
"""
import json
import sys
import time
import urllib.request
import urllib.error

CFG_FILE = 'supabase_admin.json'


def load_cfg():
    try:
        with open(CFG_FILE, 'r', encoding='utf-8') as f:
            cfg = json.load(f)
        if not cfg.get('url') or not cfg.get('svc'):
            print('[X] supabase_admin.json 里 url 或 svc 还没填，请先配置')
            sys.exit(1)
        return cfg
    except FileNotFoundError:
        print('[X] 找不到 %s，请先复制 supabase_admin.json.example 并填写' % CFG_FILE)
        sys.exit(1)


def call_rpc(cfg, fn, payload):
    req = urllib.request.Request(
        cfg['url'] + '/rest/v1/rpc/' + fn,
        data=json.dumps(payload).encode('utf-8'),
        headers={
            'Content-Type': 'application/json',
            'apikey': cfg['svc'],
            'Authorization': 'Bearer ' + cfg['svc'],
        },
        method='POST',
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode('utf-8'))


def list_tokens(cfg):
    """直接用 service key 查询表（service_role 拥有全部权限）"""
    req = urllib.request.Request(
        cfg['url'] + '/rest/v1/tokens?select=code,total,used,created_at,note,records&order=created_at.desc',
        headers={
            'apikey': cfg['svc'],
            'Authorization': 'Bearer ' + cfg['svc'],
        },
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode('utf-8'))


def fmt_time(s):
    try:
        return s[:16].replace('T', ' ')
    except Exception:
        return str(s)


def cmd_gen(cfg, args):
    count = int(args[0]) if args else 10
    total = int(args[1]) if len(args) > 1 else 3
    note = args[2] if len(args) > 2 else ''
    r = call_rpc(cfg, 'admin_create_tokens', {'p_count': count, 'p_total': total, 'p_note': note})
    if r.get('ok'):
        codes = r['codes']
        print('[OK] 成功生成 %d 个密码（每码可测 %d 次）' % (len(codes), total))
        print('-' * 46)
        for c in codes:
            print('  ' + c)
        print('-' * 46)
        print('把密码发给买家即可，配合你的线上网址使用')
    else:
        print('[X] 生成失败：', r.get('msg'))


def cmd_add(cfg, args):
    if not args:
        print('用法: python manage.py add 密码 [次数] [备注]')
        return
    code = args[0].upper()
    total = int(args[1]) if len(args) > 1 else 3
    note = args[2] if len(args) > 2 else ''
    req = urllib.request.Request(
        cfg['url'] + '/rest/v1/tokens',
        data=json.dumps({'code': code, 'total': total, 'used': 0, 'note': note}).encode('utf-8'),
        headers={'Content-Type': 'application/json', 'apikey': cfg['svc'],
                 'Authorization': 'Bearer ' + cfg['svc'], 'Prefer': 'resolution=ignore-duplicates'},
        method='POST',
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        if resp.status in (200, 201):
            print('[OK] 已添加密码 %s（可测 %d 次）' % (code, total))
        else:
            print('[X] 添加失败（可能已存在）')


def cmd_list(cfg):
    items = list_tokens(cfg)
    print('%-14s %-8s %-16s %-10s' % ('密码', '已用/总', '创建时间', '备注'))
    print('-' * 62)
    for it in items:
        print('%-14s %-8s %-16s %-10s' % (
            it['code'], '%d/%d' % (it['used'], it['total']),
            fmt_time(it['created_at']), it.get('note') or ''))


def cmd_del(cfg, args):
    if not args:
        print('用法: python manage.py del 密码')
        return
    code = args[0].upper()
    req = urllib.request.Request(
        cfg['url'] + '/rest/v1/tokens?code=eq.' + urllib.request.quote(code),
        headers={'apikey': cfg['svc'], 'Authorization': 'Bearer ' + cfg['svc']},
        method='DELETE',
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        print('[OK] 已删除 %s' % code)


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return
    cfg = load_cfg()
    cmd = sys.argv[1]
    args = sys.argv[2:]
    if cmd == 'gen':
        cmd_gen(cfg, args)
    elif cmd == 'add':
        cmd_add(cfg, args)
    elif cmd == 'list':
        cmd_list(cfg)
    elif cmd == 'del':
        cmd_del(cfg, args)
    else:
        print('未知命令：%s' % cmd)
        print(__doc__)


if __name__ == '__main__':
    main()
