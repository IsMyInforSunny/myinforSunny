async page => {
 // Main Canva dashboard states with intercepted local API responses only; no external model or search calls.
 const origin='http://127.0.0.1:5173';
 const check=(ok,message)=>{if(!ok)throw new Error(message);};
 const log=[];
 const sample=await (await page.request.post(origin+'/api/analyze',{data:{kind:'demo',fixtureId:'supported'}})).json();
 const partial={...sample,mode:'live',status:'partial',analysisId:'browser_mock_partial',requestId:'browser_mock_partial',createdAt:new Date().toISOString()};
 await page.route('**/api/capabilities',route=>route.fulfill({json:{live:true,webSearch:false,webFetch:false,rubricVersion:'browser-mock',limits:{body:2000,comments:5,comment:200,claimsPerCheck:1},searchProvider:'none'}}));
 await page.route('**/api/analyze',route=>route.request().postDataJSON().kind==='demo'?route.continue():route.fulfill({json:partial}));
 const state=()=>page.evaluate(()=>{
  const frame=document.querySelector('.cv3-frame');
  return {
   status:document.querySelector('.cv3-status')?.textContent??'',
   gauge:document.querySelector('.cv3-gauge-svg')?.getAttribute('aria-label')??'',
   board:document.querySelector('.cv3-board')?.className??'',
   axes:document.querySelector('.cv3-axes')?.getAttribute('aria-label')??'',
   notices:[...document.querySelectorAll('.cv3-notice')].map(n=>({text:n.textContent,above:!!(n.compareDocumentPosition(frame)&Node.DOCUMENT_POSITION_FOLLOWING)})),
  };
 });
 const overflow=()=>page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
 try{
  const capabilitiesLoaded=page.waitForResponse(response=>response.url().endsWith('/api/capabilities'));
  await page.setViewportSize({width:1280,height:900});
  await page.goto(origin);await capabilitiesLoaded;

  await page.getByRole('button',{name:'기사 입력하기',exact:true}).click();
  await page.getByRole('textbox',{name:'본문 필수'}).fill(sample.sources.find(s=>s.kind==='body').text);
  await page.getByRole('checkbox',{name:/가상 또는 사용 가능한 공개 자료/}).check();
  await page.getByRole('button',{name:'정보 성분표 만들기',exact:true}).click();
  await page.locator('.cv3-status',{hasText:'일부만 분석됨'}).waitFor();
  if(await page.locator('dialog[open]').count())await page.keyboard.press('Escape');
  let s=await state();
  check(s.status==='현재 입력의 분석 결과 · 일부만 분석됨',`Partial badge missing: ${s.status}`);
  const partialNote=s.notices.find(n=>n.text.includes('일부 분석만 완료된 결과'));
  check(partialNote&&partialNote.above,'Partial notice is not shown above the board');
  check(!s.notices.some(n=>n.text.includes('체험용 가상 데이터')),'Live partial result is labelled as demo');
  log.push('mocked live partial analysis shows the partial badge and the notice above the board');

  const evidence=page.getByRole('button',{name:'분석근거 표시',exact:true});
  check(!(await evidence.isDisabled()),'Evidence button disabled for a partial result');
  await evidence.click();
  await page.locator('dialog[open] #analysis-details').waitFor();
  await page.keyboard.press('Escape');
  check(await page.evaluate(()=>document.activeElement?.textContent.trim())==='분석근거 표시','Focus did not return to the evidence button');
  log.push('partial result opens evidence details and Esc returns focus');

  await page.getByRole('button',{name:'기사 다시 입력',exact:true}).click();
  await page.getByRole('textbox',{name:'본문 필수'}).press('End');
  await page.getByRole('textbox',{name:'본문 필수'}).pressSequentially(' 수정');
  await page.keyboard.press('Escape');
  s=await state();
  check(s.status.includes('이전 입력의 분석 결과')&&s.status.includes('일부만 분석됨'),`Stale partial badge wrong: ${s.status}`);
  check(s.board.includes('is-stale'),'Stale board styling missing');
  check(s.axes.includes('이전 입력의 결과'),'Stale axes label missing');
  check(s.gauge.startsWith('이전 입력 결과:'),'Stale gauge label missing');
  check(s.notices.some(n=>n.text.includes('이전 입력')&&n.above)&&s.notices.some(n=>n.text.includes('일부 분석만')&&n.above),'Stale and partial notices are not both above the board');
  log.push('editing the input after a partial result keeps both notices and marks the board as stale');

  for(const width of [1280,768,375,320]){
   await page.setViewportSize({width,height:900});
   check(!(await overflow()),`Dashboard overflows at ${width}px`);
  }
  log.push('partial and stale notices fit 1280, 768, 375 and 320px without horizontal overflow');
  return {scope:'intercepted local /api/analyze; synthetic public example; no external model or search',passed:log};
 }finally{
  await page.unrouteAll({behavior:'ignoreErrors'});
  await page.setViewportSize({width:1280,height:900});
 }
}
