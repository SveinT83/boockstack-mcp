export const escapeHtml = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
export function page(title: string, content: string): string {
  return `<!doctype html><html lang="nb"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · BookStack</title><link rel="stylesheet" href="/style.css"></head><body><main><p class="eyebrow">Trønder Data · BookStack MCP</p><h1>${escapeHtml(title)}</h1>${content}</main></body></html>`;
}
export const stylesheet = `:root{font-family:system-ui,sans-serif;color:#172f3b;background:#f0f4f6;line-height:1.65}body{margin:0;padding:3rem 1rem}main{max-width:48rem;margin:auto;background:white;padding:clamp(1.4rem,5vw,3rem);border-radius:1rem;box-shadow:0 8px 35px #1b354b12}h1{line-height:1.2;font-size:2rem}.eyebrow{color:#526e7b;font-size:.85rem;letter-spacing:.08em}a{color:#075a80}label{display:block;font-weight:600;margin-top:1rem}input[type=password]{box-sizing:border-box;width:100%;padding:.8rem;font:inherit;border:1px solid #6a8491;border-radius:.4rem}button,.button{display:inline-block;margin-top:1.2rem;background:#075a67;color:white;border:0;border-radius:.4rem;padding:.8rem 1.2rem;font:inherit;cursor:pointer;text-decoration:none}.danger{background:#942b2b}.notice{background:#edf5f7;border-left:4px solid #276e7b;padding:1rem}small{display:block;color:#526e7b}hr{border:0;border-top:1px solid #dce4e8;margin:2rem 0}li{margin:.5rem 0}`;
