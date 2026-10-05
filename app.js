import {
  loadActiveChallenge, saveActiveChallenge, clearActiveChallenge, startNewChallenge,
  isActiveChallengeForNow, archiveChallengeToHistory, loadChallengeHistory,
  setChallengeSaved, deleteChallengeFromHistory
} from './storage.js';

const PARKS = {
  mk: { id:'mk', name:'Magic Kingdom', theme:'#22d3ee', wiki:'75ea578a-adc8-4116-a54d-dccb60765ef9' },
  ep: { id:'ep', name:'EPCOT', theme:'#fb923c', wiki:'47f90d2c-e191-4239-a466-5892ef59a88b' },
  hs: { id:'hs', name:'Hollywood Studios', theme:'#ff3ea5', wiki:'288747d1-8b4f-4a64-867e-ea7c9b27bad8' },
  ak: { id:'ak', name:'Animal Kingdom', theme:'#166534', wiki:'1c84a229-8862-4648-9c71-378ddd2c7693' }
};
const TZ = 'America/New_York';
const app = document.getElementById('app');
const topbar = document.getElementById('topbar');
const appTitle = document.getElementById('appTitle');
const statusLine = document.getElementById('statusLine');
const coreTab = document.getElementById('coreTab');
const bonusTab = document.getElementById('bonusTab');
const moreBtn = document.getElementById('moreBtn');
const moreMenu = document.getElementById('moreMenu');
const dialogHost = document.getElementById('dialogHost');

let attractions = [];
let active = null;
let selectedPark = null;
let currentCategory = 'core';
let waitSnapshot = null;
let waitFetchedAt = 0;

init();

async function init(){
  attractions = await fetch('./rides.json').then(r=>r.json());
  wireStaticHeader();
  active = loadActiveChallenge();
  if (active && isActiveChallengeForNow(active)) {
    selectedPark = active.parkId;
    currentCategory = sessionStorage.getItem('ktp_category') || 'core';
    showChallenge();
  } else {
    if (active) { archiveChallengeToHistory(active); clearActiveChallenge(); active = null; }
    showChallengeSelector();
  }
}

function parkData(id){ return PARKS[id] || PARKS.mk; }
function parkAttractions(pid=selectedPark){ return attractions.filter(a=>a.park===pid && a.active!==false); }
function categoryAttractions(cat=currentCategory,pid=selectedPark){ return parkAttractions(pid).filter(a=>a.category===cat); }
function attractionById(id){ return attractions.find(a=>a.id===id); }
function excludedSet(ch=active){ return new Set(ch?.excludedAttractionIds || ch?.settings?.excludedAttractionIds || []); }
function completedMap(ch=active){
  const m = new Map();
  (ch?.events || []).forEach((e,i)=>m.set(e.attractionId,{event:e,index:i}));
  return m;
}
function statusFor(ch=active){
  const done = completedMap(ch), excluded = excludedSet(ch);
  const core = parkAttractions(ch?.parkId).filter(a=>a.category==='core');
  const required = core.filter(a=>!excluded.has(a.id));
  const coreDone = required.filter(a=>done.has(a.id)).length;
  return { total:(ch?.events||[]).length, coreDone, coreRequired:required.length, qualified:coreDone===required.length };
}
function applyTheme(pid){ document.documentElement.style.setProperty('--park',parkData(pid).theme); }
function showHeader(show){ topbar.style.display = show ? 'flex' : 'none'; app.classList.toggle('app--withKtpHeader',show); }
function refreshHeader(){
  if(!active) return;
  const s=statusFor();
  appTitle.textContent = parkData(active.parkId).name;
  statusLine.textContent = `Total ${s.total} (Core ${s.coreDone}/${s.coreRequired})`;
  coreTab.classList.toggle('active',currentCategory==='core');
  bonusTab.classList.toggle('active',currentCategory==='bonus');
}

