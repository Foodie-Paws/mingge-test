/* 命格体质测评 - 主逻辑 */
/* global QUESTIONS, TYPES, TYPES_ORDER, html2canvas */

(function(){
'use strict';

const $ = id => document.getElementById(id);
const gate = $('gate'), quiz = $('quiz'), result = $('result'), actionBar = $('action-bar');

/* ---------------- 环境自适应：线上 Supabase / 本地 Flask ---------------- */
const SUPABASE_CFG = {url:'', anon:'', svc:''}; // 若部署版覆盖此配置，见 docs/config.js
let SB = null; // {url, key} 线上模式时的 Supabase 连接信息
(function detectEnv(){
  if (typeof window.SUPABASE_DEPLOY !== 'undefined' && window.SUPABASE_DEPLOY) {
    SB = {url: window.SUPABASE_URL, key: window.SUPABASE_ANON};
    if (!SB.url || !SB.key) console.warn('部署模式缺少 Supabase 配置');
  }
})();
const ONLINE = !!SB;
const api = async (path, body) => {
  if (ONLINE) {
    // 线上：调 Supabase RPC
    const fn = path.replace('/api/', '');
    const r = await fetch(SB.url + '/rest/v1/rpc/' + fn, {
      method:'POST', headers:{'Content-Type':'application/json','apikey':SB.key,'Authorization':'Bearer '+SB.key},
      body: JSON.stringify(body || {})
    }).then(r => r.json()).catch(()=>({ok:false, msg:'网络异常，请稍后再试'}));
    return r;
  }
  // 本地：调 Flask
  return fetch(path, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body || {})}).then(r => r.json()).catch(()=>({ok:false, msg:'网络异常，请稍后再试'}));
};

const state = {
  code: '',           // 当前密码
  verified: false,    // 是否已验证（用于"再测一次"不重复扣次）
  answers: [],        // 已选答案 key 数组
  cur: 0,             // 当前题目下标
  scores: null,       // {LG:0,...}
  mainKey: null, subKey: null,
  mainName: '', subName: '',
  shareMode: false     // 是否为分享打开模式
};

/* ---------------- 工具 ---------------- */
function show(el){ el.classList.remove('hidden'); }
function hide(el){ el.classList.add('hidden'); }
function toast(msg, ok){
  const m = $('gate-msg');
  m.textContent = msg;
  m.className = 'msg ' + (ok ? 'ok' : 'err');
}

/* ---------------- 密码页 ---------------- */
$('btn-start').onclick = async () => {
  const code = $('pwd').value.trim();
  if (!code) { toast('请先输入密码'); return; }
  const r = await api('/api/verify', {code, reuse:0});
  if (r.ok) {
    state.code = r.code;
    state.verified = true;
    state.left = r.left;
    toast('验证成功，剩余 ' + r.left + ' 次机会', true);
    setTimeout(() => startQuiz(), 600);
  } else {
    toast(r.msg || '验证失败');
  }
};
$('pwd').addEventListener('keydown', e => { if (e.key === 'Enter') $('btn-start').click(); });

/* ---------------- 答题 ---------------- */
function startQuiz(){
  state.answers = new Array(QUESTIONS.length).fill(null);
  state.cur = 0;
  hide(gate); hide(result); show(quiz); hide(actionBar);
  renderQ();
}

function renderQ(){
  const q = QUESTIONS[state.cur];
  const total = QUESTIONS.length;
  $('bar').style.width = ((state.cur+1)/total*100) + '%';
  $('qnum').textContent = (state.cur+1) + ' / ' + total;
  $('qtitle').innerHTML = '<span class="tag">第 ' + (state.cur+1) + ' 题 · ' + q.axis + '</span>' + q.title;
  const box = $('opts');
  box.innerHTML = '';
  q.opts.forEach((o, i) => {
    const b = document.createElement('button');
    b.className = 'opt' + (state.answers[state.cur] === o.k ? ' sel' : '');
    b.textContent = o.t;
    b.onclick = () => {
      state.answers[state.cur] = o.k;
      box.querySelectorAll('.opt').forEach(x => x.classList.remove('sel'));
      b.classList.add('sel');
      $('btn-next').disabled = false;
    };
    box.appendChild(b);
  });
  $('btn-prev').disabled = state.cur === 0;
  $('btn-prev').style.visibility = state.cur === 0 ? 'hidden' : 'visible';
  $('btn-next').textContent = state.cur === total-1 ? '查看结果' : '下一题';
  $('btn-next').disabled = state.answers[state.cur] === null;
}

