/* ═══════════════════════════════════════════════════════════
   NOC Portal — script.js  v4
   ═══════════════════════════════════════════════════════════ */
'use strict';

// ── Config & State ──────────────────────────────────────────
const API_URL = '/api';
let currentUser = null;
let authHeader  = localStorage.getItem('authHeader');
let isProcessing = false;
let appData = { users:[], updates:[], categories:[], infoCards:[], learningItems:[], folders:[] };

// Learning state
let currentFolderId     = null;
let currentInfoCategory = null;
let contextItem         = null;
let searchDebounceTimer = null;

// Sticky notes (D1-backed)
let stickyNotes = [];

// ── Role helpers ────────────────────────────────────────────
const ROLE_RANK  = { admin:4, leader:3, member:2, intern:1 };
const myRank     = () => ROLE_RANK[currentUser?.role] ?? 1;
const isAdmin    = () => currentUser?.role === 'admin';
const isLeader   = () => myRank() >= ROLE_RANK.leader;  // leader+
const canSee     = (perm) => myRank() >= (ROLE_RANK[perm] ?? 1);
const canManageInfo = () => myRank() >= ROLE_RANK.leader; // leader+ can manage info cards

// ── Spin keyframe ───────────────────────────────────────────
(()=>{
  if(!document.getElementById('_kf')){
    const s=document.createElement('style');s.id='_kf';
    s.textContent='@keyframes spin{to{transform:rotate(360deg)}}';
    document.head.appendChild(s);
  }
})();

/* ══════════════════════════════════════════════════════════
   LOADING
══════════════════════════════════════════════════════════ */
function showLoading(prog=false){
  const ex=document.getElementById('loadingOverlay');if(ex)ex.remove();
  const o=document.createElement('div');o.id='loadingOverlay';
  o.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.6);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;z-index:9999;';
  if(prog){
    o.innerHTML=`<div style="background:var(--surface);border-radius:14px;padding:2rem;box-shadow:0 16px 40px rgba(0,0,0,.3);display:flex;flex-direction:column;align-items:center;gap:1rem;min-width:260px;max-width:90vw;">
      <div style="width:52px;height:52px;border:4px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:spin .8s linear infinite;"></div>
      <div style="text-align:center;"><p style="font-weight:700;color:var(--text);margin-bottom:.2rem;">Please wait...</p><p style="color:var(--text2);font-size:.82rem;" id="loadingStatus">Loading</p></div>
      <div style="width:100%;background:var(--border);border-radius:50px;height:6px;overflow:hidden;"><div id="progressBar" style="background:var(--accent);height:6px;border-radius:50px;transition:width .3s;width:0%;"></div></div>
      <p style="color:var(--text3);font-size:.72rem;" id="progressPercent">0%</p></div>`;
  } else {
    o.innerHTML=`<div style="background:var(--surface);border-radius:14px;padding:2rem;box-shadow:0 16px 40px rgba(0,0,0,.3);display:flex;flex-direction:column;align-items:center;gap:.9rem;">
      <div style="width:52px;height:52px;border:4px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:spin .8s linear infinite;"></div>
      <p style="font-weight:700;color:var(--text);">Please wait...</p></div>`;
  }
  document.body.appendChild(o);
}
function updateProgress(pct,status=''){
  const b=el('progressBar'),p=el('progressPercent'),s=el('loadingStatus');
  if(b)b.style.width=`${pct}%`;if(p)p.textContent=`${Math.round(pct)}%`;if(s&&status)s.textContent=status;
}
function hideLoading(){
  const o=el('loadingOverlay');
  if(o){o.classList.add('animate-fadeOut');setTimeout(()=>o.remove(),200);}
}

/* ══════════════════════════════════════════════════════════
   TOAST
══════════════════════════════════════════════════════════ */
function showToast(msg,type='error'){
  const c=el('toastContainer');
  const t=document.createElement('div');t.className='toast';
  t.style.background=type==='error'?'#ef4444':type==='info'?'var(--accent)':'#10b981';
  const icon=type==='error'?'fa-exclamation-circle':type==='info'?'fa-info-circle':'fa-check-circle';
  t.innerHTML=`<i class="fas ${icon}"></i><span>${escHtml(msg)}</span>`;
  c.appendChild(t);setTimeout(()=>t.remove(),3100);
}

/* ══════════════════════════════════════════════════════════
   API
══════════════════════════════════════════════════════════ */
const getHeaders = ()=>({'Authorization':authHeader||'','Content-Type':'application/json'});

async function fetchAPI(endpoint,opts={}){
  try{
    const res=await fetch(`${API_URL}/${endpoint}`,{...opts,headers:{...getHeaders(),...(opts.headers||{})}});
    if(res.status===401){if(!opts.silentFail)logout();return null;}
    if(!res.ok){
      const data=await res.json().catch(()=>({}));
      throw new Error(data.error||`HTTP ${res.status}`);
    }
    return res.json();
  }catch(e){
    console.error(e);
    if(!opts.silentFail)showToast('Error: '+e.message);
    return null;
  }
}

async function refreshData(silent=false){
  if(!silent)showLoading();
  const data=await fetchAPI('getData',{silentFail:silent});
  if(data){
    appData=data;
    if(!el('homePage').classList.contains('hidden'))renderUpdates();
    if(!el('learningPage').classList.contains('hidden'))renderLearning();
    if(!el('informationPage').classList.contains('hidden')&&currentInfoCategory)renderInfoCards();
    if(!el('adminPage').classList.contains('hidden')&&isAdmin()){renderUsers();}
    renderMobileInfoMenu();renderInfoDropdown();
  }
  if(!silent)hideLoading();
  return data;
}

/* ══════════════════════════════════════════════════════════
   AUTH / LOGIN
══════════════════════════════════════════════════════════ */
el('togglePassword').addEventListener('click',function(){
  const p=el('password'),i=this.querySelector('i');
  p.type=p.type==='password'?'text':'password';
  i.classList.toggle('fa-eye',p.type==='password');
  i.classList.toggle('fa-eye-slash',p.type==='text');
});

el('loginForm').addEventListener('submit',async function(e){
  e.preventDefault();
  if(isProcessing)return;isProcessing=true;
  const u=el('username').value.trim(),p=el('password').value;
  const btn=el('loginBtn'),box=el('loginBox');
  btn.innerHTML='<i class="fas fa-spinner fa-spin"></i> Please wait...';btn.disabled=true;
  const tempAuth='Basic '+btoa(u+':'+p);
  try{
    const res=await fetch(`${API_URL}/login`,{method:'POST',headers:{'Authorization':tempAuth}});
    if(res.ok){
      const data=await res.json();
      authHeader=tempAuth;localStorage.setItem('authHeader',authHeader);
      currentUser=data.user;
      showLoading(true);updateProgress(10,'Authenticating...');await delay(200);
      updateProgress(30,'Loading data...');
      const d=await fetchAPI('getData');
      updateProgress(70,'Preparing...');await delay(200);
      if(d){
        appData=d;
        // Prefer currentUser from getData (works for all roles, not just admin)
        if(d.currentUser){
          currentUser={...currentUser,...d.currentUser};
        }
        currentUser.accountName=currentUser.accountName||currentUser.account_name||
          d.users.find(x=>x.username===u)?.accountName||
          d.users.find(x=>x.username===u)?.account_name||u;
        updateProgress(90,'Almost done...');await delay(200);
        doShowApp();
        updateProgress(100,'Done!');await delay(300);hideLoading();
      }else throw new Error('Failed to load data');
    }else throw new Error('Invalid credentials');
  }catch(err){
    hideLoading();box.classList.add('shake');showToast('Wrong username or password!');
    setTimeout(()=>box.classList.remove('shake'),500);
  }
  btn.innerHTML='<span>Sign In</span><i class="fas fa-arrow-right"></i>';
  btn.disabled=false;isProcessing=false;
});

function doShowApp(){
  el('loginPage').classList.add('hidden');
  el('mainApp').classList.remove('hidden');
  // Show name only — no role badge anywhere on the page
  const wu=el('welcomeUser');if(wu)wu.textContent=currentUser.accountName;
  updateAdminUI();renderMobileInfoMenu();renderInfoDropdown();
  navigateTo('home');
  startPolling(); // begin real-time background polling
}

function updateAdminUI(){
  // Admin-only elements
  ['adminBtn','mobileAdminBtn'].forEach(id=>{
    const e=el(id);if(e)isAdmin()?e.classList.remove('hidden'):e.classList.add('hidden');
  });
  // All roles can add updates — button always visible after login
  // (handled in HTML — no hidden class)

  // Info card add button — leader+
  const addInfo=el('addInfoCardBtn');
  if(addInfo) canManageInfo()?addInfo.classList.remove('hidden'):addInfo.classList.add('hidden');

  // Learning admin buttons — admin only
  const lrn=el('learningAdminBtns');
  if(lrn) isAdmin()?lrn.classList.remove('hidden'):lrn.classList.add('hidden');
}

function delay(ms){return new Promise(r=>setTimeout(r,ms));}
async function simulateProgress(pct,status){updateProgress(pct,status);await delay(200);}

function showLoginPage(){
  el('mainApp').classList.add('hidden');el('loginPage').classList.remove('hidden');
  el('username').value='';el('password').value='';
}
function logout(){
  stopPolling(); // stop background polling on sign-out
  localStorage.removeItem('authHeader');authHeader=null;currentUser=null;
  document.querySelectorAll('.modal-bd').forEach(m=>m.classList.add('hidden'));
  showLoginPage();closeMobileMenu();
}

async function initApp(){
  loadPreferences();
  if(!authHeader){showLoginPage();return;}
  showLoading(true);updateProgress(10,'Initializing...');await delay(200);
  updateProgress(25,'Checking auth...');
  const data=await fetchAPI('getData',{silentFail:true});
  updateProgress(60,'Loading...');await delay(200);
  if(!data){hideLoading();showLoginPage();return;}
  updateProgress(80,'Preparing...');await delay(150);
  appData=data;
  if(!currentUser){
    // Prefer currentUser returned by getData (available for ALL roles)
    if(data.currentUser){
      currentUser=data.currentUser;
      currentUser.accountName=currentUser.accountName||currentUser.account_name||currentUser.username;
    } else {
      // Fallback: search users list (only populated for admin)
      const creds=atob(authHeader.split(' ')[1]).split(':'),uname=creds[0];
      const found=appData.users.find(u=>u.username===uname);
      currentUser=found
        ?{...found,accountName:found.accountName||found.account_name||uname}
        :{accountName:uname,role:'intern'};
    }
  }
  updateProgress(95,'Almost ready...');await delay(150);
  el('loginPage').classList.add('hidden');el('mainApp').classList.remove('hidden');
  doShowApp();updateProgress(100,'Done!');await delay(300);hideLoading();
}

