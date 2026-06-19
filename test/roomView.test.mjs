import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { sanitizeRoomForViewer } = require('../cloudfunctions/room_get/roomView.js');

const baseDoc = () => ({
  _id: 'A1B2C3',
  ownerOpenid: 'owner-oid',
  mode: '4',
  version: 7,
  voteEpoch: 2,
  finishedAt: null,
  votes: {},
  snapshot: { mode: '4', players: [{ id: 1, name: '帆' }], history: [] },
  claims: {
    1: { openid: 'owner-oid', nickname: '帆', avatarUrl: 'http://x', claimedAt: 1 },
    2: { openid: 'someone-else', nickname: '阿强', avatarUrl: 'http://y', claimedAt: 2 }
  }
});

describe('sanitizeRoomForViewer — 围观端只读视图（绝不下发 openid）', () => {
  it('剥掉 ownerOpenid，改下发 isOwner 布尔', () => {
    const owner = sanitizeRoomForViewer(baseDoc(), 'owner-oid');
    assert.equal(owner.isOwner, true);
    assert.equal(owner.ownerOpenid, undefined);

    const watcher = sanitizeRoomForViewer(baseDoc(), 'stranger');
    assert.equal(watcher.isOwner, false);
    assert.equal(watcher.ownerOpenid, undefined);
  });

  it('claims 改成 {nickname, mine}，每个 claim 都没有 openid', () => {
    const v = sanitizeRoomForViewer(baseDoc(), 'owner-oid');
    // 调用者认领了座位 1 → mine=true；座位 2 是别人 → mine=false
    assert.equal(v.claims['1'].mine, true);
    assert.equal(v.claims['1'].nickname, '帆');
    assert.equal(v.claims['1'].openid, undefined);
    assert.equal(v.claims['2'].mine, false);
    assert.equal(v.claims['2'].nickname, '阿强');
    assert.equal(v.claims['2'].openid, undefined);
  });

  it('透传围观需要的字段：version / voteEpoch / snapshot / finishedAt / mode', () => {
    const v = sanitizeRoomForViewer(baseDoc(), 'x');
    assert.equal(v.version, 7);
    assert.equal(v.voteEpoch, 2);
    assert.equal(v.mode, '4');
    assert.equal(v.finishedAt, null);
    assert.deepEqual(v.snapshot.players, [{ id: 1, name: '帆' }]);
  });

  it('legacy votes 字段不下发（投票走独立集合 + vote_tally）', () => {
    const v = sanitizeRoomForViewer(baseDoc(), 'x');
    assert.equal(v.votes, undefined);
  });

  it('viewerOpenid 为空时所有 mine=false、isOwner=false（不误判归属）', () => {
    const v = sanitizeRoomForViewer(baseDoc(), '');
    assert.equal(v.isOwner, false);
    assert.equal(v.claims['1'].mine, false);
    assert.equal(v.claims['2'].mine, false);
  });

  it('无 claims / null doc 安全降级', () => {
    const noClaims = sanitizeRoomForViewer({ ...baseDoc(), claims: undefined }, 'x');
    assert.deepEqual(noClaims.claims, {});
    assert.equal(sanitizeRoomForViewer(null, 'x'), null);
    assert.equal(sanitizeRoomForViewer(undefined, 'x'), null);
  });
});
