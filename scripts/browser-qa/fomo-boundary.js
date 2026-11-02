async page => {
  const origin='http://127.0.0.1:5173';
  const check=(ok,message)=>{if(!ok)throw Error(message);};
  const sample=await (await page.request.post(origin+'/api/analyze',{data:{kind:'demo',fixtureId:'supported'}})).json();
  const body='가'.repeat(495)+' 지금 당장 참여하세요.';
  // These exact ranges reproduce the current 500-unit fragmenter's whitespace
  // split inside one natural sentence, without invoking an external model.
  const units=[{id:'body_s0',start:0,end:498,natural:{index:0,part:0,parts:2}},
    {id:'body_s1',start:499,end:body.length,natural:{index:0,part:1,parts:2}}];
  const analysis={...sample,analysisId:'browser_fomo_boundary',mode:'live',sources:[{id:'body',kind:'body',text:body,sentences:units}],
    claims:[],topics:[],topicAssignments:[],proposition:undefined,stances:undefined,
    bodyTopicAssignments:units.map(u=>({sentenceId:u.id,status:'other',topicIds:[]})),
    expressions:units.map(u=>({sourceId:'body',sentenceId:u.id,status:'clear',criteria:[],context:'direct',evidence:[]})),
    counterArguments:[],perspectiveQuestions:[],warnings:[],coverage:{totalSentences:2,naturalSentences:1,factualClaimsExtracted:0,claimsMayBeOmitted:false,scopeNote:'공개 합성 문장 경계 검증입니다.'}};
  const test=await page.context().newPage();
  try{
    await test.route('**/api/capabilities',r=>r.fulfill({json:{live:true,webSearch:false,webFetch:false}}));
    await test.route('**/api/analyze',r=>r.fulfill({json:analysis}));
    const ready=test.waitForResponse(r=>r.url().endsWith('/api/capabilities'));
    await test.goto(origin);await ready;
    await test.getByRole('button',{name:'기사 입력하기',exact:true}).click();
    await test.getByRole('textbox',{name:'본문 필수'}).fill(body);
    await test.getByRole('checkbox',{name:/가상 또는 사용 가능한 공개 자료/}).check();
    await test.getByRole('button',{name:'정보 성분표 만들기',exact:true}).click();
    await test.getByRole('button',{name:'분석근거 표시',exact:true}).click();
    await test.getByRole('meter',{name:'본문 1문장 중 FOMO 표현 후보 1문장',exact:true}).waitFor();
    check(await test.locator('.review-article').textContent()===body,'Annotations changed the original body');
    for(const word of ['지금','당장']){
      await test.getByRole('button',{name:`${word} — FOMO 표현 후보`,exact:true}).click();
      check((await test.locator('.review-explanation').innerText()).includes('지금 당장'),'Fragment explanation lost the full detected phrase');
    }
    await test.setViewportSize({width:375,height:820});
    const width=await test.evaluate(()=>({client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));
    check(width.scroll<=width.client+1,'Boundary annotations overflow on mobile');
    return {scope:'mocked local analysis of one public synthetic long sentence',naturalSentences:1,processingUnits:2,flaggedSentences:1,markedParts:2,passed:[
      'FOMO count and visible source marks agree across processing units',
      'both marks explain the complete detected phrase',
      'source text and one-sentence denominator remain unchanged',
      '375px layout has no horizontal overflow',
    ]};
  }finally{await test.close();}
}
