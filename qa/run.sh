#!/bin/sh
# 화면을 실제로 돌려서 확인한다.
#   sh qa/run.sh play  [판수]   — 한 판을 끝까지 돌리며 오류를 모은다
#   sh qa/run.sh pace  [base|ck] — 안내가 몇 초씩 떠 있었는지 재서 너무 빠른 곳을 찾는다
# 미리 프로젝트 폴더를 http 로 띄워 두어야 한다:  python3 -m http.server 8899
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PORT=${PORT:-8896}   # 8899 는 다른 도구와 자주 겹친다
MODE=$2
case "$1" in
  play)
    N=${3:-1}; i=0
    while [ $i -lt $N ]; do
      "$CHROME" --headless --disable-gpu --hide-scrollbars --window-size=390,844 \
        --virtual-time-budget=1800000 --dump-dom "http://localhost:$PORT/?scene=qa&mode=${MODE:-base}" 2>/dev/null \
      | python3 -c "
import sys,re,json
m=re.search(r'<pre id=\"qaout\"[^>]*>(.*?)</pre>', sys.stdin.read(), re.S)
o=json.loads(m.group(1))
print(('OK  ' if o['done'] and not o['errs'] else 'NG  ')+o['mode']+' turn='+str(o['turn'])+' vps='+str(o.get('vps')))
[print('    ! '+e) for e in o['errs'][:6]]
"
      i=$((i+1))
    done ;;
  pace)
    "$CHROME" --headless --disable-gpu --hide-scrollbars --window-size=390,844 \
      --virtual-time-budget=1800000 --dump-dom "http://localhost:$PORT/?scene=timing&mode=${MODE:-base}" 2>/dev/null \
    | python3 -c "
import sys,re,json
m=re.search(r'<pre id=\"qaout\"[^>]*>(.*?)</pre>', sys.stdin.read(), re.S)
json.dump(json.loads(m.group(1)), open('/tmp/catan-pace.json','w'), ensure_ascii=False)
"
    python3 qa/pace.py /tmp/catan-pace.json "${MODE:-base}" ;;
  *) echo "쓰는 법: sh qa/run.sh play|pace [base|ck] [판수]" ;;
esac