$('btn-prev').onclick = () => { if (state.cur > 0) { state.cur--; renderQ(); } };
$('btn-next').onclick = () => {
  if (state.answers[state.cur] === null) return;
  if (state.cur < QUESTIONS.length - 1) { state.cur++; renderQ(); }
  else finishQuiz();
};

/* ---------------- 计分 ---------------- */
function computeScores(){
  const s = {};
  TYPES_ORDER.forEach(k => s[k] = 0);
  state.answers.forEach(k => { if (k in s) s[k]++; });
  // 每种体质8题，归一化为百分比
  const pct = {};
  TYPES_ORDER.forEach(k => pct[k] = Math.round(s[k] / 8 * 100));
  return {raw:s, pct};
}

function pickMainSub(raw){
  // 按分数降序排列
  const arr = TYPES_ORDER.map(k => ({k, v: raw[k]})).sort((a,b) => b.v - a.v);
  const main = arr[0];
  const tied = arr.filter(x => x.v === main.v);  // 与主命格并列的
  let sub, tie;
  if (tied.length > 1) {
    // 有并列：主命格取第一个，副命格取并列中的第二个
    sub = tied[1];
    tie = true;
  } else {
    sub = arr[1];   // 第二高（真实次高，哪怕分数低）
    tie = false;
  }
  return {mainKey: main.k, subKey: sub.k, tie};
}

/* ---------------- 结果页 ---------------- */
function finishQuiz(){
  const {raw, pct} = computeScores();
  state.scores = raw;
  const p = pickMainSub(raw);
  state.mainKey = p.mainKey; state.subKey = p.subKey; state.tie = p.tie;
  const M = TYPES[state.mainKey], S = TYPES[state.subKey];
  state.mainName = M.name; state.subName = S.name;

  hide(quiz); show(result); show(actionBar);

  // 头部
  $('r-name').textContent = state.tie ? (M.name + ' × ' + S.name) : M.name;
  $('r-sub').textContent = state.tie
    ? '双命格同辉 · 对应「' + M.ancient + '」与「' + S.ancient + '」'
    : M.tagline + ' · 对应传统「' + M.ancient + '」';
  // 主体质契合度环：主命格分数 + 副命格分数的一半权重
  // 每种体质满分8，主满分8，副按0.5权重=4，分母12
  const match = Math.min(99, Math.round((raw[state.mainKey] + raw[state.subKey] * 0.5) / 12 * 100));
  drawRing(match);
  drawRadar(pct);

  // 内容
  $('r-traits').innerHTML = M.traits.map(t => '<li>' + t + '</li>').join('');
  $('r-life').innerHTML = M.life.map(x => '<li><b style="color:var(--jade)">' + x.t + '：</b>' + x.v + '</li>').join('');
  $('r-lesson').textContent = M.lesson;
  // 副命格卡
  $('r-sub-card').innerHTML = '<h3>' + S.name + ' <span class="tag">' + S.ancient + '</span></h3>'
    + '<p style="margin-bottom:8px;color:var(--ink2);font-size:13px">' + S.tagline + '</p>'
    + (state.tie ? '<p>你的「' + S.name + '」特质与主命格同样突出，两种力量在你身上并存，时而互相成就，时而互相拉扯——这正是你的丰富所在。</p>'
                 : '<p>它在你身上若隐若现：' + S.traits[0] + '。在主线人生之外，藏着这样一份备用天赋。</p>');
  $('r-tips').innerHTML = M.tips.map(t => '<li>' + t + '</li>').join('');
  $('r-quote').innerHTML = '<p>' + M.quote + '</p><small>—— 写给你的话</small>';

  // 记录到服务器（统计用+扣1次），更新剩余次数
  api('/api/save_result', {code: state.code, result: {mainName: M.name, subName: S.name, scores: raw}})
    .then(d => { if (d && d.ok && typeof d.left === 'number') state.left = d.left; })
    .catch(()=>{});

  window.scrollTo(0,0);
}

