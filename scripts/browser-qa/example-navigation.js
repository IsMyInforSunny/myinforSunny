async page => {
  const origin='http://127.0.0.1:5173';
  const check=(ok,message)=>{if(!ok)throw new Error(message);};
  const log=[];
  const settle=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  // The capabilities request starts in Workbench's mount effect, after React
  // has attached the handlers. SSR buttons can be visible before that point.
  const gotoReady=async url=>{
    const capabilities=page.waitForResponse(response=>response.url().endsWith('/api/capabilities'));
    await page.goto(url);await capabilities;await settle();
  };
  const openDialog=title=>page.locator('dialog[open]').filter({has:page.getByRole('heading',{name:title,exact:true})});
  const runInterrupted=async reset=>{
    await gotoReady(origin);
    let release;
    const held=new Promise(resolve=>{release=resolve;});
    let entered;
    const intercepted=new Promise(resolve=>{entered=resolve;});
    const hold=async route=>{entered();await held;try{await route.abort();}catch{}};
    await page.route('**/api/analyze',hold);
    try{
      await page.getByRole('button',{name:'좌표 보기',exact:true}).click();
      await page.getByRole('button',{name:'예시로 좌표 체험 시작하기',exact:true}).click();
      await intercepted;
      await page.keyboard.press('Escape');
      const failed=page.waitForEvent('requestfailed',request=>request.url().endsWith('/api/analyze'));
      if(reset){
        await page.getByRole('button',{name:'기사 입력하기',exact:true}).click();
        await page.getByRole('button',{name:'입력과 결과 초기화',exact:true}).click();
      }else{
        await page.getByRole('button',{name:'요청 취소',exact:true}).click();
      }
      await failed;release();await settle();
      if(reset){
        check(await openDialog('기사 입력').isVisible(),'Cancelled example reopened coordinates over the reset editor');
        check(await page.getByRole('textbox',{name:'본문 필수'}).inputValue()==='','Cancelled example restored reset input');
      }else check(await page.locator('dialog[open]').count()===0,'Cancelled example reopened coordinates');
      // Reset keeps the editor dialog open, so the background button is inert.
      check(await page.getByRole('button',{name:'분석근거 표시',exact:true,includeHidden:true}).isDisabled(),'Cancelled example restored an analysis');
      log.push(reset?'reset suppresses late example navigation and input restoration':'cancel suppresses late example navigation');
    }finally{release();await page.unroute('**/api/analyze',hold);}
  };
  await runInterrupted(false);
  await runInterrupted(true);
  await gotoReady(origin);
  await page.getByRole('button',{name:'좌표 보기',exact:true}).click();
  await page.getByRole('button',{name:'예시로 좌표 체험 시작하기',exact:true}).click();
  await page.getByRole('heading',{name:'같은 명제, 얼마나 다른 위치일까요?',exact:true}).waitFor();
  check(await openDialog('매체 좌표와 편향 비교').isVisible(),'Successful example did not open coordinates');
  log.push('successful example still opens coordinates');
  await page.keyboard.press('Escape');
  await page.route('**/api/capabilities',route=>route.fulfill({json:{live:true,webSearch:true,webFetch:true}}));
  try{
    await gotoReady(origin+'/?example=supported');
    await page.getByRole('button',{name:'분석근거 표시',exact:true}).click();
    await page.getByRole('tab',{name:'주장 · 자료 대조 1'}).click();
    await page.getByText('수동 대조에는 참고자료 본문을 직접 넣어 주세요.',{exact:false}).waitFor();
    check(await page.getByText('설정된 공개 출처의 URL만 본문 취득을 지원해요.',{exact:false}).count()===0,'Manual comparison promised unsupported URL fetching');
    log.push('manual comparison explains required pasted text even with automated fetching enabled');
  }finally{await page.unroute('**/api/capabilities');}
  return {scope:'local browser, synthetic examples and mocked capabilities only',passed:log};
}
