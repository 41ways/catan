# -*- coding: utf-8 -*-
"""화면에 뜬 안내가 사람이 읽을 만큼 떠 있었는지 따져 본다."""
import json, sys, re

# ── 읽는 속도 기준 ────────────────────────────────
# 한글 안내문은 눈에 들어오는 데 최소 0.8초 + 글자당 0.07초로 잡는다.
# (초당 14자 남짓. 게임 화면의 짧은 문구를 훑는 속도.)
def need(text, floor):
    n = len(re.sub(r'\s', '', text or ''))
    return max(floor, 0.8 + n * 0.07)

FLOOR = {'plaque': 1.5, 'card': 1.6, 'dice': 1.6, 'robber': 1.0, 'now': 1.0}
IMPORTANT = ['내 차례', '도둑', '버립니다', '빼앗', '승리', '최장', '최강', '야만족', '독점', '수도', '약탈']

def spans(ev, kind):
    out, on = [], None
    for e in ev:
        if e['kind'] != kind: continue
        if e['on'] and on is None: on = e
        elif not e['on'] and on is not None:
            out.append((on['t'], e['t'], on['what'])); on = None
    if on: out.append((on['t'], None, on['what']))
    return out

def run(path, label):
    o = json.load(open(path)); ev = o['ev']
    total = ev[-1]['t'] / 1000.0
    print('=== %s — %.0f초짜리 한 판, 이벤트 %d개 ===' % (label, total, len(ev)))
    problems = []

    # 1) 전면 안내가 떠 있던 시간
    for kind in ['plaque', 'card', 'dice', 'robber', 'gate']:
        sp = spans(ev, kind)
        if not sp: continue
        durs = [(b - a) / 1000.0 for a, b, w in sp if b]
        print('%-7s %2d회, 평균 %.1f초, 가장 짧은 것 %.1f초' % (kind, len(sp), sum(durs)/len(durs) if durs else 0, min(durs) if durs else 0))
        if kind == 'gate': continue                    # 관문은 누를 때까지 기다린다
        for a, b, w in sp:
            if not b: continue
            d = (b - a) / 1000.0
            req = need(w, FLOOR[kind])
            if d + 0.05 < req:
                problems.append('%6.1f초 지점 · %s "%s" — %.1f초만 떴음 (%.1f초는 필요)' % (a/1000.0, kind, (w or '')[:26], d, req))

    # 2) 티커 한 줄이 머문 시간
    nows = [e for e in ev if e['kind'] == 'now']
    mine = [e['t'] for e in ev if e['kind'] == 'me']       # 로봇 대리인이 즉시 움직인 순간
    short = []
    for i, e in enumerate(nows[:-1]):
        end = nows[i+1]['t']
        if any(abs(m - end) < 200 for m in mine):          # 내가 눌러서 바뀐 줄은 사람이 보면 안 짧다
            continue
        d = (end - e['t']) / 1000.0
        txt = e['what'] or ''
        imp = any(k in txt for k in IMPORTANT)
        req = need(txt, 1.6 if imp else 1.0)
        if d + 0.05 < req:
            short.append((e['t']/1000.0, d, req, txt, imp))
    print('티커  %d줄, 너무 빨리 지나간 줄 %d개 (그중 중요한 줄 %d개)'
          % (len(nows), len(short), sum(1 for s in short if s[4])))
    for t, d, req, txt, imp in short[:14]:
        problems.append('%6.1f초 지점 · 티커%s "%s" — %.1f초 (%.1f초 필요)' % (t, '(중요)' if imp else '', txt[:30], d, req))

    # 3) 전면 안내가 겹쳐 뜬 구간
    lay = []
    for kind in ['plaque', 'card', 'dice', 'gate', 'robber']:
        for a, b, w in spans(ev, kind):
            lay.append((a, b if b else ev[-1]['t'], kind, w))
    lay.sort()
    for i in range(len(lay)):
        for j in range(i+1, len(lay)):
            if lay[j][0] >= lay[i][1]: break
            ov = (min(lay[i][1], lay[j][1]) - lay[j][0]) / 1000.0
            if ov > 0.25:
                problems.append('%6.1f초 지점 · %s 와 %s 가 %.1f초 동안 겹쳐 떴음' % (lay[j][0]/1000.0, lay[i][2], lay[j][2], ov))

    # 4) 차례가 바뀌는 간격
    turns = [e for e in ev if e['kind'] == 'turn']
    gaps = [(turns[i+1]['t'] - turns[i]['t'])/1000.0 for i in range(len(turns)-1)]
    if gaps:
        gaps_s = sorted(gaps)
        print('차례/단계 전환 %d번, 중앙값 %.1f초, 가장 짧은 셋 %s' %
              (len(turns), gaps_s[len(gaps_s)//2], ['%.1f' % g for g in gaps_s[:3]]))

    print()
    if not problems: print('  ✓ 너무 빨리 지나가는 안내 없음')
    else:
        print('  ! 걸린 것 %d개' % len(problems))
        for p in problems[:26]: print('   ·', p)
    print()
    return problems

if __name__ == '__main__':
    run(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else '기본판')
