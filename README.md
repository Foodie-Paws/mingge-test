---
AIGC:
  ContentProducer: '001191110102MAD55U9H0F10002'
  ContentPropagator: '001191110102MAD55U9H0F10002'
  Label: '1'
  ProduceID: '9afc10eb-c1fa-45c2-a641-5220af747f70'
  PropagateID: '9afc10eb-c1fa-45c2-a641-5220af747f70'
  ReservedCode1: 'a47a514a-a3ab-4116-895a-ad86e7ae844a'
  ReservedCode2: 'a47a514a-a3ab-4116-895a-ad86e7ae844a'
---

# 命格体质测评网站

基于传统八字十神理论的趣味性格测评工具。前端部署于 GitHub Pages，密码验证与扣次由 Supabase 提供。

## 目录结构

```
├── docs/                     ← GitHub Pages 线上前端（纯静态）
│   ├── index.html            测评主页面
│   ├── config.js             Supabase 连接配置（填 URL 和 anon key）
│   ├── data.js               16 道题题库 + 8 种命格文案
│   ├── main.js               前端逻辑（自动识别本地/线上环境）
│   └── html2canvas.min.js    长图生成库
├── supabase_init.sql         ← Supabase 初始化脚本（在 SQL Editor 里执行一次）
├── manage.py                 ← 商家本地管理脚本（生成/查询/删除密码）
├── supabase_admin.json.example  管理脚本配置模板
├── app.py                    本地版后端（Flask，可选）
├── templates/ + static/      本地版前端（与 docs/ 同源）
└── 使用说明.md
```

## 部署步骤

1. 注册 GitHub，新建公开仓库（如 mingge-test）
2. 注册 Supabase，新建项目，在 SQL Editor 执行 `supabase_init.sql`
3. 在 Supabase 项目的 Settings → API 里复制 Project URL 和 anon key，填入 `docs/config.js`
4. 复制 `supabase_admin.json.example` 为 `supabase_admin.json`，填入 URL 和 service_role key
5. 把本项目推送到 GitHub，仓库 Settings → Pages → 选择 main 分支 /docs 文件夹
6. 用 `python manage.py gen 10` 生成密码开始发售

## 安全设计

- 前端仅持有 anon key，无表级读写权限
- 密码验证与扣次全部在 Supabase RPC（security definer）内完成，带防重与越权保护
- service_role key 只存在于本地 `supabase_admin.json`（已 gitignore）

> AI生成