async page => {
 const origin='http://127.0.0.1:5173';
 const check=(ok,message)=>{if(!ok)throw Error(message);};
 const log=[];
 const loaded=page.waitForResponse(r=>r.url().endsWith('/api/capabilities'));
 await page.goto(origin);await loaded;
 await page.getByRole('button',{name:'작은 창 · 동작 기록',exact:true}).click();
 const opened=page.context().waitForEvent('page');
 await page.getByRole('button',{name:'작은 창으로 분석하기 ↗',exact:true}).click();
 const popup=await opened;
 try {
  await popup.waitForLoadState('networkidle');
  check(popup.url()===origin+'/popup','Popup opened the wrong route');
  check(await popup.evaluate(()=>window.opener===null),'Popup retained its opener');
  check((await page.getByRole('status').filter({hasText:'현재 입력 내용은 새 창으로 자동 전달하지 않습니다.'}).innerText()).includes('자동 전달하지 않습니다.'),'Popup transfer notice missing');
  await popup.setViewportSize({width:560,height:820});
  await popup.getByRole('button',{name:'기사 입력하기',exact:true}).click();
  await popup.getByRole('button',{name:'출처에서 확인된 주장',exact:true}).click();
  await popup.getByRole('status').filter({hasText:'가상 예시'}).waitFor();
  await popup.getByRole('img',{name:/편향 정도 계산 대기/}).waitFor();
  log.push('actual popup opens /popup without opener or automatic source transfer; demo leaves the untrained bias gauge pending');
  await popup.getByRole('button',{name:'분석근거 표시',exact:true}).click();
  const claims=popup.getByRole('tab',{name:'주장 · 자료 대조 1',exact:true});
  await claims.click();await claims.press('ArrowLeft');
  check(await popup.getByRole('tab',{name:'성분 살펴보기',exact:true}).getAttribute('aria-selected')==='true','ArrowLeft did not activate overview');
  await popup.keyboard.press('End');
  check(await claims.getAttribute('aria-selected')==='true','End did not activate claims');
  await popup.keyboard.press('Home');
  check(await popup.getByRole('tab',{name:'성분 살펴보기',exact:true}).getAttribute('aria-selected')==='true','Home did not activate overview');
  log.push('popup review tabs support arrows, Home and End with synchronized selection');
  await claims.click();await popup.getByRole('button',{name:'원문 확인',exact:true}).click();
  check((await popup.locator('.source-box mark').allTextContents()).some(t=>t.includes('도서관')),'Popup quote did not highlight its source');
  log.push('popup claim citation opens and highlights the same analyzed source');
  for(const width of [560,375]){
   await popup.setViewportSize({width,height:820});
   const sizes=await popup.evaluate(()=>({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,dialogs:[...document.querySelectorAll('dialog[open]')].map(d=>({width:d.clientWidth,scroll:d.scrollWidth}))}));
   check(sizes.scroll<=sizes.width+1,`Popup document overflows at ${width}`);
   check(sizes.dialogs.length===1&&sizes.dialogs.every(d=>d.scroll<=d.width+1),`Popup dialog overflows at ${width}`);
   const headingBounds=await popup.locator('dialog[open] .canva-dialog-heading').boundingBox();
   const closeBounds=await popup.getByRole('button',{name:'창 닫기',exact:true}).boundingBox();
   check(headingBounds.y>=0&&closeBounds.y>=0,'Popup heading or close button was scrolled above the viewport');
   await popup.screenshot({path:`output/playwright/popup-evidence-${width}-1102.png`});
  }
  log.push('560px and 375px popup evidence views have one open dialog and no horizontal overflow');
  await popup.keyboard.press('Escape');
  await popup.getByRole('button',{name:'분석근거 표시',exact:true}).waitFor({state:'visible'});
  check(await popup.locator('dialog[open]').count()===0,'Escape did not close popup evidence');
  return {scope:'actual local popup; synthetic examples only; no external API',passed:log};
 } finally {
  await popup.close();await page.keyboard.press('Escape');
 }
}