function wireStaticHeader(){
  coreTab.onclick=()=>{currentCategory='core';sessionStorage.setItem('ktp_category','core');renderChallengePage();};
  bonusTab.onclick=()=>{currentCategory='bonus';sessionStorage.setItem('ktp_category','bonus');renderChallengePage();};
  moreBtn.onclick=(e)=>{e.stopPropagation();const open=moreBtn.getAttribute('aria-expanded')==='true';moreBtn.setAttribute('aria-expanded',String(!open));moreMenu.setAttribute('aria-hidden',String(open));};
  document.addEventListener('click',()=>{moreBtn.setAttribute('aria-expanded','false');moreMenu.setAttribute('aria-hidden','true');});
  moreMenu.onclick=e=>e.stopPropagation();
  document.getElementById('settingsMenuBtn').onclick=()=>{closeMenu();openSettings();};
  document.getElementById('excludedRidesMenuBtn').onclick=()=>{closeMenu();openExclusions({mode:'active'});};
  document.getElementById('tweetUpdateMenuBtn').onclick=()=>{closeMenu();shareUpdate();};
  document.getElementById('savedChallengesMenuBtn').onclick=()=>{closeMenu();openHistory();};
  document.getElementById('endToStartBtn').onclick=()=>{closeMenu();openEndDialog();};
}
function closeMenu(){moreBtn.setAttribute('aria-expanded','false');moreMenu.setAttribute('aria-hidden','true');}

function showChallengeSelector(){
  selectedPark=null; showHeader(false); applyTheme('mk');
  app.innerHTML=`<div class="stack startPage">
    <div class="card"><div class="h1">KTP Ultimate</div><p class="p">Choose the park for today’s challenge.</p></div>
    <div class="card"><div class="h1">Choose your park</div><div class="ktpParkGrid">
      ${Object.values(PARKS).map(p=>`<button class="btn btnPrimary ktpParkButton" data-park="${p.id}">${escapeHtml(p.name)}</button>`).join('')}
    </div></div>
  </div>`;
  app.querySelectorAll('[data-park]').forEach(b=>b.onclick=()=>{selectedPark=b.dataset.park;showStartPage();});
}

function draftKey(){ return `ktp_draft_${selectedPark}`; }
function loadDraft(){ try{return JSON.parse(localStorage.getItem(draftKey())||'{"excluded":[],"fundraisingLink":"","tweetMode":"original"}');}catch{return {excluded:[],fundraisingLink:'',tweetMode:'original'};} }
function saveDraft(d){ localStorage.setItem(draftKey(),JSON.stringify(d)); }

function showStartPage(){
  showHeader(false); applyTheme(selectedPark); const p=parkData(selectedPark), d=loadDraft();
  app.innerHTML=`<div class="stack startPage">
    <div class="card"><div class="h1">KTP Ultimate ${escapeHtml(p.name)} Challenge</div><button id="backSelector" class="textLink" type="button">← Back to challenge selector</button></div>
    <div class="card"><div class="h1">Start a new challenge</div>
      <div class="formRow"><div class="label">Tweet mode</div>
        <label class="btn btnInverse optionRow"><input type="radio" name="tweetMode" value="original" ${d.tweetMode!=='twofer'?'checked':''}> <span>Single mode: tweet every attraction</span></label>
        <label class="btn btnInverse optionRow"><input type="radio" name="tweetMode" value="twofer" ${d.tweetMode==='twofer'?'checked':''}> <span>Twofer mode: tweet every 2nd attraction</span></label>
      </div>
      <div class="formRow" style="margin-top:14px"><div class="label">Fundraising</div>
        <p class="p">Help me support @GKTWVillage by donating at the link below</p>
        <input id="fundraisingLink" class="input" value="${escapeHtml(d.fundraisingLink||'')}" placeholder="https://...">
      </div>
      <div class="formRow" style="margin-top:14px"><div class="label">Excluded attractions</div>
        <button id="excludeBtn" class="btn btnInverse" type="button">Attractions excluded: ${d.excluded?.length||0} of ${parkAttractions(selectedPark).length}</button>
      </div>
      <div class="btnRow" style="margin-top:16px"><button id="startBtn" class="btn btnPrimary">Start new challenge</button></div>
    </div>
    ${renderResumeCard(selectedPark)}
  </div>`;
  document.getElementById('backSelector').onclick=showChallengeSelector;
  document.getElementById('excludeBtn').onclick=()=>openExclusions({mode:'draft'});
  document.getElementById('resumeRecent')?.addEventListener('click',()=>{
    const h=loadChallengeHistory().filter(x=>x.parkId===selectedPark).sort((a,b)=>(Date.parse(b.endedAt||b.startedAt)||0)-(Date.parse(a.endedAt||a.startedAt)||0))[0];
    if(!h)return; active=JSON.parse(JSON.stringify(h)); delete active.endedAt; saveActiveChallenge(active); currentCategory='core'; showChallenge();
  });
  document.getElementById('startBtn').onclick=()=>{
    const draft=loadDraft(); draft.fundraisingLink=document.getElementById('fundraisingLink').value.trim(); draft.tweetMode=document.querySelector('input[name="tweetMode"]:checked')?.value||'original'; saveDraft(draft);
    active=startNewChallenge({parkId:selectedPark,parkName:p.name,fundraisingLink:draft.fundraisingLink,tweetMode:draft.tweetMode,excludedAttractionIds:draft.excluded||[]});
    active.tagsText=''; saveActiveChallenge(active); currentCategory='core'; sessionStorage.setItem('ktp_category','core'); showChallenge();
  };
}

