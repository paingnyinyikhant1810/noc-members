/* ═══════════════════════════════════════════════════════════
   NOC Portal — script.js  v3
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
let contextItem         = null;   // { kind:'folder'|'item', id }
let searchDebounceTimer = null;

// ── Role helpers ────────────────────────────────────────────
const ROLE_RANK = { admin:4, leader:3, member:2, intern:1 };
const myRank = () => ROLE_RANK[currentUser?.role] ?? 1;
const isAdmin  = () => currentUser?.role === 'admin';
const canSee   = (perm) => myRank() >= (ROLE_RANK[perm] ?? 1);

// ── Spin keyframe (injected once) ──────────────────────────
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
    o.innerHTML=`<div style="background:var(--surface);border-radius:14px;padding:2rem;box-shadow:0 16px 40px rgba(0,0,0,.3);display:flex;flex-direction:column;align-items:center;gap:1rem;min-width:260px;">
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
  const b=document.getElementById('progressBar'),p=document.getElementById('progressPercent'),s=document.getElementById('loadingStatus');
  if(b)b.style.width=`${pct}%`;if(p)p.textContent=`${Math.round(pct)}%`;if(s&&status)s.textContent=status;
}
function hideLoading(){
  const o=document.getElementById('loadingOverlay');
  if(o){o.classList.add('animate-fadeOut');setTimeout(()=>o.remove(),200);}
}

/* ══════════════════════════════════════════════════════════
   TOAST
══════════════════════════════════════════════════════════ */
function showToast(msg,type='error'){
  const c=document.getElementById('toastContainer');
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
    const res=await fetch(`${API_URL}/${endpoint}`,{...opts,headers:{...getHeaders(),...opts.headers}});
    if(res.status===401){if(!opts.silentFail)logout();return null;}
    if(!res.ok)throw new Error(`HTTP ${res.status}`);
    return res.json();
  }catch(e){
    console.error(e);
    if(!opts.silentFail)showToast('Connection error: '+e.message);
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
    if(!el('adminPage').classList.contains('hidden')&&isAdmin()){renderUsers();renderCategories();}
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
  el('welcomeUser').textContent=currentUser.accountName;
  el('mobileWelcome').textContent=currentUser.accountName;
  const rb=el('userRoleBadge');
  rb.textContent=currentUser.role;
  rb.className='role-badge rb-'+(currentUser.role||'intern');
  updateAdminUI();renderMobileInfoMenu();renderInfoDropdown();
  navigateTo('home');
}

function updateAdminUI(){
  ['adminBtn','mobileAdminBtn','addUpdateBtn','learningAdminBtns','addInfoCardBtn'].forEach(id=>{
    const e=el(id);if(e)isAdmin()?e.classList.remove('hidden'):e.classList.add('hidden');
  });
}
function showLoginPage(){
  el('mainApp').classList.add('hidden');el('loginPage').classList.remove('hidden');
  el('username').value='';el('password').value='';
}
function logout(){localStorage.removeItem('authHeader');authHeader=null;currentUser=null;showLoginPage();closeMobileMenu();}

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
    const creds=atob(authHeader.split(' ')[1]).split(':'),uname=creds[0];
    const found=appData.users.find(u=>u.username===uname);
    currentUser=found?{...found,accountName:found.accountName||found.account_name||uname}:{accountName:uname,role:'intern'};
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
  setTimeout(()=>el('mobileMenu').classList.add('show'),10);renderMobileInfoMenu();
}
function closeMobileMenu(){
  el('mobileMenu').classList.remove('show');
  setTimeout(()=>{el('mobileMenu').classList.add('hidden');el('mobileOverlay').classList.add('hidden');},280);
}
function renderMobileInfoMenu(){
  el('mobileInfoMenu').innerHTML=appData.categories.map(cat=>`
    <button onclick="showInfoCategory(${cat.id},'${escAttr(cat.name)}');closeMobileMenu();" class="mob-nbtn" style="padding-left:1.5rem;">
      <i class="fas ${cat.icon}"></i> ${escHtml(cat.name)}
    </button>`).join('');
}

/* ══════════════════════════════════════════════════════════
   NAVIGATION
══════════════════════════════════════════════════════════ */
function navigateTo(page){
  document.querySelectorAll('.page').forEach(p=>p.classList.add('hidden'));
  document.querySelectorAll('.nav-btn,[data-page]').forEach(b=>b.classList.remove('active'));
  if(page==='home'){el('homePage').classList.remove('hidden');renderUpdates();}
  else if(page==='learning'){el('learningPage').classList.remove('hidden');currentFolderId=null;el('learningSearch').value='';el('clearSearch').classList.add('hidden');el('searchResults').classList.add('hidden');el('learningContainer').classList.remove('hidden');renderLearning();}
  else if(page==='admin'){if(!isAdmin())return;el('adminPage').classList.remove('hidden');showAdminTab('users');}
  document.querySelectorAll(`[data-page="${page}"]`).forEach(b=>b.classList.add('active'));
}