/* ══════════════════════════════════════════════════════════
   MOBILE MENU
══════════════════════════════════════════════════════════ */
function openMobileMenu(){
  el('mobileMenu').classList.remove('hidden');el('mobileOverlay').classList.remove('hidden');
  setTimeout(()=>el('mobileMenu').classList.add('show'),10);
  renderMobileInfoMenu();
}
function closeMobileMenu(){
  el('mobileMenu').classList.remove('show');
  setTimeout(()=>{el('mobileMenu').classList.add('hidden');el('mobileOverlay').classList.add('hidden');},280);
}

function renderMobileInfoMenu(){
  const container=el('mobileInfoMenu');
  if(!container) return;
  const cats=appData.categories.filter(c=>canSee(c.min_role_required||'intern'));
  container.innerHTML=cats.map(cat=>`
    <button onclick="showInfoCategory(${cat.id},'${escAttr(cat.name)}');closeMobileMenu();" class="mob-nbtn mob-nbtn--sub">
      <i class="fas ${cat.icon}"></i> ${escHtml(cat.name)}
    </button>`).join('');
}

/* ══════════════════════════════════════════════════════════
   NAVIGATION
══════════════════════════════════════════════════════════ */
function navigateTo(page){
  document.querySelectorAll('.page').forEach(p=>p.classList.add('hidden'));
  document.querySelectorAll('.nav-btn,[data-page]').forEach(b=>b.classList.remove('active'));
  if(page==='home'){
    el('homePage').classList.remove('hidden');renderUpdates();
  } else if(page==='learning'){
    el('learningPage').classList.remove('hidden');
    currentFolderId=null;
    if(el('learningSearch'))el('learningSearch').value='';
    if(el('clearSearch'))el('clearSearch').classList.add('hidden');
    if(el('searchResults'))el('searchResults').classList.add('hidden');
    if(el('learningContainer'))el('learningContainer').classList.remove('hidden');
    renderLearning();
  } else if(page==='admin'){
    if(!isAdmin())return;el('adminPage').classList.remove('hidden');showAdminTab('users');
  }
  document.querySelectorAll(`[data-page="${page}"]`).forEach(b=>b.classList.add('active'));
}

// Information dropdown — categories list + "Categories Setting" at bottom for admin
function toggleInfoDropdown(){
  const d=el('infoDropdown');
  if(!d) return;
  d.classList.toggle('hidden');
  if(!d.classList.contains('hidden')) renderInfoDropdown();
}
function renderInfoDropdown(){
  const d=el('infoDropdown');
  if(!d) return;
  const cats=appData.categories.filter(c=>canSee(c.min_role_required||'intern'));
  let html=cats.map(cat=>`
    <button onclick="showInfoCategory(${cat.id},'${escAttr(cat.name)}')" class="dd-item">
      <i class="fas ${cat.icon}"></i> ${escHtml(cat.name)}
    </button>`).join('');
  if(!cats.length) html='<div class="dd-empty">No categories yet</div>';
  // "Categories Setting" separator + button — admin only
  if(isAdmin()){
    html+=`<div class="dd-sep"></div>
      <button onclick="el('infoDropdown').classList.add('hidden');openCategoryManagerModal()" class="dd-item dd-item--setting">
        <i class="fas fa-cog"></i> Categories Setting
      </button>`;
  }
  d.innerHTML=html;
}

/* ── Information Category Picker Modal ──────────────────── */
function openInfoCategoryPicker(){
  renderCategoryPickerList();
  el('infoCategoryPickerModal').classList.remove('hidden');
  // Show manage button for admin
  const mb=el('manageCatsBtn');
  if(mb) isAdmin()?mb.classList.remove('hidden'):mb.classList.add('hidden');
}

function renderCategoryPickerList(){
  const list=el('categoryPickerList');
  const cats=appData.categories.filter(c=>canSee(c.min_role_required||'intern'));
  if(!cats.length){
    list.innerHTML='<div class="empty-state" style="padding:1.5rem"><i class="fas fa-tags"></i><p>No categories yet</p></div>';
    return;
  }
  list.innerHTML=cats.map(cat=>`
    <button onclick="pickCategory(${cat.id},'${escAttr(cat.name)}')" class="cat-pick-btn">
      <div class="cat-pick-icon"><i class="fas ${cat.icon}"></i></div>
      <span class="cat-pick-name">${escHtml(cat.name)}</span>
      <i class="fas fa-chevron-right cat-pick-arrow"></i>
    </button>`).join('');
}

function pickCategory(catId,catName){
  closeModal('infoCategoryPickerModal');
  showInfoCategory(catId,catName);
}

// Close dropdown when clicking outside
document.addEventListener('click',e=>{
  const dd=el('infoDropdown');
  const btn=document.querySelector('[data-page="information"]');
  if(dd&&btn&&!dd.contains(e.target)&&!btn.contains(e.target))dd.classList.add('hidden');
});

function showInfoCategory(catId,catName){
  currentInfoCategory=catId;
  if(el('infoDropdown'))el('infoDropdown').classList.add('hidden');
  document.querySelectorAll('.page').forEach(p=>p.classList.add('hidden'));
  el('informationPage').classList.remove('hidden');
  el('infoTitleText').textContent=catName;
  if(canManageInfo())el('addInfoCardBtn').classList.remove('hidden');
  else el('addInfoCardBtn').classList.add('hidden');
  renderInfoCards();
}
document.addEventListener('click',e=>{
  const dd=el('infoDropdown'),btn=document.querySelector('[data-page="information"]');
  if(btn&&dd&&!dd.contains(e.target)&&!btn.contains(e.target))dd.classList.add('hidden');
});

/* ══════════════════════════════════════════════════════════
   GENERIC API WRAPPERS (legacy saveToApi / deleteFromApi for admin CRUD)
══════════════════════════════════════════════════════════ */
async function saveToApi(table,data){
  if(isProcessing){showToast('Please wait…','info');return false;}
  isProcessing=true;showLoading(true);updateProgress(20,'Saving...');
  try{
    await fetchAPI('',{method:'POST',body:JSON.stringify({action:'save',table,data})});
    updateProgress(50,'Refreshing...');await refreshData(true);
    updateProgress(100,'Saved!');await delay(300);hideLoading();
    showToast('Saved successfully!','success');isProcessing=false;return true;
  }catch(e){hideLoading();showToast('Save failed: '+e.message);isProcessing=false;return false;}
}
async function deleteFromApi(table,id){
  if(isProcessing){showToast('Please wait…','info');return false;}
  isProcessing=true;showLoading(true);updateProgress(20,'Deleting...');
  try{
    await fetchAPI('',{method:'POST',body:JSON.stringify({action:'delete',table,id})});
    updateProgress(50,'Refreshing...');await refreshData(true);
    updateProgress(100,'Deleted!');await delay(300);hideLoading();
    showToast('Deleted!','success');isProcessing=false;return true;
  }catch(e){hideLoading();showToast('Delete failed: '+e.message);isProcessing=false;return false;}
}

/* ══════════════════════════════════════════════════════════
   UPDATES — all roles can create; delete = own only (admin = any)
══════════════════════════════════════════════════════════ */
function renderUpdates(){
  const bmap={important:'b-important',general:'b-general',announcement:'b-announcement',reminder:'b-reminder'};
  const bicon={important:'🔴',general:'🔵',announcement:'🟢',reminder:'🟡'};
  el('updatesContainer').innerHTML=appData.updates.map(u=>{
    return `<div class="upd-card upd-card--fixed" onclick="openUpdateView(${u.id})" title="Click to read">
      <div class="upd-hdr">
        <h3 class="upd-topic">${escHtml(u.topic)}</h3>
        <span class="badge ${bmap[u.badge]||'b-general'}">${bicon[u.badge]||''} ${escHtml(u.badge)}</span>
      </div>
      <div class="upd-body upd-body--clamp card-link">${linkify(escHtml(u.message))}</div>
      <div class="upd-foot">
        <span><i class="fas fa-user-circle"></i> ${escHtml(u.author||'')}</span>
        <span><i class="fas fa-calendar"></i> ${escHtml(fmtDate(u.date))}</span>
        <span class="upd-read-more">Click to read <i class="fas fa-arrow-right"></i></span>
      </div>
    </div>`;
  }).join('')||'<div class="empty-state"><i class="fas fa-inbox"></i><p>No updates yet</p></div>';
}

function openUpdateView(id){
  const u=appData.updates.find(x=>x.id===id);if(!u)return;
  const bmap={important:'b-important',general:'b-general',announcement:'b-announcement',reminder:'b-reminder'};
  const bicon={important:'🔴',general:'🔵',announcement:'🟢',reminder:'🟡'};
  el('updateViewTitle').textContent=u.topic;
  el('updateViewMeta').innerHTML=`
    <span class="badge ${bmap[u.badge]||'b-general'}">${bicon[u.badge]||''} ${escHtml(u.badge)}</span>
    <span><i class="fas fa-user-circle"></i> ${escHtml(u.author||'')}</span>
    <span><i class="fas fa-calendar"></i> ${escHtml(fmtDate(u.date))}</span>`;
  el('updateViewBody').innerHTML=linkify(escHtml(u.message));

  // Edit/Delete actions for owner or admin
  const canEdit  =isAdmin()||u.created_by===currentUser?.id;
  const canDelete=isAdmin()||u.created_by===currentUser?.id;
  el('updateViewActions').innerHTML=`
    <button onclick="closeModal('updateViewModal')" class="btn-secondary">Close</button>
    ${canEdit  ?`<button onclick="closeModal('updateViewModal');editUpdate(${u.id})" class="btn-secondary"><i class="fas fa-edit"></i> Edit</button>`:''}
    ${canDelete?`<button onclick="closeModal('updateViewModal');deleteUpdate(${u.id})" class="btn-secondary" style="color:#ef4444;border-color:#fecaca"><i class="fas fa-trash"></i> Delete</button>`:''}`;

  el('updateViewModal').classList.remove('hidden');
}
function linkify(t){return t.replace(/(https?:\/\/[^\s<]+)/g,'<a href="$1" target="_blank" rel="noopener">$1</a>').replace(/\n/g,'<br>');}

// Format YYYY-MM-DD stored date into readable MMT local date
// e.g. "2025-06-28" → "28 Jun 2025"
function fmtDate(d){
  if(!d) return '';
  const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const parts=d.split('-');
  if(parts.length!==3) return d;
  const y=parseInt(parts[0]),m=parseInt(parts[1])-1,day=parseInt(parts[2]);
  if(isNaN(y)||isNaN(m)||isNaN(day)) return d;
  return day+' '+months[m]+' '+y;
}

function openUpdateModal(id=null){
  // All roles can open the create modal
  el('updateModal').classList.remove('hidden');
  el('updateModalTitle').textContent=id?'Edit Update':'Add Update';
  el('updateId').value=id||'';
  if(id){const u=appData.updates.find(x=>x.id===id);el('updateTopic').value=u.topic;el('updateBadge').value=u.badge;el('updateMessage').value=u.message;}
  else el('updateForm').reset();
}

