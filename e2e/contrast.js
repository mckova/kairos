const { chromium } = require('playwright');
const audit = () => {
  const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,\/]+/).map(Number); return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] }; };
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }; return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); };
  const over = (top, bot) => ({ r: top.r * top.a + bot.r * (1 - top.a), g: top.g * top.a + bot.g * (1 - top.a), b: top.b * top.a + bot.b * (1 - top.a), a: 1 });
  const bgOf = (el) => { const stack = []; for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0) { stack.push(c); if (c.a >= 1) break; } } let base = { r: 255, g: 255, b: 255, a: 1 }; const bodyBg = parse(getComputedStyle(document.body).backgroundColor); if (bodyBg && bodyBg.a > 0) base = bodyBg; for (let i = stack.length - 1; i >= 0; i--) base = over(stack[i], base); return base; };
  const out = [];
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  while (w.nextNode()) {
    const n = w.currentNode; if (!n.textContent.trim()) continue; const el = n.parentElement; if (!el || seen.has(el)) continue; seen.add(el);
    const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
    if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0 || r.width < 2 || r.height < 2) continue;
    if (r.bottom < 0 || r.top > innerHeight) continue;
    let fg = parse(cs.color); if (!fg) continue; const bg = bgOf(el); fg = over(fg, bg);
    const L1 = lum(fg), L2 = lum(bg); const ratio = (Math.max(L1, L2) + .05) / (Math.min(L1, L2) + .05);
    const size = parseFloat(cs.fontSize);
    if (ratio < 4.5 && !(size >= 18.66 && ratio >= 3)) out.push({ t: n.textContent.trim().slice(0, 40), ratio: +ratio.toFixed(2), sel: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').join('.') : '') });
  }
  return out;
};
(async () => {
  const b = await chromium.launch();
  for (const theme of ['light', 'dark']) {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: theme });
    const p = await ctx.newPage();
    const report = async (name) => { await p.waitForTimeout(500); const r = await p.evaluate(audit); console.log(`## ${theme} ${name}: ${r.length}`); r.slice(0, 12).forEach(x => console.log(`   ${x.ratio}  "${x.t}"  ${x.sel}`)); };
    await p.goto('http://localhost:8000/'); await p.waitForSelector('.login-card'); await report('login');
    await p.click('.demo'); await p.waitForSelector('.lrow'); await report('list');
    for (const l of ['Board', 'Timeline', 'Sprints', 'Insights']) { await p.click(`.segmented button:has-text("${l}")`); await report(l); }
    await p.click('.segmented button:has-text("List")'); await p.waitForSelector('.lrow');
    await p.click('.lrow >> nth=0'); await p.waitForSelector('.drawer'); await report('drawer'); await p.keyboard.press('Escape');
    await p.click('.toolbar button:has-text("Ask")'); await p.waitForSelector('.copilot'); await report('assistant'); await p.click('.copilot header button[aria-label=Close]');
    await p.click('.toolbar button.primary'); await p.waitForSelector('.modal'); await report('new task'); await p.keyboard.press('Escape');
    await p.click('a.rail-btn[href="#/me"]'); await p.waitForSelector('.myday'); await report('my day');
    await p.keyboard.press('Control+k'); await p.waitForSelector('.palette'); await report('palette');
    await ctx.close();
  }
  await b.close();
})();