function toggleInfoDropdown(){const d=el('infoDropdown');d.classList.toggle('hidden');renderInfoDropdown();}
function renderInfoDropdown(){
  el('infoDropdown').innerHTML=appData.categories.map(cat=>`
    <button onclick="showInfoCategory(${cat.id},'${escAttr(cat.name)}')" class="dd-item">
      <i class="fas ${cat.icon}"></i> ${escHtml(cat.name)}
    </button>`).join('');
}
function showInfoCategory(catId,catName){
  currentInfoCategory=catId;el('infoDropdown').classList.add('hidden');
  document.querySelectorAll('.page').forEach(p=>p.classList.add('hidden'));
  el('informationPage').classList.remove('hidden');el('infoTitleText').textContent=catName;
  if(isAdmin())el('addInfoCardBtn').classList.remove('hidden');
  renderInfoCards();
}
document.addEventListener('click',e=>{
  const dd=el('infoDropdown'),btn=document.querySelector('[data-page="information"]');
  if(btn&&dd&&!dd.contains(e.target)&&!btn.contains(e.target))dd.classList.add('hidden');
});

/* ══════════════════════════════════════════════════════════
   SAVE / DELETE (generic API wrappers)
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
  }catch(e){hideLoading();showToast('Delete failed');isProcessing=false;return false;}
}

/* ══════════════════════════════════════════════════════════
   UPDATES
══════════════════════════════════════════════════════════ */
function renderUpdates(){
  const bmap={important:'b-important',general:'b-general',announcement:'b-announcement',reminder:'b-reminder'};
  const bicon={important:'🔴',general:'🔵',announcement:'🟢',reminder:'🟡'};
  el('updatesContainer').innerHTML=appData.updates.map(u=>`
    <div class="upd-card">
      <div class="upd-hdr">
        <h3 class="upd-topic">${escHtml(u.topic)}</h3>
        <div class="upd-meta">
          <span class="badge ${bmap[u.badge]||'b-general'}">${bicon[u.badge]||''} ${escHtml(u.badge)}</span>
          ${isAdmin()?`<button onclick="editUpdate(${u.id})" class="icon-btn"><i class="fas fa-edit"></i></button>
          <button onclick="deleteUpdate(${u.id})" class="icon-btn" style="color:#ef4444"><i class="fas fa-trash"></i></button>`:''}
        </div>
      </div>
      <div class="upd-body card-link">${linkify(escHtml(u.message))}</div>
      <div class="upd-foot"><span><i class="fas fa-user-circle"></i> ${escHtml(u.author)}</span><span><i class="fas fa-calendar"></i> ${escHtml(u.date)}</span></div>
    </div>`).join('')||'<div style="text-align:center;padding:3rem;color:var(--text2)"><i class="fas fa-inbox" style="font-size:2rem;display:block;margin-bottom:.5rem"></i>No updates yet</div>';
}
function linkify(t){return t.replace(/(https?:\/\/[^\s<]+)/g,'<a href="$1" target="_blank" rel="noopener">$1</a>').replace(/\n/g,'<br>');}
function openUpdateModal(id=null){
  if(!isAdmin())return;
  el('updateModal').classList.remove('hidden');
  el('updateModalTitle').textContent=id?'Edit Update':'Add Update';
  el('updateId').value=id||'';
  if(id){const u=appData.updates.find(x=>x.id===id);el('updateTopic').value=u.topic;el('updateBadge').value=u.badge;el('updateMessage').value=u.message;}
  else el('updateForm').reset();
}
async function saveUpdate(){
  if(!isAdmin())return;
  const id=el('updateId').value;
  const data={id:id?parseInt(id):null,topic:el('updateTopic').value,badge:el('updateBadge').value,message:el('updateMessage').value,author:currentUser.accountName,date:new Date().toISOString().slice(0,10)};
  if(await saveToApi('updates',data))closeModal('updateModal');
}
function editUpdate(id){if(isAdmin())openUpdateModal(id);}
async function deleteUpdate(id){if(isAdmin()&&confirm('Delete update?'))await deleteFromApi('updates',id);}

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
  el('learningSearch').value='';el('clearSearch').classList.add('hidden');
  el('searchResults').classList.add('hidden');el('learningContainer').classList.remove('hidden');
  renderLearning();
}

function doLearningSearch(q){
  const ql=q.toLowerCase();
  // Filter folders visible to user
  const matchFolders=appData.folders.filter(f=>canSee(f.min_role_required||'intern')&&f.name.toLowerCase().includes(ql));
  // Filter items visible to user
  const matchItems=appData.learningItems.filter(i=>{
    const parentFolder=appData.folders.find(f=>f.id===i.folderId);
    const folderOk=!parentFolder||canSee(parentFolder.min_role_required||'intern');
    const itemOk=canSee(i.min_role_required||'intern');
    return folderOk&&itemOk&&(i.topic.toLowerCase().includes(ql)||(i.content||'').toLowerCase().includes(ql));
  });

  el('searchResults').classList.remove('hidden');
  el('learningContainer').classList.add('hidden');
  el('searchQuery').textContent=`"${q}"`;

  const grid=el('searchResultsGrid');
  if(!matchFolders.length&&!matchItems.length){
    grid.innerHTML='<div style="grid-column:1/-1;text-align:center;padding:2rem;color:var(--text2)"><i class="fas fa-search" style="font-size:1.5rem;display:block;margin-bottom:.5rem"></i>No results found</div>';
    return;
  }
  grid.innerHTML=matchFolders.map(f=>makeFolderCard(f)).join('')+matchItems.map(i=>makeItemCard(i)).join('');
}

