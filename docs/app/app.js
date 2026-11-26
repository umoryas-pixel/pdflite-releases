const {PDFDocument,PDFName,PDFNumber,PDFRawStream,degrees,StandardFonts,rgb}=PDFLib;
const T=window.__TAURI__,$=s=>document.querySelector(s);
const inv=(c,a)=>T.core.invoke(c,a);
const base=p=>p.split(/[\\/]/).pop();
const isPdf=n=>/\.pdf$/i.test(n);
const kb=n=>n>1048576?(n/1048576).toFixed(1)+' MB':Math.round(n/1024)+' KB';
let toastT;function toast(m,ms,act){const t=$('#toast');clearTimeout(toastT);if(!m){t.hidden=true;return}t.textContent=m;if(act){const b=document.createElement('button');b.textContent=act.label;b.onclick=()=>{t.hidden=true;act.fn()};t.append(' ',b)}t.hidden=false;if(ms!==0)toastT=setTimeout(()=>t.hidden=true,ms||2500)}

/* ---------- viewer ---------- */
const V={ann:[],undo:[],nid:1,tool:'select',color:'#e11d48',sz:1,op:null,draft:null,pending:null,selId:null,cal:{def:null,pages:{}},src:null,calDraft:null,dirty:false,doc:null,native:false,sizes:null,base:null,scale:1,fit:true,io:null,tio:null,tasks:new Map(),cache:new Map(),sel:null,hits:[],hi:-1,cur:1,raf:0};
let pjReady=false;
/* Every pdf.js document is opened through pj().getDocument so these safety options always apply:
   no eval/new Function for fonts (CVE-2024-4367 class of bugs), no XFA forms, no PDF scripting. */
const PJ_SAFE={isEvalSupported:false,enableXfa:false,enableScripting:false,wasmUrl:new URL('pdfjs/',location.href).href};
/* pdf.js (about 1.9 MB with its worker) is only loaded the first time something needs it:
   the native PDFium engine draws pages in the desktop app, so most sessions never load it. */
function pjLoad(){if(!pjReady)pjReady=import('./pdfjs/pdf.min.mjs').then(()=>{pdfjsLib.GlobalWorkerOptions.workerSrc=new URL('pdfjs/pdf.worker.min.mjs',location.href).href;return pdfjsLib});return pjReady}
function pj(){return {getDocument:src=>({promise:pjLoad().then(L=>L.getDocument(Object.assign({},src,PJ_SAFE)).promise)})}}
const pages=()=>$('#viewer').children;
/* raw page pixels from the engine: width, height (u32 LE), then RGBA */
function rawBitmap(buf){const dv=new DataView(buf),w=dv.getUint32(0,true),h=dv.getUint32(4,true);return createImageBitmap(new ImageData(new Uint8ClampedArray(buf,8,w*h*4),w,h))}
const pageH=n=>V.sizes?V.sizes[n-1][1]:V.base.height;

function askPwd(){
  return new Promise(res=>{
    const d=$('#dPwd'),inp=$('#pIn');inp.value='';
    const fin=v=>{d.close();res(v)};
    $('#pOk').onclick=()=>fin(inp.value);
    $('#pCancel').onclick=$('#pX').onclick=()=>fin(null);
    inp.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();fin(inp.value)}else if(e.key==='Escape'){e.preventDefault();fin(null)}};
    d.showModal();inp.focus();
  });
}
/* ---------- trial + license ----------
   No price lives in the app: the Buy button opens BUY_URL, so you can change price, plan or payment provider
   on that page without shipping a new build. Keys are signed offline with license-tool.mjs. */
const FIRST_RUN=!localStorage.pl_t;
const LIC={
  TRIAL_DAYS:30,
  BUY_URL:'https://umoryas-pixel.github.io/pdflite-releases/',
  API:'https://pdflite-pay.YOUR-NAME.workers.dev',                                  // payment server: gives the app its license after payment   // a page or redirect you control
  PUB:'2AHNoHrv57BP0gmUIzMfIvb1oUnv+ZY21l3Ydb8Rtr0='                             // public key printed by: node license-tool.mjs keygen
};
const DAY=864e5,fnv=x=>{let h=2166136261;for(let i=0;i<x.length;i++){h^=x.charCodeAt(i);h=Math.imul(h,16777619)}return(h>>>0).toString(36)};
const b64b=x=>Uint8Array.from(atob(x.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-x.length%4)%4)),c=>c.charCodeAt(0));
function licNow(){ // effective time never goes backwards, so turning the clock back does not extend the trial
  const n=Date.now();let t0=0,seen=0;
  try{const raw=localStorage.pl_t;if(raw){const[a,b,c]=atob(raw).split('.');if(fnv(a+'.'+b+'|pdfl')!==c)return{now:n,t0:n-(LIC.TRIAL_DAYS+1)*DAY};t0=+a;seen=+b}}catch(e){return{now:n,t0:n-(LIC.TRIAL_DAYS+1)*DAY}}
  if(!t0){t0=n;seen=n}
  const now=Math.max(n,seen);try{localStorage.pl_t=btoa(t0+'.'+now+'.'+fnv(t0+'.'+now+'|pdfl'))}catch(e){}
  return{now,t0}}
function licParse(key){
  try{
    if(!LIC.PUB||!window.nacl)return{err:'Licensing is not configured in this build.'};
    const k=String(key||'').replace(/\s+/g,'');if(!/^PDFL-/.test(k))return{err:'That does not look like a Rasm license key.'};
    const[a,b]=k.slice(5).split('.');if(!a||!b)return{err:'That key is incomplete. Copy the whole key.'};
    const m=b64b(a);if(!nacl.sign.detached.verify(m,b64b(b),Uint8Array.from(atob(LIC.PUB),c=>c.charCodeAt(0))))return{err:'This license key is not valid.'};
    const o=JSON.parse(new TextDecoder().decode(m));return{email:o.e,exp:+o.x||0}
  }catch(e){return{err:'This license key is not valid.'}}}
const dayStr=d=>new Date(d*DAY).toISOString().slice(0,10);
function licStatus(){
  const t=licNow(),days=Math.max(0,Math.ceil(LIC.TRIAL_DAYS-(t.now-t.t0)/DAY)),key=localStorage.pl_k,p=key?licParse(key):null;
  if(p&&!p.err){if(!p.exp||Math.floor(t.now/DAY)<=p.exp)return{state:'licensed',email:p.email,exp:p.exp};return{state:'expired',lapsed:true,exp:p.exp,days}}
  return{state:days>0?'trial':'expired',days}}
let licLocked=false;
/* The trial start is also kept by the desktop app in two small files outside the WebView's
   storage, so clearing browsing data or reinstalling does not start a new trial. */
async function trialSync(){if(!T)return;try{
  const raw=localStorage.pl_t;let t0=0,seen=0;if(raw){const[a,b]=atob(raw).split('.');t0=+a;seen=+b}
  const start=await inv('trial_start',{seen:t0||null});
  if(start&&(!t0||start<t0)){const now=Math.max(Date.now(),seen||0);localStorage.pl_t=btoa(start+'.'+now+'.'+fnv(start+'.'+now+'|pdfl'));licUI()}
}catch(e){}}
setTimeout(trialSync,0);
function licUI(){
  const s=licStatus(),dlg=$('#dLic'),chip=$('#bLic');licLocked=s.state==='expired';
  chip.hidden=licLocked;chip.classList.toggle('warn',s.state==='trial'&&s.days<=7);
  chip.textContent=s.state==='licensed'?'Pro':'Trial · '+s.days+(s.days===1?' day':' days')+' left';
  $('#lTitle').textContent=s.state==='licensed'?'License':s.state==='trial'?'Free trial':s.lapsed?'License expired':'Trial ended';
  $('#lMsg').textContent=s.state==='licensed'?'Licensed to '+s.email+' · '+(s.exp?'valid until '+dayStr(s.exp):'lifetime license')+'.'
    :s.state==='trial'?s.days+(s.days===1?' day':' days')+' left in your free trial. Pay once and Rasm activates itself. No key to type.'
    :s.lapsed?'Your license expired on '+dayStr(s.exp)+'. Renew it, then paste the new key below.'
    :'Your '+LIC.TRIAL_DAYS+'-day free trial has ended. Buy a license: Rasm activates itself after payment.';
  const lic=s.state==='licensed';$('#lForm').hidden=lic;$('#lAct').hidden=lic;$('#lBuy').hidden=lic;$('#lOff').hidden=!lic;$('#lX').hidden=licLocked;
  if(licLocked&&!dlg.open)dlg.showModal()}