function drawRing(pct){
  const box = $('r-ring');
  const R = 78, C = 2 * Math.PI * R;
  box.innerHTML = '<svg width="170" height="170" viewBox="0 0 170 170">'
    + '<circle cx="85" cy="85" r="' + R + '" fill="none" stroke="#eee6cf" stroke-width="10"/>'
    + '<circle cx="85" cy="85" r="' + R + '" fill="none" stroke="url(#grad1)" stroke-width="10" stroke-linecap="round" '
    + 'stroke-dasharray="' + (C * pct / 100) + ' ' + C + '"/>'
    + '<defs><linearGradient id="grad1" x1="0" y1="0" x2="1" y2="1">'
    + '<stop offset="0%" stop-color="#b8860b"/><stop offset="100%" stop-color="#b33a2b"/>'
    + '</linearGradient></defs></svg>'
    + '<div class="txt"><b>' + pct + '%</b><span>命格契合度</span></div>';
}

function drawRadar(pct){
  const W = 300, H = 300, cx = W/2, cy = H/2 + 6, R = 92;
  const n = TYPES_ORDER.length;
  const pt = (i, r) => {
    const a = -Math.PI/2 + i * 2*Math.PI/n;
    return [cx + r*Math.cos(a), cy + r*Math.sin(a)];
  };
  let g = '';
  // 网格
  [0.25, 0.5, 0.75, 1].forEach(f => {
    g += '<polygon points="' + Array.from({length:n}, (_,i) => pt(i, R*f).join(',')).join(' ') + '" fill="none" stroke="#d8cdb4" stroke-width="1"/>';
  });
  // 轴线与标签
  TYPES_ORDER.forEach((k, i) => {
    const [x, y] = pt(i, R);
    const [lx, ly] = pt(i, R + 20);
    g += '<line x1="' + cx + '" y1="' + cy + '" x2="' + x + '" y2="' + y + '" stroke="#d8cdb4" stroke-width="1"/>';
    g += '<text x="' + lx + '" y="' + ly + '" text-anchor="middle" dominant-baseline="middle">' + TYPES[k].name + '</text>';
  });
  // 数值多边形
  const poly = TYPES_ORDER.map((k, i) => pt(i, R * Math.max(pct[k], 6) / 100).join(',')).join(' ');
  g += '<polygon points="' + poly + '" fill="rgba(179,58,43,.18)" stroke="#b33a2b" stroke-width="2"/>';
  TYPES_ORDER.forEach((k, i) => {
    const [x, y] = pt(i, R * Math.max(pct[k], 6) / 100);
    g += '<circle cx="' + x + '" cy="' + y + '" r="3" fill="#b33a2b"/>';
  });
  $('r-radar').innerHTML = '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">' + g + '</svg>';
}

/* ---------------- 底部操作 ---------------- */
// 再测一次
$('btn-again').onclick = () => {
  if (state.shareMode) { location.href = location.origin + '/'; return; }
  if (!state.verified) { location.reload(); return; }
  if (state.left !== undefined && state.left <= 0) {
    alert('该密码的测试机会已用完，请联系商家获取新密码');
    return;
  }
  startQuiz();
};

// 保存长图
$('btn-save').onclick = async () => {
  const overlay = $('save-overlay');
  const target = document.querySelector('.wrap');
  // 隐藏底部操作栏与分享条，避免截图干扰
  const ab = $('action-bar'), sh = $('shared-head');
  const abHidden = ab.classList.contains('hidden');
  const shHidden = sh.classList.contains('hidden');
  if (!abHidden) hide(ab);
  if (!shHidden) hide(sh);
  $('save-overlay').classList.add('show');
  try {
    const canvas = await html2canvas(target, {scale: 2, backgroundColor: '#f6f0e1', useCORS: true, scrollY: 0, windowWidth: target.scrollWidth, windowHeight: target.scrollHeight});
    const url = canvas.toDataURL('image/png');
    $('save-img').src = url;
    $('btn-download').onclick = () => {
      const a = document.createElement('a');
      a.href = url; a.download = '命格体质报告.png'; a.click();
    };
    const isMobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
    $('save-tip').textContent = isMobile ? '长按上方图片，保存到相册' : '点击"下载到本地"保存图片，或右键另存';
  } catch(e) {
    alert('图片生成失败：' + e.message);
    $('save-overlay').classList.remove('show');
  } finally {
    if (!abHidden) show(ab);
    if (!shHidden) show(sh);
  }
};