/* ══════════════════════════════════════════════════════════
   LEARNING — Render
══════════════════════════════════════════════════════════ */
function renderLearning(){
  renderBreadcrumb();
  // RBAC filter: only show items the current user can see
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
  el('learningContainer').innerHTML=html||'<div style="grid-column:1/-1;text-align:center;padding:3rem;color:var(--text2)"><i class="fas fa-folder-open" style="font-size:2rem;display:block;margin-bottom:.5rem"></i>Empty folder</div>';
}

function makeFolderCard(f){
  const perm=f.min_role_required||'intern';
  return `<div class="file-card" onclick="openFolder(${f.id})" oncontextmenu="showCtx(event,'folder',${f.id})">
    ${isAdmin()?`<div class="card-actions">
      <button class="ca-btn" onclick="event.stopPropagation();openEditItem('folder',${f.id})" title="Edit"><i class="fas fa-edit"></i></button>
      <button class="ca-btn" onclick="event.stopPropagation();openMoveItem('folder',${f.id})" title="Move"><i class="fas fa-arrows-alt"></i></button>
      <button class="ca-btn" onclick="event.stopPropagation();ctxDeleteDirect('folders',${f.id})" title="Delete" style="color:#ef4444"><i class="fas fa-trash"></i></button>
    </div>`:''}
    <div class="fi fi-folder"><i class="fas fa-folder"></i></div>
    <span class="fc-name">${escHtml(f.name)}</span>
    <span class="fc-perm perm-${perm}">${perm}</span>
  </div>`;
}

function makeItemCard(i){
  const isPdf=i.type==='pdf';
  const perm=i.min_role_required||'intern';
  const fiCls=isPdf?'fi-link':'fi-text';
  const faIcon=isPdf?'fa-link':'fa-file-alt';
  return `<div class="file-card" onclick="openLearningItem(${i.id})" oncontextmenu="showCtx(event,'item',${i.id})">
    ${isAdmin()?`<div class="card-actions">
      <button class="ca-btn" onclick="event.stopPropagation();openEditItem('item',${i.id})" title="Edit"><i class="fas fa-edit"></i></button>
      <button class="ca-btn" onclick="event.stopPropagation();openMoveItem('item',${i.id})" title="Move"><i class="fas fa-arrows-alt"></i></button>
      <button class="ca-btn" onclick="event.stopPropagation();ctxDeleteDirect('learning_items',${i.id})" title="Delete" style="color:#ef4444"><i class="fas fa-trash"></i></button>
    </div>`:''}
    <div class="fi ${fiCls}"><i class="fas ${faIcon}"></i></div>
    <span class="fc-name">${escHtml(i.topic)}</span>
    <span class="fc-perm perm-${perm}">${perm}</span>
  </div>`;
}

function renderBreadcrumb(){
  const bc=el('breadcrumb');let path=[],fid=currentFolderId;
  while(fid){const f=appData.folders.find(x=>x.id===fid);if(f){path.unshift(f);fid=f.parentId;}else break;}
  let h=`<button onclick="currentFolderId=null;clearLearningSearch();renderLearning();" class="bc-btn"><i class="fas fa-home"></i> Root</button>`;
  path.forEach(f=>{h+=`<span class="bc-sep">›</span><button onclick="currentFolderId=${f.id};clearLearningSearch();renderLearning();" class="bc-btn">${escHtml(f.name)}</button>`;});
  bc.innerHTML=h;
}

function openFolder(id){currentFolderId=id;clearLearningSearch();renderLearning();}

function openLearningItem(id){
  const item=appData.learningItems.find(i=>i.id===id);
  if(!item)return;
  if(item.type==='pdf'){window.open(item.link,'_blank');}
  else{el('textViewTitle').textContent=item.topic;el('textViewContent').textContent=item.content;el('textViewModal').classList.remove('hidden');}
}

/* ══════════════════════════════════════════════════════════
   LEARNING — Context Menu
══════════════════════════════════════════════════════════ */
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