async function saveUpdate(){
  const id=el('updateId').value;
  const topic=el('updateTopic').value.trim();
  const badge=el('updateBadge').value;
  const message=el('updateMessage').value.trim();
  if(!topic||!message)return showToast('Topic and message are required','error');

  if(isProcessing){showToast('Please wait…','info');return;}
  isProcessing=true;showLoading(true);updateProgress(20,'Saving...');

  try{
    let res;
    if(id){
      // Edit — PUT to new endpoint
      res=await fetch(`${API_URL}/updates/${id}`,{
        method:'PUT',headers:getHeaders(),body:JSON.stringify({topic,badge,message})
      });
    } else {
      // Create — POST to new endpoint (all roles)
      res=await fetch(`${API_URL}/updates`,{
        method:'POST',headers:getHeaders(),body:JSON.stringify({topic,badge,message})
      });
    }
    const data=await res.json().catch(()=>({}));
    if(!res.ok)throw new Error(data.error||`HTTP ${res.status}`);
    updateProgress(60,'Refreshing...');await refreshData(true);
    updateProgress(100,'Saved!');await delay(300);hideLoading();
    showToast('Update saved!','success');
    closeModal('updateModal');
  }catch(e){
    hideLoading();showToast('Failed: '+e.message);
  }
  isProcessing=false;
}

function editUpdate(id){
  const u=appData.updates.find(x=>x.id===id);if(!u)return;
  if(!isAdmin()&&u.created_by!==currentUser?.id)return showToast('You can only edit your own updates','error');
  openUpdateModal(id);
}

async function deleteUpdate(id){
  const u=appData.updates.find(x=>x.id===id);if(!u)return;
  if(!isAdmin()&&u.created_by!==currentUser?.id)return showToast('You can only delete your own updates','error');
  if(!confirm('Delete this update?'))return;
  if(isProcessing){showToast('Please wait…','info');return;}
  isProcessing=true;showLoading(true);updateProgress(20,'Deleting...');
  try{
    const res=await fetch(`${API_URL}/updates/${id}`,{method:'DELETE',headers:getHeaders()});
    const data=await res.json().catch(()=>({}));
    if(!res.ok)throw new Error(data.error||`HTTP ${res.status}`);
    updateProgress(60,'Refreshing...');await refreshData(true);
    updateProgress(100,'Deleted!');await delay(300);hideLoading();
    showToast('Deleted!','success');
  }catch(e){hideLoading();showToast('Failed: '+e.message);}
  isProcessing=false;
}

/* ══════════════════════════════════════════════════════════
   LEARNING — Search
══════════════════════════════════════════════════════════ */
el('learningSearch').addEventListener('input',function(){
  const q=this.value.trim();
  el('clearSearch').classList.toggle('hidden',!q);
  clearTimeout(searchDebounceTimer);
  if(!q){clearLearningSearch();return;}
  searchDebounceTimer=setTimeout(()=>doLearningSearch(q),280);
});

function clearLearningSearch(){
  if(el('learningSearch'))el('learningSearch').value='';
  if(el('clearSearch'))el('clearSearch').classList.add('hidden');
  if(el('searchResults'))el('searchResults').classList.add('hidden');
  if(el('learningContainer'))el('learningContainer').classList.remove('hidden');
  renderLearning();
}

function doLearningSearch(q){
  const ql=q.toLowerCase();

  // Folders: match name, user must be able to see them
  const matchFolders=appData.folders.filter(f=>
    canSee(f.min_role_required||'intern') &&
    f.name.toLowerCase().includes(ql)
  );

  // Items: match topic or content; item AND its parent folder must be accessible
  const matchItems=appData.learningItems.filter(i=>{
    if(!canSee(i.min_role_required||'intern')) return false;
    const pf=appData.folders.find(f=>f.id===i.folderId);
    if(pf && !canSee(pf.min_role_required||'intern')) return false;
    return i.topic.toLowerCase().includes(ql)||(i.content||'').toLowerCase().includes(ql);
  });

  el('searchResults').classList.remove('hidden');
  el('learningContainer').classList.add('hidden');
  el('searchQuery').textContent=`"${q}"`;

  const grid=el('searchResultsGrid');
  if(!matchFolders.length&&!matchItems.length){
    grid.innerHTML='<div class="empty-state"><i class="fas fa-search"></i><p>No results found</p></div>';
    return;
  }

  // Render using the same card builders — clicks work identically to normal view
  // Folders: clicking navigates into the folder (clears search, shows folder contents)
  // Items: clicking opens PDF or text view
  grid.innerHTML=
    matchFolders.map(f=>makeFolderCard(f)).join('')+
    matchItems.map(i=>makeItemCard(i)).join('');

  // Attach long-press for admin on mobile (same as renderLearning does)
  if(isAdmin()){
    grid.querySelectorAll('.file-card').forEach(card=>{
      const kind=card.dataset.kind, id=parseInt(card.dataset.id);
      if(!kind||!id) return;
      card.addEventListener('touchstart',e=>{
        lrnLongPressTimer=setTimeout(()=>{
          if(navigator.vibrate)navigator.vibrate(50);
          const touch=e.touches[0];
          showCtx({clientX:touch.clientX,clientY:touch.clientY,
                   preventDefault:()=>{},stopPropagation:()=>{}},kind,id);
        },500);
      },{passive:true});
      card.addEventListener('touchend', ()=>clearTimeout(lrnLongPressTimer));
      card.addEventListener('touchmove',()=>clearTimeout(lrnLongPressTimer));
    });
  }
}

/* ══════════════════════════════════════════════════════════
   LEARNING — Render
══════════════════════════════════════════════════════════ */
let lrnLongPressTimer=null, lrnLongPressKind=null, lrnLongPressId=null;

function renderLearning(){
  renderBreadcrumb();
  const folders=appData.folders
    .filter(f=>(f.parentId===currentFolderId)&&canSee(f.min_role_required||'intern'))
    .sort((a,b)=>a.name.localeCompare(b.name));
  const items=appData.learningItems
    .filter(i=>{
      if(i.folderId!==currentFolderId)return false;
      if(!canSee(i.min_role_required||'intern'))return false;
      const pf=appData.folders.find(f=>f.id===i.folderId);
      if(pf&&!canSee(pf.min_role_required||'intern'))return false;
      return true;
    })
    .sort((a,b)=>a.topic.localeCompare(b.topic));
  const html=folders.map(f=>makeFolderCard(f)).join('')+items.map(i=>makeItemCard(i)).join('');
  el('learningContainer').innerHTML=html||'<div class="empty-state"><i class="fas fa-folder-open"></i><p>Empty folder</p></div>';

  // Attach long-press for mobile on learning cards (admin only)
  if(isAdmin()){
    el('learningContainer').querySelectorAll('.file-card').forEach(card=>{
      const kind=card.dataset.kind, id=parseInt(card.dataset.id);
      if(!kind||!id)return;
      card.addEventListener('touchstart',e=>{
        lrnLongPressTimer=setTimeout(()=>{
          lrnLongPressKind=kind;lrnLongPressId=id;
          if(navigator.vibrate)navigator.vibrate(50);
          const touch=e.touches[0];
          const fakeE={clientX:touch.clientX,clientY:touch.clientY,preventDefault:()=>{},stopPropagation:()=>{}};
          showCtx(fakeE,kind,id);
        },500);
      },{passive:true});
      card.addEventListener('touchend',()=>clearTimeout(lrnLongPressTimer));
      card.addEventListener('touchmove',()=>clearTimeout(lrnLongPressTimer));
    });
  }
}

function makeFolderCard(f){
  const perm=f.min_role_required||'intern';
  const permTag=isAdmin()?`<span class="fc-perm perm-${perm}">${perm}</span>`:'';
  // No hover icons — right-click (desktop) / long-press (mobile) only
  return `<div class="file-card" data-kind="folder" data-id="${f.id}" onclick="openFolder(${f.id})"
    ${isAdmin()?`oncontextmenu="showCtx(event,'folder',${f.id});return false;"`:''}>
    <div class="fi fi-folder"><i class="fas fa-folder"></i></div>
    <span class="fc-name">${escHtml(f.name)}</span>
    ${permTag}
  </div>`;
}

function makeItemCard(i){
  const isPdf=i.type==='pdf';
  const perm=i.min_role_required||'intern';
  const fiCls=isPdf?'fi-pdf':'fi-txt';
  const faIcon=isPdf?'fa-file-pdf':'fa-file-alt';
  const permTag=isAdmin()?`<span class="fc-perm perm-${perm}">${perm}</span>`:'';
  // No hover icons — right-click (desktop) / long-press (mobile) only
  return `<div class="file-card" data-kind="item" data-id="${i.id}" onclick="openLearningItem(${i.id})"
    ${isAdmin()?`oncontextmenu="showCtx(event,'item',${i.id});return false;"`:''}>
    <div class="fi ${fiCls}"><i class="fas ${faIcon}"></i></div>
    <span class="fc-name">${escHtml(i.topic)}</span>
    ${permTag}
  </div>`;
}

function renderBreadcrumb(){
  const bc=el('breadcrumb');if(!bc)return;
  let path=[],fid=currentFolderId;
  while(fid){const f=appData.folders.find(x=>x.id===fid);if(f){path.unshift(f);fid=f.parentId;}else break;}
  let h=`<button onclick="currentFolderId=null;clearLearningSearch();renderLearning();" class="bc-btn"><i class="fas fa-home"></i> Root</button>`;
  path.forEach(f=>{h+=`<span class="bc-sep">›</span><button onclick="currentFolderId=${f.id};clearLearningSearch();renderLearning();" class="bc-btn">${escHtml(f.name)}</button>`;});
  bc.innerHTML=h;
}

function openFolder(id){currentFolderId=id;clearLearningSearch();renderLearning();}

function openLearningItem(id){
  const item=appData.learningItems.find(i=>i.id===id);if(!item)return;
  if(item.type==='pdf'){window.open(item.link,'_blank');}
  else{el('textViewTitle').textContent=item.topic;el('textViewContent').textContent=item.content;el('textViewModal').classList.remove('hidden');}
}

/* Context menu */
function showCtx(e,kind,id){
  if(!isAdmin())return;e.preventDefault();e.stopPropagation();
  contextItem={kind,id};
  const m=el('contextMenu');m.classList.remove('hidden');
  m.style.left=Math.min(e.clientX,window.innerWidth-170)+'px';
  m.style.top=Math.min(e.clientY,window.innerHeight-160)+'px';
}
document.addEventListener('click',()=>el('contextMenu').classList.add('hidden'));
function ctxEdit(){el('contextMenu').classList.add('hidden');if(contextItem)openEditItem(contextItem.kind,contextItem.id);}
function ctxMove(){el('contextMenu').classList.add('hidden');if(contextItem)openMoveItem(contextItem.kind,contextItem.id);}
function ctxDelete(){el('contextMenu').classList.add('hidden');if(contextItem)ctxDeleteDirect(contextItem.kind==='folder'?'folders':'learning_items',contextItem.id);}
async function ctxDeleteDirect(table,id){if(confirm('Delete this item?'))await deleteFromApi(table,id);}

