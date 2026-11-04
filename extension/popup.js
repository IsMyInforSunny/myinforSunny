const SITE_ORIGIN = 'https://naeinfo-clear-code2026.mseohyeon190.chatgpt.site';
const MAX_SELECTION = 2000;
const preview = document.getElementById('preview'), status = document.getElementById('status'), count = document.getElementById('count');
function updateCount() { count.textContent = `${preview.value.length.toLocaleString()} / ${MAX_SELECTION.toLocaleString()}자`; }
preview.addEventListener('input', updateCount);
chrome.tabs.query({ active: true, currentWindow: true }).then(async tabs => {
  if (!tabs[0]?.id) return;
  try {
    const results = await chrome.scripting.executeScript({ target: { tabId: tabs[0].id }, func: () => { const selection = window.getSelection()?.toString() ?? ''; return { text: selection.slice(0, 20_000), length: selection.length }; } });
    const selection = results[0]?.result;
    // Never silently send a truncated selection. Long selections must be edited explicitly.
    preview.value = selection?.text ?? '';
    if ((selection?.length ?? 0) > MAX_SELECTION) status.textContent = '선택한 글이 2,000자를 넘어요. 전달 전에 필요한 부분만 남겨 주세요. 20,000자를 넘는 선택 글은 미리보기도 일부만 표시됩니다.';
    updateCount();
  } catch { status.textContent = '이 페이지에서는 선택 글을 읽을 수 없어요. 직접 붙여 넣어 주세요.'; }
}).catch(() => { status.textContent = '현재 탭을 확인하지 못했어요. 글을 직접 붙여 넣어 주세요.'; });
function target(path) {
  const text = preview.value;
  if (!text.trim()) { status.textContent = '먼저 글을 선택하거나 입력해 주세요.'; return null; }
  if (text.length > MAX_SELECTION) { status.textContent = '2,000자를 넘는 글은 전달하지 않습니다. 필요한 부분만 남겨 주세요.'; return null; }
  return `${SITE_ORIGIN}${path}#selection=${encodeURIComponent(text)}`;
}
document.getElementById('open').addEventListener('click', async () => {
  const url = target('/analyze'); if (!url) return;
  try { await chrome.tabs.create({ url }); } catch { status.textContent = '웹 화면을 열지 못했어요. 잠시 후 다시 눌러 주세요.'; }
});
document.getElementById('popup').addEventListener('click', async () => {
  const url = target('/popup'); if (!url) return;
  try { await chrome.windows.create({ url, type: 'popup', width: 580, height: 840 }); } catch { status.textContent = '작은 창을 열지 못했어요. 전체 웹 화면으로 열기를 이용해 주세요.'; }
});
updateCount();