/* ══════════════════════════════════════════════════════════
   LEARNING — Edit (unified modal)
══════════════════════════════════════════════════════════ */
function openEditItem(kind,id){
  const isFolder=kind==='folder';
  const obj=isFolder?appData.folders.find(f=>f.id===id):appData.learningItems.find(i=>i.id===id);
  if(!obj)return;

  el('editItemTitle').textContent=isFolder?'Edit Folder':'Edit Item';
  el('editItemId').value=id;
  el('editItemKind').value=kind;
  el('editItemName').value=isFolder?obj.name:obj.topic;
  el('editItemPerm').value=obj.min_role_required||'intern';

  el('editItemTypeGroup').classList.toggle('hidden',isFolder);
  el('editItemLinkGroup').classList.toggle('hidden',true);
  el('editItemContentGroup').classList.toggle('hidden',true);

  if(!isFolder){
    el('editItemType').value=obj.type||'pdf';
    onEditItemTypeChange();
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
  const kind=el('editItemKind').value;
  const id=parseInt(el('editItemId').value);
  const name=el('editItemName').value.trim();
  const perm=el('editItemPerm').value;
  if(!name)return showToast('Name is required','error');

  if(kind==='folder'){
    const orig=appData.folders.find(f=>f.id===id);
    const data={...orig,id,name,min_role_required:perm};
    if(await saveToApi('folders',data))closeModal('editItemModal');
  } else {
    const orig=appData.learningItems.find(i=>i.id===id);
    const type=el('editItemType').value;
    const data={...orig,id,topic:name,type,min_role_required:perm,
      link:type==='pdf'?el('editItemLink').value:null,
      content:type==='text'?el('editItemContent').value:null};
    if(await saveToApi('learning_items',data))closeModal('editItemModal');
  }
}

/* ══════════════════════════════════════════════════════════
   LEARNING — Move
══════════════════════════════════════════════════════════ */
function openMoveItem(kind,id){
  const available=appData.folders.filter(f=>{
    if(kind==='folder'&&f.id===id)return false;
    if(kind==='folder'&&isChildFolder(f.id,id))return false;
    return canSee(f.min_role_required||'intern');
  });
  let h=`<button onclick="confirmMove('${kind}',${id},null)"><i class="fas fa-home" style="color:var(--text2)"></i> Root</button>`;
  available.forEach(f=>{h+=`<button onclick="confirmMove('${kind}',${id},${f.id})"><i class="fas fa-folder" style="color:#d97706"></i> ${escHtml(f.name)}</button>`;});
  el('moveFolderList').innerHTML=h;
  el('moveModal').classList.remove('hidden');
}
function isChildFolder(targetId,parentId){
  let cur=targetId;
  while(cur){const f=appData.folders.find(x=>x.id===cur);if(!f)break;if(f.parentId===parentId)return true;cur=f.parentId;}
  return false;
}
async function confirmMove(kind,id,targetId){
  closeModal('moveModal');
  const table=kind==='folder'?'folders':'learning_items';
  let data;
  if(kind==='folder'){const orig=appData.folders.find(f=>f.id===id);data={...orig,parentId:targetId};}
  else{const orig=appData.learningItems.find(i=>i.id===id);data={...orig,folderId:targetId};}
  await saveToApi(table,data);
}

/* ══════════════════════════════════════════════════════════
   LEARNING — Create Folder / Item
══════════════════════════════════════════════════════════ */
function openFolderModal(){
  if(!isAdmin())return;
  el('folderModal').classList.remove('hidden');el('folderModalTitle').textContent='Create Folder';
  el('folderForm').reset();el('folderId').value='';el('folderPermission').value='intern';
}
async function saveFolder(){
  const id=el('folderId').value;const name=el('folderName').value.trim();
  if(!name)return showToast('Name required','error');
  const perm=el('folderPermission').value;
  const data={id:id?parseInt(id):null,name,parentId:currentFolderId,min_role_required:perm};
  if(await saveToApi('folders',data))closeModal('folderModal');
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
    el('learningItemPermission').value=item.min_role_required||'intern';
  } else {
    el('learningItemForm').reset();el('learningItemPermission').value='intern';
  }
  toggleLearningItemFields();
}
function toggleLearningItemFields(){
  const t=el('learningItemType').value;
  el('pdfLinkField').classList.toggle('hidden',t!=='pdf');
  el('textContentField').classList.toggle('hidden',t!=='text');
}
async function saveLearningItem(){
  const id=el('learningItemId').value;const type=el('learningItemType').value;
  const data={id:id?parseInt(id):null,topic:el('learningItemTopic').value,type,
    link:type==='pdf'?el('learningItemLink').value:null,
    content:type==='text'?el('learningItemContent').value:null,
    folderId:currentFolderId,min_role_required:el('learningItemPermission').value};
  if(await saveToApi('learning_items',data))closeModal('learningItemModal');
}

/* rename modal (legacy — kept for compat) */
function renameItem(){if(!isAdmin()||!contextItem)return;const name=contextItem.kind==='folder'?appData.folders.find(f=>f.id===contextItem.id)?.name:appData.learningItems.find(i=>i.id===contextItem.id)?.topic;el('renameInput').value=name||'';el('renameModal').classList.remove('hidden');}
async function confirmRename(){
  if(!isAdmin()||!contextItem)return;const newName=el('renameInput').value.trim();if(!newName)return;
  const table=contextItem.kind==='folder'?'folders':'learning_items';
  let data;if(contextItem.kind==='folder'){const f=appData.folders.find(x=>x.id===contextItem.id);data={...f,name:newName};}
  else{const i=appData.learningItems.find(x=>x.id===contextItem.id);data={...i,topic:newName};}
  if(await saveToApi(table,data))closeModal('renameModal');
}
document.querySelector('#renameModal form').addEventListener('submit',e=>e.preventDefault());
el('renameInput').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();confirmRename();}});