/* Edit */
function openEditItem(kind,id){
  const isFolder=kind==='folder';
  const obj=isFolder?appData.folders.find(f=>f.id===id):appData.learningItems.find(i=>i.id===id);
  if(!obj)return;
  el('editItemTitle').textContent=isFolder?'Edit Folder':'Edit Item';
  el('editItemId').value=id;el('editItemKind').value=kind;
  el('editItemName').value=isFolder?obj.name:obj.topic;
  setRadio('editPerm',obj.min_role_required||'intern');
  el('editItemTypeGroup').classList.toggle('hidden',isFolder);
  el('editItemLinkGroup').classList.add('hidden');
  el('editItemContentGroup').classList.add('hidden');
  if(!isFolder){
    el('editItemType').value=obj.type||'pdf';onEditItemTypeChange();
    if(obj.type==='pdf')el('editItemLink').value=obj.link||'';
    else el('editItemContent').value=obj.content||'';
  }
  el('editItemModal').classList.remove('hidden');
}
function onEditItemTypeChange(){
  const t=el('editItemType').value;
  el('editItemLinkGroup').classList.toggle('hidden',t!=='pdf');
  el('editItemContentGroup').classList.toggle('hidden',t!=='text');
}
async function saveEditItem(){
  const kind=el('editItemKind').value,id=parseInt(el('editItemId').value);
  const name=el('editItemName').value.trim(),perm=getRadio('editPerm');
  if(!name)return showToast('Name is required','error');
  if(kind==='folder'){
    const orig=appData.folders.find(f=>f.id===id);
    if(await saveToApi('folders',{...orig,id,name,min_role_required:perm}))closeModal('editItemModal');
  } else {
    const orig=appData.learningItems.find(i=>i.id===id);
    const type=el('editItemType').value;
    if(await saveToApi('learning_items',{...orig,id,topic:name,type,min_role_required:perm,
      link:type==='pdf'?el('editItemLink').value:null,
      content:type==='text'?el('editItemContent').value:null}))closeModal('editItemModal');
  }
}

/* Move */
/* ── Move — tree navigator state ───────────────── */
let moveKind    = null;   // 'folder' | 'item'
let moveItemId  = null;   // id of the thing being moved
let moveCurFolder = null; // null = root; number = current folder id in the tree
let movePathStack = [];   // [{id, name}, ...] breadcrumb stack

function openMoveItem(kind, id){
  moveKind      = kind;
  moveItemId    = id;
  moveCurFolder = null;   // always start at root
  movePathStack = [];
  renderMoveTree();
  el('moveModal').classList.remove('hidden');
}

function isChildFolder(targetId, parentId){
  let cur = targetId;
  while(cur){
    const f = appData.folders.find(x => x.id === cur);
    if(!f) break;
    if(f.parentId === parentId) return true;
    cur = f.parentId;
  }
  return false;
}

function renderMoveTree(){
  // ── Breadcrumb ─────────────────────────────────
  const bc = el('moveBreadcrumb');
  let bcHtml = `<button class="move-bc-btn" onclick="moveNavTo(null)"><i class="fas fa-home"></i> Root</button>`;
  movePathStack.forEach((seg, i) => {
    bcHtml += `<span class="move-bc-sep">›</span>
      <button class="move-bc-btn" onclick="moveNavTo(${seg.id},${i})">${escHtml(seg.name)}</button>`;
  });
  bc.innerHTML = bcHtml;

  // ── Current destination label on the button ────
  const btn = el('moveHereBtn');
  if(btn){
    const label = moveCurFolder === null ? 'Root'
      : (movePathStack[movePathStack.length-1]?.name || 'Here');
    btn.innerHTML = `<i class="fas fa-check"></i> Move into "${escHtml(label)}"`;
  }

  // ── Folder list for this level ─────────────────
  // All direct children of moveCurFolder, excluding:
  //  - the item itself (if it's a folder)
  //  - any descendant of the item (if it's a folder — can't move into own child)
  const children = appData.folders.filter(f => {
    const parent = f.parentId ?? null;
    if(parent !== moveCurFolder) return false;          // not in this level
    if(!canSee(f.min_role_required || 'intern')) return false; // no permission
    if(moveKind === 'folder' && f.id === moveItemId) return false;  // self
    if(moveKind === 'folder' && isChildFolder(f.id, moveItemId)) return false; // descendant
    return true;
  }).sort((a,b) => a.name.localeCompare(b.name));

  let listHtml = '';

  // "Go up" button — show if we're inside a folder
  if(moveCurFolder !== null){
    const parentId = movePathStack.length >= 2
      ? movePathStack[movePathStack.length - 2].id
      : null;
    listHtml += `<button class="move-row move-row--up" onclick="moveNavUp()">
      <i class="fas fa-level-up-alt"></i> <span>.. (go up)</span>
    </button>`;
  }

  if(children.length === 0 && moveCurFolder === null){
    listHtml += `<div class="move-empty"><i class="fas fa-folder-open"></i> No folders at root</div>`;
  } else if(children.length === 0){
    listHtml += `<div class="move-empty"><i class="fas fa-folder-open"></i> No sub-folders here</div>`;
  }

  children.forEach(f => {
    // Check if this folder has any accessible sub-folders (show chevron if yes)
    const hasSubs = appData.folders.some(sub => {
      const p = sub.parentId ?? null;
      return p === f.id && canSee(sub.min_role_required || 'intern')
        && !(moveKind === 'folder' && sub.id === moveItemId)
        && !(moveKind === 'folder' && isChildFolder(sub.id, moveItemId));
    });
    listHtml += `<div class="move-row">
      <div class="move-row-left" onclick="moveNavInto(${f.id},'${escAttr(f.name)}')">
        <i class="fas fa-folder move-folder-icon"></i>
        <span class="move-folder-name">${escHtml(f.name)}</span>
      </div>
      ${hasSubs
        ? `<button class="move-row-open" onclick="moveNavInto(${f.id},'${escAttr(f.name)}')" title="Open folder">
            <i class="fas fa-chevron-right"></i>
           </button>`
        : `<div class="move-row-open-placeholder"></div>`}
    </div>`;
  });

  el('moveFolderList').innerHTML = listHtml;
}

// Navigate into a sub-folder
function moveNavInto(folderId, folderName){
  movePathStack.push({ id: folderId, name: folderName });
  moveCurFolder = folderId;
  renderMoveTree();
}

// Navigate up one level
function moveNavUp(){
  movePathStack.pop();
  moveCurFolder = movePathStack.length > 0 ? movePathStack[movePathStack.length-1].id : null;
  renderMoveTree();
}

// Navigate to a specific breadcrumb segment (or root)
function moveNavTo(folderId, stackIndex){
  if(folderId === null){
    moveCurFolder = null;
    movePathStack = [];
  } else {
    movePathStack = movePathStack.slice(0, stackIndex + 1);
    moveCurFolder = folderId;
  }
  renderMoveTree();
}

// Confirm — move item into the currently displayed folder (moveCurFolder)
async function doConfirmMove(){
  closeModal('moveModal');
  const targetId = moveCurFolder; // null = root
  const table = moveKind === 'folder' ? 'folders' : 'learning_items';
  let data;
  if(moveKind === 'folder'){
    data = { ...appData.folders.find(f => f.id === moveItemId), parentId: targetId };
  } else {
    data = { ...appData.learningItems.find(i => i.id === moveItemId), folderId: targetId };
  }
  await saveToApi(table, data);
}

// Legacy stub kept so old code references don't break
async function confirmMove(kind, id, targetId){
  closeModal('moveModal');
  const table = kind === 'folder' ? 'folders' : 'learning_items';
  let data;
  if(kind === 'folder'){ data = { ...appData.folders.find(f => f.id === id), parentId: targetId }; }
  else { data = { ...appData.learningItems.find(i => i.id === id), folderId: targetId }; }
  await saveToApi(table, data);
}

/* Create */
function openFolderModal(){
  if(!isAdmin())return;
  el('folderModal').classList.remove('hidden');el('folderModalTitle').textContent='Create Folder';
  el('folderForm').reset();el('folderId').value='';setRadio('folderPerm','intern');
}
async function saveFolder(){
  const id=el('folderId').value,name=el('folderName').value.trim();
  if(!name)return showToast('Name required','error');
  const perm=getRadio('folderPerm');
  if(await saveToApi('folders',{id:id?parseInt(id):null,name,parentId:currentFolderId,min_role_required:perm}))
    closeModal('folderModal');
}
el('folderForm').addEventListener('submit',e=>e.preventDefault());
el('folderForm').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();saveFolder();}});

function openLearningItemModal(id=null){
  if(!isAdmin())return;
  el('learningItemModal').classList.remove('hidden');
  el('learningItemModalTitle').textContent=id?'Edit Item':'Add Item';
  el('learningItemId').value=id||'';
  if(id){
    const item=appData.learningItems.find(i=>i.id===id);
    el('learningItemTopic').value=item.topic;el('learningItemType').value=item.type;
    el('learningItemLink').value=item.link||'';el('learningItemContent').value=item.content||'';
    setRadio('itemPerm',item.min_role_required||'intern');
  } else {el('learningItemForm').reset();setRadio('itemPerm','intern');}
  toggleLearningItemFields();
}
function toggleLearningItemFields(){
  const t=el('learningItemType').value;
  el('pdfLinkField').classList.toggle('hidden',t!=='pdf');
  el('textContentField').classList.toggle('hidden',t!=='text');
}
async function saveLearningItem(){
  const id=el('learningItemId').value,type=el('learningItemType').value;
  const data={id:id?parseInt(id):null,topic:el('learningItemTopic').value,type,
    link:type==='pdf'?el('learningItemLink').value:null,
    content:type==='text'?el('learningItemContent').value:null,
    folderId:currentFolderId,min_role_required:getRadio('itemPerm')};
  if(await saveToApi('learning_items',data))closeModal('learningItemModal');
}

/* Rename (legacy) */
function renameItem(){if(!isAdmin()||!contextItem)return;const name=contextItem.kind==='folder'?appData.folders.find(f=>f.id===contextItem.id)?.name:appData.learningItems.find(i=>i.id===contextItem.id)?.topic;el('renameInput').value=name||'';el('renameModal').classList.remove('hidden');}
async function confirmRename(){
  if(!isAdmin()||!contextItem)return;const newName=el('renameInput').value.trim();if(!newName)return;
  const table=contextItem.kind==='folder'?'folders':'learning_items';
  let data;if(contextItem.kind==='folder'){data={...appData.folders.find(x=>x.id===contextItem.id),name:newName};}
  else{data={...appData.learningItems.find(x=>x.id===contextItem.id),topic:newName};}
  if(await saveToApi(table,data))closeModal('renameModal');
}
if(document.querySelector('#renameModal form'))
  document.querySelector('#renameModal form').addEventListener('submit',e=>e.preventDefault());
