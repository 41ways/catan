/* 카탄: 도시와 기사 — 봇
   기본판 봇과 판단 기준이 다르다. 야만족이 오기 때문에 기사를 놓아야 하고,
   상품으로 도시를 개발해 수도를 노린다. */
(function (root) {
  'use strict';
  var CK = root.CK;

  function pipsOf(v, hi) {
    var h = v.board.hexes[hi];
    if (!h || !h.number) return 0;
    return 6 - Math.abs(7 - h.number);
  }
  function me(v) {
    for (var i = 0; i < v.players.length; i++) if (v.players[i].id === v.me) return v.players[i];
    return null;
  }

  /* 준비 — 자원이 골고루 나오고 상품이 나는 땅을 좋아한다 */
  function chooseSetupSettlement(v) {
    var spots = v.legal.settlements;
    var p = me(v);
    var best = spots[0], bestScore = -1;
    // 도시 자리(두 번째)에는 상품이 나는 땅을 더 친다
    var second = v.setup.idx >= v.players.length;
    var have = {};
    (p.settlements || []).concat(p.cities || []).forEach(function (sv) {
      v.board.verts[sv].hexes.forEach(function (h) {
        var res = v.board.hexes[h].res;
        if (res) have[res] = (have[res] || 0) + pipsOf(v, h);
      });
    });
    spots.forEach(function (sv) {
      var vert = v.board.verts[sv];
      var score = 0, kinds = {};
      vert.hexes.forEach(function (h) {
        var hex = v.board.hexes[h];
        if (!hex.res) return;
        var pip = pipsOf(v, h);
        score += pip * 1.0;
        kinds[hex.res] = true;
        // 상품이 나는 땅 — 도시를 세우면 개발 재료가 나온다
        if (second && (hex.terrain === 'mountains' || hex.terrain === 'forest' || hex.terrain === 'pasture')) {
          score += pip * 0.55;
        }
        if (!have[hex.res]) score += pip * 0.5;          // 없는 자원을 채운다
        if (hex.terrain === 'fields') score += pip * 0.25;  // 밀은 기사 활성화에 계속 든다
      });
      score += Object.keys(kinds).length * 2.2;
      if (vert.port) score += vert.port === 'any' ? 1.2 : 0.8;
      if (score > bestScore) { bestScore = score; best = sv; }
    });
    return best;
  }
  function chooseSetupRoad(v) {
    var roads = v.legal.roads;
    var best = roads[0], bs = -1;
    roads.forEach(function (ei) {
      var e = v.board.edges[ei];
      var far = e.a === v.setup.spot ? e.b : e.a;
      var vert = v.board.verts[far];
      var sc = 0;
      vert.hexes.forEach(function (h) { sc += pipsOf(v, h); });
      vert.adj.forEach(function (n) { if (!v.board.verts[n].b) sc += 1.5; });
      if (vert.port) sc += 1.5;
      if (sc > bs) { bs = sc; best = ei; }
    });
    return best;
  }

  /* 버릴 것 — 당장 안 쓰는 것부터 */
  function chooseDiscard(v, n) {
    var p = me(v), list = [];
    var keep = { g: 3, o: 2, w: 2, b: 2, l: 2, c: 1, p: 1, n: 1 };
    var pool = [];
    CK.ALL.forEach(function (c) {
      for (var i = 0; i < p.res[c]; i++) pool.push(c);
    });
    // 많이 가진 것부터 버린다. 상품은 개발에 쓰므로 조금 아낀다
    pool.sort(function (a, b) {
      var wa = p.res[a] - (keep[a] || 0) + (CK.COM.indexOf(a) >= 0 ? -1.5 : 0);
      var wb = p.res[b] - (keep[b] || 0) + (CK.COM.indexOf(b) >= 0 ? -1.5 : 0);
      return wb - wa;
    });
    return pool.slice(0, n);
  }

  /* 도둑 — 상대의 좋은 땅으로 */
  function chooseRobber(v) {
    var best = null, bs = -1, victim = null;
    v.board.hexes.forEach(function (h, i) {
      if (i === v.robber || !h.res) return;
      var score = 0, cand = null, candCards = -1, mine = false;
      h.corners.forEach(function (vi) {
        var b = v.board.verts[vi].b;
        if (!b) return;
        if (b.p === v.me) { mine = true; return; }
        var q = playerIn(v, b.p);
        if (!q) return;
        score += pipsOf(v, i) * (b.t === 'city' ? 2 : 1) * (1 + q.vp * 0.12);
        if (q.cards > candCards) { candCards = q.cards; cand = b.p; }
      });
      if (mine) score -= 100;
      if (score > bs) { bs = score; best = i; victim = cand; }
    });
    if (best === null) best = (v.robber + 1) % v.board.hexes.length;
    return { hex: best, victim: victim };
  }
  function playerIn(v, pid) {
    for (var i = 0; i < v.players.length; i++) if (v.players[i].id === pid) return v.players[i];
    return null;
  }

  /* 거래 제안에 답하기 */
  function replyToTrade(v) {
    var p = me(v), t = v.trade;
    if (!t) return false;
    var giveN = 0, wantN = 0;
    for (var c in t.want) { if (p.res[c] < t.want[c]) return false; wantN += t.want[c]; }
    for (var c2 in t.give) giveN += t.give[c2];
    // 받는 쪽이 더 많거나, 내가 남아도는 걸 주는 경우만
    var surplus = 0;
    for (var c3 in t.want) surplus += Math.max(0, p.res[c3] - 2);
    return giveN >= wantN && surplus >= wantN * 0.5;
  }

  /* 이번 차례에 무엇을 할까 — 하나씩 돌려준다 */
  function act(v, skill) {
    var p = me(v);
    if (!p) return null;
    skill = skill === undefined ? 1 : skill;

    if (v.phase === 'roll') {
      // 야만족이 코앞이면 기사를 미리 깨운다
      return { action: 'roll', args: [] };
    }
    if (v.phase !== 'main') return null;

    var barbSoon = v.barb >= CK.BARB_TRACK - 2;
    var myPower = 0, knightPower = 0;
    (p.knights || []).forEach(function (k) {
      knightPower += k.rank;
      if (k.active) myPower += k.rank;
    });
    // 야만족 힘은 판 위의 모든 도시. 내 몫만 감당하면 된다
    var cityTotal = 0, live = 0;
    v.players.forEach(function (q) { if (!q.out) { cityTotal += q.cities.length; live++; } });
    var fairShare = Math.ceil(cityTotal / Math.max(1, live));

    // ① 야만족이 임박하면 내 몫만큼 기사를 깨운다
    if (barbSoon && p.res.g >= 1 && myPower <= fairShare) {
      var sleeping = (p.knights || []).filter(function (k) { return !k.active; });
      if (sleeping.length) return { action: 'activateKnight', args: [sleeping[0].v] };
    }
    // ①-2 도시 재료가 한 장 모자라면 은행에서 바꿔 온다
    if (v.legal.cities.length && p.left.city && !can(p, CK.COST.city)) {
      var lackC = null;
      ['g', 'o'].forEach(function (c) {
        if (p.res[c] < CK.COST.city[c] && !lackC) lackC = c;
      });
      if (lackC) {
        var giveC = null, most = 0;
        CK.ALL.forEach(function (c) {
          if (c === lackC) return;
          var rate = CK.tradeRate(p, c);
          var spare = p.res[c] - (CK.COST.city[c] || 0);
          if (spare >= rate && p.res[c] > most) { most = p.res[c]; giveC = c; }
        });
        if (giveC) return { action: 'bankTrade', args: [giveC, lackC] };
      }
    }
    // ② 도시 — 개발도 수도도 도시가 있어야 한다. 모자라면 도시가 먼저다
    var metros = 0;
    CK.TRACKS.forEach(function (t) { if (p.metro[t]) metros++; });
    var cityHungry = p.cities.length <= metros;          // 4단계로 갈 도시가 없다
    if (v.legal.cities.length && can(p, CK.COST.city) && p.left.city) {
      return { action: 'build', args: ['city', bestCity(v, p)] };
    }
    // ③ 마을 — 생산을 늘리는 게 먼저다
    if (v.legal.settlements.length && can(p, CK.COST.settlement) && p.left.settlement) {
      return { action: 'build', args: ['settlement', bestSettlement(v, p)] };
    }
    // 자리가 없으면 도로를 뻗어 자리를 만든다
    if (!v.legal.settlements.length && p.left.settlement && p.left.road &&
        can(p, CK.COST.road) && v.legal.roads.length) {
      return { action: 'build', args: ['road', v.legal.roads[0]] };
    }
    // ④ 도시 개발 — 수도로 가는 길
    var devPick = bestDevelop(v, p);
    if (devPick && !(cityHungry && p.level[devPick] >= 2)) {
      return { action: 'develop', args: [devPick, false] };
    }
    // ④ 기사 — 내 몫의 방어가 모자랄 때만. 남는 자원은 도시에 쓰는 게 낫다
    var needKnight = knightPower < fairShare && v.barb >= 2;
    if (needKnight && can(p, CK.COST.knight) && v.legal.knightSpots.length &&
        countRank(p, 1) < 2 && p.res.g >= 1) {
      return { action: 'placeKnight', args: [v.legal.knightSpots[0]] };
    }
    // ⑥ 기사 승급 — 방어가 모자랄 때
    if (can(p, CK.COST.upgrade) && knightPower <= fairShare) {
      var up = (p.knights || []).filter(function (k) {
        return k.rank === 1 || (k.rank === 2 && p.level.politics >= 3 && countRank(p, 3) < 2);
      });
      if (up.length && countRank(p, up[0].rank + 1) < 2) {
        return { action: 'upgradeKnight', args: [up[0].v] };
      }
    }
    // ⑦ 성벽 — 손패가 자주 넘치면
    if (p.walls < 3 && can(p, CK.COST.wall) && handCount(p) >= 6) {
      var noWall = (p.cities || []).filter(function (cv) { return !v.board.verts[cv].wall; });
      if (noWall.length) return { action: 'build', args: ['wall', noWall[0]] };
    }
    // ⑧ 진보카드 쓰기
    var card = pickCard(v, p);
    if (card) return card;
    // ⑨ 도로 — 마을 자리를 열려고
    if (!v.legal.settlements.length && can(p, CK.COST.road) && p.left.road && v.legal.roads.length) {
      return { action: 'build', args: ['road', v.legal.roads[0]] };
    }
    // ⑩ 은행 교환 — 모자란 것을 채운다
    var tr = bestBankTrade(v, p);
    if (tr) return tr;
    // ⑪ 기사 활성화 — 야만족이 다가올 때만 밀을 태운다
    if (v.barb >= CK.BARB_TRACK - 3 && p.res.g >= 3 && myPower <= fairShare) {
      var sleep2 = (p.knights || []).filter(function (k) { return !k.active; });
      if (sleep2.length) return { action: 'activateKnight', args: [sleep2[0].v] };
    }
    return { action: 'endTurn', args: [] };
  }

  function handCount(p) {
    var n = 0;
    CK.ALL.forEach(function (c) { n += p.res[c]; });
    return n;
  }
  function can(p, cost) {
    for (var c in cost) if (p.res[c] < cost[c]) return false;
    return true;
  }
  function countRank(p, rank) {
    var n = 0;
    (p.knights || []).forEach(function (k) { if (k.rank === rank) n++; });
    return n;
  }
  // 어느 분야를 올릴까 — 수도가 눈앞이면 그쪽, 아니면 싼 쪽
  function bestDevelop(v, p) {
    var best = null, bs = -1;
    CK.TRACKS.forEach(function (t) {
      var lv = p.level[t];
      if (lv >= 5) return;
      var need = lv + 1;
      var com = CK.TRACK_COM[t];
      if (p.res[com] < need) return;
      // 수도를 올릴 도시가 없으면 4단계로 못 간다
      var metros = 0;
      CK.TRACKS.forEach(function (x) { if (p.metro[x]) metros++; });
      if (lv >= 3 && p.cities.length <= metros) return;
      var sc = 10 - need;
      if (lv === 3) sc += 12;                            // 4단계 = 수도 2점
      if (lv === 2) sc += 4;                             // 3단계 보너스
      if (t === 'politics' && lv === 2) sc += 3;         // 요새 = 상급 기사
      if (sc > bs) { bs = sc; best = t; }
    });
    return best;
  }
  function bestCity(v, p) {
    var best = v.legal.cities[0], bs = -1;
    v.legal.cities.forEach(function (cv) {
      var sc = 0;
      v.board.verts[cv].hexes.forEach(function (h) {
        var hex = v.board.hexes[h];
        var pip = pipsOf(v, h);
        sc += pip;
        // 상품이 나는 땅이면 더 값지다
        if (hex.terrain === 'mountains' || hex.terrain === 'forest' || hex.terrain === 'pasture') sc += pip * 0.6;
      });
      if (sc > bs) { bs = sc; best = cv; }
    });
    return best;
  }
  function bestSettlement(v, p) {
    var best = v.legal.settlements[0], bs = -1;
    v.legal.settlements.forEach(function (sv) {
      var sc = 0, kinds = {};
      v.board.verts[sv].hexes.forEach(function (h) {
        var hex = v.board.hexes[h];
        if (!hex.res) return;
        sc += pipsOf(v, h);
        kinds[hex.res] = true;
      });
      sc += Object.keys(kinds).length * 1.5;
      if (v.board.verts[sv].port) sc += 1;
      if (sc > bs) { bs = sc; best = sv; }
    });
    return best;
  }
  function bestBankTrade(v, p) {
    // 도시(밀2 철3)를 먼저 맞추고, 그다음 기사(철1 양1)와 개발 상품
    var need = { g: 2, o: 3, w: 1 };
    if (p.left.settlement && v.legal.roads.length) {     // 확장 중이면 도로·마을 재료도
      need.b = Math.max(need.b || 0, 2);
      need.l = Math.max(need.l || 0, 2);
    }
    CK.TRACKS.forEach(function (t) {
      if (p.level[t] < 5) {
        var com = CK.TRACK_COM[t];
        need[com] = Math.max(need[com] || 0, p.level[t] + 1);
      }
    });
    var lack = null, worst = 0;
    CK.ALL.forEach(function (c) {
      if (!need[c]) return;
      var gap = need[c] - p.res[c];
      if (gap > worst) { worst = gap; lack = c; }
    });
    if (!lack) return null;
    // 남아도는 것을 내놓는다 — 필요량을 남기고도 교환비만큼 있어야 한다
    var give = null, most = 0;
    CK.ALL.forEach(function (c) {
      if (c === lack) return;
      var rate = CK.tradeRate(p, c);
      var spare = p.res[c] - (need[c] || 0);
      if (spare >= rate && p.res[c] > most) { most = p.res[c]; give = c; }
    });
    if (!give) return null;
    return { action: 'bankTrade', args: [give, lack] };
  }
  // 쓸 수 있는 진보카드를 고른다 — 인자까지 채워서
  function pickCard(v, p) {
    var cards = p.cards || [];
    for (var i = 0; i < cards.length; i++) {
      var t = cards[i].type;
      var args = cardArgs(v, p, t);
      if (args) return { action: 'playCard', args: [t].concat([args]) };
    }
    return null;
  }
  function cardArgs(v, p, t) {
    var opp = v.players.filter(function (q) { return q.id !== v.me && !q.out; });
    switch (t) {
      case 'mining': return v.adj && v.adj.mountains ? [] : (countAdj(v, p, 'mountains') ? [] : null);
      case 'irrigation': return countAdj(v, p, 'fields') ? [] : null;
      case 'crane': return bestDevelop(v, p) === null ? null : [];
      case 'roadbuild': return (p.left.road && v.legal.roads.length) ? [] : null;
      case 'warlord': return (p.knights || []).some(function (k) { return !k.active; }) ? [] : null;
      case 'smith': {
        var ks = (p.knights || []).filter(function (k) {
          return k.rank === 1 || (k.rank === 2 && p.level.politics >= 3);
        }).map(function (k) { return k.v; });
        return ks.length ? [ks] : null;
      }
      case 'medicine': {
        if (!p.left.city || !p.settlements.length) return null;
        if (p.res.o < 2 || p.res.g < 1) return null;
        return [p.settlements[0]];
      }
      case 'engineer': {
        var nw = (p.cities || []).filter(function (cv) { return !v.board.verts[cv].wall; });
        return (nw.length && p.walls < 3) ? [nw[0]] : null;
      }
      case 'resMono': {
        var want = 'o';
        if (p.res.g < 2) want = 'g';
        else if (p.res.b < 1) want = 'b';
        return [want];
      }
      case 'commMono': {
        var pick = CK.COM[0], low = 99;
        CK.COM.forEach(function (c) { if (p.res[c] < low) { low = p.res[c]; pick = c; } });
        return [pick];
      }
      case 'bishop': {
        var r = chooseRobber(v);
        return [r.hex];
      }
      case 'spy': {
        var rich = opp.filter(function (q) { return q.cardCount > 0; });
        return rich.length ? [rich[0].id] : null;
      }
      case 'deserter': {
        var withK = opp.filter(function (q) { return q.knightList && q.knightList.length; });
        return withK.length ? [withK[0].id] : null;
      }
      case 'wedding': {
        var higher = opp.filter(function (q) { return q.vp > p.vp; });
        return higher.length ? [] : null;
      }
      case 'saboteur': {
        var hit = opp.filter(function (q) { return q.vp >= p.vp && q.cards >= 4; });
        return hit.length ? [] : null;
      }
      case 'fleet': {
        var most = CK.ALL[0], m = -1;
        CK.ALL.forEach(function (c) { if (p.res[c] > m) { m = p.res[c]; most = c; } });
        return m >= 4 ? [most] : null;
      }
      case 'trader': {
        var rich2 = opp.filter(function (q) { return q.vp > p.vp && q.cards > 0; });
        if (!rich2.length) return null;
        return null;                                     // 손을 볼 수 없으니 봇은 넘긴다
      }
      case 'harbor': return null;
      case 'merchant': {
        var mine = [];
        v.board.hexes.forEach(function (h, i) {
          if (!h.res) return;
          if (h.corners.some(function (vi) {
            var b = v.board.verts[vi].b;
            return b && b.p === v.me;
          })) mine.push(i);
        });
        return mine.length ? [mine[0]] : null;
      }
      case 'inventor': {
        // 내 건물이 닿은 좋은 숫자와, 아무 데도 안 닿은 나쁜 숫자를 맞바꾼다
        var mineHex = [], otherHex = [];
        v.board.hexes.forEach(function (h, i) {
          if (!h.number || [2, 12, 6, 8].indexOf(h.number) >= 0) return;
          var touch = h.corners.some(function (vi) {
            var b = v.board.verts[vi].b;
            return b && b.p === v.me;
          });
          (touch ? mineHex : otherHex).push(i);
        });
        if (!mineHex.length || !otherHex.length) return null;
        // 내 땅 중 가장 안 나오는 것 ↔ 남의 땅 중 가장 잘 나오는 것
        mineHex.sort(function (a, b) { return pipsOf(v, a) - pipsOf(v, b); });
        otherHex.sort(function (a, b) { return pipsOf(v, b) - pipsOf(v, a); });
        if (pipsOf(v, otherHex[0]) <= pipsOf(v, mineHex[0])) return null;
        return [mineHex[0], otherHex[0]];
      }
      case 'diplomat': {
        // 최장 교역로를 가진 상대의 열린 도로를 끊는다
        var leader = null;
        opp.forEach(function (q) { if (!leader || q.roadLen > leader.roadLen) leader = q; });
        if (!leader || leader.roadLen < 4) return null;
        var target = null;
        v.board.edges.forEach(function (e) {
          if (target !== null || e.road !== leader.id) return;
          var openEnd = [e.a, e.b].some(function (vi) {
            var vert = v.board.verts[vi];
            if (vert.b) return false;
            var links = vert.edges.filter(function (x) { return x !== e.i && v.board.edges[x].road; });
            return links.length === 0;
          });
          if (openEnd) target = e.i;
        });
        return target === null ? null : [target];
      }
      case 'intrigue': {
        var hit = null;
        v.players.forEach(function (q) {
          if (q.id === v.me || hit !== null) return;
          (q.knights || []).forEach(function (k) {
            if (hit !== null) return;
            var vert = v.board.verts[k.v];
            var mineRoad = vert.edges.some(function (ei) { return v.board.edges[ei].road === v.me; });
            if (mineRoad) hit = k.v;
          });
        });
        return hit === null ? null : [hit];
      }
      case 'alchemist': return null;                     // 주사위 전 전용 — 봇은 안 쓴다
      default: return null;
    }
  }
  function countAdj(v, p, terrain) {
    var n = 0;
    v.board.hexes.forEach(function (h, i) {
      if (h.terrain !== terrain) return;
      if (h.corners.some(function (vi) {
        var b = v.board.verts[vi].b;
        return b && b.p === v.me;
      })) n++;
    });
    return n;
  }

  root.CKAI = {
    chooseSetupSettlement: chooseSetupSettlement,
    chooseSetupRoad: chooseSetupRoad,
    chooseDiscard: chooseDiscard,
    chooseRobber: chooseRobber,
    replyToTrade: replyToTrade,
    act: act
  };
})(typeof self !== 'undefined' ? self : this);