/* ══════════════════════════════════════════════════════════
   INFO CARDS
══════════════════════════════════════════════════════════ */
let longPressTimer,longPressCardId,isLongPress,imageSource='url';
function renderInfoCards(){
  const container=el('infoCardsContainer');
  const cards=appData.infoCards.filter(c=>c.categoryId===currentInfoCategory);
  container.innerHTML=cards.map(card=>`
    <div class="relative" id="ic-${card.id}" style="position:relative">
      <div class="info-card" data-cid="${card.id}"
           onclick="handleInfoCardClick(event,${card.id},'${escAttr(card.link)}')"
           ${isAdmin()?`oncontextmenu="showInfoCardCtx(event,${card.id})"`:''}>
        ${card.displayType==='image'&&card.image
          ?`<img src="${escAttr(card.image)}" alt="${escAttr(card.title)}" class="info-card-img" onerror="this.style.display='none'">`
          :`<div class="info-icon"><i class="fas ${card.icon||'fa-link'}"></i></div>`}
        <span style="font-size:.8rem;font-weight:600;color:var(--text);line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${escHtml(card.title)}</span>
      </div>
      ${isAdmin()?`<div style="position:absolute;top:.35rem;right:.35rem;opacity:0;transition:opacity .15s" class="ica-wrap">
        <button onclick="editInfoCard(event,${card.id})" class="ca-btn"><i class="fas fa-edit"></i></button>
      </div>`:''}
    </div>`).join('')||'<div style="grid-column:1/-1;text-align:center;padding:3rem;color:var(--text2)">No items yet</div>';
  container.querySelectorAll('[id^="ic-"]').forEach(el=>{const w=el.querySelector('.ica-wrap');if(w){el.addEventListener('mouseenter',()=>w.style.opacity='1');el.addEventListener('mouseleave',()=>w.style.opacity='0');}});
  if(isAdmin()){cards.forEach(card=>{const e=document.querySelector(`[data-cid="${card.id}"]`);if(e){e.addEventListener('touchstart',ev=>startLongPress(ev,card.id),{passive:true});e.addEventListener('touchend',endLongPress);e.addEventListener('touchmove',cancelLongPress);}});}
}
function handleInfoCardClick(event,cardId,link){if(isLongPress){event.preventDefault();isLongPress=false;return;}window.open(link,'_blank');}
function startLongPress(e,id){if(!isAdmin())return;isLongPress=false;longPressCardId=id;longPressTimer=setTimeout(()=>{isLongPress=true;if(navigator.vibrate)navigator.vibrate(50);showInfoCardCtx(e,id);},500);}
function endLongPress(){clearTimeout(longPressTimer);}
function cancelLongPress(){clearTimeout(longPressTimer);isLongPress=false;}
function showInfoCardCtx(e,id){if(!isAdmin())return;longPressCardId=id;const m=el('infoCardContextMenu');m.classList.remove('hidden');const x=e.touches?e.touches[0].clientX:e.clientX,y=e.touches?e.touches[0].clientY:e.clientY;m.style.left=Math.min(x,window.innerWidth-180)+'px';m.style.top=Math.min(y,window.innerHeight-120)+'px';}
document.addEventListener('click',e=>{const m=el('infoCardContextMenu');if(m&&!m.classList.contains('hidden')&&!m.contains(e.target))m.classList.add('hidden');});
function editInfoCardFromContext(){el('infoCardContextMenu').classList.add('hidden');openInfoCardModal(longPressCardId);}
async function deleteInfoCardFromContext(){el('infoCardContextMenu').classList.add('hidden');if(confirm('Delete?'))await deleteFromApi('info_cards',longPressCardId);}
function setImageSource(src){imageSource=src;el('imageUrlField').classList.toggle('hidden',src!=='url');el('imageUploadField').classList.toggle('hidden',src!=='upload');const u=el('imgSourceUrl'),up=el('imgSourceUpload');if(src==='url'){u.className='btn-primary flex1';up.className='btn-secondary flex1';}else{up.className='btn-primary flex1';u.className='btn-secondary flex1';}}
function handleImageUpload(event){const file=event.target.files[0];if(!file||file.size>2*1024*1024)return showToast('Image too large (>2MB)');const r=new FileReader();r.onload=e=>{el('infoCardImage').value=e.target.result;el('previewImg').src=e.target.result;el('uploadPlaceholder').classList.add('hidden');el('uploadPreview').classList.remove('hidden');};r.readAsDataURL(file);}
function openInfoCardModal(id=null){if(!isAdmin())return;el('infoCardModal').classList.remove('hidden');el('infoCardModalTitle').textContent=id?'Edit':'Add';el('infoCardId').value=id||'';el('uploadPreview').classList.add('hidden');el('uploadPlaceholder').classList.remove('hidden');if(id){const c=appData.infoCards.find(x=>x.id===id);el('infoCardTitle').value=c.title;el('infoCardDisplayType').value=c.displayType;el('infoCardIcon').value=c.icon;el('infoCardLink').value=c.link;el('infoCardImage').value=c.image||'';el('infoCardImageUrl').value=c.image||'';if(c.image&&c.image.startsWith('data:')){setImageSource('upload');el('previewImg').src=c.image;el('uploadPlaceholder').classList.add('hidden');el('uploadPreview').classList.remove('hidden');}else setImageSource('url');}else{el('infoCardForm').reset();setImageSource('url');}toggleInfoCardFields();}
function toggleInfoCardFields(){const t=el('infoCardDisplayType').value;el('iconField').classList.toggle('hidden',t!=='icon');el('imageField').classList.toggle('hidden',t!=='image');}
async function saveInfoCard(){const id=el('infoCardId').value;const dt=el('infoCardDisplayType').value;const img=dt==='image'?(imageSource==='url'?el('infoCardImageUrl').value:el('infoCardImage').value):null;const data={id:id?parseInt(id):null,title:el('infoCardTitle').value,displayType:dt,icon:el('infoCardIcon').value,image:img,link:el('infoCardLink').value,categoryId:currentInfoCategory};if(await saveToApi('info_cards',data))closeModal('infoCardModal');}
function editInfoCard(e,id){e.preventDefault();e.stopPropagation();openInfoCardModal(id);}