if(el('renameInput'))
  el('renameInput').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();confirmRename();}});

/* ══════════════════════════════════════════════════════════
   INFO CARDS — leader+ can manage
══════════════════════════════════════════════════════════ */
let longPressTimer,longPressCardId,isLongPress,imageSource='url';

function renderInfoCards(){
  const container=el('infoCardsContainer');
  // Filter by permission
  const cards=appData.infoCards.filter(c=>c.categoryId===currentInfoCategory && canSee(c.min_role_required||'intern'));
  container.innerHTML=cards.map(card=>{
    const perm=card.min_role_required||'intern';
    const permTag=isAdmin()?`<span class="fc-perm perm-${perm}">${perm}</span>`:'';
    return `
    <div id="ic-${card.id}" style="position:relative">
      <div class="info-card" data-cid="${card.id}"
           onclick="handleInfoCardClick(event,${card.id},'${escAttr(card.link)}')"
           ${canManageInfo()?`oncontextmenu="showInfoCardCtx(event,${card.id});return false;"`:''}>
        ${card.displayType==='image'&&card.image
          ?`<img src="${escAttr(card.image)}" alt="${escAttr(card.title)}" class="info-card-img" onerror="this.style.display='none'">`
          :`<div class="info-icon"><i class="fas ${card.icon||'fa-link'}"></i></div>`}
        <span style="font-size:.8rem;font-weight:600;color:var(--text);line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${escHtml(card.title)}</span>
        ${permTag}
      </div>
      <!-- NO hover icons — context menu only (right-click / long-press) -->
    </div>`;
  }).join('')||'<div class="empty-state"><i class="fas fa-layer-group"></i><p>No items yet</p></div>';

  // Long-press for mobile (touch)
  if(canManageInfo()){cards.forEach(card=>{const e=document.querySelector(`[data-cid="${card.id}"]`);if(e){e.addEventListener('touchstart',ev=>startLongPress(ev,card.id),{passive:true});e.addEventListener('touchend',endLongPress);e.addEventListener('touchmove',cancelLongPress);}});}
}

function handleInfoCardClick(event,cardId,link){if(isLongPress){event.preventDefault();isLongPress=false;return;}window.open(link,'_blank');}
function startLongPress(e,id){if(!canManageInfo())return;isLongPress=false;longPressCardId=id;longPressTimer=setTimeout(()=>{isLongPress=true;if(navigator.vibrate)navigator.vibrate(50);showInfoCardCtx(e,id);},500);}
function endLongPress(){clearTimeout(longPressTimer);}
function cancelLongPress(){clearTimeout(longPressTimer);isLongPress=false;}
function showInfoCardCtx(e,id){
  if(!canManageInfo())return;
  // Always stop browser default context menu
  if(e && e.preventDefault) e.preventDefault();
  if(e && e.stopPropagation) e.stopPropagation();
  longPressCardId=id;
  const m=el('infoCardContextMenu');
  m.classList.remove('hidden');
  const x=e.touches?e.touches[0].clientX:e.clientX;
  const y=e.touches?e.touches[0].clientY:e.clientY;
  m.style.left=Math.min(x,window.innerWidth-190)+'px';
  m.style.top=Math.min(y,window.innerHeight-140)+'px';
}
document.addEventListener('click',e=>{const m=el('infoCardContextMenu');if(m&&!m.classList.contains('hidden')&&!m.contains(e.target))m.classList.add('hidden');});
function editInfoCardFromContext(){el('infoCardContextMenu').classList.add('hidden');openInfoCardModal(longPressCardId);}

function moveInfoCardFromContext(){
  el('infoCardContextMenu').classList.add('hidden');
  const list=el('infoCategoryList');
  // Show all categories except the current one
  const cats=appData.categories.filter(c=>c.id!==currentInfoCategory);
  if(!cats.length){showToast('No other categories to move to','info');return;}
  list.innerHTML=cats.map(c=>`
    <button onclick="confirmMoveInfoCard(${longPressCardId},${c.id})">
      <i class="fas ${c.icon}" style="color:var(--accent)"></i> ${escHtml(c.name)}
    </button>`).join('');
  el('infoCardMoveModal').classList.remove('hidden');
}

async function confirmMoveInfoCard(cardId,targetCatId){
  closeModal('infoCardMoveModal');
  if(isProcessing){showToast('Please wait…','info');return;}
  isProcessing=true;showLoading(true);updateProgress(20,'Moving…');
  try{
    const res=await fetch(`${API_URL}/infoCards/${cardId}`,{method:'PUT',headers:getHeaders(),body:JSON.stringify({categoryId:targetCatId})});
    const data=await res.json().catch(()=>({}));
    if(!res.ok)throw new Error(data.error||'Move failed');
    updateProgress(60,'Refreshing...');await refreshData(true);
    updateProgress(100,'Moved!');await delay(300);hideLoading();
    showToast('Item moved to new category','success');
  }catch(e){hideLoading();showToast(e.message);}
  isProcessing=false;
}

async function deleteInfoCardFromContext(){
  el('infoCardContextMenu').classList.add('hidden');
  if(!canManageInfo())return showToast('Insufficient permissions','error');
  if(!confirm('Delete?'))return;
  // Use new endpoint
  if(isProcessing){showToast('Please wait…','info');return;}
  isProcessing=true;showLoading(true);
  try{
    const res=await fetch(`${API_URL}/infoCards/${longPressCardId}`,{method:'DELETE',headers:getHeaders()});
    const data=await res.json().catch(()=>({}));
    if(!res.ok)throw new Error(data.error||'Delete failed');
    await refreshData(true);hideLoading();showToast('Deleted!','success');
  }catch(e){hideLoading();showToast(e.message);}
  isProcessing=false;
}
function setImageSource(src){imageSource=src;el('imageUrlField').classList.toggle('hidden',src!=='url');el('imageUploadField').classList.toggle('hidden',src!=='upload');const u=el('imgSourceUrl'),up=el('imgSourceUpload');if(src==='url'){u.className='btn-primary flex1';up.className='btn-secondary flex1';}else{up.className='btn-primary flex1';u.className='btn-secondary flex1';}}
function handleImageUpload(event){const file=event.target.files[0];if(!file||file.size>2*1024*1024)return showToast('Image too large (>2MB)');const r=new FileReader();r.onload=e=>{el('infoCardImage').value=e.target.result;el('previewImg').src=e.target.result;el('uploadPlaceholder').classList.add('hidden');el('uploadPreview').classList.remove('hidden');};r.readAsDataURL(file);}

function openInfoCardModal(id=null){
  if(!canManageInfo())return showToast('Leader or above required','error');
  el('infoCardModal').classList.remove('hidden');
  el('infoCardModalTitle').textContent=id?'Edit':'Add';
  el('infoCardId').value=id||'';
  el('uploadPreview').classList.add('hidden');el('uploadPlaceholder').classList.remove('hidden');
  if(id){
    const c=appData.infoCards.find(x=>x.id===id);
    el('infoCardTitle').value=c.title;el('infoCardDisplayType').value=c.displayType;
    el('infoCardIcon').value=c.icon;el('infoCardLink').value=c.link;
    el('infoCardImage').value=c.image||'';el('infoCardImageUrl').value=c.image||'';
    setRadio('infoCardPerm',c.min_role_required||'intern');
    if(c.image&&c.image.startsWith('data:')){setImageSource('upload');el('previewImg').src=c.image;el('uploadPlaceholder').classList.add('hidden');el('uploadPreview').classList.remove('hidden');}
    else setImageSource('url');
  } else {el('infoCardForm').reset();setRadio('infoCardPerm','intern');setImageSource('url');}
  toggleInfoCardFields();
}
function toggleInfoCardFields(){const t=el('infoCardDisplayType').value;el('iconField').classList.toggle('hidden',t!=='icon');el('imageField').classList.toggle('hidden',t!=='image');}

async function saveInfoCard(){
  if(!canManageInfo())return showToast('Leader or above required','error');
  const id=el('infoCardId').value;
  const dt=el('infoCardDisplayType').value;
  const img=dt==='image'?(imageSource==='url'?el('infoCardImageUrl').value:el('infoCardImage').value):null;
  const payload={
    title:el('infoCardTitle').value,displayType:dt,icon:el('infoCardIcon').value,
    image:img,link:el('infoCardLink').value,categoryId:currentInfoCategory,
    min_role_required:getRadio('infoCardPerm')
  };
  if(isProcessing){showToast('Please wait…','info');return;}
  isProcessing=true;showLoading(true);updateProgress(20,'Saving...');
  try{
    let res;
    if(id){
      res=await fetch(`${API_URL}/infoCards/${id}`,{method:'PUT',headers:getHeaders(),body:JSON.stringify(payload)});
    } else {
      res=await fetch(`${API_URL}/infoCards`,{method:'POST',headers:getHeaders(),body:JSON.stringify(payload)});
    }
    const data=await res.json().catch(()=>({}));
    if(!res.ok)throw new Error(data.error||'Save failed');
    updateProgress(60,'Refreshing...');await refreshData(true);
    updateProgress(100,'Saved!');await delay(300);hideLoading();
    showToast('Saved!','success');closeModal('infoCardModal');
  }catch(e){hideLoading();showToast(e.message);}
  isProcessing=false;
}
function editInfoCard(e,id){e.preventDefault();e.stopPropagation();openInfoCardModal(id);}

/* ══════════════════════════════════════════════════════════
   ADMIN CRUD
══════════════════════════════════════════════════════════ */
let visiblePwds={};
function togglePasswordVisibility(id){visiblePwds[id]=!visiblePwds[id];renderUsers();}
function toggleEditPasswordVisibility(){const p=el('userPassword'),btn=el('toggleEditPassword');if(!btn)return;p.type=p.type==='password'?'text':'password';btn.querySelector('i').className='fas '+(p.type==='password'?'fa-eye':'fa-eye-slash');}
/* ══════════════════════════════════════════════════════════
   ADMIN PANEL — User Management
══════════════════════════════════════════════════════════ */
let adminFilter = 'all';
let onlineSort = false;

function setAdminFilter(f){
  adminFilter = f;
  document.querySelectorAll('[data-filter]').forEach(btn=>btn.classList.toggle('active',btn.dataset.filter===f));
  renderUsers();
}