function renderResumeCard(pid){
  const candidates=loadChallengeHistory().filter(h=>h.parkId===pid).sort((a,b)=>(Date.parse(b.endedAt||b.startedAt)||0)-(Date.parse(a.endedAt||a.startedAt)||0));
  const h=candidates[0]; if(!h) return '';
  return `<div class="card"><div class="h1">Recent challenge</div><p class="p">${escapeHtml(formatDateTime(h.startedAt))} · Total ${(h.events||[]).length}</p><div class="btnRow" style="margin-top:10px"><button id="resumeRecent" class="btn">Resume this challenge</button></div></div>`;
}

function showChallenge(){ selectedPark=active.parkId; applyTheme(selectedPark); showHeader(true); renderChallengePage(); requestWaits(); }
function renderChallengePage(){
  if(!active)return; refreshHeader(); const done=completedMap(), excluded=excludedSet(); const list=categoryAttractions();
  app.innerHTML=`<div class="stack"><div class="card attractionListCard">
    <div class="sectionTitle"><h2>${currentCategory==='core'?'Core':'Bonus'} attractions</h2></div>
    <div class="rides">${list.map(a=>renderAttraction(a,done,excluded)).join('')}</div>
    <div id="waitMeta" class="subtle" style="margin-top:10px"></div>
  </div></div>`;
  list.forEach(a=>{
    if(done.has(a.id)) document.querySelector(`[data-undo="${a.id}"]`)?.addEventListener('click',()=>confirmUndo(a,done.get(a.id)));
    else if(!excluded.has(a.id)) document.querySelector(`[data-complete="${a.id}"]`)?.addEventListener('click',()=>completeAttraction(a));
  });
  applyWaits();
}
function renderAttraction(a,done,excluded){
  const info=done.get(a.id), isExcluded=!info&&excluded.has(a.id); const wait=waitFor(a);
  return `<div class="rideRow ${info?'completed':''} ${isExcluded?'excluded':''}">
    <div class="rideMain"><div class="rideName">${escapeHtml(a.name)}${wait!==null?` <span class="waitInline">(${wait} min)</span>`:''}</div>
      ${info?`<div class="completedMeta"><div class="completedNote">Completed ${escapeHtml(formatTime(info.event.timeISO))}</div><button class="smallBtn" data-undo="${a.id}">Undo</button></div>`:''}
      ${isExcluded?`<div class="excludedNote">Excluded from today’s challenge</div>`:''}
    </div>
  </div>`.replace('class="rideRow ', `class="rideRow ${!info&&!isExcluded?'clickableAttraction ':''}`).replace('<div class="rideMain"', `<div class="rideMain" ${!info&&!isExcluded?`data-complete="${a.id}"`:''}`);
}