function devId(){let d=localStorage.pl_dev;if(!/^[a-z2-7]{20,}$/.test(d||'')){const a=crypto.getRandomValues(new Uint8Array(16)),A='abcdefghijklmnopqrstuvwxyz234567';d='';for(const x of a)d+=A[x&31]+A[(x>>3)&31];localStorage.pl_dev=d=d.slice(0,26)}return d}
/* Pay -> the app activates itself: it asks the payment server whether this installation has paid */
let actTimer=0,actTries=0;
function licAccept(key){const p=licParse(key);if(p.err)return false;localStorage.pl_k=key.replace(/\s+/g,'');localStorage.removeItem('pl_wait');stopWait();licUI();$('#dLic').open&&$('#dLic').close();toast('License activated. Thank you!',5000);return true}
async function licCheck(){
  if(!/^https:\/\//.test(LIC.API)||/YOUR-NAME/.test(LIC.API)||licStatus().state==='licensed')return false;
  try{const r=await fetch(LIC.API+'/api/activate?device='+devId(),{cache:'no-store'});if(!r.ok)return false;const j=await r.json();return !!(j&&j.key&&licAccept(j.key))}catch(e){return false}}
function stopWait(){clearInterval(actTimer);actTimer=0;const w=$('#lWait');if(w)w.hidden=true}
function startWait(){localStorage.pl_wait=Date.now();actTries=0;clearInterval(actTimer);const w=$('#lWait');if(w)w.hidden=false;
  actTimer=setInterval(async()=>{if(++actTries>450||await licCheck())stopWait()},4000)}
async function licBuy(){
  const base=LIC.BUY_URL,e=$('#lErr');if(!/^https:\/\//.test(base)||/YOUR-SITE/.test(base)){e.textContent='The buy link is not set up yet.';return}
  const u=base+'?d='+devId()+'#buy';e.textContent='';startWait();
  try{if(T.opener&&T.opener.openUrl){await T.opener.openUrl(u);return}}catch(x){}
  try{await navigator.clipboard.writeText(u);e.style.color='';e.textContent='Link copied. Paste it into your browser to buy: '+u}catch(x){e.textContent='Open this link to buy: '+u}}
$('#bLic').onclick=()=>{licUI();if(!$('#dLic').open)$('#dLic').showModal()};
$('#lX').onclick=()=>$('#dLic').close();
$('#dLic').addEventListener('cancel',e=>{if(licLocked)e.preventDefault()});
$('#lBuy').onclick=licBuy;
$('#lAct').onclick=()=>{const e=$('#lErr');e.style.color='#dc2626';const k=$('#lKey').value,p=licParse(k);
  if(p.err){e.textContent=p.err;return}
  if(p.exp&&Math.floor(licNow().now/DAY)>p.exp){e.textContent='This license key has expired.';return}
  localStorage.pl_k=k.replace(/\s+/g,'');e.textContent='';$('#lKey').value='';licUI();$('#dLic').close();toast('License activated. Thank you!',3500)};
$('#lOff').onclick=()=>{localStorage.removeItem('pl_k');licUI()};
licUI();setInterval(licUI,6e5);addEventListener('focus',licUI);
setTimeout(()=>{if(licStatus().state!=='licensed'){if(localStorage.pl_dev)licCheck();if(+localStorage.pl_wait>Date.now()-864e5&&!actTimer)startWait()}},4000);
addEventListener('focus',()=>{if(+localStorage.pl_wait>Date.now()-864e5&&licStatus().state!=='licensed')licCheck()});
const NEWS={'0.7.5':['Zoom now stays on the spot under your pointer instead of sliding away toward the edge of the page.'],'0.7.4':['Zooming with Ctrl+scroll no longer flashes or blanks the drawing: the old picture stays on screen until the sharp one is ready.'],'0.7.3':['Text selection and highlighting now follow the rows of tables and spreadsheets, and the selection stays aligned while you zoom.'],'0.7.2':['The new Rasm icon now shows everywhere: the app, the installer, the website and your phone home screen.'],'0.7.1':['Sizes are now numbers, and you can change the size of a mark after drawing it: select it, then set the number. Colour works the same way.'],'0.7.0':['PDF Lite is now Rasm: new name, new icon, clearer text, and a worldwide card checkout. Pay and the app activates itself.'],'0.6.1':['No more license keys to type: after you pay, Rasm activates itself within seconds.'],'0.6.0':['Buy online: the Buy button now opens the Rasm website, where you pay with mada, Apple Pay or card and get your license key instantly.'],'0.5.3':['A small, quiet notice tells you when a new version is available. It appears at most once a day, never over your work, and you can choose Later or Skip this version.'],'0.5.2':['Text selection and highlights now follow the text lines neatly, with no stray wide bands on documents with unusual fonts.'],'0.5.1':['The Tools window now shows its tabs in a neat grid instead of a scrolling row.'],'0.5.0':['Arabic interface: switch between English and العربية from the page-size menu (the Fit button). It opens in Arabic automatically on Arabic computers.'],'0.4.0':['Tabs: open several PDFs in one window and switch between them. Ctrl+Tab changes tab, Ctrl+W closes one.','OCR: read text from scanned pages (English and Arabic) so you can search and copy it. Tools, then OCR.'],'0.3.0':['Save (Ctrl+S) writes your markup and changes into the PDF. Save as (Ctrl+Shift+S) makes a copy.','Night mode for pages and Full screen, both in the Fit menu. F11 toggles full screen.','Move around a page by holding Space and dragging, or with the middle mouse button. Home and End jump to the first and last page.','New tools: save PDF pages as pictures (ZIP), and add page numbers and a watermark.'],'0.2.5':['Opening another PDF now opens it in its own window, so you can keep several open side by side.','Zooming in keeps text and lines sharp at any zoom level.'],'0.2.4':['Merge now repairs PDFs with an unusual structure instead of failing.'],'0.2.3':['Rasm now also runs on phones and tablets (Android and iPhone) as an installable web app.','Draw and mark up with your finger on touchscreens.'],'0.2.2':['Smoother pinch and trackpad zoom: the page follows your fingers, then sharpens.','Rotate left and Rotate right buttons in the header turn the page you are on straight away. Your markup turns with it.','Fixed: exporting the markup list to a spreadsheet now saves correctly.'],'0.2.1':['Smoother pinch and trackpad zoom: the page follows your fingers, then sharpens.','Rotate left and Rotate right buttons in the header turn the page you are on straight away. Your markup turns with it.','Fixed: exporting the markup list to a spreadsheet now saves correctly.'],'0.2.0':['Print your PDFs, with or without your markup (Print button or Ctrl+P).','Markups panel in the sidebar: every highlight, note, shape, measurement and stamp in one list, with filters.','Export the markup list to a spreadsheet that opens in Excel.','New Count tool for counting items on drawings (Measure, then Count, or press N).','Turn photos into a PDF in Tools, then Images. Phone photos come out the right way up.'],'0.1.1':['Underline and strikethrough tools. Click Highlight again to switch (keys H, U, S).','Rotate and Delete pages added to Tools.','PDFs reopen on the page and zoom where you left off.','Keyboard shortcuts for every tool. Press ? to see them.','Safer zooming on very large pages.']};
(async()=>{try{const v=await T.app.getVersion(),last=localStorage.lastver;localStorage.lastver=v;
  if(v!==last&&!FIRST_RUN&&NEWS[v]&&!licLocked){$('#nVer').textContent=v;$('#nList').innerHTML=NEWS[v].map(x=>'<li>'+esc(x)+'</li>').join('');$('#dNew').showModal()}}catch(e){}})();
$('#nOk').onclick=()=>$('#dNew').close();

/* ---------- auto update (checks the public releases page, installs signed updates) ---------- */
let updBusy=false;
async function checkUpdate(manual){
  const um=$('#uMsg'),say=t=>{if(manual&&um)um.textContent=t};
  if(!T||!T.updater){say('(available in the installed app)');return}
  say('Checking…');
  try{
    const u=await T.updater.check();
    if(!u){say('You have the latest version.');return}
    say('Version '+u.version+' is available.');
    const go=async()=>{
      if(updBusy)return;
      if(V.dirty&&!window.confirm('You have unsaved markup. Install the update anyway? Rasm will close.'))return;
      updBusy=true;let tot=0,got=0;toast('Downloading update…',0);
      try{await u.downloadAndInstall(ev=>{
        if(ev.event==='Started')tot=ev.data.contentLength||0;
        else if(ev.event==='Progress'){got+=ev.data.chunkLength;if(tot)toast('Downloading update… '+Math.round(got/tot*100)+'%',0)}
        else if(ev.event==='Finished')toast('Installing. Rasm will restart.',0)})}
      catch(e){updBusy=false;toast('The update could not be installed. Try again later.',5000)}};
    if($('#dLic').open){um.innerHTML='';const b=document.createElement('button');b.textContent='Install version '+u.version;b.style.marginLeft='6px';b.onclick=go;um.append(b)}
    else if(manual)toast('Version '+u.version+' is available',30000,{label:'Update now',fn:go});
    else showUpdCard(u,go);
  }catch(e){say('Could not check for updates.')}}
$('#lUpd').onclick=e=>{e.preventDefault();checkUpdate(true)};
(async()=>{try{$('#vNum').textContent='Version '+await T.app.getVersion()}catch(e){$('#vNum').textContent=''}})();
/* Gentle update notice: one small card, at most once per session, never over a dialog or mid-drawing.
   Ignored -> asks again after 1 day. "Later" -> 3 days. "Skip this version" -> not again for that version. */
let updShown=false;
function showUpdCard(u,go){
  const KEY='pl_upd',get=()=>{try{return JSON.parse(localStorage.getItem(KEY)||'{}')}catch(e){return{}}},set=o=>{try{localStorage.setItem(KEY,JSON.stringify(Object.assign(get(),o)))}catch(e){}};
  const st=get();if(updShown||st.skip===u.version||Date.now()<(st.until||0))return;
  const busy=()=>document.querySelector('dialog[open]')||V.op||V.draft||(document.activeElement&&/^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName));
  const tryShow=()=>{
    if(updShown)return;if(busy()){setTimeout(tryShow,2*60e3);return}
    updShown=true;set({until:Date.now()+864e5});
    const c=$('#updCard');$('#ucT').textContent='Version '+u.version+' is available';c.hidden=false;
    let hideT=setTimeout(()=>{c.hidden=true},30000);
    const done=()=>{clearTimeout(hideT);c.hidden=true};
    $('#ucGo').onclick=()=>{done();go()};
    $('#ucLater').onclick=()=>{done();set({until:Date.now()+3*864e5})};
    $('#ucSkip').onclick=()=>{done();set({skip:u.version})};
    $('#ucX').onclick=done};
  tryShow()}
window.showUpdCard=showUpdCard;
if(T&&T.updater){setTimeout(()=>checkUpdate(false),20000);setInterval(()=>checkUpdate(false),12*3600e3)}

/* ---------- phone / tablet: install as an app + draw with a finger ---------- */
if(!T&&/^https?:$/.test(location.protocol)){
  const h=document.head,l=(r,hr)=>{const e=document.createElement('link');e.rel=r;e.href=hr;h.appendChild(e)},m=(n,c)=>{const e=document.createElement('meta');e.name=n;e.content=c;h.appendChild(e)};
  l('manifest','manifest.webmanifest');l('apple-touch-icon','icons/apple-touch-icon.png');m('theme-color','#ffffff');m('apple-mobile-web-app-capable','yes');m('mobile-web-app-capable','yes');m('apple-mobile-web-app-title','Rasm');
  if('serviceWorker' in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('sw.js').catch(()=>{}));
}
(function(){const v=$('#viewer');let on=false,tg=null;
  const ev=(t,type)=>new MouseEvent(type,{bubbles:true,cancelable:true,clientX:t.clientX,clientY:t.clientY,screenX:t.screenX,screenY:t.screenY,button:0,buttons:type==='mouseup'?0:1,view:window});
  v.addEventListener('touchstart',e=>{if(e.touches.length!==1||!V.doc||V.tool==='select'||licLocked){if(on&&e.touches.length>1){on=false;V.op=null;window.dispatchEvent(ev(e.touches[0],'mouseup'))}return}
    on=true;tg=e.target;e.preventDefault();tg.dispatchEvent(ev(e.touches[0],'mousedown'))},{passive:false});
  v.addEventListener('touchmove',e=>{if(!on)return;if(e.touches.length!==1)return;e.preventDefault();window.dispatchEvent(ev(e.touches[0],'mousemove'))},{passive:false});
  const end=e=>{if(!on)return;on=false;e.preventDefault();const t=e.changedTouches[0];(document.contains(tg)?tg:window).dispatchEvent(ev(t,'mouseup'))};
  v.addEventListener('touchend',end,{passive:false});v.addEventListener('touchcancel',end,{passive:false});
})();
async function openDoc(f,pwd,opts){
  if(licLocked)return false;
  toast('Opening…',0);
  try{
    let sizes=null,doc,b,rb=null,imp=null,stored=undefined,pops=[];const rm=rotMap(f),key=tkey(f);
    /* switching back to a tab: the engine usually still has the document open */
    if(opts&&opts.reuse&&T&&!V.noNative){try{sizes=await inv('pdf_activate',{key})}catch(e){sizes=null}if(sizes)rb=opts.rb||null}
    if(!sizes){
      if(opts&&opts.rb)rb=opts.rb;
      else{
        stored=await mkRead(f);
        /* markup saved by Rasm comes back as editable marks, and leaves what the engine draws */
        try{imp=await importMarks(f)}catch(e){imp=null}
        if(imp)rb=imp.bytes;
        if(Object.keys(rm).length){try{rb=await applyRot(rb||await srcBytes(f),rm)}catch(e){}}
        /* page moves, deletions and insertions not saved yet */
        if(stored&&stored.pages&&stored.pages.length){try{rb=await pageOpsReplay(rb||await srcBytes(f),stored.pages)||rb;pops=stored.pages}catch(e){toast('Could not restore your page changes: '+e.message,4000);stored=null}}
      }
    }
    if(T&&!V.noNative){
      const kh=encodeURIComponent(key);
      if(sizes){}
      else if(rb){sizes=await inv('pdf_open_bytes',rb,{headers:{key:kh}})}
      else if(f._path){sizes=await inv('pdf_open_path',{path:f._path,password:pwd||null,key})}
      else{const bytes=new Uint8Array(await f.arrayBuffer()),headers=pwd?{password:encodeURIComponent(pwd),key:kh}:{key:kh};sizes=await inv('pdf_open_bytes',bytes,{headers})}
      doc={numPages:sizes.length,native:true};b={width:sizes[0][0],height:sizes[0][1]};
    }else{
      const data=rb?rb.slice():f.arrayBuffer?new Uint8Array(await f.arrayBuffer()):new Uint8Array(await inv('read_file',{path:f._path}));
      doc=await pj().getDocument({data,password:pwd||undefined}).promise;
      const vp=(await doc.getPage(1)).getViewport({scale:1});b={width:vp.width,height:vp.height};
    }
    if(V.doc&&V.doc.destroy)V.doc.destroy();
    Object.assign(V,{ocr:null,pwd:pwd||null,rotBytes:rb,doc,native:!!sizes,sizes,base:b,fit:true,fitMode:'w',sel:null,hits:[],hi:-1,cur:1});V.cache.clear();
    $('#title').textContent=f.name;document.title=f.name+' - Rasm';$('#pn').textContent=doc.numPages;
    $('#fc').textContent='';$('#q').value='';
    V.pageOps=pops;document.body.classList.add('has');await loadMarks(f,imp,stored);await formInit(f,rb);const rp=getRp(f);fitScale();build();restoreRp(rp);buildSide();remember(f);setTool('select');updateSave();updateHistoryUi();toast('');ocrLoad(f);return true;
  }catch(e){
    const s=String(e&&e.message||e);
    if(T&&!V.noNative&&s.includes('pdfium not found')){V.noNative=true;return openDoc(f,pwd,opts)}
    if(/assword/i.test(s)){
      toast('');if(pwd)toast('Incorrect password',2500);
      const next=await askPwd();if(next!=null)return openDoc(f,next,opts);return false;
    }
    toast('Could not open this PDF: '+s,5000);return false;
  }
}
let rpT;
function getRp(f){try{return f&&f._path?JSON.parse(localStorage.getItem('rp:'+f._path)||'null'):null}catch(e){return null}}
function saveRp(){if(!V.doc||!V.src||!V.src._path)return;clearTimeout(rpT);rpT=setTimeout(()=>{try{localStorage.setItem('rp:'+V.src._path,JSON.stringify({p:V.cur,m:V.fit?V.fitMode:(V.fitMode||'c'),s:V.scale}))}catch(e){}},700)}
function restoreRp(r){if(!r)return;try{
  if(r.m==='p'||r.m==='a4'||r.m==='1')setFit(r.m);
  else if(r.m==='c'&&r.s>=.2&&r.s<=6){V.fit=false;V.fitMode=null;V.scale=r.s;fitScale();build()}
  if(r.p>1)setTimeout(()=>{goTo(r.p);toast('Back to page '+r.p,1800)},80)}catch(e){}}
function fitScale(){if(V.fit){const vw=$('#viewer'),cw=(vw.clientWidth-32)/V.base.width;V.scale=Math.max(.2,V.fitMode==='p'?Math.min(cw,(vw.clientHeight-32)/V.base.height):cw)}$('#zv').textContent=Math.round(V.scale*100)+'%';saveRp();$('#bFit').textContent=(V.fit?(V.fitMode==='p'?'Fit page':'Fit width'):V.fitMode==='a4'?'A4 size':V.fitMode==='1'?'Actual size':'Custom')+' ▾'}
function build(){
  const v=$('#viewer');V.tasks.forEach(t=>t.cancel&&t.cancel());V.tasks.clear();if(V.io)V.io.disconnect();
  /* keep the old picture of each page on screen (stretched) until its sharp redraw is ready, so zooming never flashes white */
  const keep=new Map();if(V.doc&&v._doc===V.doc)[...v.children].forEach(d=>{if(d._c&&d._c.isConnected)keep.set(+d.dataset.n,d._c)});v._doc=V.doc;v.innerHTML='';
  const fr=document.createDocumentFragment();
  for(let i=1;i<=V.doc.numPages;i++){
    const d=document.createElement('div');d.className='pg';d.dataset.n=i;d.innerHTML='<div class="ov"></div><svg class="an" viewBox="0 0 '+(V.sizes?V.sizes[i-1][0]:V.base.width)+' '+(V.sizes?V.sizes[i-1][1]:V.base.height)+'" preserveAspectRatio="none"></svg>';
    const sz=V.sizes?[V.sizes[i-1][0]*V.scale,V.sizes[i-1][1]*V.scale]:[V.base.width*V.scale,V.base.height*V.scale];
    d.style.width=sz[0]+'px';d.style.height=sz[1]+'px';fr.appendChild(d);
    const o=keep.get(i);if(o){o.style.width='100%';o.style.height='100%';d.insertBefore(o,d.firstChild);d._stale=o}
  }
  v.appendChild(fr);
  V.io=new IntersectionObserver(es=>es.forEach(e=>{e.target._vis=e.isIntersecting;e.isIntersecting?draw(e.target):undraw(e.target)}),{root:v,rootMargin:'900px 0px'});
  [...v.children].forEach(c=>V.io.observe(c));
  paintAll();paintAnnAll();if(typeof formPaintAll==='function')formPaintAll();upd();schedHi();
}
async function draw(d){
  if(d._c||d._r)return;d._r=1;const n=+d.dataset.n,doc=V.doc,sc=V.scale;
  try{
    if(doc.native){
      const w=V.sizes[n-1][0]*sc,h=V.sizes[n-1][1]*sc,dpr=Math.min(window.devicePixelRatio||1,2);
      const buf=await inv('pdf_render',{page:n-1,width:Math.min(Math.round(w*dpr),4096),prio:1,raw:true});
      if(doc!==V.doc||sc!==V.scale||!d.isConnected||!d._vis){d._r=0;return}
      const bmp=await rawBitmap(buf);
      const c=document.createElement('canvas');c.width=bmp.width;c.height=bmp.height;c.style.width=w+'px';c.style.height=h+'px';
      c.getContext('2d',{alpha:false}).drawImage(bmp,0,0);bmp.close();
      d.appendChild(c);d._c=c;d._r=0;dropStale(d);return;
    }
    const pg=await doc.getPage(n);if(doc!==V.doc||sc!==V.scale||!d.isConnected){d._r=0;return}
    const vp=pg.getViewport({scale:sc}),dpr=Math.min(window.devicePixelRatio||1,2,Math.sqrt(16e6/(vp.width*vp.height))),c=document.createElement('canvas');
    c.width=Math.floor(vp.width*dpr);c.height=Math.floor(vp.height*dpr);c.style.width=vp.width+'px';c.style.height=vp.height+'px';
    d.style.width=vp.width+'px';d.style.height=vp.height+'px';
    const t=pg.render({canvasContext:c.getContext('2d',{alpha:false}),viewport:vp,transform:dpr!==1?[dpr,0,0,dpr,0,0]:null});
    V.tasks.set(d,t);await t.promise;V.tasks.delete(d);d.appendChild(c);d._c=c;dropStale(d);
  }catch(e){}
  d._r=0;
}
/* sharp zoom: when a page needs more pixels than one canvas can hold, redraw only the part you are looking at at full detail */
let hiT=0,hiTok=0,pjDoc=null,pjFor=null;
const clearHi=d=>d.querySelectorAll('.hr').forEach(x=>{x.width=x.height=0;x.remove()});
function lowRes(r,dpr){return V.native?r.width*dpr>4000:r.width*r.height*dpr*dpr>16e6}
function schedHi(){clearTimeout(hiT);hiT=setTimeout(hiRender,140)}
async function hiDoc(){
  if(!V.native)return V.doc;if(pjDoc&&pjFor===V.doc)return pjDoc;
  if(pjDoc&&pjDoc.destroy)pjDoc.destroy();pjDoc=null;
  const bytes=V.rotBytes||await srcBytes(V.src);pjDoc=await pj().getDocument({data:bytes.slice(),password:V.pwd||undefined}).promise;pjFor=V.doc;return pjDoc}
async function hiRender(){
  if(!V.doc||GZ)return;const v=$('#viewer'),R=v.getBoundingClientRect(),dpr=window.devicePixelRatio||1,sc=V.scale,tok=++hiTok,need=[];
  for(const d of pages()){const r=d.getBoundingClientRect();
    if(r.bottom<R.top||r.top>R.bottom||r.right<R.left||r.left>R.right||!lowRes(r,dpr)){if(r.bottom<R.top-2000||r.top>R.bottom+2000||!lowRes(r,dpr))clearHi(d);continue}
    const m=120,x=Math.max(0,R.left-r.left-m),y=Math.max(0,R.top-r.top-m),x1=Math.min(r.width,R.right-r.left+m),y1=Math.min(r.height,R.bottom-r.top+m);
    if(x1>x&&y1>y)need.push([d,x,y,x1-x,y1-y])}
  if(!need.length)return;
  try{
    const doc=await hiDoc();if(!doc||tok!==hiTok)return;
    for(const[d,x,y,w,h]of need){
      let k=dpr;if(w*h*k*k>16e6)k=Math.sqrt(16e6/(w*h));
      const pg=await doc.getPage(+d.dataset.n);if(tok!==hiTok||sc!==V.scale||!d.isConnected)return;
      const vp=pg.getViewport({scale:sc}),c=document.createElement('canvas');c.width=Math.ceil(w*k);c.height=Math.ceil(h*k);c.className='hr';
      c.style.cssText='position:absolute;left:'+x+'px;top:'+y+'px;width:'+w+'px;height:'+h+'px;z-index:1;pointer-events:none';
      await pg.render({canvasContext:c.getContext('2d',{alpha:false}),viewport:vp,transform:[k,0,0,k,-x*k,-y*k]}).promise;
      if(tok!==hiTok||sc!==V.scale||!d.isConnected)return;clearHi(d);d.appendChild(c);
    }
  }catch(e){}
}
function dropStale(d){if(d._stale){d._stale.width=d._stale.height=0;d._stale.remove();d._stale=null}}
function undraw(d){dropStale(d);clearHi(d);const t=V.tasks.get(d);if(t){t.cancel();V.tasks.delete(d)}if(d._c){d._c.width=d._c.height=0;d._c.remove();d._c=null}}
function upd(){
  const v=$('#viewer'),c=v.children;if(!c.length)return;let lo=0,hi=c.length-1;const y=v.scrollTop+v.clientHeight/3;
  while(lo<hi){const m=(lo+hi+1)>>1;if(c[m].offsetTop<=y)lo=m;else hi=m-1}
  const n=lo+1;if(n!==V.cur){V.cur=n;mark();saveRp()}
  if(document.activeElement!==$('#pg'))$('#pg').value=n;
}
function mark(){const o=document.querySelector('.th.on');if(o)o.classList.remove('on');const t=document.querySelector('.th[data-n="'+V.cur+'"]');if(t){t.classList.add('on');if(!$('#side').hidden&&!$('#thumbs').hidden){const r=t.getBoundingClientRect(),p=$('#thumbs').getBoundingClientRect();if(r.top<p.top||r.bottom>p.bottom)t.scrollIntoView({block:'center'})}}}
function goTo(n){if(!V.doc)return;n=Math.min(V.doc.numPages,Math.max(1,n|0));$('#viewer').scrollTop=pages()[n-1].offsetTop-8}
function zoom(f){if(!V.doc)return;const v=$('#viewer'),r=v.scrollTop/v.scrollHeight;if(f)V.fit=false,V.fitMode=null,V.scale=Math.min(6,Math.max(.2,V.scale*f));else V.fit=true,V.fitMode='w';fitScale();build();v.scrollTop=r*v.scrollHeight}
function setFit(m){if(!V.doc)return;const v=$('#viewer'),r=v.scrollTop/v.scrollHeight;V.fitMode=m;
  if(m==='w'||m==='p')V.fit=true;else{V.fit=false;V.scale=m==='a4'?793.7/V.base.width:1}
  fitScale();build();const d=pages()[V.cur-1];if(m==='p'&&d)v.scrollTop=d.offsetTop-12;else v.scrollTop=r*v.scrollHeight}
/* keep the spot under the pointer fixed while the pages change size (pages are centred and have gaps, so plain scroll maths drifts) */
function anchorAt(cx,cy){const v=$('#viewer');let best=null,bd=1e9;
  for(const d of v.children){const r=d.getBoundingClientRect(),dy=cy<r.top?r.top-cy:cy>r.bottom?cy-r.bottom:0;if(dy<bd){bd=dy;best=d;if(!dy)break}}
  if(!best)return()=>{};const r=best.getBoundingClientRect(),fx=(cx-r.left)/(r.width||1),fy=(cy-r.top)/(r.height||1);
  return()=>{const q=best.getBoundingClientRect();v.scrollLeft+=q.left+fx*q.width-cx;v.scrollTop+=q.top+fy*q.height-cy}}
function zoomAt(f,cx,cy){if(!V.doc)return;const v=$('#viewer'),old=V.scale,ns=Math.min(6,Math.max(.2,old*f));if(ns===old)return;
  const fix=anchorAt(cx,cy);V.fit=false;V.fitMode=null;V.scale=ns;fitScale();build();fix()}
function relayout(){if(V.doc&&V.fit){fitScale();build()}}
/* smooth pinch / Ctrl+wheel zoom: stretch pages live, redraw sharply once the gesture stops */
let GZ=null;
function zoomLive(f,cx,cy){
  if(!V.doc)return;const v=$('#viewer'),R=v.getBoundingClientRect();
  if(!GZ){GZ={s0:V.scale,f:1,t:0};[...v.children].forEach(d=>{clearHi(d);d._w0=parseFloat(d.style.width);d._h0=parseFloat(d.style.height)})}
  const ns=Math.min(6,Math.max(.2,GZ.s0*GZ.f*f)),nf=ns/GZ.s0;
  if(nf!==GZ.f){
    const fix=anchorAt(cx,cy);
    [...v.children].forEach(d=>{d.style.width=d._w0*nf+'px';d.style.height=d._h0*nf+'px';const c=d._c;if(c){c.style.width='100%';c.style.height='100%'}});
    GZ.f=nf;fix();$('#zv').textContent=Math.round(ns*100)+'%';
  }
  clearTimeout(GZ.t);GZ.t=setTimeout(zoomCommit,180);
}
function zoomCommit(){
  if(!GZ)return;const v=$('#viewer'),g=GZ;GZ=null;clearTimeout(g.t);
  const sl=v.scrollLeft,st=v.scrollTop;V.fit=false;V.fitMode=null;V.scale=g.s0*g.f;fitScale();build();v.scrollLeft=sl;v.scrollTop=st;
}

/* ---------- sidebar ---------- */
function buildSide(){
  hlSoon();
  const th=$('#thumbs'),ol=$('#outline');th.innerHTML='';ol.innerHTML='';if(V.tio)V.tio.disconnect();
  if(!V.native){th.innerHTML='<p class="note">Thumbnails and bookmarks are available in the Windows app.</p>';return}
  const fr=document.createDocumentFragment(),tw=150;
  for(let i=1;i<=V.doc.numPages;i++){const[w,h]=V.sizes[i-1],d=document.createElement('div');d.className='th';d.dataset.n=i;d.draggable=true;d.tabIndex=0;d.setAttribute('role','listitem');d.setAttribute('aria-label','Page '+i);d.innerHTML='<div class="im" style="width:'+tw+'px;height:'+Math.round(h/w*tw)+'px"></div><span>'+i+'</span><button class="thm" title="Page options: rotate, move, insert, delete" aria-label="Page '+i+' options">⋯</button>';fr.appendChild(d)}
  th.appendChild(fr);
  V.tio=new IntersectionObserver(es=>es.forEach(e=>{e.target._vis=e.isIntersecting;e.isIntersecting?thumb(e.target):unthumb(e.target)}),{root:th,rootMargin:'300px 0px'});
  [...th.children].forEach(c=>V.tio.observe(c));mark();
  const doc=V.doc;
  inv('pdf_outline').then(r=>{if(doc!==V.doc)return;ol.innerHTML=r.length?r.map(x=>'<div class="ol" data-p="'+x[2]+'" style="padding-left:'+(6+x[1]*14)+'px">'+esc(x[0]||'(untitled)')+'</div>').join(''):'<p class="note">This document has no bookmarks.</p>'}).catch(()=>{});
}
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
async function thumb(d){
  if(d._u||d._r)return;d._r=1;const doc=V.doc;
  try{
    const buf=await inv('pdf_render',{page:+d.dataset.n-1,width:300,prio:0});
    if(doc!==V.doc||!d._vis||!d.isConnected){d._r=0;return}
    d._u=URL.createObjectURL(new Blob([buf],{type:'image/png'}));const im=document.createElement('img');im.src=d._u;d.firstChild.appendChild(im);
  }catch(e){}
  d._r=0;
}
function unthumb(d){if(d._u){URL.revokeObjectURL(d._u);d._u=null;d.firstChild.innerHTML=''}}
$('#thumbs').onclick=e=>{const t=e.target.closest('.th');if(t)goTo(+t.dataset.n)};
$('#outline').onclick=e=>{const t=e.target.closest('.ol');if(t&&+t.dataset.p>=0)goTo(+t.dataset.p+1)};
document.querySelectorAll('#side .tabs button').forEach(b=>b.onclick=()=>{
  document.querySelectorAll('#side .tabs button').forEach(x=>x.classList.toggle('on',x===b));
  $('#thumbs').hidden=b.dataset.s!=='thumbs';$('#outline').hidden=b.dataset.s!=='outline';$('#hls').hidden=b.dataset.s!=='hls';if(b.dataset.s==='hls')hlBuild()});
function toggleSide(){if(!V.doc)return;$('#side').hidden=!$('#side').hidden;relayout();hlSoon()}
/* ---------- markups list: every markup in one place, filter, jump, copy, export ---------- */
var hlSort='page',hlF='all',hlT=0;
const hlOn=()=>!$('#side').hidden&&!$('#hls').hidden;
function hlSoon(){if(!hlOn())return;clearTimeout(hlT);hlT=setTimeout(hlBuild,200)}
const MKT={hl:'Highlight',ul:'Underline',st:'Strikethrough',text:'Text note',callout:'Callout',pen:'Pen',line:'Line',arrow:'Arrow',rect:'Rectangle',ellipse:'Ellipse',count:'Count'};
const MKG={all:'All markup',hl:'Highlights',note:'Notes and callouts',shape:'Shapes and pen',meas:'Measure and count',stamp:'Stamps and signatures'};
const mkGroup=a=>({hl:'hl',ul:'hl',st:'hl',text:'note',callout:'note',meas:'meas',count:'meas',img:'stamp'})[a.type]||'shape';
const mkKind=a=>a.type==='img'?(a.kind==='sig'?'Signature':'Stamp'):a.type==='meas'?(a.kind==='area'?'Area':'Length'):MKT[a.type]||a.type;
const hlTop=a=>bboxOf(a)[3],hlLeft=a=>bboxOf(a)[0],hlCmp=(x,y)=>x.a.p-y.a.p||hlTop(y.a)-hlTop(x.a)||hlLeft(x.a)-hlLeft(y.a)||x.a.id-y.a.id;
async function hlText(a){
  if(!V.native||!a.rects)return'';const ch=await pageText(a.p);if(!ch||!ch.length)return'';
  let s='',prev=-2;
  for(let i=0;i<ch.length;i++){const c=ch[i];if(c[3]-c[1]<=0)continue;const cx=(c[1]+c[3])/2,cy=(c[2]+c[4])/2;
    if(a.rects.some(r=>cx>=r[0]&&cx<=r[2]&&cy>=r[1]&&cy<=r[3])){if(prev>=0&&i-prev>1)s+=' ';s+=c[0];prev=i}}
  return s.replace(/\s+/g,' ').trim()}
function measLabel(a){const k=calFor(a.p),pts=a.pts||[];if(!k)return'Scale not set';
  if(a.kind==='area')return pts.length>2?fmtNum(polyArea(pts)*k.k*k.k)+' '+k.unit+'²':'';
  return pts.length>1?fmtNum(dist(pts[0],pts[1])*k.k)+' '+k.unit:''}
async function mkContent(a){
  switch(a.type){
    case'hl':case'ul':case'st':return await hlText(a);
    case'text':case'callout':return String(a.text||'').replace(/\s+/g,' ').trim();
    case'meas':return measLabel(a);
    case'count':return'No. '+cntNo(a);
    case'img':return a.label||'';
  }return''}
async function mkRows(){const doc=V.doc,rows=await Promise.all(V.ann.map(async a=>({a,k:mkKind(a),g:mkGroup(a),t:await mkContent(a)})));return doc===V.doc?rows.sort(hlCmp):null}
async function hlBuild(){
  const box=$('#hls'),doc=V.doc;if(!doc)return;
  const all=await mkRows();if(!all||doc!==V.doc)return;
  const rows=hlF==='all'?all:all.filter(r=>r.g===hlF),keep=box.scrollTop;box._rows=rows;
  const item=r=>'<div class="hi" data-id="'+r.a.id+'"><i style="background:'+esc(r.a.c||'#888')+'"></i><div class="tx"><b class="k">'+esc(r.k)+'</b>'+esc(r.t)+'</div><span class="pn">p. '+r.a.p+'</span><button class="x" title="Delete">✕</button></div>';
  const has=g=>all.some(r=>r.g===g);
  let h='<div class="hh"><select id="hF" title="Show">'+Object.keys(MKG).filter(k=>k==='all'||k===hlF||has(k)).map(k=>'<option value="'+k+'"'+(k===hlF?' selected':'')+'>'+MKG[k]+'</option>').join('')+'</select>'
    +'<button id="hSort" title="Change order">'+{page:'By page',type:'By type',color:'By colour'}[hlSort]+'</button></div>'
    +'<div class="hh"><span>'+rows.length+(rows.length===1?' item':' items')+'</span><button id="hCopy" title="Copy the text of these items">Copy</button><button id="hCsv" title="Save this list as a spreadsheet (opens in Excel)">Export</button></div>';
  const cnt=all.filter(r=>r.a.type==='count');
  if(cnt.length&&(hlF==='all'||hlF==='meas')){const m=new Map();cnt.forEach(r=>m.set(r.a.c,(m.get(r.a.c)||0)+1));
    h+='<div class="cs">Count totals:'+[...m].map(([c,n])=>'<span><i style="background:'+esc(c)+'"></i>'+n+'</span>').join('')+'</div>'}
  if(!all.length)h+='<p class="note">No markup yet. Highlights, notes, shapes, measurements and stamps you add are listed here.</p>';
  else if(!rows.length)h+='<p class="note">Nothing of this kind yet.</p>';
  else if(hlSort==='page')h+=rows.map(item).join('');
  else{const key=hlSort==='type'?r=>r.k:r=>r.a.c,g=new Map();rows.forEach(r=>{const k=key(r);if(!g.has(k))g.set(k,[]);g.get(k).push(r)});
    g.forEach((v,k)=>{h+='<div class="gh">'+(hlSort==='color'?'<i style="background:'+esc(k)+'"></i>':'<b>'+esc(k)+'</b>')+' '+v.length+'</div>'+v.map(item).join('')})}
  box.innerHTML=h;box.scrollTop=keep}
const csvCell=v=>{v=String(v==null?'':v);return/[",\r\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v};
async function exportMarkups(rows){
  if(!rows.length){toast('Nothing to export',2000);return}
  const L=[['No.','Page','Type','Content','Colour','Created']].concat(rows.map((r,i)=>[i+1,r.a.p,r.k,r.t,r.a.c||'',r.a.ts?new Date(r.a.ts).toLocaleString('en-GB'):'']));
  const bytes=new TextEncoder().encode('\ufeff'+L.map(x=>x.map(csvCell).join(',')).join('\r\n')+'\r\n');
  const nm=((V.src&&V.src.name)||'document').replace(/\.pdf$/i,'')+'-markups.csv';
  try{await save(bytes,nm,{ext:'csv',label:'CSV spreadsheet',mime:'text/csv'});toast('Exported '+rows.length+(rows.length===1?' item':' items'),3000)}
  catch(e){if(!/cancel/i.test(e.message||''))toast('Could not save the file',3000)}}
$('#hls').addEventListener('change',e=>{if(e.target.id==='hF'){hlF=e.target.value;hlBuild()}});
$('#hls').onclick=e=>{
  const rows=$('#hls')._rows||[];
  if(e.target.id==='hSort'){hlSort={page:'type',type:'color',color:'page'}[hlSort];hlBuild();return}
  if(e.target.id==='hCsv'){exportMarkups(rows);return}
  if(e.target.id==='hCopy'){const t=rows.filter(r=>r.t).map(r=>'[p. '+r.a.p+'] '+r.k+': '+r.t).join('\n');
    if(!t){toast('No text to copy',2000);return}navigator.clipboard.writeText(t).then(()=>toast('Copied '+t.split('\n').length+' items',2000)).catch(()=>{});return}
  const it=e.target.closest('.hi');if(!it)return;const a=V.ann.find(x=>x.id===+it.dataset.id);if(!a)return;
  if(e.target.closest('.x')){selectAnn(a.id);delSel();return}
  if(V.tool!=='select')setTool('select');
  selectAnn(a.id);$('#viewer').scrollTop=Math.max(0,pages()[a.p-1].offsetTop+(pageH(a.p)-hlTop(a))*V.scale-90)};

/* ---------- print (renders each page as an image so prints match the screen) ---------- */
let printing=false;
function openPrint(){if(!V.doc||licLocked||printing)return;
  $('#prN').textContent=pages().length;$('#prMkRow').hidden=!V.ann.length;$('#prMsg').textContent='';$('#prGo').disabled=false;$('#dPrint').showModal()}
async function printCanvas(n,withMarks){
  const w=pageW(n),h=pageH(n),s=Math.min(200/72,3400/Math.max(w,h)),c=document.createElement('canvas');
  c.width=Math.max(1,Math.round(w*s));c.height=Math.max(1,Math.round(h*s));
  const x=c.getContext('2d',{alpha:false});x.fillStyle='#fff';x.fillRect(0,0,c.width,c.height);
  if(V.doc.native){const buf=await inv('pdf_render',{page:n-1,width:Math.min(c.width,4096),prio:1,raw:true});
    const bmp=await rawBitmap(buf);x.drawImage(bmp,0,0,c.width,c.height);bmp.close()}
  else{const pg=await V.doc.getPage(n),vp=pg.getViewport({scale:c.width/pg.getViewport({scale:1}).width});await pg.render({canvasContext:x,viewport:vp}).promise}
  if(withMarks&&V.ann.some(a=>a.p===n)){
    const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+w+' '+h+'" width="'+c.width+'" height="'+c.height+'">'+annInner(n,true)+'</svg>';
    x.drawImage(await loadImg('data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg)),0,0,c.width,c.height)}
  return c}
$('#bPrint').onclick=openPrint;
$('#prX').onclick=$('#prCancel').onclick=()=>$('#dPrint').close();
$('#prRange').addEventListener('focus',()=>{document.querySelector('input[name=prR][value=rng]').checked=true});
$('#prGo').onclick=async()=>{
  if(printing)return;const N=pages().length,m=document.querySelector('input[name=prR]:checked').value,msg=$('#prMsg');let idx;
  try{idx=m==='all'?[...Array(N).keys()]:m==='cur'?[V.cur-1]:parseRanges($('#prRange').value,N)}catch(e){msg.textContent=e.message;return}
  const old=$('#printArea');if(old)old.remove();
  printing=true;$('#prGo').disabled=true;const area=document.createElement('div'),urls=[],marks=$('#prMk').checked&&!$('#prMkRow').hidden;area.id='printArea';
  const cleanup=()=>{area.remove();urls.forEach(u=>URL.revokeObjectURL(u))};
  try{
    for(let i=0;i<idx.length;i++){
      if(!$('#dPrint').open)throw Error('cancel');
      msg.textContent='Preparing page '+(i+1)+' of '+idx.length+'…';
      const c=await printCanvas(idx[i]+1,marks),b=await new Promise(r=>c.toBlob(r,'image/jpeg',.92)),u=URL.createObjectURL(b);urls.push(u);
      const pp=document.createElement('div'),im=new Image();pp.className='pp';im.src=u;pp.append(im);area.append(pp)}
    document.body.append(area);
    await Promise.all([...area.querySelectorAll('img')].map(im=>im.decode().catch(()=>{})));
    $('#dPrint').close();await new Promise(r=>setTimeout(r,60));
    window.addEventListener('afterprint',cleanup,{once:true});
    window.print();
  }catch(e){cleanup();if(e.message!=='cancel')msg.textContent='Could not prepare the pages for printing.'}
  finally{printing=false;$('#prGo').disabled=false}};

/* ---------- overlays: search hits + text selection ---------- */
function paintPage(n){
  const d=pages()[n-1];if(!d)return;const s=V.scale,H=pageH(n);let h='';
  const W=pageW(n),pc=v=>(+v.toFixed(4))+'%',box=(l,b,r,t,c)=>'<i class="'+c+'" style="left:'+pc(l/W*100)+';top:'+pc((H-t)/H*100)+';width:'+pc((r-l)/W*100)+';height:'+pc((t-b)/H*100)+'"></i>';
  V.hits.forEach((x,i)=>{if(x[0]===n-1)h+=box(x[1],x[2],x[3],x[4],i===V.hi?'hit cur':'hit')});
  selLines(n).forEach(g=>h+=box(g.l,g.b,g.r,g.t,'sel'));
  d.firstChild.innerHTML=h;
}
function paintAll(){const set=new Set(V.hits.map(x=>x[0]+1));if(V.sel)set.add(V.sel.n);set.forEach(paintPage)}
function selLines(n){
  if(!V.sel||V.sel.n!==n)return[];
  const ch=V.cache.get(n)||[],lo=Math.min(V.sel.a,V.sel.b),hi=Math.max(V.sel.a,V.sel.b);
  const ws=c=>/^\s*$/.test(c[0]);const med=a=>{a=a.slice().sort((x,y)=>x-y);return a[a.length>>1]};
  const lines=[];
  for(let i=lo;i<=hi;i++){const c=ch[i];if(!c||c[3]-c[1]<=0||c[4]-c[2]<=0)continue;
    if(ws(c))continue;
    const mid=(c[2]+c[4])/2;
    /* join ANY existing line whose band holds this character (text order may jump between cells) */
    let g=null;for(const L of lines)if(mid>L.ref[0]&&mid<L.ref[1]){g=L;break}
    if(g)g.cs.push(c);else lines.push({ref:[c[2],c[4]],cs:[c]})}
  const out=[];
  for(const L of lines){
    const cs=L.cs.slice().sort((x,y)=>x[1]-y[1]);
    const b=med(cs.map(c=>c[2])),t=med(cs.map(c=>c[4])),gap=Math.max(4*(t-b),1);
    let seg=null;
    const flush=()=>{if(seg)out.push({l:seg.l,r:seg.r,b,t});seg=null};
    for(const c of cs){if(seg&&c[1]-seg.r>gap)flush();if(!seg)seg={l:c[1],r:c[3]};else{seg.l=Math.min(seg.l,c[1]);seg.r=Math.max(seg.r,c[3])}}
    flush()}
  return out;
}
/* tables exported column by column come out of PDFium in a jumbled order: put them in reading order */
function readingOrder(ch){
  const ok=ch.filter(c=>c[3]-c[1]>0&&c[4]-c[2]>0);if(ok.length<40)return ch;
  const mid=c=>(c[2]+c[4])/2,h=c=>c[4]-c[2];
  let sw=0,a=null;for(const b of ok){if(a&&Math.abs(mid(a)-mid(b))>.6*Math.max(h(a),h(b)))sw++;a=b}
  const rows=[];[...ok].sort((a,b)=>mid(b)-mid(a)).forEach(c=>{const r=rows.length?rows[rows.length-1]:null;
    if(r&&Math.abs(mid(c)-r.m)<.5*Math.min(h(c),r.h)){r.cs.push(c)}else rows.push({m:mid(c),h:h(c),cs:[c]})});
  if(sw<3*rows.length)return ch;
  const out=[];rows.forEach(r=>{r.cs.sort((a,b)=>a[1]-b[1]);r.cs.forEach((c,i)=>{if(i&&c[1]-r.cs[i-1][3]>1.5*h(c))out.push(['\t',0,0,0,0]);out.push(c)});out.push(['\n',0,0,0,0])});
  return out;
}
async function pageText(n){if(V.cache.has(n))return V.cache.get(n);
  let r=[];if(V.native){try{r=await inv('pdf_text',{page:n-1})}catch(e){r=[]}}
  const o=ocrPage(n);if(o&&r.length<20)r=ocrChars(o);
  r=readingOrder(r);V.cache.set(n,r);return r}
const ptOf=(e,d,n)=>{const r=d.getBoundingClientRect();return[(e.clientX-r.left)/V.scale,pageH(n)-(e.clientY-r.top)/V.scale]};
function nearest(ch,p){let bi=0,bd=1e18;for(let i=0;i<ch.length;i++){const c=ch[i];if(c[3]-c[1]<=0)continue;
  const dx=p[0]<c[1]?c[1]-p[0]:p[0]>c[3]?p[0]-c[3]:0,dy=p[1]<c[2]?c[2]-p[1]:p[1]>c[4]?p[1]-c[4]:0,dd=dx*dx+dy*dy*4;
  if(dd<bd){bd=dd;bi=i;if(dd===0)break}}return bi}
function clearSel(){if(V.sel){const n=V.sel.n;V.sel=null;paintPage(n)}}

function selText(){const s=V.sel;if(!s)return'';const ch=V.cache.get(s.n)||[];return ch.slice(Math.min(s.a,s.b),Math.max(s.a,s.b)+1).map(c=>c[0]).join('').replace(/\r\n?/g,'\n')}

/* ---------- find ---------- */
function showFind(){if(!V.doc)return;$('#findbar').hidden=false;$('#q').focus();$('#q').select();relayout()}
function hideFind(){$('#findbar').hidden=true;const old=new Set(V.hits.map(x=>x[0]+1));V.hits=[];V.hi=-1;old.forEach(paintPage);relayout()}
let ft;$('#q').oninput=()=>{clearTimeout(ft);ft=setTimeout(()=>find($('#q').value),250)};
async function find(q){
  const old=new Set(V.hits.map(x=>x[0]+1));V.hits=[];V.hi=-1;old.forEach(paintPage);
  if(!q){$('#fc').textContent='';return}
  if(!V.native&&!ocrPageCount()){$('#fc').innerHTML='Search needs <a id="fOcr">OCR</a> on this device';wireOcrLink();return}
  $('#fc').textContent='Searching…';
  let hs=[];if(V.native){try{hs=await inv('pdf_search',{query:q})}catch(e){hs=[]}}
  if(V.ocr)hs=hs.concat(ocrHits(q)).sort((a,b)=>a[0]-b[0]||b[2]-a[2]||a[1]-b[1]);
  V.hits=hs;
  if(q!==$('#q').value)return;
  paintAll();
  if(V.hits.length){$('#fc').textContent='';hit(0)}
  else{$('#fc').innerHTML=V.ocr?'No results':'No results · scanned? <a id="fOcr">Run OCR</a>';wireOcrLink()}
}
const ocrPageCount=()=>Object.keys(V.ocr&&V.ocr.pages||{}).length;
function wireOcrLink(){const a=$('#fOcr');if(a)a.onclick=()=>showTools('ocr')}
function hit(i){
  const n=V.hits.length;if(!n)return;const prev=V.hi;V.hi=(i+n)%n;const h=V.hits[V.hi];
  if(prev>=0&&V.hits[prev])paintPage(V.hits[prev][0]+1);paintPage(h[0]+1);
  $('#fc').textContent=(V.hi+1)+' / '+n+(n>=3000?'+':'');
  const d=pages()[h[0]];$('#viewer').scrollTop=d.offsetTop+(pageH(h[0]+1)-h[4])*V.scale-$('#viewer').clientHeight/3;
}
$('#q').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();hit(V.hi+(e.shiftKey?-1:1))}else if(e.key==='Escape')hideFind()};
$('#fNext').onclick=()=>hit(V.hi+1);$('#fPrev').onclick=()=>hit(V.hi-1);$('#fX').onclick=hideFind;


/* ---------- open / recent / drop ---------- */
const recents=()=>{try{return JSON.parse(localStorage.recent||'[]')}catch(e){return[]}};
function remember(f){if(!f._path)return;const r=recents().filter(x=>x.path!==f._path);r.unshift({name:f.name,path:f._path});try{localStorage.recent=JSON.stringify(r.slice(0,6))}catch(e){}showRecent()}
function showRecent(){const r=recents();$('#rec').innerHTML=r.length?'<div class="rh"><h2>Recent</h2><a href="#" data-clear="1">Clear list</a></div><div class="rl">'+r.map((x,i)=>'<button data-i="'+i+'" title="'+esc(x.path)+'"><span class="rd"><i></i><i></i><i></i></span><span class="rt"><b>'+esc(x.name)+'</b><small data-keep>'+esc(String(x.path).replace(/[\\/][^\\/]*$/,''))+'</small></span></button>').join('')+'</div>':''}
$('#rec').onclick=e=>{if(e.target.closest('[data-clear]')){e.preventDefault();try{localStorage.recent='[]'}catch(_){}showRecent();return}const b=e.target.closest('button[data-i]');if(b){const x=recents()[+b.dataset.i];if(x)openNew({name:x.name,_path:x.path})}};
const openNew=f=>openTab(f);
async function pick(){
  if(T){const p=await inv('pick_pdf');if(p)openNew({name:base(p),_path:p})}
  else $('#file').click();
}
$('#file').onchange=e=>{const f=e.target.files[0];e.target.value='';if(f&&isPdf(f.name))openTab(f)};
async function dropPaths(paths){
  if($('#tools').open&&tt==='images'){const fl=[];for(const p of paths.filter(isImg))fl.push(new File([await inv('read_file',{path:p})],base(p)));addTools(fl);return}
  const pdfs=paths.filter(isPdf);if(!pdfs.length)return;
  if($('#tools').open){const fl=[];for(const p of pdfs)fl.push(await ldFile(p));addTools(fl)}else for(const q of pdfs)await openNew({name:base(q),_path:q});
}
const ldFile=async p=>new File([await inv('read_file',{path:p})],base(p),{type:'application/pdf'});
window.addEventListener('dragover',e=>e.preventDefault());
window.addEventListener('drop',e=>{e.preventDefault();if($('#tools').open&&tt==='images'){addTools([...e.dataTransfer.files]);return}const fs=[...e.dataTransfer.files].filter(f=>isPdf(f.name));if(!fs.length)return;$('#tools').open?addTools(fs):openDoc(fs[0])});

/* ---------- toolbar + keys ---------- */
$('#bOpen').onclick=pick;$('#eOpen').onclick=pick;$('#bSide').onclick=toggleSide;$('#bFind').onclick=showFind;
$('#bZm').onclick=()=>zoom(1/1.2);$('#bZp').onclick=()=>zoom(1.2);$('#bFit').onclick=e=>{const b=e.currentTarget;if(!$('#pop').hidden){hidePop();return}if(!V.doc)return;
  const cur=V.fit?(V.fitMode==='p'?'p':'w'):V.fitMode||'',it=(k,t,h)=>'<button data-fit="'+k+'"><b>'+(cur===k?'✓ ':'')+t+'</b><small>'+h+'</small></button>';
  showPop(b,it('w','Fit width','Page fills the window width')+it('p','Fit page','Whole page visible at once')+it('a4','A4 size','21 cm wide, like printed paper')+it('1','Actual size','100% · original PDF size')+'<div class="sep"></div><button data-act="dark"><b>'+(document.body.classList.contains('dark')?'✓ ':'')+'Night mode</b><small>Dark pages for easier reading</small></button><button data-act="full"><b>'+(FS?'✓ ':'')+'Full screen</b><small>F11 · Esc to leave</small></button><button data-act="lang"><b>'+(LANG==='ar'?'English':'العربية')+'</b><small>Language · اللغة</small></button>')};
$('#pg').onkeydown=e=>{if(e.key==='Enter'){goTo(+e.target.value);e.target.blur()}};
$('#viewer').onscroll=()=>{cancelAnimationFrame(V.raf);V.raf=requestAnimationFrame(upd);schedHi()};
window.addEventListener('wheel',e=>{if(!e.ctrlKey)return;e.preventDefault();if(!V.doc||licLocked||document.querySelector('dialog[open]'))return;
  const dy=e.deltaMode===1?e.deltaY*33:e.deltaY;
  zoomLive(Math.abs(dy)>=50?(dy<0?1.1:1/1.1):Math.min(1.4,Math.max(1/1.4,Math.exp(-dy*.02))),e.clientX,e.clientY)},{passive:false,capture:true});
(function(){const v=$('#viewer');let pz=null,lx=0,ly=0;const dist=t=>Math.hypot(t[0].clientX-t[1].clientX,t[0].clientY-t[1].clientY),mid=t=>[(t[0].clientX+t[1].clientX)/2,(t[0].clientY+t[1].clientY)/2];
  v.addEventListener('touchstart',e=>{if(e.touches.length===2){V.op=null;pz=dist(e.touches);[lx,ly]=mid(e.touches)}},{passive:true});
  v.addEventListener('touchmove',e=>{if(pz&&e.touches.length===2){e.preventDefault();const d=dist(e.touches),[cx,cy]=mid(e.touches);
    if(pz>10)zoomLive(d/pz,cx,cy);pz=d;v.scrollLeft-=cx-lx;v.scrollTop-=cy-ly;lx=cx;ly=cy}},{passive:false});
  v.addEventListener('touchend',e=>{if(e.touches.length<2){pz=null;if(GZ){clearTimeout(GZ.t);zoomCommit()}}},{passive:true});
})();
document.addEventListener('keydown',e=>{
  const inInput=/INPUT|SELECT|TEXTAREA/.test((document.activeElement||{}).tagName||'');
  if(e.ctrlKey){
    const k=e.key.toLowerCase();
    if(k==='o'){e.preventDefault();pick()}
    else if(k==='f'){e.preventDefault();showFind()}
    else if(k==='b'){e.preventDefault();toggleSide()}
    else if(k==='g'&&V.doc){e.preventDefault();$('#pg').focus();$('#pg').select()}
    else if(k==='p'){e.preventDefault();openPrint()}
    else if(k==='c'&&!inInput&&V.sel){navigator.clipboard.writeText(selText()).then(()=>toast('Copied',1200)).catch(()=>{})}
    else if(!inInput&&(k==='+'||k==='=')){e.preventDefault();zoom(1.2)}
    else if(!inInput&&k==='-'){e.preventDefault();zoom(1/1.2)}
    else if(!inInput&&k==='0'){e.preventDefault();zoom(0)}
  }else if(e.key==='Escape'){if(!$('#findbar').hidden)hideFind();else clearSel()}
  else if(e.key==='F3'){e.preventDefault();hit(V.hi+(e.shiftKey?-1:1))}
  else if(!inInput&&!e.altKey&&!document.querySelector('dialog[open]')){
    if(e.key==='?'||e.key==='F1'){e.preventDefault();$('#dHelp').showModal();return}
    const map={v:'select',h:'hl',u:'ul',s:'st',p:'pen',t:'text',c:'callout',l:'line',a:'arrow',r:'rect',o:'ellipse',n:'count'},t=map[e.key.toLowerCase()];
    if(t&&V.doc&&!licLocked&&!e.shiftKey){e.preventDefault();setTool(t)}}
});
$('#hX').onclick=()=>$('#dHelp').close();$('#eKeys').onclick=e=>{e.preventDefault();$('#dHelp').showModal()};$('#lKeys').onclick=e=>{e.preventDefault();$('#dLic').close();$('#dHelp').showModal()};
let rt;window.addEventListener('resize',()=>{clearTimeout(rt);rt=setTimeout(relayout,150)});

/* ---------- markup: highlight, pen, text, callout, measure, stamps, signatures ---------- */
const COLORS=['#e11d48','#2563eb','#16a34a','#f59e0b','#111111'];
const IC={select:'<path d="M5 3l14 7-6 2-2 6z"/>',hl:'<path class="f" d="M14.5 4.5l5 5-8 8-5-5z"/><path d="M14.5 4.5l5 5-8 8-5-5z"/><path d="M6.5 12.5L4 18l1.5 1.5L11 17"/><path class="cl" d="M12 21h9"/>',pen:'<path class="f" d="M4 20l1-4L16 5l3 3L8 19z"/><path d="M4 20l1-4L16 5l3 3L8 19z"/><path class="cl" d="M4.4 20.4l2.6-.7"/>',text:'<path class="cl" d="M4 21h16"/><path d="M5 6V3.5h14V6M12 3.5v14M9 17.5h6"/>',callout:'<path class="f" d="M4 4h16v11h-9l-4 4v-4H4z"/><path d="M4 4h16v11h-9l-4 4v-4H4z"/><path d="M8 8.5h8M8 11.5h5"/>',shape:'<rect class="f" x="3" y="11" width="10" height="10" rx="1.5"/><rect x="3" y="11" width="10" height="10" rx="1.5"/><circle class="f" cx="16" cy="8" r="5"/><circle cx="16" cy="8" r="5"/>',meas:'<path d="M3 15L15 3l6 6L9 21z"/><path d="M8 10l2 2M11 7l2 2M5 13l2 2"/>',stamp:'<rect class="f" x="4" y="14" width="16" height="6" rx="1.5"/><rect x="4" y="14" width="16" height="6" rx="1.5"/><path d="M9 14V9a3 3 0 1 1 6 0v5"/>',sign:'<path d="M3 16c3-8 5-10 6-6s2 4 4-1 3-2 4 2"/><path d="M3 21h18"/>'};
const SH={line:['Line','<path d="M5 19L19 5"/>'],arrow:['Arrow','<path d="M5 19L19 5M10 5h9v9"/>'],rect:['Rectangle','<rect x="4" y="6" width="16" height="12" rx="1"/>'],ellipse:['Ellipse','<ellipse cx="12" cy="12" rx="9" ry="6"/>']};
const icon=p=>'<svg class="ic" viewBox="0 0 24 24">'+p+'</svg>';
const TM={hl:['Highlight',IC.hl],ul:['Underline','<path d="M7 4v7a5 5 0 0 0 10 0V4"/><path class="cl" d="M5 21h14"/>'],st:['Strikethrough','<path d="M16.5 7C15.8 5.2 14 4.5 12 4.5c-2.6 0-4.2 1.3-4.2 3 0 1.4 1.2 2.2 4.2 2.8"/><path d="M12 12.5c2.9.6 4.2 1.5 4.2 3.2 0 1.8-1.8 3.3-4.4 3.3-2.1 0-3.9-.8-4.6-2.6"/><path class="cl" d="M4 12h16"/>']};
let lastTM='hl';
const mkType=()=>V.tool==='ul'?'ul':V.tool==='st'?'st':'hl';
const FONT='"Segoe UI",Tahoma,Arial,sans-serif';
const pageW=n=>V.sizes?V.sizes[n-1][0]:V.base.width;
const UN=n=>Math.max(pageW(n),pageH(n))/850;
let mctx=null;try{mctx=document.createElement('canvas').getContext('2d')}catch(e){}
const mw=(s,sz)=>{try{mctx.font=sz+'px '+FONT;return mctx.measureText(s).width}catch(e){return s.length*sz*.55}};
const dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const rtl=s=>/[\u0590-\u08FF]/.test(s);
const f=v=>Math.round(v*100)/100;
function tm(a){const L=String(a.text||'').split('\n'),co=a.type==='callout';return{L,w:Math.max(...L.map(s=>mw(s,a.size)))+(co?a.size*.8:0),h:L.length*a.size*1.25+(co?a.size*.6:0)}}
const calFor=n=>V.cal.pages[n]||V.cal.def;
const fmtNum=v=>v>=100?v.toFixed(1):v>=10?v.toFixed(2):v.toFixed(3);
const polyArea=pts=>Math.abs(pts.reduce((s,p,i)=>{const q=pts[(i+1)%pts.length];return s+p[0]*q[1]-q[0]*p[1]},0))/2;
const centroid=pts=>[pts.reduce((s,p)=>s+p[0],0)/pts.length,pts.reduce((s,p)=>s+p[1],0)/pts.length];

function bboxOf(a){
  const U=UN(a.p),ext=(ps,pad)=>{const xs=ps.map(p=>p[0]),ys=ps.map(p=>p[1]);return[Math.min(...xs)-pad,Math.min(...ys)-pad,Math.max(...xs)+pad,Math.max(...ys)+pad]};
  switch(a.type){
    case'hl':case'ul':case'st':{const r=a.rects;return[Math.min(...r.map(x=>x[0])),Math.min(...r.map(x=>x[1])),Math.max(...r.map(x=>x[2])),Math.max(...r.map(x=>x[3]))]}
    case'pen':return ext(a.pts,a.w);
    case'line':case'arrow':return ext([[a.fx,a.fy],[a.tx,a.ty]],4*U);
    case'rect':case'ellipse':case'redact':case'cropbox':return[a.r[0],a.r[1],a.r[2],a.r[3]];
    case'meas':return ext(a.pts,6*U);
    case'img':return[a.x,a.y,a.x+a.w,a.y+a.h];
    case'count':return[a.x-a.r,a.y-a.r,a.x+a.r,a.y+a.r];
    case'text':{const m=tm(a);return[a.x,a.y-m.h,a.x+m.w,a.y]}
    case'callout':{const m=tm(a);return[Math.min(a.x,a.tx),Math.min(a.y-m.h,a.ty),Math.max(a.x+m.w,a.tx),Math.max(a.y,a.ty)]}
  }
  return[0,0,0,0];
}
function arrowSvg(fx,fy,tx,ty,c,U,ph,w){
  const ang=Math.atan2(ty-fy,tx-fx),s=Math.max(9*U,(w||0)*4.5),b=[tx-Math.cos(ang)*s,ty-Math.sin(ang)*s],px=-Math.sin(ang)*s*.4,py=Math.cos(ang)*s*.4;
  const P=(x,y)=>f(x)+','+f(ph-y);
  return '<line x1="'+f(fx)+'" y1="'+f(ph-fy)+'" x2="'+f(b[0])+'" y2="'+f(ph-b[1])+'" stroke="'+c+'" stroke-width="'+f(w||1.5*U)+'" stroke-linecap="round"/><polygon points="'+P(tx,ty)+' '+P(b[0]+px,b[1]+py)+' '+P(b[0]-px,b[1]-py)+'" fill="'+c+'"/>';
}
function textSvg(a,ph){
  const m=tm(a),co=a.type==='callout',pad=co?a.size*.4:0,top=ph-a.y;let o='';
  m.L.forEach((s,i)=>{const r=rtl(s),x=r?a.x+m.w-pad:a.x+pad;
    o+='<text x="'+f(x)+'" y="'+f(top+(co?a.size*.3:0)+a.size*(1.05+1.25*i))+'" font-size="'+f(a.size)+'" fill="'+a.c+'" font-family=\''+FONT+'\' '+(r?'direction="rtl" ':'')+'xml:space="preserve">'+(esc(s)||' ')+'</text>'});
  return o;
}
const cntNo=a=>V.ann.filter(x=>x.type==='count'&&x.p===a.p&&x.c===a.c&&x.id<=a.id).length;
function annEl(a,ph){
  const U=UN(a.p),c=a.c,Y=y=>f(ph-y);let o='';
  switch(a.type){
    case'ul':case'st':o=a.rects.map(r=>{const h=r[3]-r[1],y=a.type==='ul'?r[1]+h*.14:(r[1]+r[3])/2,w=Math.max(1.3*U,h*.075);
      return'<rect x="'+f(r[0])+'" y="'+Y(r[3])+'" width="'+f(r[2]-r[0])+'" height="'+f(h)+'" fill="rgba(0,0,0,0)"/><line x1="'+f(r[0])+'" y1="'+Y(y)+'" x2="'+f(r[2])+'" y2="'+Y(y)+'" stroke="'+c+'" stroke-width="'+f(w)+'" stroke-linecap="round"/>'}).join('');break;
    case'hl':o=a.rects.map(r=>'<rect x="'+f(r[0])+'" y="'+Y(r[3])+'" width="'+f(r[2]-r[0])+'" height="'+f(r[3]-r[1])+'" fill="'+c+'" fill-opacity=".38"/>').join('');break;
    case'pen':{const pts=a.pts.map(p=>f(p[0])+','+Y(p[1])).join(' ');
      o='<polyline points="'+pts+'" fill="none" stroke="rgba(0,0,0,0)" stroke-width="'+f(Math.max(a.w,10*U))+'" stroke-linecap="round" stroke-linejoin="round"/><polyline points="'+pts+'" fill="none" stroke="'+c+'" stroke-width="'+f(a.w)+'" stroke-linecap="round" stroke-linejoin="round"/>';break}
    case'text':{const m=tm(a);o='<rect x="'+f(a.x)+'" y="'+Y(a.y)+'" width="'+f(m.w)+'" height="'+f(m.h)+'" fill="rgba(0,0,0,0)"/>'+textSvg(a,ph);break}
    case'callout':{
      const m=tm(a),cx=a.x+m.w/2,cy=a.y-m.h/2,cands=[[a.x,cy],[a.x+m.w,cy],[cx,a.y],[cx,a.y-m.h]];let best=cands[0];
      cands.forEach(p=>{if(dist(p,[a.tx,a.ty])<dist(best,[a.tx,a.ty]))best=p});
      o='<line x1="'+f(best[0])+'" y1="'+Y(best[1])+'" x2="'+f(a.tx)+'" y2="'+Y(a.ty)+'" stroke="rgba(0,0,0,0)" stroke-width="'+f(10*U)+'"/><rect x="'+f(a.x)+'" y="'+Y(a.y)+'" width="'+f(m.w)+'" height="'+f(m.h)+'" fill="#fff" fill-opacity=".93" stroke="'+c+'" stroke-width="'+f(U)+'" rx="'+f(2*U)+'"/>'+arrowSvg(best[0],best[1],a.tx,a.ty,c,U,ph)+textSvg(a,ph);break}
    case'line':case'arrow':{const hit=a.id>0?'<line x1="'+f(a.fx)+'" y1="'+Y(a.fy)+'" x2="'+f(a.tx)+'" y2="'+Y(a.ty)+'" stroke="rgba(0,0,0,0)" stroke-width="'+f(Math.max(10*U,a.w||0))+'" pointer-events="stroke"/>':'';
      o=hit+(a.type==='arrow'?arrowSvg(a.fx,a.fy,a.tx,a.ty,c,U,ph,a.w):'<line x1="'+f(a.fx)+'" y1="'+Y(a.fy)+'" x2="'+f(a.tx)+'" y2="'+Y(a.ty)+'" stroke="'+c+'" stroke-width="'+f(a.w)+'" stroke-linecap="round"/>');break}
    case'rect':case'ellipse':{const r=a.r,sh=x=>a.type==='rect'?'<rect x="'+f(r[0])+'" y="'+Y(r[3])+'" width="'+f(r[2]-r[0])+'" height="'+f(r[3]-r[1])+'" '+x+'/>':'<ellipse cx="'+f((r[0]+r[2])/2)+'" cy="'+Y((r[1]+r[3])/2)+'" rx="'+f((r[2]-r[0])/2)+'" ry="'+f((r[3]-r[1])/2)+'" '+x+'/>';
      o=sh('fill="none" stroke="rgba(0,0,0,0)" stroke-width="'+f(Math.max(10*U,a.w))+'" pointer-events="stroke"')+sh('fill="none" stroke="'+c+'" stroke-width="'+f(a.w)+'" stroke-linejoin="round" pointer-events="stroke"');break}
    case'count':{const r=a.r,k=cntNo(a),fs=r*(k>99?.8:k>9?1:1.2);
      o='<circle cx="'+f(a.x)+'" cy="'+Y(a.y)+'" r="'+f(r)+'" fill="'+c+'" stroke="#fff" stroke-width="'+f(r*.16)+'"/><text x="'+f(a.x)+'" y="'+Y(a.y)+'" dy=".36em" font-size="'+f(fs)+'" text-anchor="middle" font-weight="700" fill="#fff" font-family=\''+FONT+'\'>'+k+'</text>';break}
    case'redact':case'cropbox':{const r=a.r,rd=a.type==='redact';
      o='<rect x="'+f(r[0])+'" y="'+Y(r[3])+'" width="'+f(r[2]-r[0])+'" height="'+f(r[3]-r[1])+'" fill="'+(rd?'#000':'none')+'" fill-opacity="'+(rd?'.55':'0')+'" stroke="'+(rd?'#dc2626':'#2563eb')+'" stroke-width="'+f(1.5*U)+'"'+(rd?'':' stroke-dasharray="'+f(5*U)+'"')+' pointer-events="all"/>';break}
    case'img':o='<image href="'+a.src+'" x="'+f(a.x)+'" y="'+Y(a.y+a.h)+'" width="'+f(a.w)+'" height="'+f(a.h)+'" preserveAspectRatio="none"/>';break;
    case'meas':{
      const pts=a.pts,k=calFor(a.p),sw=f(a.w);let lab='',pos=null;
      if(a.kind==='area'&&pts.length>2){o='<polygon points="'+pts.map(p=>f(p[0])+','+Y(p[1])).join(' ')+'" fill="'+c+'" fill-opacity=".14" stroke="'+c+'" stroke-width="'+sw+'" stroke-linejoin="round"/>';
        if(k){lab=fmtNum(polyArea(pts)*k.k*k.k)+' '+k.unit+'²';pos=centroid(pts)}}
      else{o='<polyline points="'+pts.map(p=>f(p[0])+','+Y(p[1])).join(' ')+'" fill="none" stroke="'+c+'" stroke-width="'+sw+'" stroke-linejoin="round"/>';
        if(k&&a.kind==='len'&&pts.length>1){lab=fmtNum(dist(pts[0],pts[1])*k.k)+' '+k.unit;pos=[(pts[0][0]+pts[1][0])/2,(pts[0][1]+pts[1][1])/2]}}
      pts.forEach(p=>o+='<circle cx="'+f(p[0])+'" cy="'+Y(p[1])+'" r="'+f(a.w*1.2)+'" fill="'+c+'"/>');
      if(lab)o+='<text x="'+f(pos[0])+'" y="'+Y(pos[1]+4*U)+'" font-size="'+f(12*U)+'" text-anchor="middle" font-weight="600" fill="'+c+'" stroke="#fff" stroke-width="'+f(3*U)+'" paint-order="stroke" font-family=\''+FONT+'\'>'+esc(lab)+'</text>';
      break}
  }
  return a.id>0?'<g data-id="'+a.id+'">'+o+'</g>':'<g>'+o+'</g>';
}
function shapeAnn(o,U){const w=2*U*V.sz,b={id:-1,p:o.n,c:V.color,w};
  if(o.kind==='line'||o.kind==='arrow')return{...b,type:o.kind,fx:o.p0[0],fy:o.p0[1],tx:o.cur[0],ty:o.cur[1]};
  return{...b,type:o.kind,r:[Math.min(o.p0[0],o.cur[0]),Math.min(o.p0[1],o.cur[1]),Math.max(o.p0[0],o.cur[0]),Math.max(o.p0[1],o.cur[1])]}}
function shAdj(kind,p0,p,sh){if(!sh)return p;const dx=p[0]-p0[0],dy=p[1]-p0[1];
  if(kind==='rect'||kind==='ellipse'){const m=Math.max(Math.abs(dx),Math.abs(dy));return[p0[0]+(dx<0?-m:m),p0[1]+(dy<0?-m:m)]}
  const a=Math.round(Math.atan2(dy,dx)/(Math.PI/4))*Math.PI/4,L=Math.hypot(dx,dy);return[p0[0]+Math.cos(a)*L,p0[1]+Math.sin(a)*L]}
function draftAnn(n){
  const o=V.op,D=V.draft,U=UN(n);
  if(o&&o.n===n){
    if(o.k==='shape')return shapeAnn(o,U);
    if(o.k==='pen')return{id:-1,type:'pen',p:n,pts:o.pts,c:V.color,w:2*U*V.sz};
    if(o.k==='hlrect'){const r=[Math.min(o.p0[0],o.cur[0]),Math.min(o.p0[1],o.cur[1]),Math.max(o.p0[0],o.cur[0]),Math.max(o.p0[1],o.cur[1])];return{id:-1,type:mkType(),p:n,rects:[r],c:V.color}}
    if(o.k==='callout')return{id:-1,type:'arrow',p:n,fx:o.cur[0],fy:o.cur[1],tx:o.tip[0],ty:o.tip[1],c:V.color};
    if(o.k==='box')return{id:-1,type:o.kind==='redact'?'redact':'cropbox',p:n,r:[Math.min(o.p0[0],o.cur[0]),Math.min(o.p0[1],o.cur[1]),Math.max(o.p0[0],o.cur[0]),Math.max(o.p0[1],o.cur[1])]};
  }
  if(D&&D.n===n)return{id:-1,type:'meas',kind:D.kind==='area'?'area':'len',p:n,pts:D.pts.concat([D.cur]),c:D.kind==='cal'?'#7c3aed':V.color,w:1.6*U*V.sz};
  return null;
}
function annInner(n,exp){
  const ph=pageH(n);let o='';
  V.ann.forEach(a=>{if(a.p===n)o+=annEl(a,ph)});
  if(exp)return o;
  const dr=draftAnn(n);if(dr)o+=annEl(dr,ph);
  const sel=V.selId!=null?V.ann.find(a=>a.id===V.selId&&a.p===n):null;
  if(sel){const b=bboxOf(sel),U=UN(n),pd=3*U;
    o+='<rect x="'+f(b[0]-pd)+'" y="'+f(ph-b[3]-pd)+'" width="'+f(b[2]-b[0]+2*pd)+'" height="'+f(b[3]-b[1]+2*pd)+'" fill="none" stroke="#2563eb" stroke-width="'+f(1.2*U)+'" stroke-dasharray="'+f(4*U)+'" style="pointer-events:none"/>';
    if(sel.type==='img')o+='<circle data-h="1" cx="'+f(b[2]+pd)+'" cy="'+f(ph-b[1]+pd)+'" r="'+f(5*U)+'" fill="#2563eb" style="pointer-events:all;cursor:nwse-resize"/>';
    if(sel.type==='callout')o+='<circle data-h="tip" cx="'+f(sel.tx)+'" cy="'+f(ph-sel.ty)+'" r="'+f(6*U)+'" fill="#fff" fill-opacity=".9" stroke="#2563eb" stroke-width="'+f(1.6*U)+'" style="pointer-events:all;cursor:move"/>';
    const hnd=(k,x,y)=>{o+='<circle data-h="'+k+'" cx="'+f(x)+'" cy="'+f(ph-y)+'" r="'+f(6*U)+'" fill="#fff" fill-opacity=".9" stroke="#2563eb" stroke-width="'+f(1.6*U)+'" style="pointer-events:all;cursor:move"/>'};
    if(sel.type==='line'||sel.type==='arrow'){hnd('tip',sel.tx,sel.ty);hnd('from',sel.fx,sel.fy)}
    if(sel.type==='rect'||sel.type==='ellipse'){const r=sel.r;[[r[0],r[1]],[r[2],r[1]],[r[2],r[3]],[r[0],r[3]]].forEach((q,i)=>hnd('c'+i,q[0],q[1]))}}
  return o;
}
function paintAnn(n){hlSoon();const d=pages()[n-1];if(!d)return;const s=d.querySelector('.an');if(s)s.innerHTML=annInner(n,false)}
function paintAnnAll(){const set=new Set(V.ann.map(a=>a.p));if(V.draft)set.add(V.draft.n);set.forEach(paintAnn)}

/* model operations */
function updateHistoryUi(){$('#bUndo').disabled=!V.undo.length;$('#bRedo').disabled=!V.redo.length;$('#bDel').hidden=V.selId==null}
function pushUndo(){V.undo.push(JSON.stringify(V.ann));if(V.undo.length>60)V.undo.shift();V.redo=[];updateHistoryUi()}
function changed(n){V.dirty=true;paintAnn(n);persist();updateSave();updateHistoryUi()}
function addAnn(a){a.id=V.nid++;if(!a.ts)a.ts=Date.now();pushUndo();V.ann.push(a);changed(a.p);return a}
function undo(){
  if(!V.undo.length)return;const pg=new Set(V.ann.map(a=>a.p));
  V.redo.push(JSON.stringify(V.ann));V.ann=JSON.parse(V.undo.pop());V.ann.forEach(a=>pg.add(a.p));
  if(!V.ann.find(a=>a.id===V.selId))V.selId=null;
  pg.forEach(paintAnn);V.dirty=true;persist();updateSave();updateHistoryUi();
}
function redo(){
  if(!V.redo.length)return;const pg=new Set(V.ann.map(a=>a.p));
  V.undo.push(JSON.stringify(V.ann));V.ann=JSON.parse(V.redo.pop());V.ann.forEach(a=>pg.add(a.p));
  if(!V.ann.find(a=>a.id===V.selId))V.selId=null;
  pg.forEach(paintAnn);V.dirty=true;persist();updateSave();updateHistoryUi();
}
function selectAnn(id){const old=V.ann.find(a=>a.id===V.selId);V.selId=id;if(old)paintAnn(old.p);const n=V.ann.find(a=>a.id===id);if(n)paintAnn(n.p);updateHistoryUi();if(typeof syncSz==='function')syncSz()}
function delSel(){const a=V.ann.find(x=>x.id===V.selId);if(!a)return;pushUndo();V.ann=V.ann.filter(x=>x!==a);V.selId=null;changed(a.p)}
function moveAnn(a,dx,dy){const b={...a};
  if(a.rects)b.rects=a.rects.map(r=>[r[0]+dx,r[1]+dy,r[2]+dx,r[3]+dy]);
  if(a.pts)b.pts=a.pts.map(p=>[p[0]+dx,p[1]+dy]);
  if('x' in a){b.x=a.x+dx;b.y=a.y+dy}
  if('tx' in a){b.tx=a.tx+dx;b.ty=a.ty+dy}
  if('fx' in a){b.fx=a.fx+dx;b.fy=a.fy+dy}
  if(a.r)b.r=[a.r[0]+dx,a.r[1]+dy,a.r[2]+dx,a.r[3]+dy];
  return b}
const updateSave=()=>{};
/* Unsaved markup is kept between sessions. In the desktop app it goes to a file in the app's
   data folder, named by a fingerprint of the PDF's content (so it follows the file when it is
   moved or renamed, and has no 5 MB cap). The web app keeps using browser storage by path. */
const mkKey=()=>V.src&&V.src._path?'mk:'+V.src._path:null;
const mkEmpty=()=>!(V.pageOps&&V.pageOps.length)&&!V.ann.length&&!V.cal.def&&!Object.keys(V.cal.pages||{}).length&&!(V.form&&Object.keys(V.form.values).length);
let pst,mkBase='';
function persist(){const k=mkKey();if(!k)return;clearTimeout(pst);const src=V.src;pst=setTimeout(()=>mkWrite(src,k),400)}
async function mkWrite(src,k){
  if(src!==V.src)return;
  /* pages inserted from a file picked in the browser cannot be kept: nothing is kept until saved */
  if((V.pageOps||[]).some(o=>o.bytes)){if(!V._warnedOps){V._warnedOps=1;toast('Save to keep these page changes',3500)}return}
  const json=mkEmpty()?'':JSON.stringify({ann:V.ann,cal:V.cal,form:V.form&&Object.keys(V.form.values).length?V.form.values:undefined,pages:V.pageOps&&V.pageOps.length?V.pageOps:undefined});
  if(T){
    /* nothing changed since the file was opened: no need for a copy beside it */
    try{await inv('mk_save',{path:src._path,json:json===mkBase?'':json})}catch(e){toast('Could not keep markup between sessions: '+e,4000)}
    return}
  try{if(json)localStorage.setItem(k,json);else localStorage.removeItem(k)}catch(e){toast('Could not keep markup between sessions (storage full)',4000)}}
/* The kept markup for a file: {ann, cal, form, pages} or null. */
async function mkRead(f){const k=f&&f._path?'mk:'+f._path:null;if(!k)return null;
  try{
    if(T){const t=await inv('mk_load',{path:f._path});if(t)return JSON.parse(t);
      /* markup kept by older versions in browser storage moves to the app data folder */
      const old=localStorage.getItem(k);if(old){await inv('mk_save',{path:f._path,json:old});localStorage.removeItem(k);return JSON.parse(old)}
      return null}
    return JSON.parse(localStorage.getItem(k)||'null');
  }catch(e){return null}}
async function loadMarks(f,imp,stored){V._mkForm=null;V.ann=[];V.undo=[];V.redo=[];V.selId=null;V.cal={def:null,pages:{}};V.src=f;V.dirty=false;V.nid=1;mkBase='';
  if(imp){V.ann=imp.anns;if(imp.cal)V.cal=imp.cal;mkBase=JSON.stringify({ann:V.ann,cal:V.cal})}
  const m=stored===undefined?await mkRead(f):stored;
  if(m){V.ann=m.ann||[];V.cal=m.cal||V.cal;V._mkForm=m.form||null}
  V.nid=Math.max(0,...V.ann.map(a=>a.id||0))+1}
/* Form fields: found by the engine (or pdf.js on the web), then read with pdf-lib (forms.js). */
async function formInit(f,rb){
  V.form=null;
  try{
    let has=false;
    if(V.native)has=!!(await inv('pdf_metadata')).Form;
    else has=!!(V.doc.getFieldObjects&&await V.doc.getFieldObjects());
    if(has)await formLoad(rb||await srcBytes(f));
    if(V.form&&V._mkForm)Object.assign(V.form.values,V._mkForm);
  }catch(e){V.form=null}
  V._mkForm=null}
/* Reads Rasm's own annotations back out of a PDF. Returns the PDF without them (what the
   engine should draw) and the marks, or null when the file has none. */
async function importMarks(f){
  let bytes=null,has;
  if(T&&f._path)has=await inv('pdf_has_rasm',{path:f._path});
  else{bytes=await srcBytes(f);has=RasmAnnots.hasMarker(bytes)}
  if(!has)return null;
  const pdf=await PDFDocument.load(bytes||await srcBytes(f),{ignoreEncryption:true,updateMetadata:false});
  if(pdf.isEncrypted)return null;
  const r=RasmAnnots.strip(pdf);if(!r.removed)return null;
  return{bytes:new Uint8Array(await pdf.save({useObjectStreams:false})),anns:r.anns,cal:r.cal}}

/* tools */
function setTool(t){V.tool=t;V.draft=null;V.op=null;V.pending=null;$('#viewer').className='t-'+t;
  document.querySelectorAll('#mk [data-tool]').forEach(b=>b.classList.toggle('on',b.dataset.tool===t||(b.dataset.tool==='hl'&&(t==='ul'||t==='st'))));
  if(TM[t]){lastTM=t;const bh=document.querySelector('#mk [data-tool="hl"]'),ic=bh&&bh.querySelector('.ic'),lb=bh&&bh.querySelector('.lb');if(ic)ic.innerHTML=TM[t][1];if(lb)lb.textContent=TM[t][0]}
  if(SH[t]){const ic=$('#bShape .ic');if(ic)ic.innerHTML=SH[t][1]}
 
  $('#bMeas').classList.toggle('on',['len','area','cal','count'].includes(t));$('#bShape').classList.toggle('on',!!SH[t]);hidePop();if(V.doc)paintAnnAll()}
function startPending(o){setTool('select');V.pending=o;$('#viewer').classList.add('pend');toast('Click on the page to place it',3500)}
function placePending(n,p){const o=V.pending,U=UN(n),w=(o.kind==='sig'?150:170)*U*V.sz,h=w*o.ratio;V.pending=null;$('#viewer').classList.remove('pend');
  const a=addAnn({type:'img',p:n,x:p[0]-w/2,y:p[1]-h/2,w,h,src:o.src,kind:o.kind||'',label:o.label||''});selectAnn(a.id)}
document.querySelectorAll('#mk [data-tool]').forEach(b=>b.onclick=()=>setTool(b.dataset.tool));
function setColor(c){V.color=c;document.documentElement.style.setProperty('--cc',c);
  const a=V.ann.find(x=>x.id===V.selId);if(a&&a.type!=='img'){pushUndo();V.ann[V.ann.indexOf(a)]={...a,c};changed(a.p)}}
$('#mk .swg').innerHTML='<button id="bCol" title="Colour"><i></i></button>';setColor(V.color);
const PAL=['#e11d48','#f97316','#f59e0b','#16a34a','#2563eb','#7c3aed','#111111','#6b7280'];
$('#bCol').onclick=e=>{const b=e.currentTarget;if(!$('#pop').hidden){hidePop();return}
  showPop(b,'<div class="crow">'+PAL.map(c=>'<button class="csw'+(c===V.color?' on':'')+'" data-c="'+c+'" style="background:'+c+'" title="'+c+'"></button>').join('')+'</div><label class="cust">Custom <input type="color" value="'+(/^#[0-9a-f]{6}$/i.test(V.color)?V.color:'#e11d48')+'"></label>')};
$('#pop').addEventListener('change',e=>{if(e.target.type==='color')setColor(e.target.value);else if(e.target.id==='szIn')setSz(e.target.value)});
$('#bShape').onclick=e=>{const b=e.currentTarget;if(!$('#pop').hidden){hidePop();return}
  showPop(b,Object.keys(SH).map(k=>'<button data-sh="'+k+'">'+icon(SH[k][1])+SH[k][0]+'</button>').join(''))};
[['#mk [data-tool="select"]','select'],['#mk [data-tool="hl"]','hl'],['#mk [data-tool="pen"]','pen'],['#mk [data-tool="text"]','text'],['#mk [data-tool="callout"]','callout'],['#bShape','shape'],['#bMeas','meas'],['#bStamp','stamp'],['#bSign','sign']]
  .forEach(([q,k])=>{const b=$(q);if(b)b.innerHTML=icon(IC[k])+'<span class="lb">'+b.textContent.trim()+'</span>'});
{const bh=document.querySelector('#mk [data-tool="hl"]');bh.title='Highlight text or an area. Click again to switch to underline or strikethrough (keys H, U, S)';
  bh.onclick=()=>{if(!$('#pop').hidden){hidePop();return}
    if(TM[V.tool])showPop(bh,Object.keys(TM).map(k=>'<button data-tm="'+k+'">'+icon(TM[k][1])+TM[k][0]+'</button>').join(''));
    else setTool(lastTM)}}
const SZ0=14,szMin=4,szMax=120;
function annSizeNum(a){const U=UN(a.p);if(a.type==='text'||a.type==='callout')return Math.round(a.size/U);if(a.type==='count')return Math.round(a.r/(7*U)*SZ0);if(a.type==='meas')return Math.round(a.w/(1.6*U)*SZ0);if(a.w&&a.type!=='img'&&a.type!=='hl'&&a.type!=='ul'&&a.type!=='st')return Math.round(a.w/(2*U)*SZ0);return null}
function curSzNum(){const a=V.ann.find(x=>x.id===V.selId);const n=a?annSizeNum(a):null;return n!=null?n:Math.round(V.sz*SZ0)}
function setSz(n){n=Math.max(szMin,Math.min(szMax,Math.round(+n)||SZ0));const a=V.ann.find(x=>x.id===V.selId);
  if(a&&annSizeNum(a)!=null){const U=UN(a.p),k=n/SZ0;let u;
    if(a.type==='text'||a.type==='callout')u={size:n*U};else if(a.type==='count')u={r:7*U*k};else if(a.type==='meas')u={w:1.6*U*k};else u={w:2*U*k};
    pushUndo();V.ann[V.ann.indexOf(a)]={...a,...u};changed(a.p)}
  else V.sz=n/SZ0;
  $('#bSz').textContent=n;const i=$('#szIn');if(i)i.value=n}
function syncSz(){$('#bSz').textContent=curSzNum()}
$('#bSz').onclick=e=>{const b=e.currentTarget;if(!$('#pop').hidden){hidePop();return}
  const n=curSzNum();showPop(b,'<div class="szp"><button data-sz="-1">\u2212</button><input id="szIn" type="number" min="'+szMin+'" max="'+szMax+'" value="'+n+'"><button data-sz="1">+</button></div><div class="szp">'+[8,10,12,14,18,24,36].map(v=>'<button data-sz="='+v+'">'+v+'</button>').join('')+'</div><div class="note">'+(V.selId?'Changes the selected mark':'Size of new marks')+'</div>')};

/* popups */
function showPop(btn,html){const p=$('#pop'),r=btn.getBoundingClientRect();p.innerHTML=html;p.hidden=false;if(btn.closest('#mk.v')){p.style.bottom='auto';p.style.left=Math.max(6,r.left>innerWidth/2?r.left-p.offsetWidth-8:r.right+8)+'px';p.style.top=Math.max(6,Math.min(r.top,innerHeight-p.offsetHeight-6))+'px';return}p.style.left=Math.max(6,Math.min(r.left,innerWidth-p.offsetWidth-6))+'px';if(r.top<p.offsetHeight+16){p.style.bottom='auto';p.style.top=(r.bottom+8)+'px'}else{p.style.top='auto';p.style.bottom=(innerHeight-r.top+8)+'px'}}
function hidePop(){$('#pop').hidden=true}
(function(){const mk=$('#mk'),gr=$('#mkGrip'),main=$('#main');let d=null;
  const clamp=(l,t)=>{const R=main.getBoundingClientRect();return[Math.max(0,Math.min(l,R.width-mk.offsetWidth)),Math.max(0,Math.min(t,R.height-mk.offsetHeight))]};
  const place=(l,t)=>{[l,t]=clamp(l,t);mk.style.transform='none';mk.style.bottom='auto';mk.style.left=l+'px';mk.style.top=t+'px'};
  const moved=()=>!!mk.style.top;
  gr.onpointerdown=e=>{const r=mk.getBoundingClientRect();d={dx:e.clientX-r.left,dy:e.clientY-r.top};gr.setPointerCapture(e.pointerId);e.preventDefault()};
  gr.onpointermove=e=>{if(!d)return;const R=main.getBoundingClientRect();place(e.clientX-R.left-d.dx,e.clientY-R.top-d.dy)};
  gr.onpointerup=gr.onpointercancel=()=>{if(!d)return;d=null;try{localStorage.setItem('mkpos',JSON.stringify([parseFloat(mk.style.left),parseFloat(mk.style.top)]))}catch(_){}};
  const reset=()=>{mk.style.transform=mk.style.bottom=mk.style.left=mk.style.top='';try{localStorage.removeItem('mkpos')}catch(_){}};
  gr.ondblclick=reset;
  const sv=(k,v)=>{try{v?localStorage.setItem(k,v):localStorage.removeItem(k)}catch(_){}};
  const sync=()=>{const vv=mk.classList.contains('v'),m=mk.classList.contains('min');$('#mkRot').textContent=vv?'↔':'↕';$('#mkHide').textContent=m?'✎':'–';$('#mkHide').title=m?'Show markup tools':'Hide toolbar'};
  try{if(localStorage.mkv)mk.classList.add('v');if(localStorage.mkmin)mk.classList.add('min')}catch(_){}
  $('#mkRot').onclick=()=>{mk.classList.toggle('v');sv('mkv',mk.classList.contains('v')?'1':'');reset();sync();hidePop()};
  $('#mkHide').onclick=()=>{mk.classList.toggle('min');sv('mkmin',mk.classList.contains('min')?'1':'');sync();hidePop()};
  sync();
  addEventListener('resize',()=>{if(moved())place(parseFloat(mk.style.left),parseFloat(mk.style.top))});
  if(window.ResizeObserver)new ResizeObserver(()=>{if(moved())place(parseFloat(mk.style.left),parseFloat(mk.style.top))}).observe(mk);
  try{const q=JSON.parse(localStorage.getItem('mkpos')||'null');if(q)place(q[0],q[1])}catch(_){}
})();
document.addEventListener('mousedown',e=>{if(!$('#pop').hidden&&!e.target.closest('#pop')&&!e.target.closest('#mk'))hidePop()});
$('#bMeas').onclick=e=>{const b=e.currentTarget;if(!$('#pop').hidden){hidePop();return}
  showPop(b,'<button data-m="len">Length</button><button data-m="area">Area</button><button data-m="count">Count <small>numbered markers · a new colour starts a new group</small></button><button data-m="cal">Set scale</button><div class="note">'+(V.doc&&calFor(V.cur)?'Scale is set for this page.':'Scale not set yet. Use "Set scale" first.')+'</div>')};
$('#bStamp').onclick=e=>{const b=e.currentTarget;if(!$('#pop').hidden){hidePop();return}
  showPop(b,stampHtml())};
$('#pop').onclick=e=>{const b=e.target.closest('button');if(!b)return;
  if(b.dataset.fit){hidePop();setFit(b.dataset.fit==='1'?'1':b.dataset.fit)}
  else if(b.dataset.act){hidePop();b.dataset.act==='dark'?toggleDark():b.dataset.act==='lang'?applyLang(LANG==='ar'?'en':'ar'):setFull(!FS)}
  else if(b.dataset.sz){const d=b.dataset.sz;setSz(d[0]==='='?+d.slice(1):curSzNum()+(+d)*(curSzNum()>=36?4:curSzNum()>=14?2:1))}
  else if(b.dataset.c){setColor(b.dataset.c);hidePop()}
  else if(b.dataset.tm){setTool(b.dataset.tm)}
  else if(b.dataset.sh){setTool(b.dataset.sh);$('#bShape .ic').innerHTML=SH[b.dataset.sh][1]}
  else if(b.dataset.m)setTool(b.dataset.m);
  else if(b.dataset.si!=null){const u=stampImgs()[+b.dataset.si];if(u)useStampImg(u)}
  else if(b.dataset.sd!=null){const a=stampImgs();a.splice(+b.dataset.sd,1);try{localStorage.stampimgs=JSON.stringify(a)}catch(x){}$('#pop').innerHTML=stampHtml()}
  else if(b.dataset.up!=null){hidePop();$('#stFile').click()}
  else if(b.dataset.s){let t,c;if(b.dataset.s==='c'){t=($('#stxt').value||'').trim();c=V.color;if(!t)return}else{[t,c]=STAMPS[+b.dataset.s]}{const sw=$('#swho');if(sw)try{localStorage.who=sw.value.trim()}catch(x){}}hidePop();startPending(mkStamp(t,c))}};
const STAMPS=[['APPROVED','#16a34a'],['APPROVED AS NOTED','#16a34a'],['REVISE & RESUBMIT','#d97706'],['REJECTED','#dc2626'],['FOR INFORMATION','#2563eb'],['REVIEWED','#16a34a'],['FOR CONSTRUCTION','#16a34a']];
function mkStamp(text,color){
  const who=(lsWho()).trim(),date=new Date().toLocaleDateString('en-GB')+(who?' · '+who:''),fs=48,c=document.createElement('canvas'),x=c.getContext('2d');
  x.font='bold '+fs+'px '+FONT;const w=Math.ceil(Math.max(x.measureText(text).width,x.measureText(date).width*.7))+70,h=Math.ceil(fs*2.3)+20;
  c.width=w;c.height=h;x.font='bold '+fs+'px '+FONT;x.textAlign='center';x.textBaseline='middle';x.strokeStyle=color;x.fillStyle=color;
  x.lineWidth=7;x.beginPath();x.roundRect?x.roundRect(8,8,w-16,h-16,16):x.rect(8,8,w-16,h-16);x.stroke();
  x.fillText(text,w/2,h*.38);x.font='600 '+Math.round(fs*.62)+'px '+FONT;x.fillText(date,w/2,h*.74);
  return{src:c.toDataURL('image/png'),ratio:h/w,kind:'stamp',label:text};
}

/* text editor (text + callout) */
function openEditor(n,pos,ann,extra){
  const d=pages()[n-1],U=UN(n),sz=ann?ann.size:14*U*V.sz,sc=V.scale,x=ann?ann.x:pos[0],y=ann?ann.y:pos[1],col=ann?ann.c:V.color;
  const ta=document.createElement('textarea');ta.className='ed';ta.value=ann?ann.text:'';ta.rows=ann?ann.text.split('\n').length:1;
  Object.assign(ta.style,{left:x*sc+'px',top:(pageH(n)-y)*sc+'px',fontSize:sz*sc+'px',color:col,minWidth:Math.max(120,sz*sc*8)+'px'});
  d.appendChild(ta);ta.focus();let done=false;
  const fin=ok=>{if(done)return;done=true;const t=ta.value.trim();ta.remove();
    if(ok&&t){
      if(ann){pushUndo();V.ann[V.ann.indexOf(ann)]={...ann,text:t};changed(n)}
      else{const a={type:extra&&extra.tip?'callout':'text',p:n,x,y,text:t,size:sz,c:col};if(extra&&extra.tip){a.tx=extra.tip[0];a.ty=extra.tip[1]}addAnn(a)}
    }else paintAnn(n)};
  ta.onblur=()=>fin(true);
  ta.onkeydown=ev=>{ev.stopPropagation();if(ev.key==='Escape')fin(false);else if(ev.key==='Enter'&&ev.ctrlKey)fin(true)};
  ta.oninput=()=>{ta.rows=ta.value.split('\n').length};
}

/* selection helpers shared with highlight */
function commitHlText(){
  const n=V.sel.n,g=selLines(n),U=UN(n);V.sel=null;paintPage(n);
  if(g.length)addAnn({type:mkType(),p:n,rects:g.map(r=>[r.l,r.b-.5*U,r.r,r.t+.5*U]),c:V.color});
}
async function hlDown(n,p){
  if(V.native){const ch=await pageText(n);
    if(ch.length){const i=nearest(ch,p),c=ch[i],pad=4*UN(n);
      if(p[0]>=c[1]-pad&&p[0]<=c[3]+pad&&p[1]>=c[2]-pad&&p[1]<=c[4]+pad){V.sel={n,a:i,b:i,drag:true,hl:true};paintPage(n);return}}}
  V.op={k:'hlrect',n,p0:p,cur:p};
}

/* measuring */
function measDown(n,p,e){
  const k=V.tool;
  if(k!=='cal'&&!calFor(n)){toast('Set the scale first: draw along a known length',3500);setTool('cal');return}
  if(!V.draft||V.draft.n!==n){V.draft={n,kind:k,pts:[p],cur:p,sx:e.clientX,sy:e.clientY};paintAnn(n);return}
  const D=V.draft;
  if(k==='area'){const first=D.pts[0];if(D.pts.length>=3&&dist(p,first)<10/V.scale){finishMeas();return}D.pts.push(p);paintAnn(n)}
  else{D.pts.push(p);finishMeas()}
}
function finishMeas(){
  const D=V.draft;if(!D)return;V.draft=null;const U=UN(D.n);
  if(D.kind==='cal'){if(D.pts.length<2||dist(D.pts[0],D.pts[1])<1){paintAnn(D.n);return}
    V.calDraft={n:D.n,len:dist(D.pts[0],D.pts[1])};$('#sv').value='';$('#dScale').showModal();$('#sv').focus();paintAnn(D.n);return}
  if(D.kind==='area'&&D.pts.length<3){paintAnn(D.n);return}
  addAnn({type:'meas',kind:D.kind,p:D.n,pts:D.pts,c:V.color,w:1.6*U*V.sz});
}
$('#sOk').onclick=()=>{const v=parseFloat($('#sv').value),C=V.calDraft;if(!(v>0)||!C){toast('Enter the real length as a number');return}
  const cal={k:v/C.len,unit:$('#su').value};if($('#sall').checked){V.cal.def=cal;V.cal.pages={}}else V.cal.pages[C.n]=cal;
  $('#dScale').close();persist();paintAnnAll();setTool('len');toast('Scale set. Click two points to measure a length.',3500)};
$('#sCancel').onclick=()=>$('#dScale').close();

/* signatures */
const sc=$('#sc'),sx=sc.getContext('2d');let sMode='draw',sDown=false,sInk='#111111';
const sp=e=>{const r=sc.getBoundingClientRect();return[(e.clientX-r.left)*sc.width/(r.width||1),(e.clientY-r.top)*sc.height/(r.height||1)]};
sc.onpointerdown=e=>{if(sMode!=='draw')return;sDown=true;try{sc.setPointerCapture(e.pointerId)}catch(x){}const p=sp(e);sx.strokeStyle=sInk;sx.lineWidth=3.2;sx.lineCap='round';sx.lineJoin='round';sx.beginPath();sx.moveTo(p[0],p[1]);sx.lineTo(p[0]+.1,p[1]);sx.stroke()};
sc.onpointermove=e=>{if(!sDown)return;const p=sp(e);sx.lineTo(p[0],p[1]);sx.stroke();sx.beginPath();sx.moveTo(p[0],p[1])};
sc.onpointerup=()=>{sDown=false};
function sType(){sx.clearRect(0,0,sc.width,sc.height);const t=$('#stx').value;if(!t)return;sx.fillStyle=sInk;sx.textBaseline='middle';sx.font='64px '+$('#sfont').value;sx.fillText(t,20,sc.height/2)}
$('#stx').oninput=sType;$('#sfont').onchange=sType;
document.querySelectorAll('#dSign [data-m]').forEach(b=>b.onclick=()=>{sMode=b.dataset.m;document.querySelectorAll('#dSign [data-m]').forEach(x=>x.classList.toggle('on',x===b));$('#stx').hidden=$('#sfont').hidden=sMode!=='type';sx.clearRect(0,0,sc.width,sc.height);if(sMode==='type')sType()});
document.querySelectorAll('#dSign [data-ink]').forEach(b=>b.onclick=()=>{sInk=b.dataset.ink;if(sMode==='type')sType()});
$('#sClear').onclick=()=>{sx.clearRect(0,0,sc.width,sc.height);$('#stx').value=''};
function trimCanvas(c){const x=c.getContext('2d'),d=x.getImageData(0,0,c.width,c.height).data;let l=c.width,t=c.height,r=-1,b=-1;
  for(let y=0;y<c.height;y++)for(let i=0;i<c.width;i++)if(d[(y*c.width+i)*4+3]>10){if(i<l)l=i;if(i>r)r=i;if(y<t)t=y;if(y>b)b=y}
  if(r<l)return null;const pad=6,w=r-l+1+pad*2,h=b-t+1+pad*2,o=document.createElement('canvas');o.width=w;o.height=h;o.getContext('2d').drawImage(c,l-pad,t-pad,w,h,0,0,w,h);return o}
const sigs=()=>{try{return JSON.parse(localStorage.sigs||'[]')}catch(e){return[]}};
function showSigs(){const s=sigs();$('#saved').innerHTML=s.length?'<div class="note">Saved signatures</div>'+s.map((u,i)=>'<span class="sg"><button data-u="'+i+'"><img src="'+u+'"></button><button data-d="'+i+'" title="Remove">✕</button></span>').join(''):''}
function useSig(src){const im=new Image();im.onload=()=>{$('#dSign').close();startPending({src,ratio:im.height/im.width,kind:'sig'})};im.src=src}
$('#sUse').onclick=()=>{const t=trimCanvas(sc);if(!t){toast('Draw or type your signature first');return}const u=t.toDataURL('image/png');
  try{localStorage.sigs=JSON.stringify([u].concat(sigs()).slice(0,6))}catch(e){}useSig(u)};
$('#saved').onclick=e=>{const b=e.target.closest('button');if(!b)return;const s=sigs();
  if(b.dataset.u!=null)useSig(s[+b.dataset.u]);else if(b.dataset.d!=null){s.splice(+b.dataset.d,1);try{localStorage.sigs=JSON.stringify(s)}catch(x){}showSigs()}};
$('#bSign').onclick=()=>{if(!V.doc)return;sx.clearRect(0,0,sc.width,sc.height);$('#stx').value='';showSigs();$('#dSign').showModal()};
$('#sX').onclick=()=>$('#dSign').close();


const lsWho=()=>{try{return localStorage.who||''}catch(e){return''}};
const stampImgs=()=>{try{return JSON.parse(localStorage.stampimgs||'[]')}catch(e){return[]}};
function stampHtml(){const im=stampImgs();
  return STAMPS.map((s,i)=>'<button class="stamp" data-s="'+i+'" style="color:'+s[1]+';border-color:'+s[1]+'">'+s[0]+'</button>').join('')
  +'<input type="text" id="swho" placeholder="Name or company on stamps" value="'+esc(lsWho())+'">'
  +'<input type="text" id="stxt" placeholder="Custom stamp text"><button data-s="c">Place custom stamp</button>'
  +(im.length?'<div class="note">My stamps</div>'+im.map((u,i)=>'<span class="sg"><button data-si="'+i+'"><img src="'+u+'"></button><button data-sd="'+i+'" title="Remove">✕</button></span>').join(''):'')
  +'<button data-up>+ Upload stamp image…</button>'}
function useStampImg(u){const im=new Image();im.onload=()=>startPending({src:u,ratio:im.height/im.width,kind:'stamp'});im.src=u}
const loadImg=src=>new Promise((ok,no)=>{const i=new Image();i.onload=()=>ok(i);i.onerror=no;i.src=src});
function rmWhite(c){const x=c.getContext('2d'),im=x.getImageData(0,0,c.width,c.height),d=im.data;
  for(let i=0;i<d.length;i+=4){const l=.299*d[i]+.587*d[i+1]+.114*d[i+2],a=l>=235?0:l<=150?255:255*(235-l)/85;d[i+3]=Math.min(d[i+3],a)}x.putImageData(im,0,0)}
$('#sImg').onclick=()=>$('#sFile').click();
$('#sFile').onchange=async e=>{const f=e.target.files[0];e.target.value='';if(!f)return;
  try{const im=await loadImg(URL.createObjectURL(f)),s=Math.min(sc.width/im.width,sc.height/im.height),w=im.width*s,h=im.height*s;
    sx.clearRect(0,0,sc.width,sc.height);sx.drawImage(im,(sc.width-w)/2,(sc.height-h)/2,w,h);rmWhite(sc)}catch(err){toast('Could not read that image')}};
$('#stFile').onchange=async e=>{const f=e.target.files[0];e.target.value='';if(!f)return;
  try{const im=await loadImg(URL.createObjectURL(f)),k=Math.min(1,500/Math.max(im.width,im.height)),c=document.createElement('canvas');
    c.width=Math.max(1,Math.round(im.width*k));c.height=Math.max(1,Math.round(im.height*k));c.getContext('2d').drawImage(im,0,0,c.width,c.height);rmWhite(c);
    const t=trimCanvas(c);if(!t){toast('That image looks empty');return}const u=t.toDataURL('image/png');
    try{localStorage.stampimgs=JSON.stringify([u].concat(stampImgs()).slice(0,6))}catch(x){toast('Storage is full — remove a saved stamp',4000)}useStampImg(u)}catch(err){toast('Could not read that image')}};

/* Markup is written as real PDF annotations (see annots.js): other apps can show, move and
   delete it, and Rasm turns it back into editable markup when the file is opened again. */
async function rasterAnn(a,vb){
  const ph=pageH(a.p),w=vb[2]-vb[0],h=vb[3]-vb[1],s=Math.max(1,Math.min(4,4000/Math.max(w,h,1)));
  const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="'+f(vb[0])+' '+f(ph-vb[3])+' '+f(w)+' '+f(h)+'" width="'+Math.ceil(w*s)+'" height="'+Math.ceil(h*s)+'">'+annEl(a,ph)+'</svg>';
  const img=new Image();await new Promise((ok,no)=>{img.onload=ok;img.onerror=()=>no(Error('Could not draw markup'));img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg)});
  const c=document.createElement('canvas');c.width=Math.ceil(w*s);c.height=Math.ceil(h*s);c.getContext('2d').drawImage(img,0,0,c.width,c.height);
  const blob=await new Promise(r=>c.toBlob(r,'image/png'));return new Uint8Array(await blob.arrayBuffer())}
const annText=a=>a.type==='text'||a.type==='callout'?String(a.text||''):a.type==='count'?String(cntNo(a)):'';
/* The file as it should be saved: page edits applied, markup and form entries written in. */
async function bakedBytes(){
  if(V.ann.some(a=>a.type==='redact'))throw Error('apply or remove the redaction boxes first (Redact tool)');
  const src=V.src,bytes=V.rotBytes?V.rotBytes:await srcBytes(src);
  const forms=typeof formDirty==='function'&&formDirty();
  if(!V.ann.length&&mkEmpty()&&!forms)return bytes;
  const pdf=await PDFDocument.load(bytes,{ignoreEncryption:true});
  if(pdf.isEncrypted)throw Error('this PDF is password-protected, so markup cannot be added to it');
  if(V.ann.length||!mkEmpty())await RasmAnnots.write(pdf,V.ann.filter(a=>a.type!=='redact'),{size:n=>[pageW(n),pageH(n)],bbox:bboxOf,unit:UN,raster:rasterAnn,text:annText,cal:V.cal});
  let so={};if(forms)so=await formApply(pdf)||{};
  return new Uint8Array(await pdf.save({useObjectStreams:false,...so}))}
async function saveMarked(){
  if(licLocked||!V.doc)return;
  const marked=!!(V.ann.length||V.rotBytes),nm=V.src.name.replace(/\.pdf$/i,'');
  toast('Saving…',0);
  try{
    const out=await bakedBytes();
    await save(out,nm+(marked?'-markup':'-copy')+'.pdf');
    V.dirty=false;toast(marked?'Saved with your markup':'Saved',9000,{label:'Open copy',fn:()=>openSaved(lastSaved)});
  }catch(e){toast(e.message==='Save cancelled'?'':'Could not save: '+e.message,5000)}
}
/* Ctrl+S: write the changes into the file that is open. Falls back to Save as in the web app
   or for a PDF that did not come from a file on disk. */
const canSaveInPlace=()=>!!(T&&V.src&&V.src._path&&!V.noNative);
async function saveInPlace(){
  if(licLocked||!V.doc)return;
  if(!canSaveInPlace())return saveMarked();
  const src=V.src,path=src._path;
  toast('Saving…',0);
  try{
    const out=await bakedBytes();
    await inv('mk_save',{path,json:''});
    await T.core.invoke('save_in_place',out,{headers:{path:encodeURIComponent(path)}});
    setRotMap(src,{});V.rotBytes=null;V.dirty=false;
    if(curTab)curTab.snap=null;
    await inv('pdf_forget',{key:tkey(src)}).catch(()=>{});
    const sl=viewer.scrollLeft,st=viewer.scrollTop;
    await openDoc(src);viewer.scrollLeft=sl;viewer.scrollTop=st;
    toast('Saved',2500);
  }catch(e){toast('Could not save: '+(e&&e.message||e),6000)}
}
$('#bSave').onclick=saveInPlace;if($('#bSaveAs'))$('#bSaveAs').onclick=saveMarked;$('#bUndo').onclick=undo;$('#bRedo').onclick=redo;$('#bDel').onclick=delSel;

/* mouse + keyboard */
const viewer=$('#viewer');const EDITK=/^(move|resize|tip|box|from|c[0-3])$/;
viewer.addEventListener('mousedown',async e=>{
  if(e.button!==0||!V.doc||e.target.tagName==='TEXTAREA')return;
  const d=e.target.closest('.pg'),n=d?+d.dataset.n:0;
  if(V.pending){if(d){e.preventDefault();placePending(n,ptOf(e,d,n))}return}
  if(V.tool==='select'){
    const hd=e.target.closest('[data-h]'),g=e.target.closest('[data-id]');
    if(d&&(hd||g)){const id=hd?V.selId:+g.dataset.id,a=V.ann.find(x=>x.id===id);
      if(a){selectAnn(id);let k=hd?(hd.dataset.h==='1'?'resize':hd.dataset.h):'move';if(k==='move'&&a.type==='callout'&&!e.shiftKey)k='box';
        V.op={k,n,p0:ptOf(e,d,n),orig:a,moved:false};e.preventDefault();return}}
    if(V.selId!=null)selectAnn(null);
    if(!V.native)return;
    if(!d){clearSel();return}
    const ch=await pageText(n);if(!ch.length){clearSel();return}
    const i=nearest(ch,ptOf(e,d,n)),old=V.sel&&V.sel.n;V.sel={n,a:i,b:i,drag:true};
    if(old&&old!==n)paintPage(old);paintPage(n);e.preventDefault();return;
  }
  if(!d)return;e.preventDefault();const p=ptOf(e,d,n);
  switch(V.tool){
    case'pen':V.op={k:'pen',n,pts:[p]};break;
    case'hl':case'ul':case'st':await hlDown(n,p);break;
    case'text':openEditor(n,p,null);break;
    case'callout':V.op={k:'callout',n,tip:p,cur:p};break;
    case'line':case'arrow':case'rect':case'ellipse':V.op={k:'shape',kind:V.tool,n,p0:p,cur:p};break;
    case'len':case'area':case'cal':measDown(n,p,e);break;
    case'count':addAnn({type:'count',p:n,x:p[0],y:p[1],c:V.color,r:7*UN(n)*V.sz});break;
    case'redact':case'crop':V.op={k:'box',kind:V.tool,n,p0:p,cur:p};break;
  }
});
viewer.addEventListener('dblclick',e=>{
  const g=e.target.closest('[data-id]'),a=g&&V.ann.find(x=>x.id===+g.dataset.id);
  if(V.tool==='select'&&a&&(a.type==='text'||a.type==='callout')){openEditor(a.p,null,a);return}
  const D=V.draft;if(D&&D.kind==='area'){if(D.pts.length>1&&dist(D.pts[D.pts.length-1],D.pts[D.pts.length-2])<2/V.scale)D.pts.pop();finishMeas()}
});
window.addEventListener('mousemove',e=>{
  const s=V.sel;
  if(s&&s.drag){const d=pages()[s.n-1],ch=V.cache.get(s.n);if(d&&ch){const i=nearest(ch,ptOf(e,d,s.n));if(i!==s.b){s.b=i;paintPage(s.n)}}}
  const o=V.op;
  if(o){const d=pages()[o.n-1];if(d){const p=ptOf(e,d,o.n),U=UN(o.n);
    if(o.k==='pen'){const l=o.pts[o.pts.length-1];if(dist(p,l)>.6*U){o.pts.push(p);paintAnn(o.n)}}
    else if(o.k==='hlrect'||o.k==='callout'||o.k==='box'){o.cur=p;paintAnn(o.n)}
    else if(o.k==='shape'){o.cur=shAdj(o.kind,o.p0,p,e.shiftKey);paintAnn(o.n)}
    else if(EDITK.test(o.k)){
      if(!o.moved){pushUndo();o.moved=true}
      const idx=V.ann.findIndex(a=>a.id===o.orig.id),a=o.orig;
      if(o.k==='move')V.ann[idx]=moveAnn(a,p[0]-o.p0[0],p[1]-o.p0[1]);
      else if(o.k==='tip')V.ann[idx]={...a,tx:p[0],ty:p[1]};
      else if(o.k==='box')V.ann[idx]={...a,x:a.x+p[0]-o.p0[0],y:a.y+p[1]-o.p0[1]};
      else if(o.k==='from')V.ann[idx]={...a,fx:p[0],fy:p[1]};
      else if(o.k.length===2){const i=+o.k[1],r=a.r.slice();if(i===0||i===3)r[0]=p[0];else r[2]=p[0];if(i===0||i===1)r[1]=p[1];else r[3]=p[1];
        V.ann[idx]={...a,r:[Math.min(r[0],r[2]),Math.min(r[1],r[3]),Math.max(r[0],r[2]),Math.max(r[1],r[3])]}}
      else{const w=Math.max(8*U,p[0]-a.x),h=w*a.h/a.w;V.ann[idx]={...a,w,h,y:a.y+a.h-h}}
      paintAnn(o.n)}}}
  if(V.draft){const d=pages()[V.draft.n-1];if(d){V.draft.cur=ptOf(e,d,V.draft.n);paintAnn(V.draft.n)}}
});
window.addEventListener('mouseup',e=>{
  if(V.sel){const h=V.sel.hl;V.sel.drag=false;if(h)commitHlText()}
  const D=V.draft;
  if(D&&D.kind!=='area'&&D.pts.length===1&&Math.hypot(e.clientX-D.sx,e.clientY-D.sy)>8){D.pts.push(D.cur);finishMeas()}
  const o=V.op;if(!o)return;V.op=null;const U=UN(o.n);
  if(o.k==='pen'){if(o.pts.length>1)addAnn({type:'pen',p:o.n,pts:o.pts,c:V.color,w:2*U*V.sz});else paintAnn(o.n)}
  else if(o.k==='hlrect'){const r=[Math.min(o.p0[0],o.cur[0]),Math.min(o.p0[1],o.cur[1]),Math.max(o.p0[0],o.cur[0]),Math.max(o.p0[1],o.cur[1])];
    if(r[2]-r[0]>2*U&&r[3]-r[1]>2*U)addAnn({type:mkType(),p:o.n,rects:[r],c:V.color});else paintAnn(o.n)}
  else if(o.k==='shape'){if(dist(o.p0,o.cur)>4*U)addAnn(shapeAnn(o,U));else paintAnn(o.n)}
  else if(o.k==='box'){const r=[Math.min(o.p0[0],o.cur[0]),Math.min(o.p0[1],o.cur[1]),Math.max(o.p0[0],o.cur[0]),Math.max(o.p0[1],o.cur[1])];paintAnn(o.n);
    if(r[2]-r[0]>3*U&&r[3]-r[1]>3*U){if(o.kind==='redact'){addAnn({type:'redact',p:o.n,r});redactUi()}else cropAsk(o.n,r)}}
  else if(o.k==='callout'){const far=dist(o.tip,o.cur)>14*U,pos=far?o.cur:[o.tip[0]+40*U,o.tip[1]+30*U];openEditor(o.n,pos,null,{tip:o.tip})}
  else if(EDITK.test(o.k)){if(o.moved)changed(o.n)}
});
document.addEventListener('keydown',e=>{
  if(/INPUT|SELECT|TEXTAREA/.test((document.activeElement||{}).tagName||''))return;
  if(e.ctrlKey&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redo():undo()}
  else if(e.ctrlKey&&e.key.toLowerCase()==='y'){e.preventDefault();redo()}
  else if(e.ctrlKey&&e.key.toLowerCase()==='s'){e.preventDefault();e.shiftKey?saveMarked():saveInPlace()}
  else if((e.key==='Delete'||e.key==='Backspace')&&V.selId!=null){e.preventDefault();delSel()}
  else if(e.key==='Escape'){V.draft=null;V.op=null;V.pending=null;viewer.classList.remove('pend');if(V.tool!=='select')setTool('select');else selectAnn(null);if(V.doc)paintAnnAll()}
  else if(e.key==='Enter'&&V.draft&&V.draft.kind==='area')finishMeas();
});

/* ---------- tabs: several PDFs in one window ---------- */
const TABS=[];let curTab=null;
const tkey=f=>f._path||('f:'+f.name+':'+(f.size||0));
function snapTab(t){if(!t||!V.doc)return;t.snap={pageOps:V.pageOps,form:V.form,ann:V.ann,undo:V.undo,redo:V.redo,cal:V.cal,nid:V.nid,rb:V.rotBytes,ocr:V.ocr,pwd:V.pwd,fit:V.fit,fitMode:V.fitMode,scale:V.scale,sl:viewer.scrollLeft,st:viewer.scrollTop,cur:V.cur}}
function restoreSnap(t){const n=t.snap;if(!n||!V.doc)return;
  Object.assign(V,{ann:n.ann,undo:n.undo,redo:n.redo,cal:n.cal,nid:n.nid,form:n.form||null,pageOps:n.pageOps||[]});if(n.ocr)V.ocr=n.ocr;
  V.fit=n.fit;V.fitMode=n.fitMode;if(!n.fit)V.scale=n.scale;fitScale();build();viewer.scrollLeft=n.sl;viewer.scrollTop=n.st;updateHistoryUi();setTimeout(()=>{if(V.doc){paintAnnAll();viewer.scrollLeft=n.sl;viewer.scrollTop=n.st}},60)}
function renderTabs(){
  const el=$('#dtabs'),show=TABS.length>=2;el.hidden=!show;
  el.innerHTML=TABS.map((t,i)=>'<div class="dt'+(t===curTab?' on':'')+'" data-i="'+i+'" title="'+esc(t.f._path||t.name)+'"><span>'+esc(t.name)+'</span><button data-x="'+i+'" title="Close (Ctrl+W)">✕</button></div>').join('')+'<button class="plus" id="dtNew" title="Open another PDF (Ctrl+O)">+</button>';
  setTimeout(relayout,0)}
async function openTab(f,pwd){
  if(licLocked)return;
  const k=tkey(f);let t=TABS.find(x=>x.k===k);
  if(t&&t===curTab&&V.doc)return;
  const prev=curTab;snapTab(prev);
  const isNew=!t;if(isNew){t={k,f,name:f.name};TABS.push(t)}
  curTab=t;renderTabs();
  const ok=await openDoc(t.f,pwd||(t.snap&&t.snap.pwd)||undefined,t.snap?{rb:t.snap.rb,reuse:true}:undefined);
  if(ok===false&&V.src&&tkey(V.src)!==k){ /* open failed: go back to what was showing */
    if(isNew)TABS.splice(TABS.indexOf(t),1);curTab=prev&&TABS.includes(prev)?prev:(TABS.find(x=>V.src&&x.k===tkey(V.src))||null);renderTabs();return}
  if(ok&&t.snap)restoreSnap(t);
  renderTabs()}
function closeDoc(){
  Array.from(pages()).forEach(undraw);if(V.io)V.io.disconnect();
  if(V.doc&&V.doc.destroy)V.doc.destroy();
  Object.assign(V,{pageOps:[],form:null,doc:null,src:null,ann:[],undo:[],redo:[],cal:{def:null,pages:{}},selId:null,sel:null,hits:[],hi:-1,cur:1,native:false,sizes:null,rotBytes:null,ocr:null});
  V.cache.clear();$('#viewer').innerHTML='';document.body.classList.remove('has');$('#title').textContent='Rasm';document.title='Rasm';$('#fc').textContent='';$('#findbar').hidden=true;showRecent()}
function closeTab(t){
  const i=TABS.indexOf(t);if(i<0)return;
  if(T)inv('pdf_forget',{key:t.k}).catch(()=>{});
  if(t===curTab){TABS.splice(i,1);const nx=TABS[i]||TABS[i-1];curTab=null;if(nx)openTab(nx.f);else{closeDoc();renderTabs()}}
  else{TABS.splice(i,1);renderTabs()}}
$('#dtabs').addEventListener('click',e=>{
  if(e.target.id==='dtNew'){pick();return}
  const x=e.target.closest('[data-x]');if(x){e.stopPropagation();closeTab(TABS[+x.dataset.x]);return}
  const d=e.target.closest('.dt');if(d)openTab(TABS[+d.dataset.i].f)});
$('#dtabs').addEventListener('auxclick',e=>{if(e.button===1){const d=e.target.closest('.dt');if(d){e.preventDefault();closeTab(TABS[+d.dataset.i])}}});
document.addEventListener('keydown',e=>{
  if(!e.ctrlKey||e.altKey||!TABS.length)return;
  const k=e.key,inI=/INPUT|SELECT|TEXTAREA/.test((document.activeElement||{}).tagName||'');
  if(k.toLowerCase()==='w'&&!e.shiftKey&&!document.querySelector('dialog[open]')){e.preventDefault();if(curTab)closeTab(curTab)}
  else if((k==='Tab'||k==='PageDown'||k==='PageUp')&&TABS.length>1&&!inI){e.preventDefault();const back=k==='PageUp'||(k==='Tab'&&e.shiftKey),i=TABS.indexOf(curTab);openTab(TABS[(i+(back?-1:1)+TABS.length)%TABS.length].f)}
});

/* ---------- OCR: read text from scanned pages (runs on this computer, offline) ---------- */
const isAr=s=>/[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/.test(s);
const okey=f=>f&&(f._path||('f:'+f.name+':'+(f.size||0)));
const idb=()=>new Promise((res,rej)=>{try{const r=indexedDB.open('pdflite',1);r.onupgradeneeded=()=>r.result.createObjectStore('ocr');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)}catch(e){rej(e)}});
async function ocrSave(){try{if(!V.ocr||!V.src)return;const db=await idb();db.transaction('ocr','readwrite').objectStore('ocr').put(JSON.parse(JSON.stringify(V.ocr)),okey(V.src))}catch(e){}}
async function ocrLoad(f){try{const db=await idb(),v=await new Promise(res=>{const q=db.transaction('ocr').objectStore('ocr').get(okey(f));q.onsuccess=()=>res(q.result);q.onerror=()=>res(null)});
  if(v&&V.src===f&&V.doc&&v.n===V.doc.numPages&&!V.ocr){V.ocr=v;V.cache.clear();paintAll()}}catch(e){}}
function ocrPage(n){const o=V.ocr&&V.ocr.pages&&V.ocr.pages[n];return o&&!o.skip&&o.words&&o.words.length?o:null}
function ocrChars(o){
  const lines=new Map();for(const w of o.words){if(!lines.has(w.l))lines.set(w.l,[]);lines.get(w.l).push(w)}
  const out=[];
  for(const ws of lines.values()){
    const rtl=ws.filter(w=>isAr(w.t)).length>ws.length/2;ws.sort((a,b)=>rtl?b.b[0]-a.b[0]:a.b[0]-b.b[0]);
    ws.forEach((w,wi)=>{
      const ch=[...w.t],cw=(w.b[2]-w.b[0])/ch.length,ar=isAr(w.t);
      ch.forEach((c,i)=>{const x0=ar?w.b[2]-(i+1)*cw:w.b[0]+i*cw;out.push([c,x0,w.b[1],x0+cw,w.b[3]])});
      const nx=ws[wi+1];
      if(nx)out.push([' ',rtl?nx.b[2]:w.b[2],w.b[1],rtl?w.b[0]:nx.b[0],w.b[3]]);
    });
    const l=ws[ws.length-1];out.push(['\n',l.b[2],l.b[1],l.b[2],l.b[3]]);
  }
  return out}
const nrm=s=>s.toLowerCase().replace(/[\u0623\u0625\u0622]/g,'\u0627').replace(/\u0649/g,'\u064A').replace(/\u0629/g,'\u0647');
function ocrHits(q){
  const out=[],nq=nrm(q);if(!nq)return out;
  for(const n of Object.keys(V.ocr&&V.ocr.pages||{})){const o=ocrPage(+n);if(!o)continue;
    const ch=ocrChars(o),txt=nrm(ch.map(c=>c[0]).join(''));let i=txt.indexOf(nq);
    while(i>=0){const seg=ch.slice(i,i+nq.length).filter(c=>c[3]>c[1]);
      if(seg.length)out.push([+n-1,Math.min(...seg.map(c=>c[1])),Math.min(...seg.map(c=>c[2])),Math.max(...seg.map(c=>c[3])),Math.max(...seg.map(c=>c[4]))]);
      i=txt.indexOf(nq,i+nq.length)}}
  return out}
function rotOcr(n,dir,w,h){const o=V.ocr&&V.ocr.pages&&V.ocr.pages[n];if(!o)return;
  const P=dir>0?(x,y)=>[y,w-x]:(x,y)=>[h-y,x];
  o.words.forEach(k=>{const a=P(k.b[0],k.b[1]),b=P(k.b[2],k.b[3]);k.b=[Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[0],b[0]),Math.max(a[1],b[1])]});V.cache.delete(n);ocrSave()}
function loadScript(src){return new Promise((res,rej)=>{const e=document.createElement('script');e.src=src;e.onload=res;e.onerror=()=>rej(Error('The OCR files are missing from this build'));document.head.appendChild(e)})}
let ocrW=null,OCR_STOP=false;
async function ocrWorker(lang){
  if(!window.Tesseract)await loadScript('ocr/tesseract.min.js');
  return Tesseract.createWorker(lang,1,{workerPath:'ocr/worker.min.js',corePath:'ocr',langPath:'ocr',workerBlobURL:false,logger:()=>{}})}
function ocrWords(d){
  const out=[];let li=0;
  const take=(w,l)=>{const t=String(w.text||'').replace(/[\u200e\u200f\u202a-\u202e]/g,'').trim();if(!t||w.confidence<35||!w.bbox)return;out.push({t,c:Math.round(w.confidence),b:[w.bbox.x0,w.bbox.y0,w.bbox.x1,w.bbox.y1],l})};
  if(d.blocks)for(const b of d.blocks)for(const p of b.paragraphs||[])for(const l of p.lines||[]){li++;for(const w of l.words||[])take(w,li)}
  else for(const w of d.words||[])take(w,Math.round(((w.bbox.y0+w.bbox.y1)/2)/20));
  return out}
async function ocrRun(pages,lang,note){
  const doc=await hiDoc(),w=await ocrWorker(lang),res={};
  try{
    for(let k=0;k<pages.length;k++){
      if(OCR_STOP)break;const n=pages[k];note('Reading page '+(k+1)+' of '+pages.length+'…');
      const pg=await doc.getPage(n),v1=pg.getViewport({scale:1});let sc=Math.min(3,3600/Math.max(v1.width,v1.height));sc=Math.max(sc,1.2);
      const vp=pg.getViewport({scale:sc}),c=document.createElement('canvas');c.width=Math.ceil(vp.width);c.height=Math.ceil(vp.height);
      const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,c.width,c.height);await pg.render({canvasContext:x,viewport:vp}).promise;
      const r=await w.recognize(c,{},{blocks:true,text:true}),words=ocrWords(r.data),kx=pageW(n)/c.width,ky=pageH(n)/c.height,H=pageH(n);
      res[n]={words:words.map(q=>({t:q.t,c:q.c,l:q.l,b:[q.b[0]*kx,H-q.b[3]*ky,q.b[2]*kx,H-q.b[1]*ky]}))};c.width=c.height=0}
  }finally{try{await w.terminate()}catch(e){}}
  return res}

/* ---------- view: night mode, full screen, hand-drag, page keys ---------- */
let FS=false;
function toggleDark(on){const d=on===undefined?!document.body.classList.contains('dark'):on;document.body.classList.toggle('dark',d);try{localStorage.pl_dark=d?'1':''}catch(e){}}
try{if(localStorage.pl_dark)toggleDark(true)}catch(e){}
async function setFull(on){
  try{if(T&&T.window&&T.window.getCurrentWindow)await T.window.getCurrentWindow().setFullscreen(on);else if(on)await document.documentElement.requestFullscreen();else if(document.fullscreenElement)await document.exitFullscreen()}
  catch(e){try{if(on)await document.documentElement.requestFullscreen()}catch(_){return}}
  FS=on;document.body.classList.toggle('fs',on);document.body.classList.remove('hdr');setTimeout(relayout,200)}
document.addEventListener('fullscreenchange',()=>{if(!T){FS=!!document.fullscreenElement;document.body.classList.toggle('fs',FS);setTimeout(relayout,200)}});
document.addEventListener('mousemove',e=>{if(FS)document.body.classList.toggle('hdr',e.clientY<10||!!e.target.closest('header'))});
(function(){let space=false,pan=null;const v=$('#viewer'),B=document.body;
  const typing=()=>/INPUT|SELECT|TEXTAREA/.test((document.activeElement||{}).tagName||'')||document.querySelector('dialog[open]');
  document.addEventListener('keydown',e=>{
    if(e.code==='Space'&&V.doc&&!typing()){e.preventDefault();if(!space){space=true;B.classList.add('pan')}return}
    if(typing())return;
    if(e.key==='F11'){e.preventDefault();setFull(!FS)}
    else if(e.key==='Escape'&&FS)setFull(false);
    else if(!V.doc||e.ctrlKey||e.altKey)return;
    else if(e.key==='Home'){e.preventDefault();goTo(1)}
    else if(e.key==='End'){e.preventDefault();goTo(V.doc.numPages)}
    else if(e.key==='PageDown'){e.preventDefault();v.scrollBy({top:v.clientHeight*.9})}
    else if(e.key==='PageUp'){e.preventDefault();v.scrollBy({top:-v.clientHeight*.9})}
    else if(e.key==='ArrowDown'&&V.selId==null){e.preventDefault();v.scrollBy({top:80})}
    else if(e.key==='ArrowUp'&&V.selId==null){e.preventDefault();v.scrollBy({top:-80})}
  });
  document.addEventListener('keyup',e=>{if(e.code==='Space'){space=false;B.classList.remove('pan')}});
  window.addEventListener('blur',()=>{space=false;B.classList.remove('pan')});
  v.addEventListener('mousedown',e=>{if(!V.doc)return;if(e.button===1||(e.button===0&&space)){e.preventDefault();e.stopImmediatePropagation();pan={x:e.clientX,y:e.clientY,l:v.scrollLeft,t:v.scrollTop};B.classList.add('panning')}},true);
  window.addEventListener('mousemove',e=>{if(pan){v.scrollLeft=pan.l-(e.clientX-pan.x);v.scrollTop=pan.t-(e.clientY-pan.y)}});
  window.addEventListener('mouseup',()=>{if(pan){pan=null;B.classList.remove('panning')}});
})();

/* ---------- tools: compress / merge / split ---------- */
let tt='compress',tfiles=[];
const LIMIT=1e9;
function usesLeft(){try{const d=new Date().toDateString(),s=JSON.parse(localStorage.u||'{}');return s.d===d?LIMIT-s.n:LIMIT}catch(e){return LIMIT}}
function useOne(){try{const d=new Date().toDateString(),s=JSON.parse(localStorage.u||'{}');localStorage.u=JSON.stringify({d,n:(s.d===d?s.n:0)+1})}catch(e){}}
async function imgToJpeg(f){
  let bmp;try{bmp=await createImageBitmap(f,{imageOrientation:'from-image'})}catch(e){bmp=await createImageBitmap(f)}
  const k=Math.min(1,3000/Math.max(bmp.width,bmp.height)),c=document.createElement('canvas');c.width=Math.max(1,Math.round(bmp.width*k));c.height=Math.max(1,Math.round(bmp.height*k));
  const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,c.width,c.height);x.drawImage(bmp,0,0,c.width,c.height);if(bmp.close)bmp.close();
  const b=await new Promise(r=>c.toBlob(r,'image/jpeg',.88));return{bytes:new Uint8Array(await b.arrayBuffer()),w:c.width,h:c.height}}
function showTools(t){if(t)setTab(t);$('#tools').showModal()}
function setTab(t){tt=t;tfiles=[];document.querySelectorAll('#tools .tt button').forEach(b=>b.classList.toggle('on',b.dataset.t===t));$('#tmsg').textContent='';renderTools()}
function renderTools(){
  if(TD[tt]){$('#tHead').textContent=TD[tt][0];$('#tDesc').textContent=TD[tt][1]}
  $('#tlist').innerHTML=tfiles.map((f,i)=>'<li><span>'+esc(f.name)+'</span><small>'+kb(f.size)+'</small>'+(tt==='merge'||tt==='images'?'<button data-u="'+i+'">↑</button>':'')+'<button data-x="'+i+'">✕</button></li>').join('');
  $('#trange').hidden=!['split','rotate','delete','toimg','mark','ocr'].includes(tt);$('#tocrBox').hidden=tt!=='ocr';$('#tdrop').hidden=tt==='ocr';$('#tlist').hidden=tt==='ocr';$('#tlvl').hidden=tt!=='compress';$('#tfmt').hidden=tt!=='toimg';$('#tmkbox').hidden=tt!=='mark';$('#timg').hidden=tt!=='images';$('#tfile').accept=tt==='images'?'.jpg,.jpeg,.png,.webp,.bmp,.gif,image/*':'.pdf,application/pdf';$('#tdrop').textContent=tt==='images'?'Drop photos or images here (JPG, PNG) or click to choose':'Drop PDF files here or click to choose';$('#tang').hidden=tt!=='rotate';
  $('#trange').placeholder={split:'Pages to extract, e.g. 1-3, 5, 8-10',rotate:'Pages to rotate (empty = all pages), e.g. 1-3, 5',delete:'Pages to delete, e.g. 2, 4-6',toimg:'Pages to save (empty = all pages), e.g. 1-3, 5',mark:'Pages to mark (empty = all pages), e.g. 1-3, 5',ocr:'Pages to read (empty = every page without text), e.g. 1-3, 5'}[tt]||'';
  $('#tocrInfo').textContent=V.doc?'Reads the scanned pages of "'+V.src.name+'" so you can search them (Ctrl+F) and copy text. It runs on your computer; nothing is uploaded.':'Open a PDF first, then come back here.';
  $('#tgo').textContent={compress:'Compress',merge:'Merge',split:'Extract pages',rotate:'Rotate pages',delete:'Delete pages',images:'Create PDF',toimg:'Save as pictures (ZIP)',mark:'Add to PDF',ocr:'Read text (OCR)'}[tt];$('#tgo').disabled=tt==='ocr'?!V.doc:!tfiles.length;
}
const isImg=n=>/\.(jpe?g|png|webp|bmp|gif)$/i.test(n);
function addTools(fl){const n=[...fl].filter(f=>tt==='images'?isImg(f.name):isPdf(f.name));tfiles=tt==='merge'||tt==='images'?tfiles.concat(n):n.slice(0,1);renderTools();$('#tmsg').textContent=''}
$('#bTools').onclick=()=>showTools();
/* tools: icons in the side list, a title and a line of help for each */
const TI={compress:'<path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/>',merge:'<path d="M12 3 3 8l9 5 9-5z"/><path d="m3 13 9 5 9-5"/>',split:'<path d="M6 3v18M18 3v18M10 12h4M12 10l2 2-2 2"/>',rotate:'<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',delete:'<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',images:'<rect x="4" y="5" width="16" height="14" rx="1.5"/><path d="m4 15 4-4 5 5 3-3 4 4"/>',toimg:'<path d="M7 3h7l4 4v14H7z"/><path d="m10 14 2 2 3-4"/>',mark:'<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',ocr:'<path d="M4 7V4h3M17 4h3v3M20 17v3h-3M7 20H4v-3M8 12h8"/>'};
const TD={compress:['Compress PDF','Make a PDF smaller so it is easier to email or upload.'],merge:['Merge PDFs','Add files in the order you want them joined. Use ↑ to move a file up.'],split:['Split PDF','Save some pages as a new PDF.'],rotate:['Rotate pages','Turn pages that are sideways or upside down.'],delete:['Delete pages','Save a copy without the pages you choose.'],images:['Images to PDF','Turn photos and scans into one PDF.'],toimg:['PDF to images','Save pages as JPG or PNG pictures in a ZIP file.'],mark:['Watermark','Add page numbers and a watermark to every page.'],ocr:['Text from scan','Read the text in scanned pages so you can search and copy it.']};
document.querySelectorAll('#tools .tt button').forEach(b=>{if(TI[b.dataset.t])b.innerHTML=icon(TI[b.dataset.t])+'<span>'+b.textContent.trim()+'</span>'});
$('#qtools').onclick=e=>{const b=e.target.closest('[data-t]');if(b)showTools(b.dataset.t)};
/* settings menu: language, license, shortcuts */
$('#bSet').onclick=e=>{const b=e.currentTarget;if(!$('#pop').hidden){hidePop();return}
  showPop(b,'<button data-act="lang"><b>'+(LANG==='ar'?'English':'العربية')+'</b><small>Language · اللغة</small></button><button data-set="lic"><b>License and updates</b><small>Trial, license key, version</small></button><button data-set="keys"><b>Keyboard shortcuts</b><small>Press ? any time</small></button>');
  const p=$('#pop'),r=b.getBoundingClientRect();p.style.left=Math.max(6,Math.min(r.right-p.offsetWidth,innerWidth-p.offsetWidth-6))+'px'};
$('#pop').addEventListener('click',e=>{const b=e.target.closest('[data-set]');if(!b)return;hidePop();if(b.dataset.set==='lic'){licUI();$('#dLic').showModal()}else $('#dHelp').showModal()});
$('#tools').addEventListener('close',()=>{OCR_STOP=true});
const srcBytes=async f=>f._path?new Uint8Array(await inv('read_file',{path:f._path})):new Uint8Array(await f.arrayBuffer());
const rotMap=f=>{try{return f&&f._path?JSON.parse(localStorage.getItem('rt:'+f._path)||'{}'):{}}catch(e){return{}}};
function setRotMap(f,m){try{if(!f||!f._path)return;if(Object.keys(m).length)localStorage.setItem('rt:'+f._path,JSON.stringify(m));else localStorage.removeItem('rt:'+f._path)}catch(e){}}
async function applyRot(bytes,map){const pdf=await PDFDocument.load(bytes,{ignoreEncryption:true});if(pdf.isEncrypted)throw Error('encrypted');
  for(const n of Object.keys(map)){const pg=pdf.getPages()[n-1];if(pg)pg.setRotation(degrees((((pg.getRotation().angle+map[n])%360)+360)%360))}
  return new Uint8Array(await pdf.save({useObjectStreams:true}))}
function rotAnns(n,dir,w,h){
  const P=dir>0?(x,y)=>[y,w-x]:(x,y)=>[h-y,x],M=p=>P(p[0],p[1]);
  const box=(a,bw,bh,top)=>{const cx=a.x+bw/2,cy=top?a.y-bh/2:a.y+bh/2,c=P(cx,cy);a.x=c[0]-bw/2;a.y=top?c[1]+bh/2:c[1]-bh/2};
  V.ann.filter(a=>a.p===n).forEach(a=>{
    switch(a.type){
      case'hl':case'ul':case'st':a.rects=a.rects.map(r=>{const p=M([r[0],r[1]]),q=M([r[2],r[3]]);return[Math.min(p[0],q[0]),Math.min(p[1],q[1]),Math.max(p[0],q[0]),Math.max(p[1],q[1])]});break;
      case'pen':case'meas':a.pts=a.pts.map(M);break;
      case'line':case'arrow':{const f1=P(a.fx,a.fy),t1=P(a.tx,a.ty);a.fx=f1[0];a.fy=f1[1];a.tx=t1[0];a.ty=t1[1];break}
      case'rect':case'ellipse':case'redact':{const p=M([a.r[0],a.r[1]]),q=M([a.r[2],a.r[3]]);a.r=[Math.min(p[0],q[0]),Math.min(p[1],q[1]),Math.max(p[0],q[0]),Math.max(p[1],q[1])];break}
      case'count':{const c=P(a.x,a.y);a.x=c[0];a.y=c[1];break}
      case'img':box(a,a.w,a.h,false);break;
      case'text':{const m=tm(a);box(a,m.w,m.h,true);break}
      case'callout':{const m=tm(a),t=P(a.tx,a.ty);box(a,m.w,m.h,true);a.tx=t[0];a.ty=t[1];break}
    }});
}
async function rotatePage(dir){
  if(!V.doc||!V.src||licLocked)return;const n=V.cur;
  if(V.pageOps&&V.pageOps.length)return pageEdit({k:'rot',n,deg:dir},'Page '+n+' rotated');
  try{
    const base=V.rotBytes||await srcBytes(V.src),pdf=await PDFDocument.load(base,{ignoreEncryption:true});
    if(pdf.isEncrypted){toast('Password-protected PDFs cannot be rotated here',3500);return}
    const pg=pdf.getPages()[n-1];pg.setRotation(degrees((((pg.getRotation().angle+dir)%360)+360)%360));
    const out=new Uint8Array(await pdf.save({useObjectStreams:true})),w=pageW(n),h=pageH(n);
    let sizes=null,doc,b;
    if(V.native){sizes=await inv('pdf_open_bytes',out,{headers:{}});doc={numPages:sizes.length,native:true};b={width:sizes[0][0],height:sizes[0][1]}}
    else{doc=await pj().getDocument({data:out.slice()}).promise;const vp=(await doc.getPage(1)).getViewport({scale:1});b={width:vp.width,height:vp.height}}
    rotAnns(n,dir,w,h);rotOcr(n,dir,w,h);V.undo=[];V.redo=[];V.selId=null;
    const rm=rotMap(V.src);rm[n]=(((rm[n]||0)+dir)%360+360)%360;if(!rm[n])delete rm[n];setRotMap(V.src,rm);
    if(V.doc&&V.doc.destroy)V.doc.destroy();
    Object.assign(V,{doc,sizes,base:b,rotBytes:out,sel:null,hits:[],hi:-1});V.cache.clear();
    fitScale();build();goTo(n);buildSide();V.dirty=true;persist();updateSave();updateHistoryUi();
    toast('Page '+n+' rotated · Save copy to keep it in a PDF',3500);
  }catch(e){toast('Could not rotate: '+(e.message||e),4000)}
}
$('#bRotL').onclick=()=>rotatePage(-90);$('#bRotR').onclick=()=>rotatePage(90);$('#tX').onclick=()=>$('#tools').close();
document.querySelector('#tools .tt').onclick=e=>{const b=e.target.closest('[data-t]');if(b)setTab(b.dataset.t)};
$('#tdrop').onclick=()=>$('#tfile').click();
$('#tfile').onchange=e=>{addTools(e.target.files);e.target.value=''};
$('#tlist').onclick=e=>{const x=e.target.dataset.x,u=e.target.dataset.u;if(x!=null)tfiles.splice(+x,1);if(u!=null&&+u>0)[tfiles[u-1],tfiles[u]]=[tfiles[u],tfiles[u-1]];renderTools()};

async function recompress(d,q,maxDim){
  let n=0;const N=s=>PDFName.of(s);
  for(const [ref,obj] of d.context.enumerateIndirectObjects()){
    if(!(obj instanceof PDFRawStream))continue;
    const dc=obj.dict;
    if(dc.get(N('Subtype'))!==N('Image')||dc.get(N('Filter'))!==N('DCTDecode'))continue;
    const cs=dc.get(N('ColorSpace'));
    if((cs!==N('DeviceRGB')&&cs!==N('DeviceGray'))||dc.get(N('Decode'))||dc.get(N('ImageMask')))continue;
    try{
      const w=dc.get(N('Width')).asNumber(),h=dc.get(N('Height')).asNumber();
      const bmp=await createImageBitmap(new Blob([obj.contents],{type:'image/jpeg'}));
      const s=Math.min(1,maxDim/Math.max(w,h)),nw=Math.max(1,Math.round(w*s)),nh=Math.max(1,Math.round(h*s));
      const c=document.createElement('canvas');c.width=nw;c.height=nh;
      const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,nw,nh);x.drawImage(bmp,0,0,nw,nh);
      const blob=await new Promise(r=>c.toBlob(r,'image/jpeg',q));
      const nb=new Uint8Array(await blob.arrayBuffer());
      if(nb.length<obj.contents.length*0.9){
        dc.set(N('Width'),PDFNumber.of(nw));dc.set(N('Height'),PDFNumber.of(nh));
        dc.set(N('ColorSpace'),N('DeviceRGB'));dc.set(N('BitsPerComponent'),PDFNumber.of(8));
        dc.set(N('Length'),PDFNumber.of(nb.length));
        d.context.assign(ref,PDFRawStream.of(dc,nb));n++;
      }
    }catch(e){}
  }
  return n;
}
function pageGeom(pg){const cb=pg.getCropBox?pg.getCropBox():pg.getMediaBox(),r=((pg.getRotation().angle%360)+360)%360,sw=r%180===0;return{cb,r,w:cb.width,h:cb.height,dw:sw?cb.width:cb.height,dh:sw?cb.height:cb.width}}
function putText(pg,font,text,size,ax,ay,theta,align,color,opacity){
  const g=pageGeom(pg),a=theta*Math.PI/180,tw=font.widthOfTextAtSize(text,size),off=align==='c'?tw/2:align==='r'?tw:0;
  const sx=ax-off*Math.cos(a)+size*.33*Math.sin(a),sy=ay-off*Math.sin(a)-size*.33*Math.cos(a);
  let X,Y;if(g.r===0){X=sx;Y=sy}else if(g.r===90){X=g.w-sy;Y=sx}else if(g.r===180){X=g.w-sx;Y=g.h-sy}else{X=sy;Y=g.h-sx}
  pg.drawText(text,{x:g.cb.x+X,y:g.cb.y+Y,size,font,color,opacity,rotate:degrees(theta+g.r)})}
const crcT=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0}return t})();
const crc32=u=>{let c=~0;for(let i=0;i<u.length;i++)c=crcT[(c^u[i])&255]^(c>>>8);return(~c)>>>0};
function makeZip(files){
  const enc=new TextEncoder(),parts=[],cd=[],dt=new Date(),tm_=(dt.getHours()<<11)|(dt.getMinutes()<<5)|(dt.getSeconds()>>1),dd=((dt.getFullYear()-1980)<<9)|((dt.getMonth()+1)<<5)|dt.getDate();let off=0;
  for(const f of files){
    const nm=enc.encode(f.name),crc=crc32(f.data),sz=f.data.length,h=new DataView(new ArrayBuffer(30));
    h.setUint32(0,0x04034b50,true);h.setUint16(4,20,true);h.setUint16(6,0x0800,true);h.setUint16(10,tm_,true);h.setUint16(12,dd,true);h.setUint32(14,crc,true);h.setUint32(18,sz,true);h.setUint32(22,sz,true);h.setUint16(26,nm.length,true);
    parts.push(new Uint8Array(h.buffer),nm,f.data);
    const c=new DataView(new ArrayBuffer(46));c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint16(8,0x0800,true);c.setUint16(12,tm_,true);c.setUint16(14,dd,true);c.setUint32(16,crc,true);c.setUint32(20,sz,true);c.setUint32(24,sz,true);c.setUint16(28,nm.length,true);c.setUint32(42,off,true);
    cd.push(new Uint8Array(c.buffer),nm);off+=30+nm.length+sz;
  }
  const cdLen=cd.reduce((n,a)=>n+a.length,0),e=new DataView(new ArrayBuffer(22));e.setUint32(0,0x06054b50,true);e.setUint16(8,files.length,true);e.setUint16(10,files.length,true);e.setUint32(12,cdLen,true);e.setUint32(16,off,true);
  const all=[...parts,...cd,new Uint8Array(e.buffer)],out=new Uint8Array(all.reduce((n,a)=>n+a.length,0));let o=0;for(const a of all){out.set(a,o);o+=a.length}return out}