/* ══════════════════════════════════════════════════════════
   ADMIN
══════════════════════════════════════════════════════════ */
let visiblePwds={};
function togglePasswordVisibility(id){visiblePwds[id]=!visiblePwds[id];renderUsers();}
function toggleEditPasswordVisibility(){const p=el('userPassword'),btn=el('toggleEditPassword');if(!btn)return;p.type=p.type==='password'?'text':'password';btn.querySelector('i').className='fas '+(p.type==='password'?'fa-eye':'fa-eye-slash');}
function renderUsers(){
  el('usersTable').innerHTML=appData.users.map(u=>`
    <tr>
      <td><div style="display:flex;align-items:center;gap:.6rem"><div style="width:34px;height:34px;background:var(--border);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:.8rem;color:var(--text2)"><i class="fas fa-user"></i></div><span style="font-weight:600">${escHtml(u.accountName||u.account_name||u.username)}</span></div></td>
      <td class="col-sm">${escHtml(u.username)}</td>
      <td><div style="display:flex;align-items:center;gap:.35rem"><span style="font-family:monospace;font-size:.82rem;${visiblePwds[u.id]?'':'letter-spacing:.1em'}">${visiblePwds[u.id]?escHtml(u.password):'••••'}</span><button onclick="togglePasswordVisibility(${u.id})" class="icon-btn"><i class="fas ${visiblePwds[u.id]?'fa-eye-slash':'fa-eye'}"></i></button></div></td>
      <td><span class="badge b-${u.role==='admin'?'important':u.role==='leader'?'general':u.role==='member'?'announcement':'reminder'}">${escHtml(u.role)}</span></td>
      <td class="tr"><button onclick="editUser(${u.id})" class="icon-btn" style="color:var(--accent)"><i class="fas fa-edit"></i></button>${u.id!==currentUser.id?`<button onclick="deleteFromApi('users',${u.id})" class="icon-btn" style="color:#ef4444"><i class="fas fa-trash"></i></button>`:''}</td>
    </tr>`).join('');
}
function showAdminTab(tab){if(!isAdmin())return;document.querySelectorAll('.admin-tab').forEach(t=>t.classList.remove('active','bg-white','shadow-sm'));document.querySelectorAll('.admin-tc').forEach(c=>c.classList.add('hidden'));document.querySelector(`[data-tab="${tab}"]`).classList.add('active','bg-white','shadow-sm');el(`${tab}Tab`).classList.remove('hidden');if(tab==='users')renderUsers();if(tab==='categories')renderCategories();}
function renderCategories(){el('categoriesList').innerHTML=appData.categories.map(cat=>`<div class="cat-card"><div style="display:flex;align-items:center;gap:.65rem"><div class="cat-icon"><i class="fas ${cat.icon}"></i></div><span style="font-weight:600">${escHtml(cat.name)}</span></div><div style="display:flex;gap:.35rem"><button onclick="openCategoryModal(${cat.id})" class="icon-btn" style="color:var(--accent)"><i class="fas fa-edit"></i></button><button onclick="deleteFromApi('categories',${cat.id})" class="icon-btn" style="color:#ef4444"><i class="fas fa-trash"></i></button></div></div>`).join('');}
function openCategoryModal(id=null){el('categoryModal').classList.remove('hidden');el('categoryId').value=id||'';if(id){const c=appData.categories.find(x=>x.id===id);el('categoryName').value=c.name;el('categoryIcon').value=c.icon;}else el('categoryForm').reset();}
async function saveCategory(){const id=el('categoryId').value;const data={id:id?parseInt(id):null,name:el('categoryName').value,icon:el('categoryIcon').value};if(await saveToApi('categories',data))closeModal('categoryModal');}
function openUserModal(id=null){el('userModal').classList.remove('hidden');el('userModalTitle').textContent=id?'Edit User':'Add User';el('userId').value=id||'';const p=el('userPassword');p.type='password';const ti=el('toggleEditPassword');if(ti){ti.querySelector('i').className='fas fa-eye';}if(id){const u=appData.users.find(x=>x.id===id);el('userAccountName').value=u.accountName||u.account_name||'';el('userUsername').value=u.username;el('userPassword').value=u.password;el('userRole').value=u.role;}else el('userForm').reset();}
async function saveUser(){const id=el('userId').value;const data={id:id?parseInt(id):null,accountName:el('userAccountName').value,username:el('userUsername').value,password:el('userPassword').value,role:el('userRole').value};if(await saveToApi('users',data))closeModal('userModal');}
function editUser(id){openUserModal(id);}