function completeAttraction(a){
  if(!active)return;
  const e={id:crypto.randomUUID(),attractionId:a.id,park:a.park,category:a.category,attractionName:a.name,timeISO:new Date().toISOString()};
  active.events.push(e); saveActiveChallenge(active); refreshHeader(); renderChallengePage();
  const mode=active.tweetMode||active.settings?.tweetMode||'original';
  if(mode==='original') openTweetDraft(buildTweet([e]));
  else if(active.events.length%2===0) openTweetDraft(buildTweet(active.events.slice(-2)));
}
function buildTweet(events){
  const all=active.events; const lines=events.map(e=>{const n=all.findIndex(x=>x.id===e.id)+1;return `Attraction ${n}. ${e.attractionName} at ${formatTime(e.timeISO)}`;});
  const link=(active.fundraisingLink??active.settings?.fundraisingLink??'').trim();
  const tags=(active.tagsText??active.settings?.tagsText??'').trim();
  return [lines.join('\n'), tags, link].filter(Boolean).join('\n\n');
}
function openTweetDraft(text){ window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`,'_blank','noopener,noreferrer'); }

function confirmUndo(a,info){
  openConfirm({title:`Undo completion of ${a.name}?`,body:info.index===active.events.length-1?'This attraction will be marked incomplete.':'This attraction will be marked incomplete and later attraction numbers will change. Previously sent tweets will not change.',confirm:'Undo completion',action:()=>{active.events=active.events.filter(e=>e.id!==info.event.id);saveActiveChallenge(active);renderChallengePage();}});
}

function openExclusions({mode}){
  const d=mode==='draft'?loadDraft():null; let selected=new Set(mode==='draft'?(d.excluded||[]):[...excludedSet()]); let tab='core';
  const render=()=>{
    dialogHost.innerHTML=`<div class="dialogBackdrop"><div class="dialog"><h3>Excluded attractions</h3><div class="ktpDialogTabs"><button class="btn ${tab==='core'?'btnPrimary':''}" data-cat="core">Core</button><button class="btn ${tab==='bonus'?'btnPrimary':''}" data-cat="bonus">Bonus</button></div>
      <div class="excludeList">${categoryAttractions(tab,selectedPark).map(a=>`<label class="excludeRow"><input type="checkbox" value="${a.id}" ${selected.has(a.id)?'checked':''} ${mode==='active'&&completedMap().has(a.id)?'disabled':''}><span>${escapeHtml(a.name)}</span></label>`).join('')}</div>
      <div class="btnRow"><button id="saveExclusions" class="btn btnPrimary">Save</button><button id="cancelExclusions" class="btn">Cancel</button></div></div></div>`;
    dialogHost.querySelectorAll('[data-cat]').forEach(b=>b.onclick=()=>{tab=b.dataset.cat;render();});
    dialogHost.querySelectorAll('.excludeRow input').forEach(c=>c.onchange=()=>{c.checked?selected.add(c.value):selected.delete(c.value);});
    document.getElementById('cancelExclusions').onclick=closeDialog;
    document.getElementById('saveExclusions').onclick=()=>{
      if(mode==='draft'){const x=loadDraft();x.excluded=[...selected];saveDraft(x);closeDialog();showStartPage();}
      else {active.excludedAttractionIds=[...selected];active.settings=active.settings||{};active.settings.excludedAttractionIds=[...selected];saveActiveChallenge(active);closeDialog();renderChallengePage();}
    };
  }; render();
}

function openSettings(){
  if(!active)return; const link=active.fundraisingLink??active.settings?.fundraisingLink??'';
  openDialog({title:'Tweet settings',content:`<div class="formRow"><div class="label">Additional tweet text / hashtags</div><textarea id="tagsText" class="textarea">${escapeHtml(active.tagsText??active.settings?.tagsText??'')}</textarea></div><div class="formRow" style="margin-top:10px"><div class="label">Fundraising link</div><input id="fundLink" class="input" value="${escapeHtml(link)}"></div>`,buttons:[{text:'Save',primary:true,action:()=>{active.tagsText=document.getElementById('tagsText').value.trim();active.fundraisingLink=document.getElementById('fundLink').value.trim();active.settings={...(active.settings||{}),tagsText:active.tagsText,fundraisingLink:active.fundraisingLink};saveActiveChallenge(active);closeDialog();}},{text:'Cancel',action:closeDialog}]});
}

function pendingTwofer(){ if((active?.tweetMode||active?.settings?.tweetMode)!=='twofer')return[]; return (active.events||[]).length%2===1?[active.events.at(-1)]:[]; }
function openEndDialog(){
  const pending=pendingTwofer();
  openDialog({title:'End today’s challenge?',body:pending.length?'One attraction has not been included in a Twofer tweet yet.':'Your challenge will be saved to Recent challenges.',buttons:[...(pending.length?[{text:'Send final tweet & end',primary:true,action:()=>{openTweetDraft(buildTweet(pending));finishChallenge();}}]:[]),{text:'End challenge',primary:!pending.length,action:finishChallenge},{text:'Cancel',action:closeDialog}]});
}
function finishChallenge(){ if(!active)return;active.endedAt=new Date().toISOString();archiveChallengeToHistory(active);clearActiveChallenge();active=null;closeDialog();showStartPage(); }

function openHistory(){
  const hist=loadChallengeHistory();
  const rows=hist.map(h=>`<div class="historyRow"><div><strong>${escapeHtml(h.parkName||parkData(h.parkId).name)}</strong><div class="subtle">${escapeHtml(formatDateTime(h.startedAt))} · Total ${(h.events||[]).length}</div></div><div class="historyActions"><button class="smallBtn" data-resume="${h.id}">Resume</button><button class="smallBtn" data-save="${h.id}">${h.saved?'Unsave':'Save'}</button><button class="smallBtn" data-delete="${h.id}">Delete</button></div></div>`).join('')||'<p class="p">No saved or recent challenges yet.</p>';
  openDialog({title:'Saved Challenges',content:`<div class="historyList">${rows}</div>`,buttons:[{text:'Close',action:closeDialog}]});
  dialogHost.querySelectorAll('[data-resume]').forEach(b=>b.onclick=()=>{const h=hist.find(x=>x.id===b.dataset.resume);if(!h)return;active=JSON.parse(JSON.stringify(h));delete active.endedAt;selectedPark=active.parkId;saveActiveChallenge(active);closeDialog();showChallenge();});
  dialogHost.querySelectorAll('[data-save]').forEach(b=>b.onclick=()=>{const h=hist.find(x=>x.id===b.dataset.save);setChallengeSaved(h.id,!h.saved);closeDialog();openHistory();});
  dialogHost.querySelectorAll('[data-delete]').forEach(b=>b.onclick=()=>{deleteChallengeFromHistory(b.dataset.delete);closeDialog();openHistory();});
}

async function requestWaits(){
  const p=parkData(selectedPark); if(!p.wiki)return;
  try{const r=await fetch(`https://api.themeparks.wiki/v1/entity/${p.wiki}/live`);if(!r.ok)throw new Error('waits');const j=await r.json();waitSnapshot=j;waitFetchedAt=Date.now();applyWaits();}catch{waitSnapshot=null;}
}
function flattenLive(obj){ if(Array.isArray(obj))return obj.flatMap(flattenLive); if(!obj||typeof obj!=='object')return[]; return [obj,...Object.values(obj).flatMap(flattenLive)]; }
function waitFor(a){
  if(!a?.themeparksWikiId||!waitSnapshot)return null; const ent=flattenLive(waitSnapshot).find(x=>x?.id===a.themeparksWikiId); if(!ent)return null;
  const q=ent.queue||ent.queues||{}; const v=q?.STANDBY?.waitTime??q?.standby?.waitTime??ent.waitTime; return Number.isFinite(Number(v))?Number(v):null;
}
function applyWaits(){ if(!active)return; const meta=document.getElementById('waitMeta'); if(meta&&waitFetchedAt)meta.textContent=`Waits updated ${new Date(waitFetchedAt).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}`; }

