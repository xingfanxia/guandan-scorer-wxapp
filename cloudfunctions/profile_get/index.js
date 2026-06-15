/**
 * profile_get — 读自己的玩家档案（openid 维度；走函数绕开集合读权限）。
 * partners/opponents 以**别人的** openid 为 key —— 不下发原始 openid；
 * 经 pool 反查显示名后以 display-safe 数组下发『队友与对手』。
 * 绑定过 web 的玩家：再实时拉 web 全量战绩，把 web 历史与小程序新局**合并**
 * （否则关系/走势/最近游戏只剩小程序那几局，富档案变空）。对位 web player-profile.html。
 */
const cloud = require('wx-server-sdk');
const {
  relationsFromMap, rankTrendFromSessions, rankTrendFromWeb,
  recentGamesFromSessions, recentGamesFromWeb,
  mergeRelations, mergeTrend, mergeRecentGames, relationKeys
} = require('./profileExtras.js');
const https = require('https');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const WEB_BASE = 'https://gd.ax0x.ai';

function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { Accept: 'application/json' } }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
        try { resolve(JSON.parse(data)); } catch (err) { reject(new Error('bad JSON')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(4000, () => req.destroy(new Error('web timeout')));
  });
}

/** openid → {name,emoji,handle}：第三方 openid 经 pool 反查显示名，绝不下发 openid 本身 */
async function resolveByOpenids(db, openids) {
  const map = new Map();
  if (!openids.length) return map;
  const _ = db.command;
  const res = await db.collection('pool').where({ boundOpenid: _.in(openids) }).limit(100).get().catch(() => ({ data: [] }));
  for (const d of res.data) {
    if (d.boundOpenid) map.set(d.boundOpenid, { name: d.displayName || d.handle, emoji: d.emoji || '🙂', handle: d.handle });
  }
  return map;
}

/** handle → {name,emoji,handle}：web 端 partners/opponents 以 handle 键控（公开标识，可下发） */
async function resolveByHandles(db, handles) {
  const map = new Map();
  if (!handles.length) return map;
  const _ = db.command;
  const res = await db.collection('pool').where({ handle: _.in(handles) }).limit(100).get().catch(() => ({ data: [] }));
  for (const d of res.data) {
    map.set(d.handle, { name: d.displayName || d.handle, emoji: d.emoji || '🙂', handle: d.handle });
  }
  return map;
}

exports.main = async () => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { ok: false, error: 'no_openid' };

  const db = cloud.database();
  const res = await db.collection('players').doc(OPENID).get().catch(() => null);
  if (!res || !res.data) return { ok: true, openid: OPENID, profile: null };
  const profile = { ...res.data };
  const raw = profile.stats && typeof profile.stats === 'object' ? profile.stats : null;
  if (raw) {
    const { partners, opponents, ...safe } = raw;
    // wx 侧关系（openid → 反查显示名，无 openid 下发）
    const wxKeys = relationKeys(partners, opponents);
    const nameByOpenid = await resolveByOpenids(db, wxKeys);
    const wxResolve = (k) => nameByOpenid.get(k) || null;
    const wxPartners = relationsFromMap(partners, wxResolve);
    const wxOpponents = relationsFromMap(opponents, wxResolve);
    const wxTrend = rankTrendFromSessions(raw.sessionHistory);
    const wxGames = recentGamesFromSessions(raw.sessionHistory);
    // 绑过 web 的话，把 web 历史合并进来（绑定 = web 历史 + 小程序新局）
    let webPartners = [], webOpponents = [], webTrend = [], webGames = [];
    const handle = raw.webImport && raw.webImport.handle;
    if (handle) {
      try {
        const detail = await getJson(`${WEB_BASE}/api/players/${encodeURIComponent(handle)}`);
        const node = detail && (detail.player || detail);
        const ws = (node && node.stats) || {};
        const webKeys = relationKeys(ws.partners, ws.opponents);
        const nameByHandle = await resolveByHandles(db, webKeys);
        const webResolve = (h) => nameByHandle.get(h) || { name: h, emoji: '🙂', handle: h };
        webPartners = relationsFromMap(ws.partners, webResolve);
        webOpponents = relationsFromMap(ws.opponents, webResolve);
        webTrend = rankTrendFromWeb(ws.recentRankings);
        webGames = recentGamesFromWeb(node && node.recentGames);
      } catch (err) {
        console.error('own profile web merge fetch failed:', String((err && err.message) || err));
      }
    }
    safe.relations = {
      partners: mergeRelations(webPartners, wxPartners),
      opponents: mergeRelations(webOpponents, wxOpponents)
    };
    safe.rankTrend = mergeTrend(webTrend, wxTrend);
    safe.recentGames = mergeRecentGames(webGames, wxGames);
    profile.stats = safe;
  }
  return { ok: true, openid: OPENID, profile };
};
