const preview=document.getElementById('preview');const status=document.getElementById('status');
chrome.tabs.query({active:true,currentWindow:true}).then(async tabs=>{
  if(!tabs[0]?.id)return;
  try{const results=await chrome.scripting.executeScript({target:{tabId:tabs[0].id},func:()=>window.getSelection()?.toString()??''});preview.value=(results[0]?.result??'').slice(0,8000);}catch{status.textContent='이 페이지에서는 선택 글을 읽을 수 없어요. 직접 붙여 넣어 주세요.';}
});
document.getElementById('open').addEventListener('click',()=>{
  if(!preview.value.trim()){status.textContent='먼저 글을 선택하거나 입력해 주세요.';return;}
  // Local fragment handoff: text is not placed in server query strings or logs.
  const url='http://127.0.0.1:4173/analyze#selection='+encodeURIComponent(preview.value);
  chrome.tabs.create({url});
});