function parseRanges(s,max){const out=[];for(const p of s.split(',')){const m=p.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);if(!m)throw Error('Invalid range: '+p);let a=+m[1],b=+(m[2]||m[1]);if(a<1||b>max||a>b)throw Error('Out of range: '+p+' (document has '+max+' pages)');for(let i=a;i<=b;i++)out.push(i-1)}if(!out.length)throw Error('Enter page numbers');return out}
let lastSaved=null;
function openSaved(s){if(s)openTab(s.path?{name:s.name,_path:s.path}:new File([s.bytes],s.name,{type:'application/pdf'}))}
async function save(bytes,name,ft){ft=ft||{ext:'pdf',label:'PDF',mime:'application/pdf'};const pdf=ft.ext==='pdf';
  if(T){const p=await inv('pick_save',{name,label:ft.label,ext:ft.ext});if(!p)throw Error('Save cancelled');await T.core.invoke('write_file',new Uint8Array(bytes),{headers:{path:encodeURIComponent(p)}});const r={path:p,name:base(p),bytes:null};if(pdf)lastSaved=r;return r}
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([bytes],{type:ft.mime}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),4000);const r={path:null,name,bytes:new Uint8Array(bytes)};if(pdf)lastSaved=r;return r}
$('#tgo').onclick=async()=>{
  if(licLocked)return;
  const msg=$('#tmsg');
  const doneMsg=h=>{msg.innerHTML=h;if(lastSaved){msg.insertAdjacentHTML('beforeend','<div style="margin-top:10px"><button id="tOpen" class="pri">Open file</button></div>');$('#tOpen').onclick=()=>{$('#tools').close();openSaved(lastSaved)}}};
  if(usesLeft()<=0){msg.innerHTML='<b>Daily free limit reached.</b> Unlock unlimited use to continue.';return}
  $('#tgo').disabled=true;msg.textContent='Working…';lastSaved=null;
  try{
    if(tt==='merge'){
      if(tfiles.length<2)throw Error('Add at least 2 files');
      const out=await PDFDocument.create();
      const rebuilt=[];
      for(const f of tfiles){
        const buf=await f.arrayBuffer();
        try{const d=await PDFDocument.load(buf,{ignoreEncryption:true,throwOnInvalidObject:false});(await out.copyPages(d,d.getPageIndices())).forEach(p=>out.addPage(p))}
        catch(e1){
          /* odd PDF structure: rebuild this file page by page from its picture so the merge still works */
          msg.textContent='Working… repairing '+f.name;
          const doc=await pj().getDocument({data:new Uint8Array(buf.slice(0))}).promise;
          for(let i=1;i<=doc.numPages;i++){
            const pg=await doc.getPage(i),v1=pg.getViewport({scale:1}),sc=Math.min(2.2,4000/Math.max(v1.width,v1.height)),vp=pg.getViewport({scale:sc}),c=document.createElement('canvas');
            c.width=Math.ceil(vp.width);c.height=Math.ceil(vp.height);const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,c.width,c.height);
            await pg.render({canvasContext:x,viewport:vp}).promise;
            const jb=await new Promise(r=>c.toBlob(r,'image/jpeg',.88)),img=await out.embedJpg(new Uint8Array(await jb.arrayBuffer())),page=out.addPage([v1.width,v1.height]);
            page.drawImage(img,{x:0,y:0,width:v1.width,height:v1.height});c.width=c.height=0;
          }
          if(doc.destroy)doc.destroy();rebuilt.push(f.name);
        }
      }
      await save(await out.save({useObjectStreams:true}),'merged.pdf');
      doneMsg('<b>Done.</b> '+tfiles.length+' files merged.'+(rebuilt.length?'<br><small>'+rebuilt.map(esc).join(', ')+' had an unusual structure, so '+(rebuilt.length>1?'those pages were':'its pages were')+' rebuilt as images (text in them is no longer selectable).</small>':''));
    }else if(tt==='images'){
      const out=await PDFDocument.create(),fit=$('#timg').value==='a4';
      for(let i=0;i<tfiles.length;i++){msg.textContent='Adding image '+(i+1)+' of '+tfiles.length+'…';
        let j;try{j=await imgToJpeg(tfiles[i])}catch(e){throw Error('Could not read '+tfiles[i].name)}
        const im=await out.embedJpg(j.bytes);
        if(fit){const land=j.w>j.h,PW=land?841.89:595.28,PH=land?595.28:841.89,mg=28,k=Math.min((PW-2*mg)/j.w,(PH-2*mg)/j.h),dw=j.w*k,dh=j.h*k;
          out.addPage([PW,PH]).drawImage(im,{x:(PW-dw)/2,y:(PH-dh)/2,width:dw,height:dh})}
        else{const k=72/150;out.addPage([j.w*k,j.h*k]).drawImage(im,{x:0,y:0,width:j.w*k,height:j.h*k})}}
      const nm=tfiles.length===1?tfiles[0].name.replace(/\.[^.]+$/,'')+'.pdf':'images.pdf';
      await save(await out.save({useObjectStreams:true}),nm);doneMsg('<b>Done.</b> '+tfiles.length+(tfiles.length===1?' image':' images')+' turned into a PDF.');
    }else if(tt==='split'){
      const f=tfiles[0],d=await PDFDocument.load(await f.arrayBuffer(),{ignoreEncryption:true});
      const idx=parseRanges($('#trange').value,d.getPageCount()),out=await PDFDocument.create();
      (await out.copyPages(d,idx)).forEach(p=>out.addPage(p));
      await save(await out.save({useObjectStreams:true}),f.name.replace(/\.pdf$/i,'')+'-extract.pdf');doneMsg('<b>Done.</b> '+idx.length+' pages extracted.');
    }else if(tt==='rotate'){
      const f=tfiles[0],d=await PDFDocument.load(await f.arrayBuffer(),{ignoreEncryption:true});
      const idx=$('#trange').value.trim()?parseRanges($('#trange').value,d.getPageCount()):d.getPageIndices(),ang=+$('#tang').value;
      idx.forEach(i=>{const pg=d.getPage(i);pg.setRotation(degrees(((pg.getRotation().angle+ang)%360+360)%360))});
      await save(await d.save({useObjectStreams:true}),f.name.replace(/\.pdf$/i,'')+'-rotated.pdf');doneMsg('<b>Done.</b> '+idx.length+(idx.length===1?' page':' pages')+' rotated.');
    }else if(tt==='ocr'){
      if(!V.doc)throw Error('Open a PDF first');
      const total=V.doc.numPages,lang=$('#tlang').value;let list,skipped=0;OCR_STOP=false;
      if($('#trange').value.trim())list=parseRanges($('#trange').value,total).map(i=>i+1);
      else{list=[];for(let n=1;n<=total;n++){let has=false;if(V.native){try{has=(await inv('pdf_text',{page:n-1})).length>=20}catch(e){}}if(has)skipped++;else list.push(n)}}
      if(!list.length){msg.innerHTML='<b>Nothing to read.</b> Every page already has searchable text.';$('#tgo').disabled=false;return}
      const got=await ocrRun(list,lang,t=>{msg.textContent=t});
      if(OCR_STOP){msg.textContent='Stopped.';$('#tgo').disabled=false;return}
      V.ocr=V.ocr||{n:total,pages:{}};V.ocr.n=total;let words=0;
      for(const n of Object.keys(got)){V.ocr.pages[n]=got[n];words+=got[n].words.length;V.cache.delete(+n)}
      ocrSave();paintAll();
      let extra='';
      if($('#tocrPdf').checked){
        msg.textContent='Building the searchable PDF…';
        const bytes=V.rotBytes||await srcBytes(V.src),d=await PDFDocument.load(bytes,{ignoreEncryption:true}),font=await d.embedFont(StandardFonts.Helvetica);let used=0;
        for(const n of Object.keys(got)){const pg=d.getPage(n-1);
          for(const w of got[n].words){
            let ok=true;try{font.widthOfTextAtSize(w.t,10)}catch(e){ok=false}if(!ok)continue;
            const bw=w.b[2]-w.b[0],bh=w.b[3]-w.b[1],wf=font.widthOfTextAtSize(w.t,1),sz=Math.max(bh*.5,Math.min(bh*1.5,bw/wf));
            putText(pg,font,w.t,sz,w.b[0],w.b[1]+bh*.2,0,'l',rgb(0,0,0),0);used++}}
        await save(await d.save({useObjectStreams:true}),V.src.name.replace(/\.pdf$/i,'')+'-ocr.pdf');
        extra='<br><small>The copy has '+used+' searchable words (English letters and numbers).</small>'}
      doneMsg('<b>Done.</b> Read '+Object.keys(got).length+(Object.keys(got).length===1?' page':' pages')+', '+words+' words found.'+(skipped?' '+skipped+' pages already had text.':'')+'<br><small>Press Ctrl+F to search, or select text with the mouse.</small>'+extra);
    }else if(tt==='toimg'){
      const f=tfiles[0],bn=f.name.replace(/\.pdf$/i,''),doc=await pj().getDocument({data:new Uint8Array(await f.arrayBuffer())}).promise;
      const idx=$('#trange').value.trim()?parseRanges($('#trange').value,doc.numPages):[...Array(doc.numPages).keys()],fm=$('#tfmt').value,dpi=fm==='h'?220:150,png=fm==='p',files=[];
      for(let k=0;k<idx.length;k++){
        msg.textContent='Working… page '+(k+1)+' of '+idx.length;
        const pg=await doc.getPage(idx[k]+1),v1=pg.getViewport({scale:1});let sc=dpi/72;const mx=Math.max(v1.width,v1.height)*sc;if(mx>6000)sc*=6000/mx;
        const vp=pg.getViewport({scale:sc}),c=document.createElement('canvas');c.width=Math.ceil(vp.width);c.height=Math.ceil(vp.height);
        const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,c.width,c.height);await pg.render({canvasContext:x,viewport:vp}).promise;
        const bl=await new Promise(r=>c.toBlob(r,png?'image/png':'image/jpeg',.9));
        files.push({name:bn+'-'+String(idx[k]+1).padStart(3,'0')+(png?'.png':'.jpg'),data:new Uint8Array(await bl.arrayBuffer())});c.width=c.height=0;
      }
      if(doc.destroy)doc.destroy();
      await save(makeZip(files),bn+'-images.zip',{ext:'zip',label:'ZIP archive',mime:'application/zip'});doneMsg('<b>Done.</b> '+files.length+(files.length===1?' picture':' pictures')+' saved in a ZIP file.');
    }else if(tt==='mark'){
      const f=tfiles[0],d=await PDFDocument.load(await f.arrayBuffer(),{ignoreEncryption:true}),num=$('#mkNum').checked,wm=$('#mkWm').value.trim();
      if(!num&&!wm)throw Error('Tick page numbers, type a watermark, or both');
      const idx=$('#trange').value.trim()?parseRanges($('#trange').value,d.getPageCount()):d.getPageIndices(),font=await d.embedFont(StandardFonts.Helvetica),bold=await d.embedFont(StandardFonts.HelveticaBold),total=d.getPageCount();
      if(wm){try{bold.widthOfTextAtSize(wm,10)}catch(e){throw Error('The watermark can only use English letters, numbers and common symbols')}}
      for(const i of idx){
        const pg=d.getPage(i),g=pageGeom(pg);
        if(wm){const th=Math.atan2(g.dh,g.dw)*180/Math.PI,diag=Math.hypot(g.dw,g.dh),w1=bold.widthOfTextAtSize(wm,1),sz=Math.max(14,Math.min(.62*diag/w1,Math.min(g.dw,g.dh)*.3)),red=$('#mkSty').value==='r';
          putText(pg,bold,wm,sz,g.dw/2,g.dh/2,th,'c',red?rgb(.85,.1,.1):rgb(.55,.55,.55),.25)}
        if(num){const fm=$('#mkFmt').value,t=fm==='of'?(i+1)+' / '+total:fm==='pg'?'Page '+(i+1)+' of '+total:String(i+1),pos=$('#mkPos').value,m=34;
          const P={bc:[g.dw/2,22,'c'],br:[g.dw-m,22,'r'],bl:[m,22,'l'],tr:[g.dw-m,g.dh-30,'r']}[pos];putText(pg,font,t,10,P[0],P[1],0,P[2],rgb(.2,.2,.2),1)}
      }
      await save(await d.save({useObjectStreams:true}),f.name.replace(/\.pdf$/i,'')+'-marked.pdf');doneMsg('<b>Done.</b> '+idx.length+(idx.length===1?' page':' pages')+' updated.');
    }else if(tt==='delete'){
      const f=tfiles[0],d=await PDFDocument.load(await f.arrayBuffer(),{ignoreEncryption:true});
      const idx=[...new Set(parseRanges($('#trange').value,d.getPageCount()))].sort((a,b)=>b-a);
      if(idx.length>=d.getPageCount())throw Error('You cannot delete every page');
      idx.forEach(i=>d.removePage(i));dropUnreachable(d);/* otherwise the deleted pages stay hidden in the file */
      await save(await d.save({useObjectStreams:true}),f.name.replace(/\.pdf$/i,'')+'-edited.pdf');doneMsg('<b>Done.</b> '+idx.length+(idx.length===1?' page':' pages')+' deleted.');
    }else{
      const f=tfiles[0],d=await PDFDocument.load(await f.arrayBuffer(),{ignoreEncryption:true,updateMetadata:false});
      const L=$('#tlvl').value==='s'?[0.5,1400]:[0.7,2000];const ni=await recompress(d,L[0],L[1]);
      d.setTitle('');d.setAuthor('');d.setSubject('');d.setKeywords([]);d.setProducer('');d.setCreator('');
      const b=await d.save({useObjectStreams:true});
      if(b.length>=f.size){msg.innerHTML='<b>Already optimized</b> — no JPEG images to shrink in this file.'}
      else{await save(b,f.name.replace(/\.pdf$/i,'')+'-small.pdf');doneMsg('<b>Done.</b> '+kb(f.size)+' → '+kb(b.length)+' (saved '+Math.round(100-b.length/f.size*100)+'%, '+ni+' images optimized)')}
    }
    useOne();
  }catch(e){msg.textContent='Error: '+e.message}
  $('#tgo').disabled=!tfiles.length;
};

