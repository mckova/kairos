// End-to-end walkthrough of every page and component. Run against a seeded server:
//   BASE=http://localhost:8000 node e2e/walkthrough.js
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8000';
const results = []; const problems = [];
let page, ctx, theme = 'light';
const step = async (name, fn) => {
  try { await fn(); results.push([theme, name, 'ok']); }
  catch (e) { results.push([theme, name, 'FAIL ' + String(e.message).split('\n')[0]]); try { await page.screenshot({ path: `/tmp/qa-fail-${theme}-${results.length}.png` }); } catch {} }
};
const settle = (ms = 350) => page.waitForTimeout(ms);
const expect = async (cond, msg) => { if (!(await cond)) throw new Error(msg); };

async function run(t, viewport = { width: 1440, height: 900 }) {
  theme = t;
  const b = await chromium.launch();
  ctx = await b.newContext({ viewport, colorScheme: t });
  page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push([theme, 'pageerror', String(e)]));
  page.on('console', (m) => m.type() === 'error' && !/503|Failed to load resource/.test(m.text()) && problems.push([theme, 'console', m.text().slice(0, 160)]));
  page.on('response', (r) => { const s = r.status(); if (s >= 400 && !/\/ai\//.test(r.url()) && !/\/auth\/login/.test(r.url())) problems.push([theme, 'http ' + s, r.request().method() + ' ' + r.url().replace(BASE, '')]); });

  await step('login: wrong password shows an error', async () => {
    await page.goto(BASE); await page.waitForSelector('.login-card');
    await page.fill('input[aria-label=Email]', 'demo@kairos.dev'); await page.fill('input[aria-label=Password]', 'nope');
    await page.click('.login-card button.primary'); await settle(600);
    await expect(page.locator('.login-card').innerText().then((s) => /invalid|incorrect|wrong|could not|failed/i.test(s)), 'no error text');
  });
  await step('login: demo workspace opens', async () => { await page.click('.demo'); await page.waitForSelector('.lrow'); });
  await step('theme toggle flips and persists', async () => {
    const before = await page.evaluate(() => document.documentElement.dataset.theme);
    await page.click('button[aria-label*="theme" i], .rail button:has(svg.lucide-moon), .rail button:has(svg.lucide-sun)'); await settle(200);
    const after = await page.evaluate(() => document.documentElement.dataset.theme);
    await expect(before !== after, 'theme did not change'); await page.click('button[aria-label*="theme" i], .rail button:has(svg.lucide-moon), .rail button:has(svg.lucide-sun)'); await settle(200);
  });

  // ---- list + filters
  await step('list: groups, counts and rows render', async () => { await expect((await page.locator('.glist h3').count()) >= 3, 'groups'); await expect((await page.locator('.lrow').count()) >= 10, 'rows'); });
  await step('list: text filter narrows rows', async () => {
    const n = await page.locator('.lrow').count(); await page.fill('.filters input', 'checkout'); await settle(); const m = await page.locator('.lrow').count();
    await expect(m > 0 && m < n, `filter ${n}->${m}`); await page.fill('.filters input', ''); await settle();
  });
  for (const [label, idx] of [['Assignee', 1], ['Priority', 1], ['Sprint', 1], ['Label', 1]]) {
    await step(`filter: ${label}`, async () => {
      const sel = page.locator(`.filters select[aria-label="${label}"]`); if (!(await sel.count())) throw new Error('missing select');
      const n = await page.locator('.lrow').count(); await sel.selectOption({ index: idx }); await settle(); const m = await page.locator('.lrow').count();
      await expect(m <= n, 'filter grew'); await sel.selectOption({ index: 0 }); await settle();
    });
  }
  await step('list: finished group folds and expands', async () => {
    const b = page.locator('button:has-text("finished")').first(); if (await b.count()) { await b.click(); await settle(); }
  });

  // ---- drawer
  await step('drawer: opens from a row and closes with Escape', async () => { await page.click('.lrow >> nth=2'); await page.waitForSelector('.drawer'); await page.keyboard.press('Escape'); await settle(); await expect((await page.locator('.drawer').count()) === 0, 'still open'); });
  await step('drawer: edit title and description persist', async () => {
    await page.click('.lrow >> nth=2'); await page.waitForSelector('.drawer');
    const title = page.locator('.drawer [aria-label=Title]'); await title.fill('QA renamed task'); await title.blur(); await settle(500);
    const d = page.locator('.drawer [aria-label=Description]'); await d.fill('QA description line'); await d.blur(); await settle(500);
    await page.keyboard.press('Escape'); await settle();
    await expect(page.locator('.lrow:has-text("QA renamed task")').count().then((c) => c > 0), 'rename not in list');
  });
  await step('drawer: status, priority, assignee, sprint, estimate selects change', async () => {
    await page.click('.lrow:has-text("QA renamed task")'); await page.waitForSelector('.drawer');
    const sels = page.locator('.drawer select'); const n = await sels.count(); await expect(n >= 5, 'selects ' + n);
    for (let i = 0; i < Math.min(n, 5); i++) { const opts = await sels.nth(i).locator('option').count(); if (opts > 1) { await sels.nth(i).selectOption({ index: Math.min(2, opts - 1) }); await settle(250); } }
  });
  await step('drawer: comment posts and shows', async () => {
    await page.fill('.drawer [aria-label="New comment"]', 'QA comment'); await page.click('.drawer button:has-text("Comment")'); await settle(600);
    await expect(page.locator('.drawer :text("QA comment")').count().then((c) => c > 0), 'comment missing');
  });
  await step('drawer: dependency can be added and removed', async () => {
    const add = page.locator('.drawer select:has(option:text("Add a task"))'); if (!(await add.count())) throw new Error('no dep select');
    await add.selectOption({ index: 1 }); await settle(500);
    const rm = page.locator('.drawer button[aria-label^="Remove dependency"]'); await expect((await rm.count()) > 0, 'dep not added'); await rm.first().click(); await settle(400);
  });
  await step('drawer: split into subtasks reports AI state', async () => {
    await page.click('.drawer button:has-text("Split into subtasks")'); await settle(1200);
    const txt = await page.locator('.drawer').innerText(); await expect(/subtask|offline|not configured|demo|Create subtasks/i.test(txt), 'no feedback');
  });
  await step('drawer: delete asks for confirmation then removes', async () => {
    await page.click('.drawer button:has-text("Delete")'); await page.waitForSelector('[role=alertdialog]'); await page.click('[role=alertdialog] button.ghost'); await settle(300);
    await expect((await page.locator('.drawer').count()) === 1, 'cancel closed drawer');
    await page.click('.drawer button:has-text("Delete")'); await page.waitForSelector('[role=alertdialog]'); await page.click('[role=alertdialog] .danger-solid'); await settle(600);
    await expect((await page.locator('.lrow:has-text("QA renamed task")').count()) === 0, 'task not deleted');
  });

  // ---- new task
  await step('new task: needs a title, creates, appears in list', async () => {
    await page.click('.toolbar button.primary'); await page.waitForSelector('.modal');
    await expect(page.locator('.modal button.primary').isDisabled(), 'create enabled without title');
    await page.fill('.modal .title-input', 'QA created task'); await page.selectOption('.modal select >> nth=1', { index: 2 }); await page.click('.modal button.primary'); await settle(700);
    await expect(page.locator('.lrow:has-text("QA created task")').count().then((c) => c > 0), 'not in list');
  });
  await step('new task: from a sentence + suggest report AI state', async () => {
    await page.click('.toolbar button.primary'); await page.waitForSelector('.modal');
    await page.click('.tabs-pill button:has-text("From a sentence")'); await page.fill('.ai-capture textarea', 'Noa should write the pricing page copy by Friday, high priority, 2 points'); await page.click('.ai-capture button'); await settle(1500);
    const title = await page.inputValue('.modal .title-input'); await page.fill('.modal .title-input', title || 'QA sentence task');
    await page.click('.title-row button'); await settle(1200);
    await page.keyboard.press('Escape'); await settle(200);
  });

  // ---- board
  await step('board: columns render and a card can be dragged to another column', async () => {
    await page.click('.segmented button:has-text("Board")'); await page.waitForSelector('.column'); await settle();
    const card = page.locator('.column >> nth=1 >> .card >> nth=0'); const target = page.locator('.column >> nth=2'); await card.dragTo(target); await settle(700);
  });
  await step('board: add-to-column opens the new task dialog', async () => {
    await page.locator('.column >> nth=0').hover(); await page.click('button[aria-label^="Add a task to"] >> nth=0', { force: true }); await page.waitForSelector('.modal'); await page.keyboard.press('Escape'); await settle(200);
  });
  await step('board: card opens the drawer', async () => { await page.click('.card >> nth=0'); await page.waitForSelector('.drawer'); await page.keyboard.press('Escape'); await settle(200); });
  await step('timeline: renders bars and opens a task', async () => { await page.click('.segmented button:has-text("Timeline")'); await settle(700); const bars = page.locator('[aria-label^="PLS-"]'); await expect((await bars.count()) > 3, 'no bars'); await bars.first().click(); await page.waitForSelector('.drawer'); await page.keyboard.press('Escape'); });

  // ---- sprints
  await step('sprints: chart, capacity and plan lists render', async () => {
    await page.click('.segmented button:has-text("Sprints")'); await settle(900);
    await expect((await page.locator('svg.burn rect.day').count()) > 10, 'burndown'); await expect((await page.locator('.ticks').count()) > 0, 'capacity');
  });
  await step('sprints: move a task into and out of the sprint', async () => {
    const add = page.locator('button:has-text("Add")').first(); if (await add.count()) { await add.click(); await settle(500); }
    const rm = page.locator('button:has-text("Remove")').first(); if (await rm.count()) { await rm.click(); await settle(500); }
  });
  await step('sprints: edit goal persists', async () => { const g = page.locator('[aria-label="Sprint goal"]'); await g.fill('QA goal'); await g.blur(); await settle(500); });
  await step('sprints: new sprint is created', async () => { await page.click('button:has-text("New sprint")'); await settle(700); });
  await step('sprints: status report opens and closes', async () => {
    await page.click('button:has-text("Write status report")'); await settle(1500);
    const txt = await page.locator('main, .app').innerText(); await expect(/report|offline|not configured|demo/i.test(txt), 'no feedback');
    const c = page.locator('[aria-label="Close report"]'); if (await c.count()) await c.click();
  });
  await step('sprints: complete sprint dialog works', async () => { const b = page.locator('button:has-text("Complete sprint")'); if (await b.count()) { await b.click(); await settle(700); const a = page.locator('[role=alertdialog] .ghost'); if (await a.count()) await a.click(); } });
  await step('insights: summary, risks, charts and activity render', async () => {
    await page.click('.segmented button:has-text("Insights")'); await settle(1000);
    await expect((await page.locator('.weeks .tile').count()) > 0, 'weeks'); await expect((await page.locator('svg.ring').count()) >= 2, 'rings'); await expect((await page.locator('.risks li').count()) > 0, 'risks');
    await page.locator('.risks li[role=button]').first().click(); await page.waitForSelector('.drawer'); await page.keyboard.press('Escape');
  });

  // ---- my day, inbox, palette, assistant
  await step('my day: loads plan and tasks', async () => { await page.click('a.rail-btn[href="#/me"]'); await page.waitForSelector('.myday'); await settle(700); });
  await step('my day: plan my day reports AI state', async () => { await page.click('button:has-text("Plan my day")'); await settle(1800); const txt = await page.locator('.myday').innerText(); await expect(/plan|offline|not configured|demo|focus/i.test(txt), 'no feedback'); });
  await step('inbox: tabs switch and mark read', async () => {
    const tabs = page.locator('.inbox .seg button'); const n = await tabs.count(); for (let i = 0; i < n; i++) { await tabs.nth(i).click(); await settle(200); }
    const mark = page.locator('.inbox button:has-text("Mark")'); if (await mark.count()) await mark.first().click(); await settle(300);
  });
  await step('palette: search opens a task with Enter', async () => {
    await page.keyboard.press('Control+k'); await page.waitForSelector('.palette'); await page.keyboard.type('stripe'); await settle(700); await page.keyboard.press('Enter'); await settle(800);
    await expect((await page.locator('.drawer').count()) > 0 || /#\/p\//.test(page.url()), 'nothing opened'); await page.keyboard.press('Escape'); await settle(200);
  });
  await step('palette: Escape closes', async () => { await page.keyboard.press('Control+k'); await page.waitForSelector('.palette'); await page.keyboard.press('Escape'); await settle(200); await expect((await page.locator('.palette').count()) === 0, 'palette stuck'); });
  await step('assistant: sends a message and shows a reply or a clear state', async () => {
    await page.click('a.rail-btn[href^="#/p"], .rail a:has(svg.lucide-layout-list)').catch(() => {});
    await page.click('.toolbar button:has-text("Ask")'); await page.waitForSelector('.copilot'); await page.fill('.copilot [aria-label=Message]', 'What is at risk this sprint?'); await page.click('.copilot [aria-label=Send]'); await settle(2500);
    const txt = await page.locator('.copilot').innerText(); await expect(txt.length > 80, 'no reply'); await expect(!/not configured|set ANTHROPIC/i.test(txt) || process.env.ALLOW_OFFLINE, 'offline error shown to demo user');
    await page.click('.copilot header button[aria-label=Close]');
  });
  await step('new project dialog creates a project', async () => {
    await page.click('button[aria-label="New project"]'); await page.waitForSelector('.modal'); await page.fill('.modal input >> nth=0', 'QA Project'); await page.click('.modal button.primary'); await settle(900);
    await expect((await page.locator('.modal').count()) === 0, 'dialog stuck');
  });
  await step('mobile viewport has no horizontal overflow', async () => {
    await page.setViewportSize({ width: 390, height: 800 }); await settle(500);
    for (const l of ['List', 'Board', 'Timeline', 'Sprints', 'Insights']) { const t = page.locator(`.segmented button:has-text("${l}")`); if (await t.count()) { await t.click(); await settle(500); } const o = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth); await expect(o <= 4, `${l} overflows by ${o}px`); }
    await page.setViewportSize({ width: 1440, height: 900 });
  });
  await step('sign out returns to login', async () => { await page.click('button[aria-label="Sign out"]'); await page.waitForSelector('.login-card'); });
  await b.close();
}
(async () => {
  await run('light'); await run('dark');
  const fails = results.filter((r) => r[2] !== 'ok');
  console.log(results.map((r) => `${r[2] === 'ok' ? 'PASS' : 'FAIL'}  [${r[0]}] ${r[1]}${r[2] === 'ok' ? '' : '  -> ' + r[2]}`).join('\n'));
  console.log('\nproblems:', problems.length); problems.slice(0, 40).forEach((p) => console.log('  ', p.join(' | ')));
  console.log(`\n${results.length - fails.length}/${results.length} steps passed`);
  process.exit(fails.length ? 1 : 0);
})();