function toggleOnlineSort(){
  onlineSort = !onlineSort;
  const icon = el('onlineSortIcon');
  if(onlineSort){
    icon.className = 'fas fa-sort-amount-down';
    icon.style.opacity = '1';
  } else {
    icon.className = 'fas fa-sort';
    icon.style.opacity = '0.5';
  }
  renderUsers();
}

function isUserOnline(lastSeen){
  if(!lastSeen) return false;
  try {
    // SQLite datetime('now') is YYYY-MM-DD HH:MM:SS (UTC)
    const iso = lastSeen.replace(' ', 'T') + 'Z';
    const last = new Date(iso).getTime();
    if(isNaN(last)) return false;
    // Accuracy fix: use 1-minute threshold (60000ms)
    return (Date.now() - last) < 60000;
  } catch(e) { return false; }
}

// Presence Fix: Signal offline when closing browser tab
window.addEventListener('pagehide', () => {
  if (authHeader && currentUser) {
    fetch(`${API_URL}/presence/offline`, {
      method: 'POST',
      headers: getHeaders(),
      keepalive: true
    });
  }
});

function renderUsers(){
  const container = el('usersTable');
  if(!container) return;

  const searchQuery = el('adminUserSearch')?.value.toLowerCase().trim() || '';
  
  let filtered = [...appData.users];

  // 1. Role Filtering
  if(adminFilter !== 'all'){
    filtered = filtered.filter(u => u.role === adminFilter);
  }

  // 2. Search Filtering (Name or Username)
  if(searchQuery){
    filtered = filtered.filter(u => {
      const name = (u.accountName || u.account_name || '').toLowerCase();
      const uname = (u.username || '').toLowerCase();
      return name.includes(searchQuery) || uname.includes(searchQuery);
    });
  }

  // 3. Sorting
  filtered.sort((a, b) => {
    // Primary Sort: Online Status (if toggled)
    if(onlineSort){
      const aOn = isUserOnline(a.last_seen);
      const bOn = isUserOnline(b.last_seen);
      if(aOn && !bOn) return -1;
      if(!aOn && bOn) return 1;
    }
    // Default/Secondary Sort: Name A-Z
    const nameA = (a.accountName || a.account_name || a.username || '').toLowerCase();
    const nameB = (b.accountName || b.account_name || b.username || '').toLowerCase();
    return nameA.localeCompare(nameB);
  });

  container.innerHTML = filtered.map(u => {
    const online = isUserOnline(u.last_seen);
    const displayName = u.accountName || u.account_name || u.username;
    return `
    <tr>
      <td>
        <div style="display:flex;align-items:center;gap:.6rem">
          <div style="width:34px;height:34px;background:var(--border);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:.8rem;color:var(--text2)">
            <i class="fas fa-user"></i>
          </div>
          <span style="font-weight:600">${escHtml(displayName)}</span>
        </div>
      </td>
      <td class="col-sm">${escHtml(u.username)}</td>
      <td>
        <div style="display:flex;align-items:center;gap:.35rem">
          <span style="font-family:monospace;font-size:.82rem;${visiblePwds[u.id]?'':'letter-spacing:.1em'}">${visiblePwds[u.id]?escHtml(u.password):'••••'}</span>
          <button onclick="togglePasswordVisibility(${u.id})" class="icon-btn" title="Toggle Visibility">
            <i class="fas ${visiblePwds[u.id]?'fa-eye-slash':'fa-eye'}"></i>
          </button>
        </div>
      </td>
      <td>
        <span class="badge b-${u.role==='admin'?'important':u.role==='leader'?'general':u.role==='member'?'announcement':'reminder'}">
          ${escHtml(u.role)}
        </span>
      </td>
      <td>
        <div class="online-badge ${online?'online':'offline'}">
          <span class="status-dot ${online?'status-online':'status-offline'}"></span>
          ${online?'Online':'Offline'}
        </div>
      </td>
      <td class="tr">
        <button onclick="editUser(${u.id})" class="icon-btn" style="color:var(--accent)" title="Edit User">
          <i class="fas fa-edit"></i>
        </button>
        ${u.id !== currentUser.id ? `
          <button onclick="deleteFromApi('users',${u.id})" class="icon-btn" style="color:#ef4444" title="Delete User">
            <i class="fas fa-trash"></i>
          </button>` : ''}
      </td>
    </tr>`;
  }).join('') || `<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--text3)">No users found matching filters</td></tr>`;
}

function showAdminTab(tab){
  if(!isAdmin())return;
  // Categories tab removed — only users tab remains
  if(tab==='users') renderUsers();
  // renderCategories kept for category manager modal
  if(tab==='categories') renderCategories();
}
function renderCategories(){
  // categoriesList element removed from admin panel — update manager list instead
  const listEl=el('categoriesList');
  if(listEl) listEl.innerHTML=appData.categories.map(cat=>`<div class="cat-card"><div style="display:flex;align-items:center;gap:.65rem"><div class="cat-icon"><i class="fas ${cat.icon}"></i></div><span style="font-weight:600">${escHtml(cat.name)}</span></div><div style="display:flex;gap:.35rem"><button onclick="openCategoryModal(${cat.id})" class="icon-btn" style="color:var(--accent)"><i class="fas fa-edit"></i></button><button onclick="deleteFromApi('categories',${cat.id})" class="icon-btn" style="color:#ef4444"><i class="fas fa-trash"></i></button></div></div>`).join('');
  // Also refresh the manager list if it is currently open
  if(el('categoryManagerModal')&&!el('categoryManagerModal').classList.contains('hidden')){
    renderCategoryManagerList();
  }
}
/* ── Category Manager (drag to sort) ────────────────────── */
let catDragSrc=null;

function openCategoryManagerModal(){
  renderCategoryManagerList();
  el('categoryManagerModal').classList.remove('hidden');
}

function renderCategoryManagerList(){
  const list=el('categoryManagerList');
  list.innerHTML=appData.categories.map(cat=>`
    <div class="cat-mgr-item" draggable="true" data-cat-id="${cat.id}"
         ondragstart="catDragStart(event,${cat.id})"
         ondragover="catDragOver(event)"
         ondrop="catDrop(event,${cat.id})"
         ondragend="catDragEnd()">
      <div class="cat-mgr-drag"><i class="fas fa-grip-vertical"></i></div>
      <div class="cat-mgr-icon"><i class="fas ${cat.icon}"></i></div>
      <span class="cat-mgr-name">${escHtml(cat.name)}</span>
      <span class="cat-mgr-perm perm-${cat.min_role_required||'intern'}">${cat.min_role_required||'intern'}</span>
      <div class="cat-mgr-actions">
        <button onclick="openCategoryModal(${cat.id})" class="icon-btn" title="Edit"><i class="fas fa-edit"></i></button>
        <button onclick="deleteCategoryConfirm(${cat.id})" class="icon-btn" style="color:#ef4444" title="Delete"><i class="fas fa-trash"></i></button>
      </div>
    </div>`).join('');
}

function catDragStart(e,id){
  catDragSrc=id;
  e.dataTransfer.effectAllowed='move';
  e.currentTarget.classList.add('cat-dragging');
}
function catDragOver(e){
  e.preventDefault();e.dataTransfer.dropEffect='move';
  document.querySelectorAll('.cat-mgr-item').forEach(el=>el.classList.remove('cat-drag-over'));
  e.currentTarget.classList.add('cat-drag-over');
}
function catDragEnd(){document.querySelectorAll('.cat-mgr-item').forEach(el=>el.classList.remove('cat-dragging','cat-drag-over'));}
async function catDrop(e,targetId){
  e.preventDefault();
  if(catDragSrc===targetId){catDragEnd();return;}
  catDragEnd();

  // Reorder locally
  const cats=[...appData.categories];
  const fromIdx=cats.findIndex(c=>c.id===catDragSrc);
  const toIdx  =cats.findIndex(c=>c.id===targetId);
  if(fromIdx<0||toIdx<0)return;
  const [moved]=cats.splice(fromIdx,1);
  cats.splice(toIdx,0,moved);
  appData.categories=cats;

  // Re-render immediately for instant visual feedback
  renderCategoryManagerList();
  renderInfoDropdown();

  // Persist to D1 via dedicated sort endpoint
  try{
    const res=await fetch(`${API_URL}/categories/sort`,{
      method:'POST',
      headers:getHeaders(),
      body:JSON.stringify({order:cats.map(c=>c.id)})
    });
    const data=await res.json().catch(()=>({}));
    if(!res.ok)throw new Error(data.error||'Sort failed');
    // Silently refresh so appData stays in sync (no loading overlay)
    refreshData(true);
  }catch(e){
    showToast('Failed to save sort order: '+e.message,'error');
  }
}

async function deleteCategoryConfirm(id){
  if(!confirm('Delete this category and all its info cards?'))return;
  await deleteFromApi('categories',id);
  renderCategoryManagerList();
  renderCategoryPickerList();
}

// Cancel category form → close it and re-open the manager
function cancelCategoryModal(){
  closeModal('categoryModal');
  openCategoryManagerModal();
}

function openCategoryModal(id=null){
  // Hide the manager so the category form modal is clearly visible
  el('categoryManagerModal').classList.add('hidden');
  el('categoryModal').classList.remove('hidden');
  el('categoryId').value=id||'';
  if(id){const c=appData.categories.find(x=>x.id===id);el('categoryName').value=c.name;el('categoryIcon').value=c.icon;setRadio('catPerm',c.min_role_required||'intern');}
  else{el('categoryForm').reset();setRadio('catPerm','intern');}
}
async function saveCategory(){
  const id=el('categoryId').value;
  const data={id:id?parseInt(id):null,name:el('categoryName').value,icon:el('categoryIcon').value,min_role_required:getRadio('catPerm')};
  if(await saveToApi('categories',data)){
    closeModal('categoryModal');
    // Re-open the manager so user can continue sorting/editing
    openCategoryManagerModal();
  }
}
function openUserModal(id=null){el('userModal').classList.remove('hidden');el('userModalTitle').textContent=id?'Edit User':'Add User';el('userId').value=id||'';const p=el('userPassword');p.type='password';const ti=el('toggleEditPassword');if(ti)ti.querySelector('i').className='fas fa-eye';if(id){const u=appData.users.find(x=>x.id===id);el('userAccountName').value=u.accountName||u.account_name||'';el('userUsername').value=u.username;el('userPassword').value=u.password;el('userRole').value=u.role;}else el('userForm').reset();}
async function saveUser(){const id=el('userId').value;const data={id:id?parseInt(id):null,accountName:el('userAccountName').value,username:el('userUsername').value,password:el('userPassword').value,role:el('userRole').value};if(await saveToApi('users',data))closeModal('userModal');}
function editUser(id){openUserModal(id);}

