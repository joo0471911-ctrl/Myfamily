/* Browser smoke test.
 *   python3 -m http.server 8080      (in the project root, in another terminal)
 *   npm install && npx playwright install chromium
 *   npm test
 * Set BASE_URL to test another address and SHOT_DIR to save screenshots.
 */
const { chromium } = require('playwright');

const BASE = process.env.BASE_URL || 'http://localhost:8080';
const SHOTS = process.env.SHOT_DIR || '';
const errors = [];
let failed = 0;

function check(cond, msg) {
  if (cond) console.log('  ok   ' + msg);
  else { failed++; console.log('  FAIL ' + msg); }
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    // blocked Google Fonts requests (offline / sandboxed runs) are not app errors
    if (m.type() === 'error' && !/net::ERR_/.test(m.text())) errors.push('console: ' + m.text());
  });
  const shot = async (name) => { if (SHOTS) await page.screenshot({ path: SHOTS + '/' + name + '.png' }); };

  console.log('Landing → App');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(BASE + '/?page=Landing');
  await page.waitForSelector('text=Eat well');
  check(await page.locator('text=মাসে কত টাকা').count() > 0, 'landing mentions monthly budget');
  await page.click('a:has-text("অ্যাপ খুলুন")');
  await page.waitForSelector('text=শুরু করুন');
  check(page.url().includes('page=App'), 'landing button opens the app');

  console.log('App');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click('text=শুরু করুন');
  await page.waitForSelector('[role="dialog"]');
  const remTxt = await page.locator('[role="dialog"]').innerText();
  check(/আজ .*·/.test(remTxt) && /লাগবে/.test(remTxt) && /(কেজি|গ্রাম|টি|লিটার|মিলি|প্যাকেট|আঁটি)/.test(remTxt), 'entering the app shows today\'s meal reminder with ingredients and quantities');
  check(await page.locator('[role="dialog"] svg').count() >= 2, 'reminder shows the dish plate');
  await shot('0-reminder');
  await page.click('button[aria-label="পপ-আপ বন্ধ করুন"]');
  await page.waitForSelector('nav[aria-label="মূল মেনু"]');
  const tabs = await page.locator('nav[aria-label="মূল মেনু"] button > span:first-child').allTextContents();
  check(tabs.join(',') === 'ফ্যামিলি,বাজেট,লিস্ট,রেসিপি,প্ল্যান', 'tab order: ' + tabs.join(' | '));
  check((await page.locator('nav[aria-label="মূল মেনু"] button').first().innerText()).includes('৪ জন'), 'Family tab shows member count');
  await shot('1-family');

  const nameInput = page.locator('#memberName');
  await nameInput.fill('আব্বু');
  check(await nameInput.inputValue() === 'আব্বু', 'typing in the name field keeps focus and value');
  await page.click('text=+ নতুন সদস্য');
  check((await page.locator('nav button').first().innerText()).includes('৫ জন'), 'adding a member updates the tab count to ৫');

  // family photo + popup
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC', 'base64');
  await page.locator('button[aria-label="আব্বু-এর ছবি যোগ করুন"]').click();
  await page.waitForSelector('[role="dialog"]');
  await page.locator('[role="dialog"] input[type=file]').nth(1).setInputFiles({ name: 'baba.png', mimeType: 'image/png', buffer: PNG });
  await page.waitForSelector('[role="dialog"] img');
  const info = await page.locator('[role="dialog"]').innerText();
  check(/আব্বু/.test(info) && /বয়স ৪২/.test(info) && /ওজন ৭৫ কেজি/.test(info) && /ক্যালোরি \/ দিন/.test(info), 'member popup shows photo with name, age, kg, kcal');
  await shot('1b-member-popup');
  await page.click('button[aria-label="পপ-আপ বন্ধ করুন"]');
  check(await page.locator('button[aria-label="আব্বু-এর ছবি দেখুন"] img').count() === 1, 'member card shows the uploaded photo');

  await page.click('nav >> text=বাজেট');
  check(await page.locator('h1:has-text("মাসিক বাজেট")').count() === 1, 'budget page is monthly');
  check(await page.locator('text=৳১৮,০০০').count() > 0, 'default monthly budget ৳১৮,০০০');
  await page.click('button[aria-label="মাসিক বাজেট বাড়ান"]');
  check(await page.locator('text=৳১৮,৫০০').count() > 0, 'budget + button adds ৳৫০০');
  await shot('2-budget');

  check(await page.locator('h2:has-text("মাসে কী কিনবেন")').count() === 1 && await page.locator('text=বাজেটে বাকি থাকছে').count() + await page.locator('text=বাজেটের বেশি').count() > 0, 'budget tab lists what can be bought within the monthly budget');
  // price editor changes totals
  const monthText = async () => (await page.locator('span:has-text("/ ৳১৮,৫০০")').first().innerText()).split('/')[0].trim();
  const before = await monthText();
  await page.click('text=সবজি, মাছ, মাংসের দাম দেখুন ও এডিট করুন');
  await page.fill('#price_goru', '1600');
  await page.fill('#price_rui', '700');
  await page.fill('#price_murgi', '400');
  const afterP = await monthText();
  check(before !== afterP, 'editing prices changes the monthly total (' + before + ' → ' + afterP + ')');
  await page.click('text=ডিফল্ট দাম ফিরিয়ে আনুন');
  check(await monthText() === before, 'reset prices restores the total');
  await page.click('text=সবজি, মাছ, মাংসের দাম দেখুন ও এডিট করুন');
  // low budget: local market follows the budget
  for (let i = 0; i < 33; i++) await page.click('button[aria-label="মাসিক বাজেট কমান"]');
  check(await page.locator('h1:has-text("মাসিক বাজেট")').count() === 1 && await page.locator('text=৳২,০০০').count() > 0, 'budget can go down to ৳২,০০০');
  const localTotal = await page.locator('button[aria-pressed]:has-text("লোকাল বাজার")').innerText();
  const lt = Number(localTotal.replace(/[^০-৯]/g, '').replace(/[০-৯]/g, (d) => '০১২৩৪৫৬৭৮৯'.indexOf(d)));
  check(lt >= 1800 && lt <= 2400, 'local market total follows the ৳২,০০০ budget: ' + localTotal.replace(/\n/g, ' '));
  await shot('2b-budget-low');
  for (let i = 0; i < 33; i++) await page.click('button[aria-label="মাসিক বাজেট বাড়ান"]');

  await page.click('nav >> text=লিস্ট');
  await page.click('text=+ নিজের আইটেম যোগ করুন');
  await page.fill('#itemName', 'লবণ');
  await page.fill('#itemQty', '১ কেজি');
  await page.fill('#itemPrice', '40');
  await shot('3-grocery-form');
  await page.click('text=লিস্টে যোগ করুন');
  check(await page.locator('h2:has-text("আমার যোগ করা আইটেম")').count() === 1 && await page.locator('text=লবণ').count() > 0, 'own grocery item added');
  await page.click('button[aria-label="লবণ মুছে ফেলুন"]');
  check(await page.locator('h2:has-text("আমার যোগ করা আইটেম")').count() === 0, 'own grocery item removed');

  // header summary stays visible while scrolling
  const hdr = page.locator('[aria-label="বাজারের সারসংক্ষেপ"]');
  check(/কেনা/.test(await hdr.innerText()) && /বাকি/.test(await hdr.innerText()), 'grocery header shows কেনা/বাকি/মাসিক');
  await page.evaluate(() => { document.querySelectorAll('div').forEach((d) => { if (d.scrollHeight > d.clientHeight + 50 && getComputedStyle(d).overflowY === 'auto') d.scrollTop = d.scrollHeight; }); });
  const hb = await hdr.boundingBox();
  check(hb && hb.y < 140 && hb.y >= 0, 'header summary is still visible after scrolling down');
  await page.evaluate(() => { document.querySelectorAll('div').forEach((d) => { d.scrollTop = 0; }); });

  // month box by date
  check(await page.locator('h2:has-text("মাসের হিসাব")').count() === 1, 'month box is shown in the list tab');
  await page.click('button:has-text("এই সপ্তাহ সেভ করুন")');
  check(await page.locator('text=সেভ করা তালিকা').count() > 0, 'saved week shows its saved list');
  const weekBtns = page.locator('button[aria-label^="সপ্তাহ "]');
  const nWeeks = await weekBtns.count();
  check(nWeeks >= 4, 'month shows ' + nWeeks + ' dated weeks');
  let otherIdx = nWeeks - 1;
  await weekBtns.nth(otherIdx).click();
  if (await page.locator('text=এই সপ্তাহ এখনও সেভ হয়নি').count() === 0) { otherIdx = 0; await weekBtns.nth(otherIdx).click(); } // today may fall in the last week
  check(await page.locator('text=এই সপ্তাহ এখনও সেভ হয়নি').count() > 0, 'another week opens as unsaved');
  await page.click('button:has-text("এই সপ্তাহ সেভ করুন")');
  await weekBtns.nth(otherIdx === 0 ? nWeeks - 1 : 0).click();
  await weekBtns.nth(otherIdx).click();
  check(await page.locator('text=সেভ করা তালিকা').count() > 0, 'a saved week can be opened again and its items seen');
  await page.click('button:has-text("আপডেট করে সেভ করুন")');
  check(/সেভ হয়েছে/.test(await page.locator('body').innerText()), 'saved week can be updated again');
  await shot('3b-month');

  await page.click('nav >> text=রেসিপি');
  await page.click('text=+ নিজের রেসিপি তৈরি করুন');
  await page.fill('#recName', 'শুটকি ভর্তা');
  await page.click('button:has-text("রাত")');
  await page.fill('#recIng', 'শুটকি, পেঁয়াজ, মরিচ');
  await shot('4-recipe-form');
  await page.click('text=রেসিপি সেভ করুন');
  check(await page.locator('h2:has-text("আমার রেসিপি")').count() === 1, 'own recipe created');
  await page.click('button:has-text("এডিট")');
  check(await page.locator('#recName').inputValue() === 'শুটকি ভর্তা', 'edit opens the form with the recipe');
  await page.click('button:has-text("বাতিল")');

  await page.click('nav >> text=প্ল্যান');
  check(await page.locator('h2:has-text("সাপ্তাহিক চার্ট")').count() === 1, 'weekly chart shown');
  check(await page.locator('text=৳').count() === 0, 'no taka amounts on the plan page');
  await shot('5-plan-week');
  check(await page.locator('button[aria-label^="শনিবার"][aria-label*=":"]').count() === 1, 'weekly chart is compact: day chips only until opened');
  await page.click('button:has-text("ক্যালেন্ডার")');
  const cell = page.locator('button[aria-label^="সোমবার, ১৬ নভেম্বর"]');
  check(await cell.count() === 1, 'calendar shows dated cells with weekday names');
  await cell.click();
  check(/৳/.test('') === false && await page.locator('text=বাছাই করা সপ্তাহ').count() > 0, 'calendar selects the week of the tapped date');
  await shot('5b-calendar');
  await page.click('button:has-text("চার্ট দেখুন")');
  await page.locator('button[aria-label^="শনিবার"][aria-label*=":"]').click();
  check(await page.locator('h2:has-text("তিন বেলা")').count() === 1, 'day view with three meals');
  await shot('6-plan-day');

  const slots = ['নাস্তা', 'দুপুর', 'রাত'];
  for (let i = 0; i < 3; i++) {
    await page.locator('button[aria-label^="' + slots[i] + ':"]').click();
    await page.waitForSelector('[role="dialog"]');
    const svgs = await page.locator('[role="dialog"] svg').count();
    check(svgs >= 2, slots[i] + ' popup draws ' + svgs + ' dish illustrations');
    if (i === 0) {
      await page.locator('[role="dialog"] input[type=file]').nth(1).setInputFiles({ name: 'dish.png', mimeType: 'image/png', buffer: PNG });
      await page.waitForSelector('[role="dialog"] img[alt$="আপনার তোলা ছবি"]');
      check(true, 'dish popup accepts an uploaded photo');
    }
    await shot('7-popup-' + (i + 1));
    await page.click('button[aria-label="পপ-আপ বন্ধ করুন"]');
    check(await page.locator('[role="dialog"]').count() === 0, slots[i] + ' popup closes');
  }

  console.log('Recipe popup → plan');
  await page.click('nav >> text=রেসিপি');
  await page.click('button[aria-label^="মুড়ি"]');
  await page.waitForSelector('[role="dialog"]');
  check(await page.locator('[role="dialog"] svg').count() >= 1, 'recipe popup draws the plate for মুড়ি/দুধ type dishes');
  check(await page.locator('[role="dialog"] >> text=প্ল্যানে যোগ করুন').count() > 0, 'recipe popup offers add to plan');
  await shot('8-recipe-popup');
  await page.locator('[role="dialog"] button:has-text("রাত")').first().click();
  await page.locator('[role="dialog"] button:text-is("মঙ্গল")').click();
  await page.click('[role="dialog"] button:has-text("য় যোগ করুন")');
  check(await page.locator('h2:has-text("তিন বেলা")').count() === 1, 'after adding, plan day view opens');
  check(await page.locator('h2:has-text("মঙ্গলবার")').count() === 1, 'the chosen day (মঙ্গলবার) is shown');
  const dinner = await page.locator('button[aria-label^="রাত:"]').innerText();
  check(/মুড়ি/.test(dinner), 'dinner of that day is now the added recipe: ' + dinner.split('\n')[1]);
  await page.locator('button[aria-label^="রাত:"]').click();
  await page.waitForSelector('[role="dialog"]');
  await page.locator('[role="dialog"] input[type=file]').nth(1).setInputFiles({ name: 'dish.png', mimeType: 'image/png', buffer: PNG });
  await page.waitForSelector('[role="dialog"] [role="img"] img');
  check(await page.locator('[role="dialog"] [role="img"] svg').count() === 0, 'photo is shown round inside the plate (drawn items hidden)');
  await shot('9-plate-photo');
  await page.click('button[aria-label="পপ-আপ বন্ধ করুন"]');

  console.log('Persistence');
  await page.waitForTimeout(600);
  await page.reload();
  await page.waitForSelector('[role="dialog"]');
  check(/আজ/.test(await page.locator('[role="dialog"]').innerText()), 'after reload: the reminder opens first');
  await page.click('button[aria-label="পপ-আপ বন্ধ করুন"]');
  await page.waitForSelector('nav[aria-label="মূল মেনু"]');
  check((await page.locator('nav button').first().innerText()).includes('৫ জন'), 'after reload: app opens directly with the saved family (৫ জন)');
  check(await page.locator('button[aria-label="আব্বু-এর ছবি দেখুন"] img').count() === 1, 'after reload: member photo is still there');
  await page.click('nav >> text=লিস্ট');
  check(await page.locator('text=/সেভ হয়েছে · কেনা/').count() >= 2, 'after reload: the saved weeks are still listed with their amounts');
  await page.click('nav >> text=প্ল্যান');
  await page.locator('button[aria-label^="মঙ্গলবার"][aria-label*=":"]').click();
  check(/মুড়ি/.test(await page.locator('button[aria-label^="রাত:"]').innerText()), 'after reload: the plan keeps the added recipe');
  await page.locator('button[aria-label^="রাত:"]').click();
  check(await page.locator('[role="dialog"] [role="img"] img').count() === 1, 'after reload: dish photo is still on the plate');
  await page.click('button[aria-label="পপ-আপ বন্ধ করুন"]');

  console.log('Cloud sync (stub)');
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx2.addInitScript(() => {
    // in-memory fake of window.ThalaCloud, shared through sessionStorage-free closure per page
    const bus = (window.top.__thalaRemote = window.top.__thalaRemote || { doc: null });
    const L = [];
    window.ThalaCloud = {
      enabled: true, user: null,
      onAuth(f) { L.push(f); },
      signIn() { this.user = { uid: 'u1', name: 'Test User', email: 't@example.com' }; L.forEach((f) => f(this.user)); return Promise.resolve(); },
      signOut() { this.user = null; L.forEach((f) => f(null)); return Promise.resolve(); },
      pull() { return Promise.resolve(bus.doc); },
      push(r) { bus.doc = r; window.__pushed = (window.__pushed || 0) + 1; return Promise.resolve(); }
    };
  });
  const p2 = await ctx2.newPage();
  await p2.goto(BASE + '/?page=App');
  await p2.click('text=শুরু করুন');
  await p2.click('button[aria-label="পপ-আপ বন্ধ করুন"]');
  await p2.locator('#memberName').fill('বাবা-মা-পরীক্ষা');
  await p2.click('text=Google দিয়ে লগইন করুন');
  await p2.waitForSelector('text=লগইন আছে: Test User');
  await p2.waitForFunction(() => window.__pushed >= 1);
  check(true, 'cloud: signing in pushes the saved family to the cloud');
  const ctx3 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx3.addInitScript(() => {
    const L = [];
    window.ThalaCloud = {
      enabled: true, user: null,
      onAuth(f) { L.push(f); },
      signIn() { this.user = { uid: 'u1', name: 'Test User', email: 't@example.com' }; L.forEach((f) => f(this.user)); return Promise.resolve(); },
      signOut() { return Promise.resolve(); },
      pull() { return Promise.resolve(window.__remote || null); },
      push() { return Promise.resolve(); }
    };
  });
  const remote = await p2.evaluate(() => window.top.__thalaRemote.doc);
  await ctx3.addInitScript((r) => { window.__remote = r; }, remote);
  const p3 = await ctx3.newPage();
  await p3.goto(BASE + '/?page=App');
  await p3.click('text=শুরু করুন');
  await p3.click('button[aria-label="পপ-আপ বন্ধ করুন"]');
  await p3.click('text=Google দিয়ে লগইন করুন');
  await p3.waitForSelector('text=ক্লাউড থেকে আপনার সেভ করা তথ্য আনা হয়েছে।');
  check(await p3.locator('#memberName').inputValue() === 'বাবা-মা-পরীক্ষা', 'cloud: a new device gets the same family after login');
  await ctx2.close(); await ctx3.close();

  console.log('Fix pass: Esc, focus, filter, today card');
  await page.click('nav >> text=প্ল্যান');
  if (await page.locator('button:has-text("সাপ্তাহিক চার্ট")').count()) await page.click('button:has-text("সাপ্তাহিক চার্ট")');
  const todayBtn = page.locator('button[aria-label^="আজ নাস্তা:"]');
  check(await todayBtn.count() === 1, 'plan shows the "আজকের খাবার" card');
  await todayBtn.click();
  await page.waitForSelector('[role="dialog"]');
  await page.waitForTimeout(150);
  check(await page.evaluate(() => !!document.activeElement.closest('[role="dialog"]')), 'focus moves into the dialog');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  check(await page.evaluate(() => !!document.activeElement.closest('[role="dialog"]')), 'Tab stays inside the dialog');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  check(await page.locator('[role="dialog"]').count() === 0, 'Escape closes the dialog');
  await page.click('nav >> text=রেসিপি');
  await page.click('button[aria-pressed]:has-text("রাত")');
  check(await page.locator('h2:has-text("নাস্তা · Breakfast")').count() === 0 && await page.locator('h2:has-text("রাত · Dinner")').count() === 1, 'recipe filter shows only dinner');
  await page.click('button[aria-pressed]:has-text("সব")');
  await page.click('nav >> text=ফ্যামিলি');

  console.log('Project hub');
  await page.click('nav >> text=ফ্যামিলি');
  check(await page.locator('.hub-row [role="listitem"]').count() === 10, 'hub shows all cards when the page opens');
  await page.click('button[aria-controls="hubBody"]');
  check(await page.locator('.hub-row').count() === 0, 'hub arrow collapses the cards');
  await page.click('button[aria-controls="hubBody"]');
  await page.click('button[aria-label="নির্বাচিত কার্ড এডিট করুন"]');
  await page.waitForSelector('#hubDlg');
  await page.fill('#hubName', 'KIDS LEARNING 2');
  await page.click('button:has-text("সেভ করুন")');
  check(await page.locator('text=KIDS LEARNING 2').count() > 0, 'hub card can be edited');
  await page.click('button[aria-label="নির্বাচিত কার্ড এডিট করুন"]');
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape');
  check(await page.locator('#hubDlg').count() === 0, 'Esc closes the hub editor');

  console.log('Editable budget sections');
  await page.click('nav >> text=বাজেট');
  const meatHdr = page.locator('button[aria-expanded]').filter({ hasText: 'মাংস ও মাছ' });
  await meatHdr.click();
  check(await page.locator('#cap_meat').count() === 1, 'meat section opens with its own budget field');
  await page.locator('#cap_meat').fill('2000');
  const meatTxt = await meatHdr.innerText();
  check(/২,০|১,৯/.test(meatTxt), 'section budget rescales the section total: ' + meatTxt.replace(/\s+/g, ' '));
  const q0 = await page.locator('input[id^="q_"]').first().inputValue();
  await page.locator('input[id^="t_"]').first().fill('500');
  const q1 = await page.locator('input[id^="q_"]').first().inputValue();
  check(q0 !== q1, 'editing the amount changes the quantity: ' + q0 + ' -> ' + q1);
  await page.locator('#budgetInput').fill('30000');
  check((await page.locator('#budgetInput').inputValue()) === '30000', 'monthly budget can be typed');
  await page.click('button:has-text("সব অটো করুন")');
  await page.click('nav >> text=প্ল্যান');

  console.log('Built-in dish photos');
  await page.click('nav >> text=রেসিপি');
  const nRec = await page.locator('button[aria-label*="প্লেট ও বানানোর"]').count();
  check(nRec >= 70, 'recipe list has the new dishes: ' + nRec);
  check(await page.locator('img.thumb').count() >= 50, 'recipe rows show round thumbnails');
  await page.locator('button[aria-label^="কাচ্চি বিরিয়ানি"]').first().click();
  await page.waitForSelector('[role="dialog"] img.dish-img');
  check(await page.evaluate(() => { const i = document.querySelector('[role="dialog"] img.dish-img'); return i.complete && i.naturalWidth > 100; }), 'built-in dish photo loads in the plate popup');
  check(await page.locator('[role="dialog"] >> text=ছবি সরান').count() === 0, 'no remove button for built-in photos');
  await page.keyboard.press('Escape');

  console.log('Calorie calculator');
  await page.goto(BASE + '/?page=Main');
  await page.waitForSelector('text=আমার পরিবারের খাবার পরিকল্পনা');
  check(await page.locator('a:has-text("মিল প্ল্যানার খুলুন")').count() === 1, 'calculator links to the app');

  check(errors.length === 0, 'no console or page errors' + (errors.length ? ': ' + errors.join(' / ') : ''));
  await browser.close();
  if (failed) { console.log('\n' + failed + ' check(s) failed'); process.exit(1); }
  console.log('\nAll checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