/* ---------- desktop integration ---------- */
if(T){
  async function pull(){
    const items=await inv('take_files');if(!items.length)return;
    const m=[],o=[];items.forEach(s=>(s[0]==='m'?m:o).push(s.slice(2)));
    if(m.length){const fl=[];for(const p of m)fl.push(await ldFile(p));showTools('merge');addTools(fl)}
    else if(o.length){for(const p of o)await openNew({name:base(p),_path:p})}
  }
  T.event.listen('files-ready',pull);pull();
  T.event.listen('tauri://drag-drop',e=>dropPaths((e.payload&&e.payload.paths)||[]));
}
showRecent();renderTools();

/* ---------- language: English / العربية ---------- */
const AR={
// redesign (home, tools, settings)
'Open a PDF to get started':'افتح ملف PDF للبدء','View, mark up, sign and fix PDFs. Everything stays on this computer.':'اعرض ملفات PDF وعلّق عليها ووقّعها وأصلحها. كل شيء يبقى على هذا الجهاز.','Drop a PDF here':'أفلت ملف PDF هنا','or':'أو','Choose a file':'اختر ملفاً','Ctrl+O':'Ctrl+O','Keyboard shortcuts':'اختصارات لوحة المفاتيح','Quick tools':'أدوات سريعة','Recent':'الأخيرة','Clear list':'مسح القائمة',
'Make a PDF smaller':'تصغير حجم ملف PDF','Join several PDFs':'دمج عدة ملفات PDF','Pull out pages':'استخراج صفحات','Images to PDF':'صور إلى PDF','Photos and scans':'صور ومستندات ممسوحة','PDF to images':'PDF إلى صور','Save pages as JPG or PNG':'حفظ الصفحات بصيغة JPG أو PNG','Page numbers and stamps':'أرقام الصفحات والعلامات','Text from scan':'نص من مسح ضوئي','OCR, English and Arabic':'تعرّف على النص، عربي وإنجليزي','Rotate pages':'تدوير الصفحات','Turn pages the right way':'اضبط اتجاه الصفحات','Delete pages':'حذف الصفحات',
'Compress PDF':'ضغط PDF','Merge PDFs':'دمج ملفات PDF','Split PDF':'تقسيم PDF','Make a PDF smaller so it is easier to email or upload.':'صغّر حجم ملف PDF ليسهل إرساله أو رفعه.','Add files in the order you want them joined. Use ↑ to move a file up.':'أضف الملفات بالترتيب الذي تريد دمجها به. استخدم ↑ لتحريك ملف للأعلى.','Save some pages as a new PDF.':'احفظ بعض الصفحات في ملف PDF جديد.','Turn pages that are sideways or upside down.':'دوّر الصفحات المائلة أو المقلوبة.','Save a copy without the pages you choose.':'احفظ نسخة بدون الصفحات التي تختارها.','Turn photos and scans into one PDF.':'حوّل الصور والمستندات الممسوحة إلى ملف PDF واحد.','Save pages as JPG or PNG pictures in a ZIP file.':'احفظ الصفحات كصور JPG أو PNG في ملف ZIP.','Add page numbers and a watermark to every page.':'أضف أرقام الصفحات وعلامة مائية إلى كل صفحة.','Read the text in scanned pages so you can search and copy it.':'اقرأ النص في الصفحات الممسوحة لتتمكن من البحث فيه ونسخه.',
'Settings':'الإعدادات','License and updates':'الترخيص والتحديثات','Trial, license key, version':'التجربة ومفتاح الترخيص والإصدار','Press ? any time':'اضغط ? في أي وقت','Compress, merge, split and more':'ضغط ودمج وتقسيم والمزيد','Zoom out':'تصغير','Zoom in':'تكبير','Undo':'تراجع','Redo':'إعادة','Close':'إغلاق',
// header, menus
'Open':'فتح','Tools':'الأدوات','Print':'طباعة','Find':'بحث','Save as':'حفظ باسم','Save':'حفظ','Save your markup and changes into this PDF (Ctrl+S)':'احفظ علاماتك وتغييراتك في هذا الملف (Ctrl+S)','Save as… a new PDF file (Ctrl+Shift+S)':'حفظ باسم… ملف PDF جديد (Ctrl+Shift+S)','Redact':'تنقيح','Redact: draw boxes over text or pictures to remove for good, then Apply':'تنقيح: ارسم مربعات فوق النص أو الصور لإزالتها نهائياً، ثم اضغط تطبيق','Apply redactions':'تطبيق التنقيح','Crop: drag a box around the part of the page to keep':'قص: اسحب مربعاً حول الجزء الذي تريد إبقاءه من الصفحة','Crop pages':'قص الصفحات','Add or remove a password':'إضافة كلمة مرور أو إزالتها','Add a password':'إضافة كلمة مرور','Remove the password':'إزالة كلمة المرور','Also block printing and copying text':'منع الطباعة ونسخ النص أيضاً','New password':'كلمة مرور جديدة','Current password':'كلمة المرور الحالية','Type it again':'اكتبها مرة أخرى','Add password':'إضافة كلمة المرور','Remove password':'إزالة كلمة المرور','Rotate left':'تدوير لليسار','Rotate right':'تدوير لليمين','Move up':'نقل لأعلى','Move down':'نقل لأسفل','Insert blank page after':'إدراج صفحة فارغة بعدها','Insert pages from a PDF after…':'إدراج صفحات من ملف PDF بعدها…','Delete page':'حذف الصفحة','Page options: rotate, move, insert, delete':'خيارات الصفحة: تدوير، نقل، إدراج، حذف','Passwords are available in the Windows app.':'كلمات المرور متاحة في تطبيق ويندوز.','Save to keep these page changes':'احفظ الملف للاحتفاظ بتغييرات الصفحات','Drag a box around the part of the page to keep':'اسحب مربعاً حول الجزء الذي تريد إبقاءه من الصفحة','Redacting…':'جارٍ التنقيح…','Redacted · Save to keep it':'تم التنقيح · احفظ الملف للاحتفاظ به','Markup tools':'أدوات التعليق','Save as…':'حفظ باسم…','Sidebar':'اللوحة الجانبية','Pages':'الصفحات','Bookmarks':'الإشارات المرجعية','Markups':'التعليقات والعلامات','Shortcuts':'الاختصارات',
'Fit width':'ملاءمة العرض','Fit page':'ملاءمة الصفحة','A4 size':'حجم A4','Actual size':'الحجم الفعلي','Custom':'مخصص','Fit width ▾':'ملاءمة العرض ▾','Fit page ▾':'ملاءمة الصفحة ▾','A4 size ▾':'حجم A4 ▾','Actual size ▾':'الحجم الفعلي ▾','Custom ▾':'مخصص ▾',
'Page fills the window width':'تملأ الصفحة عرض النافذة','Whole page visible at once':'تظهر الصفحة كاملة','21 cm wide, like printed paper':'بعرض 21 سم مثل الورق المطبوع','100% · original PDF size':'100% · الحجم الأصلي للملف',
'Night mode':'الوضع الليلي','Dark pages for easier reading':'صفحات داكنة لقراءة أريح','Full screen':'ملء الشاشة','F11 · Esc to leave':'F11 · اضغط Esc للخروج',
'Language · اللغة':'Language · اللغة',
'Trial':'تجربة','Pro':'احترافي','Free trial':'تجربة مجانية','Trial ended':'انتهت التجربة','License expired':'انتهى الترخيص','License':'الترخيص',
'A fast, simple PDF viewer with merge, split and compress.':'عارض PDF سريع وبسيط مع الدمج والتقسيم والضغط.','Open a PDF':'فتح ملف PDF','or drop a file anywhere ·':'أو اسحب ملفاً وأفلته في أي مكان ·','keyboard shortcuts':'اختصارات لوحة المفاتيح','Recent':'الأخيرة',
// toolbar
'Select':'تحديد','Highlight':'تظليل','Pen':'قلم','Text':'نص','Callout':'تعليق','Shapes':'أشكال','Measure':'قياس','Stamp':'ختم','Sign':'توقيع','Underline':'تسطير','Strikethrough':'شطب','Line':'خط','Arrow':'سهم','Rectangle':'مستطيل','Ellipse':'قطع ناقص','Count':'عدّ','Hand':'يد','Text note':'ملاحظة نصية',
'Length':'الطول','Area':'المساحة','Set scale':'ضبط المقياس','Straight lines, squares':'خطوط مستقيمة ومربعات','Black ink':'حبر أسود','Blue ink':'حبر أزرق','Brush':'فرشاة','Delete selected':'حذف المحدد','Delete':'حذف',
'Hide toolbar':'إخفاء الأدوات','Show markup tools':'إظهار أدوات التعليق','Drag to move the toolbar (double-click to reset)':'اسحب لتحريك الشريط (انقر مرتين للإعادة)','Switch between horizontal and vertical':'التبديل بين الأفقي والعمودي',
'Highlight text or an area':'تظليل نص أو منطقة','Highlight text or an area. Click again to switch to underline or strikethrough (keys H, U, S)':'تظليل نص أو منطقة. انقر مرة أخرى للتبديل إلى التسطير أو الشطب (المفاتيح H و U و S)','Freehand pen':'قلم حر','Select, move, copy text':'تحديد ونقل ونسخ النص',
'Comment box with arrow: click the target, drag to the box. Select it later to drag the arrow tip or the box; double-click to edit the text':'مربع تعليق بسهم: انقر على الهدف ثم اسحب إلى المربع. حدّده لاحقاً لتحريك السهم أو المربع، وانقر مرتين لتعديل النص','Shapes: line, arrow, rectangle, ellipse':'أشكال: خط، سهم، مستطيل، قطع ناقص','Measure length and area':'قياس الطول والمساحة','Size of new marks: S, M, L':'حجم العلامات الجديدة: S و M و L',
'Delete selected mark (Del)':'حذف العلامة المحددة (Del)','Undo (Ctrl+Z)':'تراجع (Ctrl+Z)','Redo (Ctrl+Y)':'إعادة (Ctrl+Y)','Stamps':'الأختام','Signature':'التوقيع','Text note':'ملاحظة نصية',
// header tooltips
'Open (Ctrl+O)':'فتح (Ctrl+O)','Print (Ctrl+P)':'طباعة (Ctrl+P)','Find (Ctrl+F)':'بحث (Ctrl+F)','Find in document':'بحث في المستند','Zoom in':'تكبير','Zoom out':'تصغير','Compress, merge, split':'ضغط ودمج وتقسيم','Trial / license':'التجربة / الترخيص','Pages, bookmarks and markups (Ctrl+B)':'الصفحات والإشارات والتعليقات (Ctrl+B)',
'Page size: fit width, fit page, A4, actual size (Ctrl+0 = fit width)':'حجم الصفحة: ملاءمة العرض أو الصفحة أو A4 أو الحجم الفعلي (Ctrl+0 = ملاءمة العرض)','Rotate this page left':'تدوير هذه الصفحة لليسار','Rotate this page right':'تدوير هذه الصفحة لليمين','Save as… a new PDF file, with your markup included (Ctrl+S)':'حفظ باسم… ملف PDF جديد مع تعليقاتك (Ctrl+S)','Next search match':'نتيجة البحث التالية','Change order':'تغيير الترتيب',
// tools dialog
'Compress':'ضغط','Merge':'دمج','Split':'تقسيم','Rotate':'تدوير','Delete pages':'حذف الصفحات','Images':'صور','To images':'إلى صور','Watermark':'علامة مائية','OCR':'OCR',
'Drop PDF files here or click to choose':'أفلت ملفات PDF هنا أو انقر للاختيار','Drop photos or images here (JPG, PNG) or click to choose':'أفلت الصور هنا (JPG, PNG) أو انقر للاختيار','Balanced (good quality, smaller)':'متوازن (جودة جيدة وحجم أصغر)','Strong (smallest size)':'قوي (أصغر حجم)',
'All pages (':'كل الصفحات (','Current page':'الصفحة الحالية','Include my markup':'تضمين تعليقاتي','Page size = image size':'حجم الصفحة = حجم الصورة','A4 pages (fit and centre)':'صفحات A4 (ملاءمة وتوسيط)',
'Compress, merge, split':'ضغط ودمج وتقسيم','Turn photos and images into a PDF':'تحويل الصور إلى ملف PDF','Save PDF pages as JPG or PNG pictures (ZIP)':'حفظ صفحات PDF كصور JPG أو PNG (ملف ZIP)','Add page numbers and a watermark':'إضافة أرقام الصفحات وعلامة مائية','Read text in scanned pages so you can search and copy it':'قراءة النص في الصفحات الممسوحة ضوئياً للبحث فيه ونسخه',
'JPG · standard (150 dpi)':'JPG · عادي (150 نقطة/بوصة)','JPG · high quality (220 dpi)':'JPG · جودة عالية (220 نقطة/بوصة)','PNG · lossless (150 dpi)':'PNG · بدون فقد (150 نقطة/بوصة)',
'Page numbers':'أرقام الصفحات','Bottom centre':'أسفل الوسط','Bottom right':'أسفل اليمين','Bottom left':'أسفل اليسار','Top right':'أعلى اليمين','Page 1 of 10':'صفحة 1 من 10','Watermark: light grey':'العلامة: رمادي فاتح','Watermark: red':'العلامة: أحمر','Watermark text (optional), e.g. DRAFT':'نص العلامة المائية (اختياري)، مثل DRAFT',
'English + Arabic (recommended)':'إنجليزي + عربي (موصى به)','English only':'الإنجليزية فقط','Arabic only':'العربية فقط','Also save a searchable PDF copy':'احفظ أيضاً نسخة PDF قابلة للبحث','English letters and numbers only. Arabic stays searchable inside Rasm.':'الحروف الإنجليزية والأرقام فقط. يبقى النص العربي قابلاً للبحث داخل Rasm.',
'Read text (OCR)':'قراءة النص (OCR)','Add to PDF':'إضافة إلى الملف','Save as pictures (ZIP)':'حفظ كصور (ZIP)','Create PDF':'إنشاء PDF','Delete pages':'حذف الصفحات','Extract pages':'استخراج الصفحات','Rotate pages':'تدوير الصفحات',
'Pages to delete, e.g. 2, 4-6':'الصفحات المراد حذفها، مثل 2, 4-6','Pages to extract, e.g. 1-3, 5, 8-10':'الصفحات المراد استخراجها، مثل 1-3, 5, 8-10','Pages to mark (empty = all pages), e.g. 1-3, 5':'الصفحات المراد وسمها (فارغ = كل الصفحات)، مثل 1-3, 5','Pages to read (empty = every page without text), e.g. 1-3, 5':'الصفحات المراد قراءتها (فارغ = كل صفحة بلا نص)، مثل 1-3, 5','Pages to rotate (empty = all pages), e.g. 1-3, 5':'الصفحات المراد تدويرها (فارغ = الكل)، مثل 1-3, 5','Pages to save (empty = all pages), e.g. 1-3, 5':'الصفحات المراد حفظها (فارغ = الكل)، مثل 1-3, 5',
'Rotate left 90°':'تدوير 90° لليسار','Rotate right 90°':'تدوير 90° لليمين','Rotate 180°':'تدوير 180°',
'Open a PDF first':'افتح ملف PDF أولاً','Open a PDF first, then come back here.':'افتح ملف PDF أولاً ثم عُد إلى هنا.','Working…':'جارٍ العمل…','Done.':'تم.','Open file':'فتح الملف','Cancel':'إلغاء','Got it':'حسناً','Clear':'مسح','Activate':'تفعيل','Unlock':'فتح القفل','Upload image':'رفع صورة','Use signature':'استخدام التوقيع','Draw':'رسم','Type':'كتابة','Script':'خط يدوي',
'Add at least 2 files':'أضف ملفين على الأقل','Enter page numbers':'أدخل أرقام الصفحات','You cannot delete every page':'لا يمكن حذف كل الصفحات','Building the searchable PDF…':'جارٍ إنشاء ملف PDF قابل للبحث…','Tick page numbers, type a watermark, or both':'فعّل أرقام الصفحات أو اكتب علامة مائية أو كليهما','The watermark can only use English letters, numbers and common symbols':'العلامة المائية تدعم الأحرف الإنجليزية والأرقام والرموز الشائعة فقط','Password-protected PDFs cannot be rotated here':'لا يمكن تدوير ملفات PDF المحمية بكلمة مرور هنا','The OCR files are missing from this build':'ملفات التعرف على النص (OCR) غير موجودة في هذا الإصدار','Stopped.':'تم الإيقاف.',
// dialogs
'Keyboard shortcuts':'اختصارات لوحة المفاتيح','This list':'هذه القائمة','Zoom in / out':'تكبير / تصغير','Undo / redo':'تراجع / إعادة','Move the page':'تحريك الصفحة','Go to page':'الانتقال إلى صفحة','First / last page':'الصفحة الأولى / الأخيرة','Page up / down':'الصفحة السابقة / التالية','Next tab':'التبويب التالي','Close tab':'إغلاق التبويب','Space':'مسافة','+drag':'+سحب','Home':'Home','End':'End',
'Password required':'كلمة المرور مطلوبة','This PDF is encrypted. Enter the password to open it.':'هذا الملف مشفّر. أدخل كلمة المرور لفتحه.','Password':'كلمة المرور','Incorrect password':'كلمة المرور غير صحيحة',
'Signature':'التوقيع','Type your name':'اكتب اسمك','Draw or type your signature first':'ارسم توقيعك أو اكتبه أولاً','Saved signatures':'التواقيع المحفوظة','My stamps':'أختامي','Name or company on stamps':'الاسم أو الشركة على الأختام',
'Enter the real length of the line you just drew (a dimension you know on the drawing).':'أدخل الطول الحقيقي للخط الذي رسمته للتو (بُعد معروف في المخطط).','Use this scale for all pages':'استخدام هذا المقياس لكل الصفحات','Set the scale first: draw along a known length':'اضبط المقياس أولاً: ارسم خطاً على طول معروف','Scale not set':'لم يُضبط المقياس','Scale not set yet. Use "Set scale" first.':'لم يُضبط المقياس بعد. استخدم «ضبط المقياس» أولاً.','Scale set. Click two points to measure a length.':'تم ضبط المقياس. انقر نقطتين لقياس طول.','Enter the real length as a number':'أدخل الطول الحقيقي كرقم','Scale is set for this page.':'تم ضبط المقياس لهذه الصفحة.','Count totals:':'إجمالي العدّ:','cm':'سم','mm':'مم','in':'بوصة','ft':'قدم',
'Buy a license':'شراء ترخيص','Remove license':'إزالة الترخيص','Check for updates':'التحقق من التحديثات','Paste your license key (PDFL-…)':'ألصق مفتاح الترخيص (PDFL-…)','License activated. Thank you!':'تم تفعيل الترخيص. شكراً لك!','This license key is not valid.':'مفتاح الترخيص هذا غير صالح.','This license key has expired.':'انتهت صلاحية مفتاح الترخيص هذا.','Licensing is not configured in this build.':'الترخيص غير مُعدّ في هذا الإصدار.',
'Update now':'حدّث الآن','Downloading update…':'جارٍ تنزيل التحديث…','Installing. Rasm will restart.':'جارٍ التثبيت. سيُعاد تشغيل Rasm.','The update could not be installed. Try again later.':'تعذّر تثبيت التحديث. حاول لاحقاً.','You have the latest version.':'لديك أحدث إصدار.','Could not check for updates.':'تعذّر التحقق من التحديثات.','You have unsaved markup. Install the update anyway? Rasm will close.':'لديك تعليقات غير محفوظة. هل تريد تثبيت التحديث؟ سيُغلق Rasm.',
'What\'s new in':'الجديد في',
// toasts and messages
'Opening…':'جارٍ الفتح…','Saving…':'جارٍ الحفظ…','Saved':'تم الحفظ','Saved with your markup':'تم الحفظ مع تعليقاتك','Open copy':'فتح النسخة','Save cancelled':'أُلغي الحفظ','Could not save the file':'تعذّر حفظ الملف','Copied':'تم النسخ','No text to copy':'لا يوجد نص للنسخ','Nothing to export':'لا يوجد ما يمكن تصديره','Click on the page to place it':'انقر على الصفحة لوضعه','That image looks empty':'تبدو هذه الصورة فارغة','Could not read that image':'تعذّر قراءة هذه الصورة','Could not draw markup':'تعذّر رسم التعليق','Could not keep markup between sessions (storage full)':'تعذّر حفظ التعليقات بين الجلسات (التخزين ممتلئ)','Storage is full — remove a saved stamp':'التخزين ممتلئ — احذف ختماً محفوظاً','Could not prepare the pages for printing.':'تعذّر تجهيز الصفحات للطباعة.','Export the markup list to a spreadsheet that opens in Excel.':'تصدير قائمة التعليقات إلى جدول بيانات يُفتح في Excel.','CSV spreadsheet':'جدول CSV','ZIP archive':'أرشيف ZIP',
'Copy':'نسخ','Export':'تصدير','All markup':'كل التعليقات','Notes and callouts':'الملاحظات والتعليقات','Shapes and pen':'الأشكال والقلم','Stamps and signatures':'الأختام والتواقيع','Measure and count':'القياس والعدّ','Notes':'الملاحظات','Sort':'ترتيب','Filter':'تصفية',
'APPROVED AS NOTED':'معتمد مع الملاحظات','APPROVED':'معتمد','REJECTED':'مرفوض','FOR CONSTRUCTION':'للتنفيذ','FOR INFORMATION':'للعلم','DRAFT':'مسودة','VOID':'ملغى','REVISE':'يُعدَّل',
'Scale not set yet':'لم يُضبط المقياس بعد','Colour':'اللون','Changes the selected mark':'يغيّر العلامة المحددة','Size of new marks':'حجم العلامات الجديدة','Size (number) of new marks, or of the selected mark':'الحجم (رقم) للعلامات الجديدة أو للعلامة المحددة','Waiting for your payment… Rasm activates itself when it arrives.':'بانتظار الدفع… سيفعّل Rasm نفسه تلقائياً عند وصوله.','Already have a key? Paste it here (PDFL-…)':'لديك مفتاح؟ الصقه هنا (PDFL-…)','It takes a few seconds and keeps your settings.':'يستغرق ثوانٍ قليلة ولا يؤثر على إعداداتك.','Later':'لاحقاً','Skip this version':'تخطّي هذا الإصدار','Close':'إغلاق','Close (Ctrl+W)':'إغلاق (Ctrl+W)','Open another PDF (Ctrl+O)':'فتح ملف PDF آخر (Ctrl+O)','Open another PDF':'فتح ملف PDF آخر'
};
const ARP=[
 [/^✓ (.+)$/,(m,a)=>'✓ '+(trStr(a)||a)],
 [/^Page (\d+) of (\d+)$/,'صفحة $1 من $2'],
 [/^Page (\d+) rotated · Save copy to keep it in a PDF$/,'تم تدوير الصفحة $1 · استخدم «حفظ باسم» لحفظه في ملف PDF'],
 [/^Back to page (\d+)$/,'العودة إلى الصفحة $1'],
 [/^Reading page (\d+) of (\d+)…$/,'قراءة الصفحة $1 من $2…'],
 [/^Preparing page (\d+) of (\d+)…$/,'تجهيز الصفحة $1 من $2…'],
 [/^Adding image (\d+) of (\d+)…$/,'إضافة الصورة $1 من $2…'],
 [/^Working… page (\d+) of (\d+)$/,'جارٍ العمل… الصفحة $1 من $2'],
 [/^Working… repairing (.+)$/,'جارٍ العمل… إصلاح $1'],
 [/^(\d+) files merged\.$/,'تم دمج $1 ملفات.'],
 [/^(\d+) pages extracted\.$/,'تم استخراج $1 صفحات.'],
 [/^(\d+) images? turned into a PDF\.$/,'تم تحويل $1 صور إلى ملف PDF.'],
 [/^(\d+) pictures? saved in a ZIP file\.$/,'تم حفظ $1 صور في ملف ZIP.'],
 [/^(\d+) pages? updated\.$/,'تم تحديث $1 صفحات.'],
 [/^(\d+) pages? rotated\.$/,'تم تدوير $1 صفحات.'],
 [/^(\d+) pages? deleted\.$/,'تم حذف $1 صفحات.'],
 [/^Read (\d+) pages?, (\d+) words found\.$/,'تمت قراءة $1 صفحات، وعُثر على $2 كلمة.'],
 [/^(\d+) pages already had text\.$/,'$1 صفحات تحتوي نصاً أصلاً.'],
 [/^Press Ctrl\+F to search, or select text with the mouse\.$/,'اضغط Ctrl+F للبحث أو حدّد النص بالفأرة.'],
 [/^The copy has (\d+) searchable words \(English letters and numbers\)\.$/,'تحتوي النسخة على $1 كلمة قابلة للبحث (أحرف إنجليزية وأرقام).'],
 [/^(.+) had an unusual structure, so (its pages were|those pages were) rebuilt as images \(text in them is no longer selectable\)\.$/,'$1 ذو بنية غير معتادة، لذا أُعيد بناء صفحاته كصور (لم يعد النص فيها قابلاً للتحديد).'],
 [/^Nothing to read\. Every page already has searchable text\.$/,'لا شيء للقراءة. كل الصفحات تحتوي نصاً قابلاً للبحث.'],
 [/^Reads the scanned pages of "(.+)" so you can search them \(Ctrl\+F\) and copy text\. It runs on your computer; nothing is uploaded\.$/,'يقرأ الصفحات الممسوحة ضوئياً في «$1» لتبحث فيها (Ctrl+F) وتنسخ النص. يعمل على جهازك ولا يُرفع أي شيء.'],
 [/^Invalid range: (.+)$/,'نطاق غير صالح: $1'],
 [/^Out of range: (.+)$/,'خارج النطاق: $1'],
 [/^Could not open this PDF: (.+)$/,'تعذّر فتح ملف PDF هذا: $1'],
 [/^Could not read (.+)$/,'تعذّرت قراءة $1'],
 [/^Could not rotate: (.+)$/,'تعذّر التدوير: $1'],
 [/^Could not save: (.+)$/,'تعذّر الحفظ: $1'],
 [/^Exported (\d+) items?$/,'تم تصدير $1 عناصر'],
 [/^Copied (\d+) items$/,'تم نسخ $1 عناصر'],
 [/^Version ([\d.]+) is available\.?$/,'الإصدار $1 متاح'],
 [/^Version ([\d.]+)$/,'الإصدار $1'],
 [/^Trial · (\d+) days? left$/,(m,d)=>'تجربة · متبقٍ '+d+(d==1?' يوم':' أيام')],
 [/^(\d+) days? left in your free trial\. Pay once and Rasm activates itself\. No key to type\.$/,'متبقٍ $1 أيام في تجربتك المجانية. ادفع مرة واحدة ويفعّل Rasm نفسه تلقائياً دون إدخال مفتاح.'],
 [/^Your (\d+)-day free trial has ended\. Buy a license: Rasm activates itself after payment\.$/,'انتهت تجربتك المجانية ($1 يوماً). اشترِ ترخيصاً وسيفعّل Rasm نفسه بعد الدفع.'],
 [/^Licensed to (.+) · (valid until .+|lifetime license)\.$/,(m,e,v)=>'مرخّص لـ '+e+' · '+(/^valid until/.test(v)?'صالح حتى'+v.slice(11):'ترخيص دائم')+'.'],
 [/^Your license expired on (.+)\. Renew it, then paste the new key below\.$/,'انتهى ترخيصك في $1. جدّده ثم ألصق المفتاح الجديد أدناه.'],
 [/^p\. (\d+)$/,'ص $1'],
 [/^(\d+) \/ (\d+)$/,'$1 / $2'],
 [/^(\d+) markups?$/,'$1 تعليقات'],
];
let LANG='en';const trMap=new Map(),trEl=new Set();let trObs=null;
function trStr(str){const t=String(str).trim();if(!t)return null;let r=AR[t];
  if(r==null){for(const[re,fn]of ARP){const m=t.match(re);if(m){r=typeof fn==='function'?fn(...m):t.replace(re,fn);break}}}
  return r==null?null:String(str).replace(t,()=>r)}
