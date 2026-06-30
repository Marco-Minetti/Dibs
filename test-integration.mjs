import { JSDOM } from 'jsdom';
import fs from 'node:fs';

const API = 'http://localhost:4000';
const LOG = '/tmp/dibs_api.log';
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(...a);
let pass = 0, fail = 0;
function ok(cond, msg){ if(cond){ pass++; log('  ✓', msg); } else { fail++; log('  ✗', msg); } }

// read the freshest login code for an email from the server log
function codeFor(email){
  const lines = fs.readFileSync(LOG,'utf8').split('\n').filter(l=>l.includes(`login code for ${email}`));
  const last = lines[lines.length-1] || '';
  const m = last.match(/(\d{6})/);
  return m ? m[1] : null;
}

// build the page with dibs-api.js inlined so jsdom needs no external fetch for scripts
let html = fs.readFileSync('frontend/index.html','utf8');
const apiClient = fs.readFileSync('frontend/dibs-api.js','utf8');
html = html.replace('<script src="dibs-api.js"></script>', `<script>${apiClient}</script>`).replace('<script src="https://js.stripe.com/v3/"></script>','');

const dom = new JSDOM(html, {
  url: 'http://localhost:8080/',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  beforeParse(window){
    window.fetch = (...args) => fetch(...args);          // node fetch (ignores CORS, like we need)
    window.requestAnimationFrame = (cb)=>setTimeout(cb,0);
    class FakeWS { constructor(){ this.readyState=1; setTimeout(()=>this.onopen&&this.onopen(),0);} send(){} close(){} }
    window.WebSocket = FakeWS;
  }
});
const { window } = dom;
const { document } = window;
const $ = (s)=>document.querySelector(s);
const fire = (el, type)=> el.dispatchEvent(new window.Event(type, { bubbles:true }));
const click = (el)=> el && el.dispatchEvent(new window.MouseEvent('click', { bubbles:true }));

async function run(){
  await wait(200); // let inline scripts run

  log('\n[1] splash → login gate');
  click($('[data-act="start"]'));
  await wait(50);
  ok(!$('#gate-auth').hidden, 'login gate is visible');

  log('[2] school search hits the API');
  $('#schoolq').value = 'new york';
  fire($('#schoolq'), 'input');
  await wait(500);
  const firstSchool = document.querySelector('#slist .srow[data-act="pickschool"]');
  ok(!!firstSchool, 'school results came back from /api/schools ('+(firstSchool?firstSchool.textContent.trim().slice(0,24):'none')+')');
  click(firstSchool);
  await wait(50);
  ok(!$('#schipBox').hidden, 'school chip selected');

  log('[3] request a real login code');
  $('#gemail').value = 'alex@nyu.edu';
  $('#gname').value = 'Alex';
  click($('[data-act="continueAuth"]'));
  await wait(700);
  ok(!$('#gate-verify').hidden, 'advanced to verify screen (code requested)');

  log('[4] verify the code from the server log');
  const code = codeFor('alex@nyu.edu');
  ok(!!code, 'server logged a 6-digit code: '+code);
  const boxes = document.querySelectorAll('.code');
  code.split('').forEach((d,i)=>{ if(boxes[i]){ boxes[i].value=d; } });
  click($('[data-act="verify"]'));
  await wait(900);
  ok(!$('#app').hidden, 'logged in — app shell visible');

  log('[5] campus feed rendered from the API');
  await wait(600);
  const cards = document.querySelectorAll('#grid [data-act="open"]');
  ok(cards.length > 0, `feed shows ${cards.length} real listings`);
  const firstId = cards[0] && cards[0].getAttribute('data-id');
  ok(/^[0-9a-f-]{36}$/.test(firstId||''), 'listing id is a real uuid: '+firstId);

  log('[6] favorite a listing (PUT /favorite)');
  const favBtn = document.querySelector(`#grid [data-act="fav"][data-id="${firstId}"]`);
  click(favBtn);
  await wait(400);
  // verify via API using the token the app stored
  const access = window.localStorage.getItem('dibs_access');
  let favRes = await fetch(`${API}/api/favorites`, { headers:{ Authorization:`Bearer ${access}` }}).then(r=>r.json());
  ok((favRes.items||[]).some(i=>i.id===firstId), 'favorite persisted on the server');

  log('[7] open detail + call dibs (creates hold + conversation)');
  click(cards[0]);
  await wait(300);
  ok($('#screen-detail').classList.contains('active'), 'detail screen open');
  // call dibs on a listing that is NOT mine
  let target = null;
  const feed = await fetch(`${API}/api/listings?limit=20`, { headers:{ Authorization:`Bearer ${access}` }}).then(r=>r.json());
  target = (feed.items||[]).find(i=>!i.mine && i.status==='active');
  ok(!!target, 'found an active listing from another seller to dibs');
  // open that specific detail then dibs through the UI
  window.openDetail(target.id);
  await wait(200);
  const cta = $('#dcta');
  ok(cta && cta.getAttribute('data-act')==='dibs', 'CTA shows "call dibs"');
  click(cta);
  await wait(800);
  const convos = await fetch(`${API}/api/conversations`, { headers:{ Authorization:`Bearer ${access}` }}).then(r=>r.json());
  ok((convos.conversations||[]).length > 0, `conversation created (${(convos.conversations||[]).length} in inbox)`);
  ok($('#screen-chat').classList.contains('active'), 'jumped into the chat thread');

  log('[8] send a chat message (POST message)');
  $('#chatInput').value = 'hi! is this still around?';
  click($('[data-act="send"]'));
  await wait(600);
  const convId = (convos.conversations||[])[0].id;
  const msgs = await fetch(`${API}/api/conversations/${convId}/messages`, { headers:{ Authorization:`Bearer ${access}` }}).then(r=>r.json());
  ok((msgs.messages||[]).some(m=>m.body.includes('still around')), 'message persisted on the server');

  log(`\n──────── ${pass} passed, ${fail} failed ────────`);
  dom.window.close();
  process.exit(fail ? 1 : 0);
}
run().catch(e=>{ console.error('HARNESS ERROR:', e); process.exit(2); });