async function shareUpdate(){
  if(!active?.events?.length){toast('Complete at least one attraction first.');return;}
  toast('Generating image…');
  try{const {blob,headerText}=await renderUpdateImage();showImageDialog(blob,headerText);}catch(e){console.error(e);toast('Could not create the image on this device.');}
}
async function renderUpdateImage(){
  const s=statusFor(); const width=1080,pad=70,rowH=72,headerH=190,height=headerH+pad+(active.events.length*rowH)+70;
  const c=document.createElement('canvas');c.width=width;c.height=height;const x=c.getContext('2d');x.fillStyle='#ffffff';x.fillRect(0,0,width,height);x.fillStyle='#111827';x.font='bold 48px system-ui';x.fillText(`KTP Ultimate — ${parkData(active.parkId).name}`,pad,75);x.font='32px system-ui';const headerText=`Total ${s.total} (Core ${s.coreDone}/${s.coreRequired})`;x.fillText(headerText,pad,130);x.font='26px system-ui';x.fillText(formatDate(active.startedAt),pad,170);
  active.events.forEach((e,i)=>{const y=headerH+pad+i*rowH;x.fillStyle=i%2?'#f8fafc':'#f1f5f9';x.fillRect(pad-15,y-40,width-pad*2+30,58);x.fillStyle='#111827';x.font='26px system-ui';const label=e.category==='bonus'?'Bonus':'Core';x.fillText(`${i+1}. ${e.attractionName}  •  ${label}  •  ${formatTime(e.timeISO)}`,pad,y);});
  const blob=await new Promise((resolve,reject)=>c.toBlob(b=>b?resolve(b):reject(new Error('blob')),'image/png')); return {blob,headerText:`KTP Ultimate ${parkData(active.parkId).name}: ${headerText}`};
}
function showImageDialog(blob,headerText){
  const url=URL.createObjectURL(blob); const file=()=>new File([blob],'ktp-ultimate-update.png',{type:'image/png'}); const canShare=!!(navigator.share&&navigator.canShare&&navigator.canShare({files:[file()]}));
  dialogHost.innerHTML=`<div class="dialogBackdrop updateImageDialogBackdrop"><div class="dialog updateImageDialog"><div class="updateImagePreview"><img src="${url}" alt="KTP Ultimate update image"></div><div class="btnRow updateImageActions">${canShare?'<button id="shareImg" class="btn btnPrimary">Share image</button>':''}<button id="downloadImg" class="btn ${canShare?'':'btnPrimary'}">Download image</button><button id="closeImg" class="btn">Close</button></div></div></div>`;
  document.getElementById('closeImg').onclick=()=>{URL.revokeObjectURL(url);closeDialog();};document.getElementById('downloadImg').onclick=()=>{const a=document.createElement('a');a.href=url;a.download='ktp-ultimate-update.png';a.click();};document.getElementById('shareImg')?.addEventListener('click',async()=>{try{await navigator.share({files:[file()],text:headerText});}catch{}});
}