$('btn-close-overlay').onclick = () => $('save-overlay').classList.remove('show');

// 复制结果链接
$('btn-share').onclick = async () => {
  const payload = {
    m: state.mainKey, s: state.subKey, t: state.tie ? 1 : 0,
    sc: state.scores, nm: '命格体质'
  };
  const enc = btoa(unescape(encodeURIComponent(JSON.stringify(payload)))).replace(/\+/g,'-').replace(/\//g,'_');
  // 兼容 GitHub Pages 子路径部署：取当前页面地址（去掉查询参数）作为分享基址
  const link = location.origin + location.pathname + '?r=' + enc;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(link);
    } else {
      const ta = document.createElement('textarea');
      ta.value = link; document.body.appendChild(ta);
      ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
    }
    alert('链接已复制！发给好友，TA 无需密码即可查看你的命格结果');
  } catch(e) {
    prompt('复制下面的链接分享给好友：', link);
  }
};

// 好评有礼
$('btn-review').onclick = () => show($('review-mask'));
$('btn-review-ok').onclick = () => hide($('review-mask'));
$('review-mask').onclick = e => { if (e.target === $('review-mask')) hide($('review-mask')); };

/* ---------------- 分享模式（?r= 参数） ---------------- */
function init(){
  const params = new URLSearchParams(location.search);
  const enc = params.get('r');
  if (enc) {
    try {
      const payload = JSON.parse(decodeURIComponent(escape(atob(enc.replace(/-/g,'+').replace(/_/g,'/')))));
      if (payload && payload.m && TYPES[payload.m]) {
        state.shareMode = true;
        state.mainKey = payload.m; state.subKey = payload.s; state.tie = !!payload.t;
        state.scores = payload.sc || null;
        renderShareResult();
        return;
      }
    } catch(e) {}
  }
}
init();

function renderShareResult(){
  hide(gate); hide(quiz);
  show(result); show(actionBar);
  const M = TYPES[state.mainKey], S = TYPES[state.subKey];
  const raw = state.scores;
  const pct = {};
  TYPES_ORDER.forEach(k => pct[k] = raw ? Math.round(raw[k]/8*100) : (k===state.mainKey?100:(k===state.subKey?50:30)));
  $('r-name').textContent = state.tie ? (M.name + ' × ' + S.name) : M.name;
  $('r-sub').textContent = state.tie
    ? '双命格同辉 · 对应「' + M.ancient + '」与「' + S.ancient + '」'
    : M.tagline + ' · 对应传统「' + M.ancient + '」';
  const match = Math.min(99, Math.round((raw[state.mainKey] + raw[state.subKey] * 0.5) / 12 * 100));
  drawRing(match); drawRadar(pct);
  $('r-traits').innerHTML = M.traits.map(t => '<li>' + t + '</li>').join('');
  $('r-life').innerHTML = M.life.map(x => '<li><b style="color:var(--jade)">' + x.t + '：</b>' + x.v + '</li>').join('');
  $('r-lesson').textContent = M.lesson;
  $('r-sub-card').innerHTML = '<h3>' + S.name + ' <span class="tag">' + S.ancient + '</span></h3>'
    + '<p style="margin-bottom:8px;color:var(--ink2);font-size:13px">' + S.tagline + '</p>'
    + (state.tie ? '<p>你的「' + S.name + '」特质与主命格同样突出，两种力量并存。</p>'
                 : '<p>它在你身上若隐若现：' + S.traits[0] + '</p>');
  $('r-tips').innerHTML = M.tips.map(t => '<li>' + t + '</li>').join('');
  $('r-quote').innerHTML = '<p>' + M.quote + '</p><small>—— 写给你的话</small>';
  // 分享条
  const sh = $('shared-head');
  show(sh);
  $('shared-name').textContent = M.name;
  // 分享模式下按钮改文案
  $('btn-again').textContent = '我也要测';
  window.scrollTo(0,0);
}

})();
