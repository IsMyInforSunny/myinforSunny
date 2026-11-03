async page => {
 const origin=new URL(page.url()).origin;
 const sample=await (await page.request.post(origin+'/api/analyze',{data:{kind:'demo',fixtureId:'supported'}})).json();
 const capabilities=await (await page.request.get(origin+'/api/capabilities')).json();
 let searchReady=false,textRequests=0;
 const capRoute=route=>route.fulfill({json:{...capabilities,live:true,webSearch:searchReady,webFetch:searchReady}});
 const analysisRoute=route=>{
  if(route.request().postDataJSON().kind==='demo')return route.continue();
  textRequests++;
  return route.fulfill({json:{...sample,mode:'live',status:'success'}});
 };
 const check=(value,message)=>{if(!value)throw Error(message);};
 await page.route('**/api/capabilities',capRoute);
 await page.route('**/api/analyze',analysisRoute);
 try{
  const inspect=async()=>{
   await page.goto(origin+'/?qa=pending-'+Date.now());
   check(await page.locator('aside[aria-label="산출 대기 이유"]').count()===0,'No-input screen suggested an unfinished analysis');
   await page.getByRole('button',{name:'기사 입력하기',exact:true}).click();
   await page.getByRole('textbox',{name:'본문 필수'}).fill('화면 검사용 공개 가상 기사입니다.');
   await page.locator('dialog[open] .transmission-consent input').check();
   await page.getByRole('button',{name:'정보 성분표 만들기',exact:true}).click();
   const guide=page.locator('aside[aria-label="산출 대기 이유"]');
   await guide.waitFor();
   const text=await guide.innerText();
   check(text.includes('비교 모델과 검토 기사 자료를 준비 중'),'Missing known model availability reason');
   check(!text.includes('외부 자료를 조사하고 있어요'),'Claimed an unstarted investigation was running');
   check(!(await page.locator('.cv3-axis-expression .cv3-axis-value').innerText()).includes('산출 대기'),'Usable expression score was hidden');
   return text;
  };
  const unavailable=await inspect();
  check(unavailable.includes('관련 기사 검색과 원문 수집을 연결 중'),'Missing unavailable article-collection reason');
  await page.setViewportSize({width:375,height:812});
  const layout=await page.evaluate(()=>({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));
  check(layout.scroll<=layout.width+1,'Readiness guide overflows at 375px');
  await page.setViewportSize({width:1280,height:900});
  searchReady=true;
  const available=await inspect();
  check(available.includes('외부 근거 대조가 필요해요'),'Available research did not explain next step');
  check(!available.includes('기사 검색과 원문 수집을 연결 중'),'Known ready search was described as disconnected');
  check(textRequests===2,'Unexpected analysis dispatch count');
  return {scope:'selected origin; synthetic analysis intercepted; external inference requests: 0',passed:['no pending message before analysis','known model and search prerequisites explained','available research offers the next step without claiming it started','existing expression score remains visible','375px readiness guide has no horizontal overflow']};
 }finally{
  await page.unroute('**/api/capabilities',capRoute);
  await page.unroute('**/api/analyze',analysisRoute);
 }
}