function openDialog({title,body='',content='',buttons=[]}){dialogHost.innerHTML=`<div class="dialogBackdrop"><div class="dialog"><h3>${escapeHtml(title)}</h3>${body?`<p>${escapeHtml(body)}</p>`:''}${content}<div class="btnRow" style="margin-top:12px">${buttons.map((b,i)=>`<button data-dialog="${i}" class="btn ${b.primary?'btnPrimary':''}">${escapeHtml(b.text)}</button>`).join('')}</div></div></div>`;buttons.forEach((b,i)=>dialogHost.querySelector(`[data-dialog="${i}"]`).onclick=b.action);}
function openConfirm({title,body,confirm,action}){openDialog({title,body,buttons:[{text:confirm,primary:true,action:()=>{closeDialog();action();}},{text:'Cancel',action:closeDialog}]});}
function closeDialog(){dialogHost.innerHTML='';}
function toast(msg){const e=document.createElement('div');e.className='toast';e.textContent=msg;document.body.appendChild(e);setTimeout(()=>e.remove(),2200);}
function formatTime(iso){return new Intl.DateTimeFormat('en-US',{timeZone:TZ,hour:'numeric',minute:'2-digit'}).format(new Date(iso));}
function formatDate(iso){return new Intl.DateTimeFormat('en-US',{timeZone:TZ,month:'short',day:'numeric',year:'numeric'}).format(new Date(iso));}
function formatDateTime(iso){return `${formatDate(iso)} ${formatTime(iso)}`;}
function escapeHtml(s){return String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');}