/* ══════════════════════════════════════════════════════════
   SETTINGS
══════════════════════════════════════════════════════════ */
function openSettings(){
  loadPreferencesUI();
  el('settingsModal').classList.remove('hidden');
}
function loadPreferencesUI(){
  const prefs=getPrefs();
  el('darkModeToggle').checked=prefs.dark;
  document.querySelectorAll('.font-opt').forEach(b=>b.classList.toggle('active',b.dataset.font===prefs.font));
  document.querySelectorAll('.msize-opt').forEach(b=>b.classList.toggle('active',b.dataset.msize===prefs.modal));
}
function getPrefs(){return{dark:localStorage.getItem('noc_dark')==='1',color:localStorage.getItem('noc_color')||'blue',font:localStorage.getItem('noc_font')||'md',modal:localStorage.getItem('noc_modal')||'md'};}
function loadPreferences(){const p=getPrefs();applyDarkMode(p.dark,false);applyColor(p.color,false);applyFont(p.font,false);applyModalSize(p.modal,false);}
function applyDarkMode(on,save=true){document.documentElement.setAttribute('data-theme',on?'dark':'light');if(save)localStorage.setItem('noc_dark',on?'1':'0');}
function applyColor(c,save=true){document.documentElement.setAttribute('data-color',c);if(save)localStorage.setItem('noc_color',c);}
function applyFont(f,save=true){document.documentElement.setAttribute('data-font',f);if(save)localStorage.setItem('noc_font',f);if(save)loadPreferencesUI();}
function applyModalSize(m,save=true){document.documentElement.setAttribute('data-modal',m);if(save)localStorage.setItem('noc_modal',m);if(save)loadPreferencesUI();}

/* ══════════════════════════════════════════════════════════
   NOC UTILITIES
══════════════════════════════════════════════════════════ */
function openUtilities(){el('utilitiesModal').classList.remove('hidden');switchUtilTab('time');convertTime();loadStickyNotes();}
function switchUtilTab(tab){
  document.querySelectorAll('.util-tab').forEach(t=>t.classList.toggle('active',t.dataset.utab===tab));
  document.querySelectorAll('.util-panel').forEach(p=>p.classList.add('hidden'));
  el('util'+tab.charAt(0).toUpperCase()+tab.slice(1)).classList.remove('hidden');
}

/* ── Time Converter ─────────────────────────────────────── */
const TZ_LIST=[
  {id:'UTC',  label:'UTC',  name:'UTC',               offset:0},
  {id:'MMT',  label:'MMT',  name:'Myanmar (UTC+6:30)', offset:390},
  {id:'IST',  label:'IST',  name:'India (UTC+5:30)',   offset:330},
  {id:'ICT',  label:'ICT',  name:'Indochina (UTC+7)',  offset:420},
  {id:'SGT',  label:'SGT',  name:'Singapore (UTC+8)',  offset:480},
];
function convertTime(){
  const h=parseInt(el('tcHour').value)||0,m=parseInt(el('tcMin').value)||0,fmt=el('tcFmt').value;
  if(h<0||h>23||m<0||m>59){el('timeResults').innerHTML='<div style="color:#ef4444;font-size:.85rem;padding:.5rem">Invalid time</div>';return;}
  const totalMin=h*60+m;
  el('timeResults').innerHTML=TZ_LIST.map(tz=>{
    let mins=(totalMin+tz.offset)%1440;if(mins<0)mins+=1440;
    const th=Math.floor(mins/60),tm=mins%60;
    let display;
    if(fmt==='12'){const ampm=th>=12?'PM':'AM';const h12=th%12||12;display=`${pad(h12)}:${pad(tm)} ${ampm}`;}
    else display=`${pad(th)}:${pad(tm)}`;
    return `<div class="tz-row"><div><div class="tz-label">${tz.label}</div><div class="tz-name">${tz.name}</div></div><div class="tz-time">${display}</div></div>`;
  }).join('');
}
function pad(n){return String(n).padStart(2,'0');}