const trSkip=n=>{const e=n.nodeType===3?n.parentElement:n;return!e||!!e.closest('#viewer,script,style,textarea,.tx,[data-keep]')};
function trText(n){if(LANG!=='ar'||trSkip(n))return;const o=trMap.get(n);if(o&&n.data===o.ar)return;const r=trStr(n.data);if(r!=null&&r!==n.data){trMap.set(n,{en:n.data,ar:r});n.data=r}}
function trAttrs(e){if(LANG!=='ar'||e.nodeType!==1||trSkip(e))return;for(const a of['title','placeholder','aria-label']){const v=e.getAttribute&&e.getAttribute(a);if(!v)continue;const o=e.__en&&e.__en[a];if(o&&v===o.ar)continue;const r=trStr(v);if(r!=null&&r!==v){(e.__en=e.__en||{})[a]={en:v,ar:r};e.setAttribute(a,r);trEl.add(e)}}}
function trTree(root){if(LANG!=='ar')return;if(root.nodeType===3){trText(root);return}if(root.nodeType!==1||trSkip(root))return;trAttrs(root);
  const w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT|NodeFilter.SHOW_ELEMENT);let n;while(n=w.nextNode()){if(n.nodeType===3)trText(n);else if(n.nodeType===1){if(n.id==='viewer'){w.nextSibling();continue}trAttrs(n)}}}
function applyLang(l){
  LANG=l==='ar'?'ar':'en';try{localStorage.pl_lang=LANG}catch(e){}
  document.documentElement.lang=LANG;document.documentElement.dir=LANG==='ar'?'rtl':'ltr';
  if(LANG==='ar'){trTree(document.body);if(!trObs){trObs=new MutationObserver(ms=>{for(const m of ms){if(m.type==='childList')m.addedNodes.forEach(trTree);else if(m.type==='characterData')trText(m.target);else if(m.type==='attributes')trAttrs(m.target)}});trObs.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['title','placeholder']})}}
  else{if(trObs){trObs.disconnect();trObs=null}trMap.forEach((o,n)=>{if(n.isConnected&&n.data===o.ar)n.data=o.en});trMap.clear();trEl.forEach(e=>{for(const a in e.__en||{})if(e.getAttribute(a)===e.__en[a].ar)e.setAttribute(a,e.__en[a].en);e.__en=null});trEl.clear()}
  setTimeout(()=>{try{relayout()}catch(e){}},50)}
try{applyLang(localStorage.pl_lang||((navigator.language||'').toLowerCase().startsWith('ar')?'ar':'en'))}catch(e){}

