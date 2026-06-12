/**
 * pool_import — 从 web 版（gd.ax0x.ai）一次性导入玩家池到 pool 集合。
 * 幂等 upsert（_id = handle），可重复跑刷新 webStats；boundOpenid 永不被导入覆盖。
 * 云函数出站 HTTPS 不受小程序域名白名单限制。
 */
const cloud = require('wx-server-sdk');
const https = require('https');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const WEB_BASE = 'https://gd.ax0x.ai';
const MAX_PLAYERS = 100;

function getJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { Accept: 'application/json' } }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch (err) {
          reject(new Error(`bad JSON from ${url}`));
        }
      });
    }).on('error', reject);
  });
}

/** 列表概要子集（完整战绩在 pool_bind 时单人实时拉 —— 函数 3 秒预算的取舍） */
function pickListStats(stats) {
  if (!stats || typeof stats !== 'object') return {};
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  return {
    sessionsPlayed: num(stats.sessionsPlayed),
    sessionsWon: num(stats.sessionsWon),
    avgRankingPerSession: num(stats.avgRankingPerSession)
  };
}

exports.main = async () => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { ok: false, error: 'no_openid' };

  const db = cloud.database();
  try {
    await db.createCollection('pool');
  } catch (err) { /* 已存在 */ }

  let list;
  try {
    list = await getJson(`${WEB_BASE}/api/players/list?limit=${MAX_PLAYERS}`);
  } catch (err) {
    console.error('pool_import list failed:', err);
    return { ok: false, error: 'web_unreachable', detail: String(err.message || err) };
  }

  const players = (Array.isArray(list.players) ? list.players : []).slice(0, MAX_PLAYERS);
  const failures = [];

  // 只用列表数据（1 次 HTTP）+ 并行 upsert —— 必须挤进云函数 3 秒默认超时
  const results = await Promise.all(players.map(async (p) => {
    const handle = String(p.handle || '').toLowerCase();
    if (!/^[a-z0-9_-]{2,32}$/.test(handle)) return false;
    const data = {
      handle,
      displayName: String(p.displayName || '').slice(0, 32),
      emoji: String(p.emoji || '🙂').slice(0, 8),
      tagline: String(p.tagline || '').slice(0, 64),
      webStats: pickListStats(p.stats),
      importedAt: db.serverDate()
      // boundOpenid 故意不写：导入永不覆盖绑定
    };
    try {
      // TCB 坑：update 对不存在的文档返回成功(updated:0)不抛错 —— 必须先探存在性
      const existing = await db.collection('pool').doc(handle).get().catch(() => null);
      if (existing && existing.data) {
        await db.collection('pool').doc(handle).update({ data }); // 合并语义，保住 boundOpenid
      } else {
        await db.collection('pool').doc(handle).set({ data });
      }
      return true;
    } catch (err) {
      console.error('pool upsert failed:', handle, err);
      failures.push(handle);
      return false;
    }
  }));

  return { ok: true, imported: results.filter(Boolean).length, total: players.length, failures };
};
