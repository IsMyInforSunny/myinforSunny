async page => {
 const origin='http://127.0.0.1:5173';
 const check=(ok,message)=>{if(!ok)throw new Error(message);};
 const sample=await (await page.request.post(origin+'/api/analyze',{data:{kind:'demo',fixtureId:'supported'}})).json();
 const demoReview=await (await page.request.post(origin+'/api/verify',{data:{kind:'demo',fixtureId:'supported'}})).json();
 const analysis={...sample,mode:'live',analysisId:'browser_mock_analysis',requestId:'browser_mock_analysis',createdAt:new Date().toISOString()};
 const review={...demoReview,mode:'live',parentAnalysisId:undefined,references:demoReview.references.map((r,i)=>({...r,provenance:'web_fetched',url:`https://news.example/browser-fixture-${i}`,fetchedAt:new Date().toISOString()}))};
 let planCount=0,compareCount=0,holdAnalysis=true,quota=false;const releases=[],log=[];
 const defer=(route,json)=>new Promise(resolve=>{releases.push(async()=>{try{await route.fulfill({json});}catch{}finally{resolve();}});});
 const releaseAll=async()=>{for(const release of releases.splice(0))await release();};
 await page.route('**/api/capabilities',route=>route.fulfill({json:{live:true,webSearch:true,webFetch:true,rubricVersion:'browser-mock',limits:{body:2000,comments:5,comment:200,claimsPerCheck:1},searchProvider:'firecrawl'}}));
 await page.route('**/api/analyze',route=>{
  if(route.request().postDataJSON().kind==='demo')return route.continue();
  if(quota)return route.fulfill({status:429,json:{error:{code:'FREE_QUOTA_EXHAUSTED',message:'Synthetic free quota boundary'}}});
  return holdAnalysis?defer(route,analysis):route.fulfill({json:analysis});
 });
 await page.route('**/api/research',route=>{
  const operation=route.request().postDataJSON().operation;
  if(operation==='plan'){planCount++;return route.fulfill({json:{schemaVersion:'research-1.0',planId:'mock-plan',token:'synthetic-plan',queries:[{claimId:analysis.claims[0].id,label:'공개 가상 자료',query:'fictional library hours',purpose:'fact_check'}],claimCount:1,expiresAt:new Date(Date.now()+600000).toISOString(),nextModelCallAt:new Date(0).toISOString()}});}
  if(operation==='discover')return defer(route,{schemaVersion:'evidence-1.0',token:'synthetic-evidence',references:review.references,attempts:[]});
  compareCount++;return route.fulfill({json:review});
 });
 const openInput=async()=>{await page.getByRole('button',{name:/^기사 (입력하기|다시 입력)$/}).click();};

 try{
  const capabilitiesLoaded=page.waitForResponse(response=>response.url().endsWith('/api/capabilities'));
  await page.goto(origin);await capabilitiesLoaded;
  await openInput();await page.getByRole('textbox',{name:'본문 필수'}).fill(sample.sources.find(s=>s.kind==='body').text);
  await page.getByRole('checkbox',{name:/가상 또는 사용 가능한 공개 자료/}).check();
  await page.getByRole('button',{name:'정보 성분표 만들기',exact:true}).click();
  await page.getByRole('button',{name:'요청 취소',exact:true}).waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'진행 화면 열기',exact:true}).waitFor();
  await page.getByRole('button',{name:'요청 취소',exact:true}).click();
  await releaseAll();
  check(await page.getByRole('button',{name:'분석근거 표시',exact:true}).isDisabled(),'Late analysis response survived cancellation');
  log.push('closed input keeps visible progress and cancellation suppresses late analysis response');
  holdAnalysis=false;
  await openInput();await page.getByRole('checkbox',{name:/가상 또는 사용 가능한 공개 자료/}).check();
  await page.getByRole('button',{name:'정보 성분표 만들기',exact:true}).click();
  await page.getByRole('button',{name:'분석근거 표시',exact:true}).click();
  const region=page.getByRole('region',{name:'자동 신뢰성 조사',exact:true});
  await region.getByRole('checkbox').check();await region.getByRole('button',{name:'공개 자료로 자동 조사하기',exact:true}).click();
  await region.getByText('1/1 · 공개 가상 자료 관련 자료를 찾고 있어요.',{exact:true}).waitFor();
  await region.getByRole('button',{name:'조사 취소',exact:true}).click();
  await region.getByRole('button',{name:'새 조사 준비하기',exact:true}).click();
  check(!await region.getByRole('checkbox').isChecked(),'Research restart retained consent');
  check(planCount===1&&compareCount===0,'Cancellation retried or compared automatically');
  await releaseAll();
  log.push('research cancel and prepare restart require fresh consent and do not retry');
  await region.getByRole('checkbox').check();await region.getByRole('button',{name:'공개 자료로 자동 조사하기',exact:true}).click();
  await region.getByText('1/1 · 공개 가상 자료 관련 자료를 찾고 있어요.',{exact:true}).waitFor();
  await page.keyboard.press('Escape');await openInput();
  const body=page.getByRole('textbox',{name:'본문 필수'}),original=await body.inputValue();
  await body.fill(original+' 공개 가상 수정 문장.');await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'분석근거 표시',exact:true}).click();
  check(JSON.parse(await page.locator('.export-preview pre').textContent()).research.stage==='cancelled','Changed input did not cancel research');
  await page.keyboard.press('Escape');await openInput();await body.fill(original);await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'분석근거 표시',exact:true}).click();
  check(!await region.getByRole('checkbox').isChecked(),'Restored input reused research consent');
  check(await region.getByRole('button',{name:'공개 자료로 자동 조사하기',exact:true}).isDisabled(),'Restored input restarted research');
  check(planCount===2&&compareCount===0,'Restoring input issued an automatic API call');
  await releaseAll();
  log.push('input change cancels active research and restoring the text makes no new call');
  await region.getByRole('checkbox').check();await region.getByRole('button',{name:'공개 자료로 자동 조사하기',exact:true}).click();
  await region.getByText('1/1 · 공개 가상 자료 관련 자료를 찾고 있어요.',{exact:true}).waitFor();
  await releaseAll();await region.getByRole('button',{name:'새 조사 준비하기',exact:true}).waitFor();
  check(planCount===3&&compareCount===1,'Explicit restart did not complete one comparison');
  check((await region.innerText()).includes('대조 완료 1개'),'Local research panel lost the unbound server result');
  await page.keyboard.press('Escape');
  check(await page.getByRole('img',{name:/사실 주장 1개 중 1개 대조 완료/}).isVisible(),'Completed research did not update main gauge');
  log.push('explicit restart completes one mocked comparison and updates the same main gauge');
  await page.getByRole('button',{name:'분석근거 표시',exact:true}).click();
  const exported=JSON.parse(await page.locator('.export-preview pre').textContent());
  check(exported.summary.completedChecks===1&&exported.research.completedClaims===1,'Export completion differs from the main gauge');
  check(!('analysis' in exported)&&!('results' in exported.research),'Default export includes raw input or source results');
  await page.keyboard.press('Escape');
  log.push('default export matches automatic completion on the main gauge without raw input or reference text');
  quota=true;
  await openInput();await body.fill(original+' 추가 가상 문장.');await page.getByRole('checkbox',{name:/가상 또는 사용 가능한 공개 자료/}).check();
  await page.getByRole('button',{name:'정보 성분표 만들기',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'오늘 실시간 분석 한도를 다 썼어요.'}).waitFor();
  check(await page.getByRole('status').filter({hasText:'가상 예시 · 실제 웹 조사 아님'}).isVisible(),'Quota fallback did not open a marked demo');
  log.push('quota exhaustion switches to a clearly marked demo and retains the limit notice');
  return {scope:'browser with intercepted local API responses; no external model/search calls',planCount,compareCount,passed:log};
 }catch(error){throw new Error(JSON.stringify({message:error.message,log,planCount,compareCount,openDialog:await page.locator('dialog[open]').allTextContents()}));}finally{
  await releaseAll();await page.unroute('**/api/capabilities');await page.unroute('**/api/analyze');await page.unroute('**/api/research');await page.goto(origin);
 }
}
