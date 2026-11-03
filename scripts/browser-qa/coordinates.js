async page => {
 const origin='http://127.0.0.1:5173';
 const check=(ok,message)=>{if(!ok)throw Error(message);};
 const sample=await (await page.request.post(origin+'/api/analyze',{data:{kind:'demo',fixtureId:'supported'}})).json();
 const first=sample.sources[0].text,second='토요일에는 오후 3시에 문을 닫는다.',body=`${first} ${second}`;
 const proposition='학교 도서관 운영 시간을 늘려야 한다.';
 const units=[{id:'body_s0',start:0,end:first.length,natural:{index:0,part:0,parts:1}},{id:'body_s1',start:first.length+1,end:body.length,natural:{index:1,part:0,parts:1}}];
 const claims=units.map((u,i)=>({id:`fact_${i}`,text:body.slice(u.start,u.end),kind:'factual',origin:[{sourceId:'body',sentenceId:u.id,start:u.start,end:u.end,quote:body.slice(u.start,u.end)}]}));
 const analysis={...sample,analysisId:'browser_coordinate_analysis',mode:'live',sources:[{id:'body',kind:'body',text:body,sentences:units}],claims,proposition,bodyTopicAssignments:units.map(u=>({sentenceId:u.id,status:'assigned',topicIds:[sample.topics[0].id]})),expressions:units.map(u=>({sourceId:'body',sentenceId:u.id,status:'clear',criteria:[],context:'direct',evidence:[]}))};
 const queries=[...claims.map(c=>({claimId:c.id,purpose:'fact_check',label:'도서관 운영 시간',query:'school library hours'})),{claimId:'comparison_position',purpose:'perspective',label:'운영 연장 입장',query:'school library extended hours viewpoints'}];
 const observed=[],received=[];let step=0;
 const refs=index=>['a','b'].map((host,j)=>{
  const quote=j===0?'학교 도서관 운영 시간을 늘려야 한다.':'학교 도서관 운영 시간을 늘릴 필요가 없다.';
  const context=['평일 이용자의 좌석 이용 계획을 살펴본 공개 합성 기사다.','주말 근무 인력의 배치 조건을 살펴본 공개 합성 기사다.','방과 후 교통편과 열람실 이용 조건을 살펴본 공개 합성 기사다.'][index];
  const text=`${first} ${second} ${context} ${quote}`;
  return {id:`ref_${index}_${host}`,url:`https://publisher-${host}.example/article-${index}`,title:`공개 합성 매체 ${host.toUpperCase()} 기사 ${index+1}`,text,provenance:'web_fetched',truncated:false,fetchedAt:new Date().toISOString(),quote,stance:j===0?'supports_position':'opposes_position'};
 });
 const test=await page.context().newPage();
 try{
  await test.clock.install();
  await test.route('**/api/capabilities',route=>route.fulfill({json:{live:true,webSearch:true,webFetch:true,rubricVersion:'browser-mock',limits:{body:2000,comments:5,comment:200,claimsPerCheck:1},searchProvider:'gdelt'}}));
  await test.route('**/api/analyze',route=>route.fulfill({json:analysis}));
  await test.route('**/api/research',route=>{
   const data=route.request().postDataJSON();received.push({operation:data.operation,proposition:data.input.proposition,claims:data.input.claims.length});
   if(data.operation==='plan')return route.fulfill({json:{schemaVersion:'research-1.0',planId:'synthetic-plan',token:'synthetic-plan-token',queries,claimCount:2,expiresAt:new Date(Date.now()+600000).toISOString(),nextModelCallAt:new Date(0).toISOString()}});
   if(data.operation==='discover'){step=data.queryIndex;return route.fulfill({json:{schemaVersion:'evidence-1.0',token:`synthetic-evidence-${step}`,references:refs(step),attempts:[]}});}
   const sources=refs(step),query=queries[step];
   const result={schemaVersion:'2.1',requestId:`synthetic-${step}`,mode:'live',status:'success',versions:{rubric:'mock',prompt:'mock',model:'mock',retriever:'mock'},scope:'retrieved_documents',references:sources.map(({quote,stance,...r})=>r),checks:query.purpose==='fact_check'?[{claimId:query.claimId,outcome:'supported',execution:'completed',relations:sources.map(r=>({referenceId:r.id,quote:claims[step].text,start:r.text.indexOf(claims[step].text),end:r.text.indexOf(claims[step].text)+claims[step].text.length,relation:'supports',explanation:'같은 운영 시간의 합성 인용이다.'})),explanation:'합성 자료 범위의 대조다.',temporalFit:'matched',limitations:[]}]:[],perspectiveChecks:sources.map(r=>({referenceId:r.id,positionText:proposition,stance:r.stance,quote:r.quote,start:r.text.indexOf(r.quote),end:r.text.indexOf(r.quote)+r.quote.length,explanation:'이 비교 명제에 대한 합성 입장 인용이다.'})),attempts:[],warnings:[],createdAt:new Date().toISOString()};
   observed.push(...sources);return route.fulfill({json:result});
  });
  const loaded=test.waitForResponse(r=>r.url().endsWith('/api/capabilities'));
  await test.goto(origin);await loaded;
  await test.getByRole('button',{name:'기사 입력하기',exact:true}).click();
  await test.getByRole('textbox',{name:'본문 필수'}).fill(body);
  await test.getByText('찬반 입장도 살펴보고 싶다면',{exact:true}).click();
  await test.getByRole('textbox',{name:'찬반을 살펴볼 명제',exact:true}).fill(proposition);
  await test.getByRole('checkbox',{name:/가상 또는 사용 가능한 공개 자료/}).check();
  await test.getByRole('button',{name:'정보 성분표 만들기',exact:true}).click();
  await test.getByRole('button',{name:'추천·조사 열기',exact:true}).click();
  const region=test.getByRole('region',{name:'자동 신뢰성 조사',exact:true});
  await region.getByText(`직접 지정한 비교 명제: ${proposition} · 이 명제에 대한 기사 입장을 별도로 살펴봅니다.`,{exact:true}).waitFor();
  await region.getByRole('checkbox').check();await region.getByRole('button',{name:'공개 자료로 자동 조사하기',exact:true}).click();
  for(let i=1;i<=2;i++){
   await region.getByText(/무료 AI 한도를 지키기 위해 약/).waitFor();
   await test.clock.fastForward(62000);
   if(i===1)await region.getByText('대조 완료 2개',{exact:true}).waitFor();
  }
  await region.getByRole('button',{name:'새 조사 준비하기',exact:true}).waitFor();
  check(observed.length===6,'Expected six bounded mocked article fetches');
  check(received.every(r=>r.proposition===proposition&&r.claims===2),'Explicit proposition was dropped or counted as a fact');
  check((await region.innerText()).includes('대조 완료 2개'),'Perspective query inflated factual completion');
  await test.keyboard.press('Escape');
  await test.getByRole('img',{name:/편향 정도 계산 대기/}).waitFor();
  await test.getByRole('button',{name:'좌표 보기',exact:true}).click();
  await test.getByLabel('직접 지정한 입력 기사 입장',{exact:true}).selectOption('1');
  check((await test.getByLabel('입장 차이의 절댓값',{exact:true}).innerText()).includes('1.000'),'Six-article publisher baseline did not update from the same research');
  const list=test.getByRole('list',{name:'매체별 좌표와 표본 적격 여부',exact:true});
  check(await list.getByRole('listitem').count()===2,'Expected two eligible publishers');
  check((await list.innerText()).match(/고유 기사 3개/g)?.length===2,'Expected three distinct articles per publisher');
  await test.setViewportSize({width:375,height:820});
  const bounds=await test.evaluate(()=>({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,dialogs:[...document.querySelectorAll('dialog[open]')].map(d=>({width:d.clientWidth,scroll:d.scrollWidth}))}));
  check(bounds.scroll<=bounds.width+1&&bounds.dialogs.every(d=>d.scroll<=d.width+1),'Mocked coordinates overflow on mobile');
  await test.screenshot({path:'output/playwright/current-coordinate-mock-375-1102.png'});
  return {scope:'intercepted local API; six synthetic articles, not real acquisition or accuracy evaluation',queries:3,articles:6,eligiblePublishers:2,factualCompletion:2,propositionExcludedFromFactualCount:true,baseline:0,inputStance:1,absoluteDifference:1,passed:['user-selected proposition reaches every research operation','related articles, factual progress and publisher coordinates share current analysis','three unique articles per publisher and two publishers remain required','mobile coordinates have no horizontal overflow']};
 }finally{await test.close();}
}
