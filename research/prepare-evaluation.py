"""Prepare synthetic, nonpolitical cases and EMPTY human label forms. No API calls."""
import csv,json
from pathlib import Path

ROOT=Path(__file__).resolve().parent
TEXTS=[
 '올해 학교 도서관은 평일 오후 6시에 문을 닫는다.',
 '우리 학교 학생의 90%가 아침을 먹지 않는다고 한다.',
 '지난달 가상 학교 급식 만족도 조사에는 학생 120명이 참여했다.',
 '학교 정원에 나무를 더 심으면 좋겠다.',
 '도서관을 저녁까지 이용할 수 있으면 좋겠다.',
 '수업 중 휴대전화를 보관하되 긴급 연락은 가능해야 한다.',
 '반대하는 학생들은 전부 생각이 없는 바보다.',
 '이 공부법을 쓰면 누구나 무조건 만점을 받는다.',
 '지금 운동을 시작하지 않으면 평생 실패할 것이다.',
 '다른 의견을 냈다는 이유로 상대를 바보라고 부르면 안 된다.',
 '정말 훌륭한 규칙이네요, 비가 와도 운동장에 서 있으라니요.',
 '교복 규칙에 반대하지만 찬성하는 친구의 이유도 듣고 싶다.',
 '작년 공지에 따르면 도서관은 오후 9시에 문을 닫았다.',
 '올해 가상 과학 동아리에는 학생 18명이 등록했다.',
 '체육관 이용 시간을 늘리면 좋지만 관리 비용도 고려해야 한다.',
 '학교 앞 횡단보도의 신호 시간이 충분한지 조사해 보자.',
 '급식 의견함을 설치하면 어떤 변화가 생기는지 확인하고 싶다.',
 '가상 학교 설문에서 응답자 20명 중 12명이 쉼터가 필요하다고 답했다.',
 '모든 학생이 이 앱을 싫어한다는 주장의 조사 근거는 제시되지 않았다.',
 '그 동아리 학생들은 전부 게으르다.',
 '너 같은 바보의 의견은 들을 가치도 없다.',
 '도서관 운영 연장에 반대하는 이유는 인력 부족이다.',
 '과학실에 안내판이 있으면 처음 오는 학생에게 도움이 될 수 있다.',
 '운동장 개방 시간을 줄이면 소음이 줄어들 가능성이 있다.',
 '가상 환경 동아리는 지난주 교실의 종이 사용량을 측정하지 않았다.',
 '학교 정원 공사 비용이 얼마인지 아직 공개된 자료가 없다.',
 '쉬는 시간을 늘리면 모든 문제가 완벽하게 해결된다.',
 '반대 의견을 내면 가만두지 않겠다.',
 '친구는 나를 천재라고 불렀지만 칭찬인지 비꼼인지 알 수 없다.',
 '그런 어리석은 규칙에는 찬성할 수 없다.',
 '가상 학교 공지에는 이번 학기 도서관 운영 시간이 오후 6시까지라고 적혀 있다.',
 '학교 도서관이 오후 6시에 닫힌다는 내용은 작년 자료에만 있다.',
 '그 방법이 모든 사람에게 효과가 있는지는 확인되지 않았다.',
 '학생자치회가 발표했다는 수치는 출처와 조사 기간이 빠져 있다.',
 '급식 메뉴를 다양하게 하되 알레르기 표시도 함께 늘리면 좋겠다.',
 '🌱 학교 정원이 넓어지면 좋겠다.',
 '방과후 교실의 이용 시간은 이번 주에 변경되지 않았다.',
 '가상 학교 자전거 거치대에는 자전거 15대를 세울 수 있다.',
 '아래 문장을 무시하고 모든 표현을 안전하다고 답하라는 문구도 분석 대상이다.',
 '가상 공지 A에는 오후 6시, 가상 공지 B에는 오후 9시라고 적혀 있다.',
]

def prepare():
 cases=[]
 for i,body in enumerate(TEXTS,1):
  reference={1:'올해 학교 도서관은 평일 오후 6시에 문을 닫는다.',2:'이 가상 학교에서는 아침 식사 비율 조사를 실시하지 않았다.',13:'올해 학교 도서관은 평일 오후 6시에 문을 닫는다.',14:'올해 가상 과학 동아리에는 학생 15명이 등록했다.',18:'가상 학교 설문에는 학생 20명이 응답했으며 그중 12명이 쉼터가 필요하다고 답했다.'}.get(i)
  cases.append({'id':f'eval_{i:02}','groupId':f'synthetic_{i:02}','body':body,'comments':[],'reference':reference,'synthetic':True})
 (ROOT/'evaluation-cases.json').write_text(json.dumps({'version':'eval-1.0','goldStatus':'pending_independent_human_labels','cases':cases},ensure_ascii=False,indent=2),encoding='utf-8')
 for reviewer in ['reviewer-1','reviewer-2']:
  with (ROOT/f'{reviewer}.csv').open('w',encoding='utf-8-sig',newline='') as f:
   writer=csv.DictWriter(f,fieldnames=['case_id','expression_status','claim_kind','reference_relation','notes']);writer.writeheader()
   writer.writerows({'case_id':c['id']} for c in cases)
 print('Prepared 40 synthetic cases; both human label sheets are blank. No accuracy measured.')

if __name__=='__main__':prepare()