/* ══════════════════════════════════════════════════════════
   SETTINGS
══════════════════════════════════════════════════════════ */
function openSettings(){loadPreferencesUI();el('settingsModal').classList.remove('hidden');}
function loadPreferencesUI(){
  const p=getPrefs();
  el('darkModeToggle').checked=p.dark;
  document.querySelectorAll('.font-opt').forEach(b=>b.classList.toggle('active',b.dataset.font===p.font));
}
function getPrefs(){return{dark:localStorage.getItem('noc_dark')==='1',color:localStorage.getItem('noc_color')||'blue',font:localStorage.getItem('noc_font')||'md',modal:localStorage.getItem('noc_modal')||'md'};}
function loadPreferences(){const p=getPrefs();applyDarkMode(p.dark,false);applyColor(p.color,false);applyFont(p.font,false);applyModalSize(p.modal,false);}
function applyDarkMode(on,save=true){document.documentElement.setAttribute('data-theme',on?'dark':'light');if(save)localStorage.setItem('noc_dark',on?'1':'0');}
function applyColor(c,save=true){document.documentElement.setAttribute('data-color',c);if(save)localStorage.setItem('noc_color',c);}
function applyFont(f,save=true){document.documentElement.setAttribute('data-font',f);if(save)localStorage.setItem('noc_font',f);if(save)loadPreferencesUI();}
function applyModalSize(m,save=true){document.documentElement.setAttribute('data-modal',m);if(save)localStorage.setItem('noc_modal',m);if(save)loadPreferencesUI();}

/* ══════════════════════════════════════════════════════════
   CHANGE PASSWORD
══════════════════════════════════════════════════════════ */
function openChangePassword(){
  el('changePwdModal').classList.remove('hidden');el('changePwdForm').reset();
  ['cpOld','cpNew','cpConfirm'].forEach(id=>{el(id).type='password';});
  document.querySelectorAll('#changePwdForm .eye-btn i').forEach(i=>i.className='fas fa-eye');
  showCpMsg('','');updateStrengthBar('');
}
function togglePwdField(inputId,btn){const inp=el(inputId),icon=btn.querySelector('i');if(inp.type==='password'){inp.type='text';icon.classList.replace('fa-eye','fa-eye-slash');}else{inp.type='password';icon.classList.replace('fa-eye-slash','fa-eye');}}
function showCpMsg(msg,type){const box=el('cpError');if(!msg){box.className='cp-error hidden';box.innerHTML='';return;}box.className=type==='success'?'cp-success':'cp-error';const icon=type==='success'?'fa-check-circle':'fa-exclamation-circle';box.innerHTML=`<i class="fas ${icon}"></i> ${escHtml(msg)}`;}
function updateStrengthBar(pwd){
  const bar=el('cpStrengthBar'),label=el('cpStrengthLabel');
  if(!bar||!label)return;
  const setRule=(id,pass)=>{const li=el(id);if(!li)return;li.classList.toggle('rule-pass',pass);li.classList.toggle('rule-fail',pwd.length>0&&!pass);li.querySelector('i').className='fas '+(pass?'fa-check-circle':'fa-circle-dot');};
  setRule('ruleLen',pwd.length>=5);setRule('ruleUpper',/[A-Z]/.test(pwd));setRule('ruleNum',/[0-9]/.test(pwd));
  if(!pwd){bar.style.width='0%';bar.style.background='var(--border)';label.textContent='';return;}
  let score=0;
  if(pwd.length>=5)score++;if(pwd.length>=8)score++;if(/[A-Z]/.test(pwd))score++;if(/[0-9]/.test(pwd))score++;if(/[^A-Za-z0-9]/.test(pwd))score++;
  const levels=[{w:'20%',color:'#ef4444',text:'Very weak'},{w:'40%',color:'#f97316',text:'Weak'},{w:'60%',color:'#eab308',text:'Fair'},{w:'80%',color:'#22c55e',text:'Strong'},{w:'100%',color:'#16a34a',text:'Very strong'}];
  const lvl=levels[Math.min(score,4)];bar.style.width=lvl.w;bar.style.background=lvl.color;label.textContent=lvl.text;label.style.color=lvl.color;
}
function liveMatchCheck(){
  const np=el('cpNew').value,cp=el('cpConfirm').value,hint=el('cpMatchHint');if(!hint)return;
  if(!cp){hint.className='cp-match-hint hidden';hint.innerHTML='';return;}
  if(np===cp){hint.className='cp-match-hint match-ok';hint.innerHTML='<i class="fas fa-check-circle"></i> Passwords match';}
  else{hint.className='cp-match-hint match-no';hint.innerHTML='<i class="fas fa-times-circle"></i> Passwords do not match';}
}
async function submitChangePassword(){
  const oldPwd=el('cpOld').value,newPwd=el('cpNew').value,confirmPwd=el('cpConfirm').value;
  if(!oldPwd){showCpMsg('Please enter your current password.','error');el('cpOld').focus();return;}
  if(!newPwd){showCpMsg('Please enter a new password.','error');el('cpNew').focus();return;}
  if(newPwd.length<5){showCpMsg('New password must be at least 5 characters.','error');el('cpNew').focus();return;}
  if(!confirmPwd){showCpMsg('Please confirm your new password.','error');el('cpConfirm').focus();return;}
  if(newPwd!==confirmPwd){showCpMsg('New passwords do not match.','error');el('cpConfirm').focus();return;}
  if(oldPwd===newPwd){showCpMsg('New password must differ from current.','error');el('cpNew').focus();return;}
  const submitBtn=document.querySelector('#changePwdModal .btn-primary');
  if(submitBtn){submitBtn.disabled=true;submitBtn.innerHTML='<i class="fas fa-spinner fa-spin"></i> Changing…';}
  try{
    const res=await fetch(`${API_URL}/changePassword`,{method:'POST',headers:getHeaders(),body:JSON.stringify({oldPassword:oldPwd,newPassword:newPwd})});
    const data=await res.json().catch(()=>({}));
    if(res.ok&&data.success){
      currentUser.password=newPwd;authHeader='Basic '+btoa(currentUser.username+':'+newPwd);localStorage.setItem('authHeader',authHeader);
      showCpMsg('Password changed successfully!','success');
      setTimeout(()=>{closeModal('changePwdModal');closeModal('settingsModal');showToast('Password changed — please sign in again with your new password.','info');setTimeout(()=>logout(),2200);},1200);
    } else showCpMsg(data.error||'Failed to change password.','error');
  }catch(e){showCpMsg('Connection error. Please try again.','error');}
  if(submitBtn){submitBtn.disabled=false;submitBtn.innerHTML='<i class="fas fa-check"></i> Change Password';}
}

/* ══════════════════════════════════════════════════════════
   NOC UTILITIES
══════════════════════════════════════════════════════════ */
function openUtilities(){el('utilitiesModal').classList.remove('hidden');switchUtilTab('time');convertTime();loadStickyNotes();}
function switchUtilTab(tab){
  document.querySelectorAll('.util-tab').forEach(t=>t.classList.toggle('active',t.dataset.utab===tab));
  document.querySelectorAll('.util-panel').forEach(p=>p.classList.add('hidden'));
  el('util'+tab.charAt(0).toUpperCase()+tab.slice(1)).classList.remove('hidden');
}

/* Time Converter */
const TZ_LIST=[
  {id:'MMT',label:'MMT',name:'Myanmar   UTC+6:30',offset:390},
  {id:'UTC',label:'UTC',name:'Universal UTC+0',offset:0},
  {id:'IST',label:'IST',name:'India     UTC+5:30',offset:330},
  {id:'ICT',label:'ICT',name:'Indochina/Thailand UTC+7:00',offset:420},
  {id:'SGT',label:'SGT',name:'Singapore UTC+8:00',offset:480},
];
function convertTime(){
  const h=parseInt(el('tcHour').value),m=parseInt(el('tcMin').value);
  const inputZoneId=el('tcInputZone').value;
  if(isNaN(h)||isNaN(m)||h<0||h>23||m<0||m>59){
    if(el('tcHour').value!==''||el('tcMin').value!=='')
      el('timeResults').innerHTML='<div style="color:#ef4444;font-size:.85rem;padding:.5rem 0">⚠ Invalid time</div>';
    else el('timeResults').innerHTML='';return;
  }
  const inputZone=TZ_LIST.find(z=>z.id===inputZoneId)||TZ_LIST[0];
  const utcMin=(h*60+m)-inputZone.offset;
  el('timeResults').innerHTML=TZ_LIST.map(tz=>{
    let mins=((utcMin+tz.offset)%1440+1440)%1440;
    const th=Math.floor(mins/60),tm=mins%60;
    const ampm=th>=12?'PM':'AM',h12=th%12||12;
    const isInput=tz.id===inputZoneId;
    return `<div class="tz-row${isInput?' tz-row--active':''}">
      <div><div class="tz-label">${tz.label}${isInput?' <span class="tz-source">source</span>':''}</div><div class="tz-name">${tz.name}</div></div>
      <div style="text-align:right"><div class="tz-time">${pad(th)}:${pad(tm)}</div><div class="tz-time12">${pad(h12)}:${pad(tm)} ${ampm}</div></div>
    </div>`;
  }).join('');
}
function pad(n){return String(n).padStart(2,'0');}

/* Subnet Calculator — debounced so large subnets don't lag on every keystroke */
let subnetTimer=null;
el('subnetInput').addEventListener('input',()=>{
  clearTimeout(subnetTimer);
  subnetTimer=setTimeout(calcSubnet, 180);
});