/* ── Subnet Calculator ──────────────────────────────────── */
el('subnetInput').addEventListener('input',calcSubnet);
function calcSubnet(){
  const raw=el('subnetInput').value.trim();
  const out=el('subnetResults');
  if(!raw){out.innerHTML='';return;}
  try{
    const [ipPart,cidrPart]=raw.split('/');
    if(!cidrPart)throw new Error('Enter CIDR notation, e.g. 192.168.1.0/24');
    const cidr=parseInt(cidrPart);
    if(cidr<0||cidr>32)throw new Error('CIDR must be 0–32');
    const ipNums=ipPart.split('.').map(Number);
    if(ipNums.length!==4||ipNums.some(n=>isNaN(n)||n<0||n>255))throw new Error('Invalid IP address');

    const ipInt=ipNums.reduce((acc,b)=>(acc<<8)+b,0)>>>0;
    const mask=cidr===0?0:(0xFFFFFFFF<<(32-cidr))>>>0;
    const network=(ipInt&mask)>>>0;
    const broadcast=(network|(~mask>>>0))>>>0;
    const first=(network+1)>>>0;
    const last=(broadcast-1)>>>0;
    const total=Math.pow(2,32-cidr);
    const usable=cidr>=31?total:Math.max(0,total-2);

    const i2s=n=>[24,16,8,0].map(s=>(n>>s)&0xFF).join('.');
    const maskStr=i2s(mask);
    const wild=i2s(~mask>>>0);

    const rows=[
      ['Network Address',i2s(network)],
      ['Subnet Mask',maskStr],
      ['Wildcard Mask',wild],
      ['Broadcast',i2s(broadcast)],
      ['First Host',cidr>=31?'N/A':i2s(first)],
      ['Last Host',cidr>=31?'N/A':i2s(last)],
      ['Total IPs',total.toLocaleString()],
      ['Usable Hosts',usable.toLocaleString()],
      ['CIDR',`/${cidr}`],
    ];
    out.innerHTML=rows.map(([l,v])=>`<div class="sn-row"><span class="sn-label">${l}</span><span class="sn-val">${v}</span></div>`).join('');
  }catch(e){out.innerHTML=`<div class="sn-error"><i class="fas fa-exclamation-circle"></i> ${escHtml(e.message)}</div>`;}
}

/* ── Handover Sticky Notes ──────────────────────────────── */
const STICKY_COLORS=['#fef9c3','#fce7f3','#dbeafe','#d1fae5','#ede9fe','#fee2e2'];
const STICKY_TEXT_COLORS=['#1e293b','#1e293b','#1e293b','#1e293b','#1e293b','#1e293b'];
let stickyNotes=[];

function loadStickyNotes(){stickyNotes=JSON.parse(localStorage.getItem('noc_sticky')||'[]');renderStickyNotes();}
function saveStickyNotes(){localStorage.setItem('noc_sticky',JSON.stringify(stickyNotes));}
function addStickyNote(){
  stickyNotes.push({id:Date.now(),text:'',color:STICKY_COLORS[Math.floor(Math.random()*STICKY_COLORS.length)]});
  saveStickyNotes();renderStickyNotes();
}
function deleteSticky(id){stickyNotes=stickyNotes.filter(n=>n.id!==id);saveStickyNotes();renderStickyNotes();}
function updateStickyText(id,text){const n=stickyNotes.find(x=>x.id===id);if(n){n.text=text;saveStickyNotes();}}
function updateStickyColor(id,color){const n=stickyNotes.find(x=>x.id===id);if(n){n.color=color;saveStickyNotes();renderStickyNotes();}}
function renderStickyNotes(){
  const board=el('stickyBoard');
  if(!stickyNotes.length){board.innerHTML='<div style="grid-column:1/-1;text-align:center;padding:2rem;color:var(--text2);font-size:.85rem"><i class="fas fa-sticky-note" style="font-size:1.5rem;display:block;margin-bottom:.5rem"></i>No notes yet. Click + Add Note</div>';return;}
  board.innerHTML=stickyNotes.map(n=>`
    <div class="sticky-note" style="background:${n.color}">
      <textarea placeholder="Type your note…" oninput="updateStickyText(${n.id},this.value)">${escHtml(n.text)}</textarea>
      <div class="sticky-note-actions">
        <div class="sticky-color-pick">
          ${STICKY_COLORS.map((c,i)=>`<button class="sc-dot" style="background:${c};border:${n.color===c?'2px solid #1e293b':'1px solid rgba(0,0,0,.15)'}" onclick="updateStickyColor(${n.id},'${c}')"></button>`).join('')}
        </div>
        <button class="sticky-del" onclick="deleteSticky(${n.id})"><i class="fas fa-times"></i></button>
      </div>
    </div>`).join('');
}

/* ══════════════════════════════════════════════════════════
   MODALS — general
══════════════════════════════════════════════════════════ */
function closeModal(id){el(id).classList.add('hidden');}
document.querySelectorAll('.modal-bd').forEach(bd=>{bd.addEventListener('click',e=>{if(e.target===bd)bd.classList.add('hidden');});});
document.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelectorAll('.modal-bd').forEach(m=>m.classList.add('hidden'));});

/* ══════════════════════════════════════════════════════════
   UTILS
══════════════════════════════════════════════════════════ */
function el(id){return document.getElementById(id);}
function escHtml(s){if(s==null)return'';return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function escAttr(s){if(s==null)return'';return String(s).replace(/'/g,"\\'").replace(/"/g,'&quot;');}
function delay(ms){return new Promise(r=>setTimeout(r,ms));}
async function simulateProgress(pct,status){updateProgress(pct,status);await delay(200);}

/* ══════════════════════════════════════════════════════════
   BOOT
══════════════════════════════════════════════════════════ */
initApp();
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&authHeader)refreshData(true);});