function calcSubnet(){
  const raw=el('subnetInput').value.trim();
  const out=el('subnetResults');
  const hb=el('handoverBlock');

  if(!raw){ out.innerHTML=''; if(hb)hb.classList.add('hidden'); return; }

  try{
    const parts=raw.split('/');
    if(parts.length<2) throw new Error('Enter CIDR e.g. 192.168.1.0/24');
    const cidr=parseInt(parts[1]);
    if(isNaN(cidr)||cidr<0||cidr>32) throw new Error('CIDR must be 0-32');
    const oct=parts[0].split('.').map(Number);
    if(oct.length!==4||oct.some(function(n){return isNaN(n)||n<0||n>255;}))
      throw new Error('Invalid IP address');

    var ipInt=((oct[0]*256+oct[1])*256+oct[2])*256+oct[3];
    ipInt=ipInt>>>0;
    var mask=cidr===0?0:(0xFFFFFFFF<<(32-cidr))>>>0;
    var network=(ipInt&mask)>>>0;
    var broadcast=(network|(~mask>>>0))>>>0;
    var first=(network+1)>>>0;
    var last=(broadcast-1)>>>0;
    var total=Math.pow(2,32-cidr);
    var usable=cidr>=31?total:Math.max(0,total-2);
    function i2s(n){return [n>>>24&255,(n>>>16)&255,(n>>>8)&255,n&255].join('.');}
    var maskStr=i2s(mask);

    /* ── Subnet info table — always shown ───────── */
    var tableRows=[
      ['Network Address', i2s(network)],
      ['Subnet Mask',     maskStr],
      ['Wildcard Mask',   i2s((~mask)>>>0)],
      ['Broadcast',       i2s(broadcast)],
      ['First Usable',    cidr>=31?'N/A':i2s(first)],
      ['Last Usable',     cidr>=31?'N/A':i2s(last)],
      ['Total IPs',       total.toLocaleString()],
      ['Usable Hosts',    usable.toLocaleString()],
      ['CIDR',            '/'+cidr],
    ];
    out.innerHTML=tableRows.map(function(r){
      return '<div class="sn-row"><span class="sn-label">'+escHtml(r[0])+'</span><span class="sn-val">'+escHtml(r[1])+'</span></div>';
    }).join('');

    /* ── Handover block — ONLY /29 and /30 ──────── */
    if(cidr!==29&&cidr!==30){ if(hb)hb.classList.add('hidden'); return; }

    var gateway=i2s(first);
    var custCount=usable-1;
    var custIPs=[];
    for(var n=1;n<=custCount;n++){ custIPs.push(i2s((first+n)>>>0)); }
    var custStr=custIPs.join(', ');
    var subnetStr=i2s(network)+'/'+cidr+' ('+maskStr+')';

    var lines=[
      ['Customer IP', custStr],
      ['Gateway    ', gateway],
      ['Subnet     ', subnetStr],
      ['DNS1       ', '59.153.88.210'],
      ['DNS2       ', '59.153.90.34'],
    ];

    var htEl=el('handoverText');
    if(htEl){
      htEl.innerHTML=lines.map(function(r){
        return '<div class="sn-ho-row">'+
          '<span class="sn-ho-label">'+escHtml(r[0])+' : </span>'+
          '<span class="sn-ho-value">'+escHtml(r[1])+'</span>'+
          '</div>';
      }).join('');
    }
    if(hb)hb.classList.remove('hidden');

  }catch(e){
    el('subnetResults').innerHTML='<div class="sn-error"><i class="fas fa-exclamation-circle"></i> '+escHtml(e.message)+'</div>';
    var hb2=el('handoverBlock'); if(hb2)hb2.classList.add('hidden');
  }
}

function copyHandoverText(){
  const pre=el('handoverText');
  if(!pre)return;
  const rows=pre.querySelectorAll('.sn-ho-row');
  const text=Array.from(rows).map(function(r){
    return (r.querySelector('.sn-ho-label')||{textContent:''}).textContent
          +(r.querySelector('.sn-ho-value')||{textContent:''}).textContent;
  }).join('\n');
  navigator.clipboard.writeText(text).then(()=>{
    const btn=document.querySelector('.sn-copy-btn');
    if(btn){
      btn.innerHTML='<i class="fas fa-check"></i> Copied!';
      btn.style.background='#10b981';btn.style.color='#fff';
      setTimeout(()=>{btn.innerHTML='<i class="fas fa-copy"></i> Copy';btn.style.background='';btn.style.color='';},2000);
    }
    showToast('Handover info copied!','success');
  }).catch(()=>{
    // Fallback for older browsers
    const ta=document.createElement('textarea');
    ta.value=text;ta.style.position='fixed';ta.style.opacity='0';
    document.body.appendChild(ta);ta.select();
    document.execCommand('copy');document.body.removeChild(ta);
    showToast('Copied!','success');
  });
}

/* ══════════════════════════════════════════════════════════
   STICKY NOTES — D1-backed
══════════════════════════════════════════════════════════ */
const STICKY_COLORS=['#fef9c3','#fce7f3','#dbeafe','#d1fae5','#ede9fe','#fee2e2'];

async function loadStickyNotes(){
  const board=el('stickyBoard');
  board.innerHTML='<div style="text-align:center;padding:1rem;color:var(--text3);font-size:.82rem"><i class="fas fa-spinner fa-spin"></i> Loading…</div>';
  try{
    const data=await fetchAPI('sticky',{silentFail:true});
    stickyNotes=(data?.notes)||[];
  } catch{ stickyNotes=[]; }
  renderStickyNotes();
}

async function addStickyNote(){
  // Show inline spinner inside the board
  const board=el('stickyBoard');
  const ghost=document.createElement('div');
  ghost.className='sticky-note sticky-adding';
  ghost.innerHTML='<div class="sticky-spinner"><i class="fas fa-spinner fa-spin"></i><span>Adding…</span></div>';
  ghost.style.background='#f1f5f9';
  board.prepend(ghost);

  const color=STICKY_COLORS[Math.floor(Math.random()*STICKY_COLORS.length)];
  try{
    const data=await fetchAPI('sticky',{method:'POST',body:JSON.stringify({text:'',color,sort_order:stickyNotes.length})});
    if(data?.note){
      stickyNotes.push(data.note);
      renderStickyNotes();
      showToast('Note added','success');
    } else throw new Error('No note returned');
  }catch(e){
    ghost.remove();
    showToast('Failed to add note: '+e.message);
  }
}

async function deleteSticky(id){
  // Mark the note as deleting visually
  const noteEl=document.querySelector(`.sticky-note[data-sid="${id}"]`);
  if(noteEl){
    noteEl.style.opacity='0.4';
    noteEl.style.pointerEvents='none';
    const spinner=document.createElement('div');
    spinner.className='sticky-del-overlay';
    spinner.innerHTML='<i class="fas fa-spinner fa-spin"></i>';
    noteEl.appendChild(spinner);
  }
  try{
    const res=await fetch(`${API_URL}/sticky/${id}`,{method:'DELETE',headers:getHeaders()});
    if(!res.ok){const d=await res.json().catch(()=>({}));throw new Error(d.error||'Delete failed');}
    stickyNotes=stickyNotes.filter(n=>n.id!==id);
    renderStickyNotes();
    showToast('Note deleted','success');
  }catch(e){
    if(noteEl){noteEl.style.opacity='1';noteEl.style.pointerEvents='';noteEl.querySelector('.sticky-del-overlay')?.remove();}
    showToast('Failed to delete: '+e.message);
  }
}

// Debounced text save
const stickyTextTimers={};
function updateStickyText(id,text){
  const note=stickyNotes.find(n=>n.id===id);if(note)note.text=text;
  clearTimeout(stickyTextTimers[id]);
  stickyTextTimers[id]=setTimeout(async()=>{
    try{await fetch(`${API_URL}/sticky/${id}`,{method:'PUT',headers:getHeaders(),body:JSON.stringify({text})});}
    catch(e){console.warn('Sticky save failed',e);}
  },600);
}

async function updateStickyColor(id,color){
  const note=stickyNotes.find(n=>n.id===id);if(note)note.color=color;
  renderStickyNotes();
  try{await fetch(`${API_URL}/sticky/${id}`,{method:'PUT',headers:getHeaders(),body:JSON.stringify({color})});}
  catch(e){console.warn('Sticky color save failed',e);}
}

function renderStickyNotes(){
  const board=el('stickyBoard');
  if(!stickyNotes.length){
    board.innerHTML='<div style="grid-column:1/-1;text-align:center;padding:2rem;color:var(--text2);font-size:.85rem"><i class="fas fa-sticky-note" style="font-size:1.5rem;display:block;margin-bottom:.5rem"></i>No notes yet. Click + Add Note</div>';
    return;
  }
  board.innerHTML=stickyNotes.map(n=>{
    // resolve display name of author
    const author = n.accountName || n.account_name || n.username || 'Unknown';
    // only the creator can edit text/color, but everyone can delete
    const isOwn  = n.user_id === currentUser?.id;
    return `
    <div class="sticky-note" data-sid="${n.id}" style="background:${n.color}">
      <div class="sticky-author"><i class="fas fa-user-circle"></i> ${escHtml(author)}</div>
      <textarea placeholder="Type your note…"
        ${isOwn ? `oninput="updateStickyText(${n.id},this.value)"` : 'readonly'}
        style="${isOwn?'':'opacity:.75;cursor:default'}"
      >${escHtml(n.text||'')}</textarea>
      <div class="sticky-note-actions">
        ${isOwn ? `<div class="sticky-color-pick">
          ${STICKY_COLORS.map(c=>`<button class="sc-dot" style="background:${c};border:${n.color===c?'2px solid #1e293b':'1px solid rgba(0,0,0,.15)'}" onclick="updateStickyColor(${n.id},'${c}')"></button>`).join('')}
        </div>` : '<div></div>'}
        <button class="sticky-del" title="Delete" onclick="deleteSticky(${n.id})"><i class="fas fa-times"></i></button>
      </div>
    </div>`;
  }).join('');
}

/* ══════════════════════════════════════════════════════════
   RADIO HELPERS
══════════════════════════════════════════════════════════ */
function getRadio(name){const c=document.querySelector(`input[name="${name}"]:checked`);return c?c.value:'intern';}
function setRadio(name,value){const r=document.querySelector(`input[name="${name}"][value="${value}"]`);if(r)r.checked=true;}

/* ══════════════════════════════════════════════════════════
   MODALS
══════════════════════════════════════════════════════════ */
function closeModal(id){const e=el(id);if(e)e.classList.add('hidden');}
document.querySelectorAll('.modal-bd').forEach(bd=>{bd.addEventListener('click',e=>{if(e.target===bd)bd.classList.add('hidden');});});
document.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelectorAll('.modal-bd').forEach(m=>m.classList.add('hidden'));});

/* ══════════════════════════════════════════════════════════
   UTILS
══════════════════════════════════════════════════════════ */
function el(id){return document.getElementById(id);}
function escHtml(s){if(s==null)return'';return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function escAttr(s){if(s==null)return'';return String(s).replace(/'/g,"\\'").replace(/"/g,'&quot;');}

/* ══════════════════════════════════════════════════════════
   BOOT & REAL-TIME POLLING
══════════════════════════════════════════════════════════ */
const POLL_INTERVAL = 20000; // 20 seconds — balances freshness vs D1 query cost
let pollTimer = null;

function startPolling(){
  stopPolling();
  pollTimer=setInterval(async()=>{
    if(!authHeader||document.hidden)return; // skip if not authed or tab hidden
    await refreshData(true);                 // silent — no loading overlay
    // Also refresh sticky notes if utilities modal is open
    if(el('utilitiesModal')&&!el('utilitiesModal').classList.contains('hidden')){
      const board=el('stickyBoard');
      if(board){
        try{
          const data=await fetchAPI('sticky',{silentFail:true});
          if(data?.notes){
            stickyNotes=data.notes;
            renderStickyNotes();
          }
        }catch{ /* ignore */ }
      }
    }
  }, POLL_INTERVAL);
}

function stopPolling(){
  if(pollTimer){ clearInterval(pollTimer); pollTimer=null; }
}

// Refresh immediately on tab focus (user returns to tab)
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='visible'&&authHeader){
    refreshData(true);
    startPolling(); // restart timer from now so we don't double-poll
  } else {
    stopPolling(); // pause polling when tab is hidden (saves resources)
  }
});

initApp();
