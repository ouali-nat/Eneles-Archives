(function(){
'use strict';
const FOLDER_TABLE='cases_personnelles',ASSIGN_TABLE='documents_cases_personnelles',PRIVATE_TABLE='documents_personnels_prives',MAX_FOLDERS=10,PRIVE_TAILLE_MAX=104857600,STORAGE_LIMIT_BYTES=1000000000;let folders=[],folderAssignments=[],privateDocs=[],draggedFolderId=null;let storageUsageCache=null,storageUsageAt=0,storageUsagePromise=null,storageUsageUserId='';
const esc=v=>typeof escapeTextePersonnel==='function'?escapeTextePersonnel(v==null?'':String(v)):String(v==null?'':v).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const uid=()=>session?.id?String(session.id):'';
async function api(table,o={}){if(!session?.access_token)throw new Error('SESSION_ABSENTE');const r=await fetch(`${SUPABASE_URL}/rest/v1/${table}${o.query?'?'+o.query:''}`,{method:o.method||'GET',headers:{...headersAdmin(),'Content-Type':'application/json',...(o.headers||{})},body:o.body?JSON.stringify(o.body):undefined,cache:'no-store'});if(!r.ok)throw new Error(`${table} HTTP ${r.status} ${await r.text().catch(()=> '')}`);return r.status===204?'':await r.text();}
const lk=()=>`aurore_cases_personnelles_${uid()}`,ak=()=>`aurore_cases_documents_${uid()}`;const read=(k,d)=>{try{const v=localStorage.getItem(k);return v?JSON.parse(v):d}catch(e){return d}};const write=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}};
function normF(a){return(Array.isArray(a)?a:[]).filter(x=>x&&x.id!=null).map((x,i)=>({id:String(x.id),name:String(x.name||'Sans nom').trim().slice(0,60)||'Sans nom',parent_id:x.parent_id?String(x.parent_id):null,position:Number.isFinite(+x.position)?+x.position:i})).sort((a,b)=>a.position-b.position)}
function normA(a){return(Array.isArray(a)?a:[]).filter(x=>x&&x.document_id!=null&&x.case_id!=null).map(x=>({document_id:String(x.document_id),case_id:String(x.case_id)}))}
function normP(a){return(Array.isArray(a)?a:[]).filter(x=>x&&x.id!=null&&x.case_id!=null).map(x=>({id:String(x.id),case_id:String(x.case_id),titre:String(x.titre||'Document').trim().slice(0,150)||'Document',fichier_url:String(x.fichier_url||''),taille_octets:Number(x.taille_octets)||0,type_fichier:x.type_fichier||null,created_at:x.created_at||null}))}

function formaterOctets(n){const v=Math.max(0,Number(n)||0);return v.toLocaleString('fr-FR')+' octets ('+(v/1000000).toLocaleString('fr-FR',{minimumFractionDigits:2,maximumFractionDigits:2})+' Mo)';}
async function actualiserUtilisationStockage(force=false){
  const currentUid=uid();
  if(!currentUid){storageUsageCache=null;storageUsageAt=0;storageUsageUserId='';document.querySelectorAll('[data-storage-trigger-remaining]').forEach(el=>el.textContent='Connexion requise');return {documents_count:0,bytes_used:0,storage_limit_bytes:STORAGE_LIMIT_BYTES};}
  if(storageUsageUserId!==currentUid){storageUsageCache=null;storageUsageAt=0;storageUsageUserId=currentUid;}
  if(!force&&storageUsageCache&&Date.now()-storageUsageAt<15000)return storageUsageCache;
  if(storageUsagePromise)return storageUsagePromise;
  storageUsagePromise=(async()=>{const raw=await api('rpc/aurore_personal_storage_usage',{method:'POST',body:{}});const parsed=raw?JSON.parse(raw):[];const row=Array.isArray(parsed)?(parsed[0]||{}):(parsed||{});
    storageUsageCache={documents_count:Number(row.documents_count)||0,bytes_used:Number(row.bytes_used)||0,storage_limit_bytes:Number(row.storage_limit_bytes)||STORAGE_LIMIT_BYTES};storageUsageAt=Date.now();actualiserAffichageStockage();return storageUsageCache;
  })().finally(()=>{storageUsagePromise=null;});return storageUsagePromise;
}
function ensureStorageModal(){
  let modal=document.getElementById('personalStorageModal');if(modal)return modal;
  modal=document.createElement('div');modal.id='personalStorageModal';modal.className='personal-storage-modal';modal.setAttribute('aria-hidden','true');
  modal.innerHTML='<section class="personal-storage-dialog" role="dialog" aria-modal="true" aria-labelledby="personalStorageTitle"><button type="button" class="personal-storage-close" aria-label="Fermer">×</button><span class="personal-storage-kicker">ESPACE PERSONNEL</span><h3 id="personalStorageTitle">Votre stockage Eneles</h3><p class="personal-storage-lead">Votre espace de dépôt personnel est limité à 1 Go. Seuls les PDF déposés dans vos cases sont comptabilisés.</p><div class="personal-storage-meter"><div class="personal-storage-meter-head"><strong data-storage-used>Calcul en cours…</strong><span data-storage-percent>—</span></div><div class="personal-storage-track"><span data-storage-bar></span></div><div class="personal-storage-meter-foot"><span><b data-storage-remaining>—</b><small>disponibles</small></span><span><b data-storage-count>—</b><small>PDF déposés</small></span></div></div><div class="personal-storage-details"><div><span>Documents dans vos cases</span><strong data-storage-total-docs>—</strong></div><div><span>Capacité maximale</span><strong>1 Go (1 000 000 000 octets)</strong></div></div><p class="personal-storage-note">Les documents de la bibliothèque publique classés dans vos cases ne consomment pas ce quota.</p></section>';
  document.body.appendChild(modal);modal.addEventListener('click',e=>{if(e.target===modal)fermerStockageModal();});modal.querySelector('.personal-storage-close').addEventListener('click',fermerStockageModal);return modal;
}
function actualiserAffichageStockage(){
  const usage=storageUsageCache;if(!usage)return;const limit=usage.storage_limit_bytes||STORAGE_LIMIT_BYTES,used=usage.bytes_used||0,remaining=Math.max(0,limit-used),percent=Math.min(100,limit?used/limit*100:0);
  const set=(sel,val)=>document.querySelectorAll(sel).forEach(el=>{el.textContent=val;});
  set('[data-storage-used]',formaterOctets(used)+' utilisés');set('[data-storage-remaining]',formaterOctets(remaining));set('[data-storage-count]',String(usage.documents_count));
  set('[data-storage-total-docs]',String(privateDocs.length+folderAssignments.length));set('[data-storage-trigger-remaining]',formaterOctets(remaining)+' libres');set('[data-storage-trigger-total]',String(privateDocs.length+folderAssignments.length)+' documents');set('[data-storage-percent]',percent.toLocaleString('fr-FR',{maximumFractionDigits:1})+' %');document.querySelectorAll('[data-storage-bar]').forEach(el=>el.style.width=percent+'%');
  const panel=document.getElementById('pfuStorageSummary');if(panel){const file=panel._selectedFile||null,after=used+(file?Number(file.size)||0:0),left=Math.max(0,limit-after);panel.querySelector('[data-storage-inline-used]').textContent=formaterOctets(used)+' utilisés · '+usage.documents_count+' PDF';panel.querySelector('[data-storage-inline-remaining]').textContent=file?(after>limit?'Ce dépôt dépasserait votre quota de 1 Go.':'Après ce dépôt : '+formaterOctets(left)+' restants.'):'Il vous reste '+formaterOctets(remaining)+'.';panel.classList.toggle('is-over-limit',after>limit);}
}
function ouvrirStockageModal(){const modal=ensureStorageModal();modal.classList.add('show');modal.setAttribute('aria-hidden','false');actualiserAffichageStockage();actualiserUtilisationStockage(true).catch(e=>console.warn('[Stockage personnel] actualisation:',e));}
function fermerStockageModal(){const modal=document.getElementById('personalStorageModal');if(modal){modal.classList.remove('show');modal.setAttribute('aria-hidden','true');}}
function ensureStorageControls(){const head=document.querySelector('#personalFolders .personal-folders-head');if(!head)return;let actions=head.querySelector('.personal-folders-head-actions');if(!actions){actions=document.createElement('div');actions.className='personal-folders-head-actions';const counter=head.querySelector('.personal-folder-limit');if(counter)actions.appendChild(counter);const btn=document.createElement('button');btn.type='button';btn.className='personal-storage-trigger';btn.innerHTML='<span class="personal-storage-trigger-icon">▤</span><span>Stockage <b data-storage-trigger-remaining>Calcul…</b><small data-storage-trigger-total>— documents</small></span>';btn.addEventListener('click',ouvrirStockageModal);actions.appendChild(btn);head.appendChild(actions);}}
function afficherConfirmationDepotStockage(){
  const usage=storageUsageCache;if(!usage)return;
  const host=document.querySelector('#screen-personal-case .personal-section-detail-head');if(!host)return;
  document.getElementById('personalStorageDepositNotice')?.remove();
  const notice=document.createElement('div');notice.id='personalStorageDepositNotice';notice.className='personal-storage-success';
  notice.innerHTML='<strong>Document déposé</strong><span data-storage-success-summary></span>';
  const remaining=Math.max(0,(usage.storage_limit_bytes||STORAGE_LIMIT_BYTES)-(usage.bytes_used||0));
  notice.querySelector('[data-storage-success-summary]').textContent='Espace restant : '+formaterOctets(remaining)+' · '+(privateDocs.length+folderAssignments.length)+' documents dans vos cases · '+usage.documents_count+' PDF comptabilisés.';
  host.insertAdjacentElement('afterend',notice);
  setTimeout(()=>notice.remove(),10000);
}
function afficherResumeStockageImport(panel){const frame=panel.querySelector('#pfuStorageSummary');if(!frame)return;frame._selectedFile=panel.querySelector('#pfuFichier')?.files?.[0]||null;if(storageUsageCache)actualiserAffichageStockage();else actualiserUtilisationStockage(true).catch(e=>{console.warn('[Stockage personnel] calcul:',e);const a=frame.querySelector('[data-storage-inline-used]');if(a)a.textContent='Calcul du stockage indisponible.';});}
const pk=()=>`aurore_cases_documents_prives_${uid()}`;
async function load(){
  if(!uid())return;
  const localFolders=normF(read(lk(),[]));
  let foldersLoaded=false;
  try{
    const raw=await api(FOLDER_TABLE,{query:`select=id,name,parent_id,position,created_at&user_id=eq.${encodeURIComponent(uid())}&order=position.asc,created_at.asc`});
    const serverFolders=normF(raw?JSON.parse(raw):[]);
    if(serverFolders.length){
      folders=serverFolders; write(lk(),folders);
    }else if(localFolders.length){
      // Une réponse vide peut arriver pendant la restauration de session/RLS.
      // Ne jamais remplacer des cases connues par une case par défaut.
      folders=localFolders;
    }else{
      await createFolder('À classer',true);
    }
    foldersLoaded=true;
  }catch(e){
    folders=localFolders;
    if(!folders.length){folders=[{id:'local-default',name:'À classer',position:0}];write(lk(),folders);}
  }
  try{
    const raw=await api(ASSIGN_TABLE,{query:`select=document_id,case_id&user_id=eq.${encodeURIComponent(uid())}`});
    const serverAssignments=normA(raw?JSON.parse(raw):[]);
    const localAssignments=normA(read(ak(),[]));
    // En cas de réponse vide transitoire, conserver les affectations locales.
    folderAssignments=serverAssignments.length?serverAssignments:localAssignments;
    write(ak(),folderAssignments);
  }catch(e){folderAssignments=normA(read(ak(),[]));}
  try{
    const raw=await api(PRIVATE_TABLE,{query:`select=id,case_id,titre,fichier_url,taille_octets,type_fichier,created_at&user_id=eq.${encodeURIComponent(uid())}&order=created_at.asc`});
    const serverPrivate=normP(raw?JSON.parse(raw):[]);
    const localPrivate=normP(read(pk(),[]));
    privateDocs=serverPrivate.length?serverPrivate:localPrivate;
    write(pk(),privateDocs);
  }catch(e){privateDocs=normP(read(pk(),[]));}
  render();
}
function render(){ensureStorageControls();actualiserAffichageStockage();actualiserUtilisationStockage().catch(e=>console.warn('[Stockage personnel] état:',e));const grid=document.getElementById('personalFolderGrid');if(!grid)return;const roots=folders.filter(x=>!x.parent_id);document.getElementById('personalFolderCount').textContent=String(roots.length);grid.innerHTML='';roots.forEach(f=>{const c=document.createElement('article');c.className='personal-folder';c.draggable=true;c.dataset.folderId=f.id;const n=folderAssignments.filter(a=>a.case_id===f.id).length+privateDocs.filter(x=>x.case_id===f.id).length;c.innerHTML=`<div class="personal-folder-top"><div class="personal-folder-icon">▱</div><button type="button" class="personal-folder-menu" aria-label="Options">⋯</button></div><div class="personal-folder-name" title="${esc(f.name)}">${esc(f.name)}</div><div class="personal-folder-count">${n} document${n>1?'s':''}</div><div class="personal-folder-hint">Glisser pour déplacer</div>`;c.addEventListener('click',e=>{if(!e.target.closest('.personal-folder-menu'))openFolder(f)});c.querySelector('.personal-folder-menu').addEventListener('click',e=>{e.stopPropagation();folderMenu(f)});c.addEventListener('dragstart',()=>{draggedFolderId=f.id;c.classList.add('dragging')});c.addEventListener('dragend',()=>{draggedFolderId=null;c.classList.remove('dragging');grid.querySelectorAll('.drag-over').forEach(x=>x.classList.remove('drag-over'))});c.addEventListener('dragover',e=>{e.preventDefault();if(draggedFolderId!==f.id)c.classList.add('drag-over')});c.addEventListener('dragleave',()=>c.classList.remove('drag-over'));c.addEventListener('drop',e=>{e.preventDefault();c.classList.remove('drag-over');if(draggedFolderId&&draggedFolderId!==f.id)reorder(draggedFolderId,f.id)});grid.appendChild(c)});if(roots.length<MAX_FOLDERS){const b=document.createElement('button');b.type='button';b.className='personal-folder-create';b.innerHTML=`<span class="personal-folder-create-icon">＋</span><strong>Créer une case</strong><span>Encore ${MAX_FOLDERS-roots.length} emplacement${MAX_FOLDERS-roots.length>1?'s':''}</span>`;b.onclick=()=>dialog('create');grid.appendChild(b)}}
async function createFolder(name,quiet=false,parentId=null){
  const normalizedParent=parentId?String(parentId):null;
  const siblings=folders.filter(f=>(f.parent_id||null)===normalizedParent).sort((a,b)=>a.position-b.position);
  // La limite de 10 concerne les cases racines. Les sous-dossiers peuvent
  // être créés dans chaque case sans consommer les emplacements racine.
  if(!normalizedParent && siblings.length>=MAX_FOLDERS){if(!quiet)alert('Vous avez atteint la limite de 10 cases.');return}
  const clean=String(name||'').trim().replace(/\s+/g,' ').slice(0,60);
  if(!clean)return;
  if(siblings.some(f=>f.name.toLocaleLowerCase('fr')===clean.toLocaleLowerCase('fr'))){if(!quiet)alert('Une case porte déjà ce nom.');return}
  if(!quiet && typeof window.auroreAfficherVeuillezPatienter==='function'){
    window.auroreAfficherVeuillezPatienter('Création de votre case en cours…');
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  }
  try{
    const raw=await api(FOLDER_TABLE,{method:'POST',headers:{Prefer:'return=representation'},body:{user_id:uid(),name:clean,parent_id:parentId||null,position:siblings.length}});
    const r=raw?JSON.parse(raw):[];
    if(!Array.isArray(r)||!r[0]) throw new Error('Supabase n’a renvoyé aucune ligne créée. Vérifiez les droits INSERT/SELECT et la politique RLS de cases_personnelles.');
    folders=normF([...folders,r[0]]);
    write(lk(),folders);
  }catch(e){
    console.error('[Cases personnelles] création impossible:',e);
    if(quiet){
      folders=[...folders,{id:'local-'+Date.now().toString(36),name:clean,parent_id:parentId||null,position:siblings.length}];
      write(lk(),folders);
    }else{
      const detail=String(e?.message||e||'Erreur inconnue').replace(/\\s+/g,' ').slice(0,320);
      const duplicate=/23505|cases_personnelles_user_(?:root_)?name_unique|cases_personnelles_user_parent_name_unique/i.test(detail);
      if(duplicate){
        alert('Ce nom est déjà utilisé dans ce dossier. Choisissez un autre nom.');
        try{
          const latest=await api(FOLDER_TABLE,{query:`select=id,name,parent_id,position,created_at&user_id=eq.${encodeURIComponent(uid())}&order=position.asc,created_at.asc`});
          const rows=latest?JSON.parse(latest):[];
          if(Array.isArray(rows)){folders=normF(rows);write(lk(),folders);}
        }catch(refreshError){console.warn('[Cases personnelles] actualisation après doublon:',refreshError);}
      }else{
        alert('Impossible de créer la case ou le sous-dossier. Vérifiez votre connexion et vos droits.\n\nDétail : '+detail);
      }
      return;
    }
  }finally{
    if(!quiet && typeof window.auroreCacherVeuillezPatienter==='function') window.auroreCacherVeuillezPatienter();
  }
  render();
}
async function renameFolder(f,name){const clean=String(name||'').trim().replace(/\s+/g,' ').slice(0,60);if(!clean)return;if(folders.some(x=>x.id!==f.id&&(x.parent_id||null)===(f.parent_id||null)&&x.name.toLocaleLowerCase('fr')===clean.toLocaleLowerCase('fr'))){alert('Une autre case porte déjà ce nom.');return}try{await api(FOLDER_TABLE,{method:'PATCH',query:`id=eq.${encodeURIComponent(f.id)}&user_id=eq.${encodeURIComponent(uid())}`,body:{name:clean}})}catch(e){if(!String(f.id).startsWith('local-')){alert('Impossible de renommer cette case pour le moment.');return}}f.name=clean;write(lk(),folders);render()}
async function deleteFolder(f){if(!confirm(`Supprimer la case « ${f.name} » ? Les documents ne seront pas supprimés.`))return;try{await api(FOLDER_TABLE,{method:'DELETE',query:`id=eq.${encodeURIComponent(f.id)}&user_id=eq.${encodeURIComponent(uid())}`})}catch(e){if(!String(f.id).startsWith('local-')){alert('Impossible de supprimer cette case pour le moment.');return}}folders=folders.filter(x=>x.id!==f.id);folderAssignments=folderAssignments.filter(x=>x.case_id!==f.id);write(lk(),folders);write(ak(),folderAssignments);render();closeFolder()}
async function reorder(a,b){const source=folders.find(x=>x.id===a),target=folders.find(x=>x.id===b);if(!source||!target||(source.parent_id||null)!==(target.parent_id||null))return;const siblings=folders.filter(x=>(x.parent_id||null)===(source.parent_id||null)).sort((x,y)=>x.position-y.position);const i=siblings.findIndex(x=>x.id===a),j=siblings.findIndex(x=>x.id===b);if(i<0||j<0)return;const m=siblings.splice(i,1)[0];siblings.splice(j,0,m);siblings.forEach((x,k)=>x.position=k);folders=folders.map(x=>{const s=siblings.find(y=>y.id===x.id);return s?{...x,position:s.position}:x});write(lk(),folders);render();try{await Promise.all(siblings.filter(x=>!String(x.id).startsWith('local-')).map(x=>api(FOLDER_TABLE,{method:'PATCH',query:`id=eq.${encodeURIComponent(x.id)}&user_id=eq.${encodeURIComponent(uid())}`,body:{position:x.position}})))}catch(e){console.warn('[Cases] ordre:',e)}}
function folderMenu(f){
  let menu=document.getElementById('personalFolderMenuPopover');
  if(!menu){
    menu=document.createElement('div');menu.id='personalFolderMenuPopover';menu.className='personal-folder-menu-popover';
    menu.innerHTML=`<div class="personal-folder-menu-title"></div><button type="button" data-folder-share>Partager la section</button><button type="button" data-folder-rename>✎ Renommer</button><button type="button" data-folder-delete>⌫ Supprimer</button>`;
    document.body.appendChild(menu);
    menu.addEventListener('click',e=>{e.stopPropagation();});
    menu.querySelector('[data-folder-share]').addEventListener('click',()=>{const id=menu.dataset.folderId;const target=folders.find(x=>String(x.id)===String(id));menu.classList.remove('show');if(target)window.aurorePartagerSection?.(target)});
    menu.querySelector('[data-folder-rename]').addEventListener('click',()=>{const id=menu.dataset.folderId;const target=folders.find(x=>String(x.id)===String(id));menu.classList.remove('show');if(target)dialog('rename',target)});
    menu.querySelector('[data-folder-delete]').addEventListener('click',()=>{const id=menu.dataset.folderId;const target=folders.find(x=>String(x.id)===String(id));menu.classList.remove('show');if(target)deleteFolder(target)});
    document.addEventListener('click',()=>menu.classList.remove('show'));
    document.addEventListener('keydown',e=>{if(e.key==='Escape')menu.classList.remove('show')});
  }
  menu.dataset.folderId=f.id;menu.querySelector('.personal-folder-menu-title').textContent=f.name;
  const source=document.querySelector(`[data-folder-id="${CSS.escape(String(f.id))}"] .personal-folder-menu`);
  if(source){const r=source.getBoundingClientRect();menu.style.left=Math.min(window.innerWidth-220,Math.max(12,r.right-205))+'px';menu.style.top=Math.min(window.innerHeight-130,r.bottom+8)+'px';}
  menu.classList.add('show');
}
function dialog(mode,f=null,parent=null){let d=document.getElementById('personalFolderDialog');if(!d){d=document.createElement('div');d.id='personalFolderDialog';d.className='personal-folder-dialog';d.innerHTML=`<section class="personal-folder-dialog-card"><h3 id="pfdTitle"></h3><p id="pfdText"></p><input id="pfdInput" maxlength="60" autocomplete="off"><div class="personal-folder-message" id="pfdMsg"></div><div class="personal-folder-dialog-actions"><button type="button" id="pfdCancel">Annuler</button><button type="button" class="primary" id="pfdOk">Continuer</button></div></section>`;document.body.appendChild(d);d.onclick=e=>{if(e.target===d)d.classList.remove('show')};d.querySelector('#pfdCancel').onclick=()=>d.classList.remove('show')}d.dataset.mode=mode;d.dataset.folderId=f?.id||'';d.dataset.parentId=parent?.id||'';d.querySelector('#pfdTitle').textContent=mode==='rename'?'Renommer la case':(parent?'Créer un sous-dossier':'Créer une case');d.querySelector('#pfdText').textContent=mode==='rename'?`Modifiez le nom de « ${f.name} ».`:(parent?`Créez un sous-dossier dans « ${esc(parent.name)} ».`:'Donnez un nom à votre case. Vous pourrez le modifier plus tard.');d.querySelector('#pfdInput').value=mode==='rename'?f.name:'';d.querySelector('#pfdOk').onclick=async()=>{const v=d.querySelector('#pfdInput').value.trim();if(!v){d.querySelector('#pfdMsg').className='personal-folder-message err';d.querySelector('#pfdMsg').textContent='Entrez un nom.';return}d.querySelector('#pfdOk').disabled=true;try{if(mode==='rename')await renameFolder(f,v);else await createFolder(v,false,d.dataset.parentId||null);d.classList.remove('show')}finally{d.querySelector('#pfdOk').disabled=false}};d.classList.add('show');setTimeout(()=>d.querySelector('#pfdInput').focus(),20)}
function picker(){let p=document.getElementById('folderDocumentPicker');if(p)return p;p=document.createElement('div');p.id='folderDocumentPicker';p.className='folder-document-picker';p.innerHTML=`<section class="folder-document-picker-card"><div class="folder-document-picker-head"><div><h3>Ranger ce document</h3><p id="fdpTitle"></p></div><button type="button" class="folder-document-close">×</button></div><div class="folder-document-list" id="folderDocumentList"></div></section>`;document.body.appendChild(p);p.onclick=e=>{if(e.target===p)p.classList.remove('show')};p.querySelector('.folder-document-close').onclick=()=>p.classList.remove('show');return p}
async function chooseDoc(doc){if(!session){const signup=document.getElementById('accessSignupBtn');if(signup)signup.click();setTimeout(()=>document.getElementById('showLoginBtn')?.click(),30);const m=document.getElementById('loginMessage');if(m){m.textContent='Connectez-vous pour ranger vos documents dans vos cases personnelles.';m.className='access-message ok';m.style.display='block'}return}if(!doc?.id)return;if(!folders.length){await load();}const p=picker(),list=p.querySelector('#folderDocumentList');p.querySelector('#fdpTitle').textContent=doc.Titre||'Document';list.innerHTML='';const current=folderAssignments.find(x=>x.document_id===String(doc.id));folders.forEach(f=>{const b=document.createElement('button');b.type='button';b.className='folder-document-option'+(current?.case_id===f.id?' is-current':'');b.innerHTML=`<strong>▱ ${esc(f.name)}</strong><span>${current?.case_id===f.id?'Actuellement ici':'Ajouter ici'}</span>`;b.onclick=()=>assign(doc,f);list.appendChild(b)});if(current){const b=document.createElement('button');b.type='button';b.className='folder-document-option';b.innerHTML='<strong>× Retirer de la case</strong><span>Sans classement</span>';b.onclick=()=>removeAssignment(doc);list.appendChild(b)}p.classList.add('show')}
async function assign(doc,f){
  const did=String(doc.id),fid=String(f.id),old=folderAssignments.find(x=>x.document_id===did);
  if(!session?.id||!doc?.id||!f?.id)return;
  folderAssignments=folderAssignments.filter(x=>x.document_id!==did);folderAssignments.push({document_id:did,case_id:fid});write(ak(),folderAssignments);
  try{await api(ASSIGN_TABLE,{method:'DELETE',query:`user_id=eq.${encodeURIComponent(uid())}&document_id=eq.${encodeURIComponent(doc.id)}`});await api(ASSIGN_TABLE,{method:'POST',headers:{Prefer:'return=minimal'},body:{user_id:uid(),document_id:Number(doc.id),case_id:f.id}});}catch(e){folderAssignments=folderAssignments.filter(x=>x.document_id!==did);if(old)folderAssignments.push(old);write(ak(),folderAssignments);console.error('[Cases] affectation',e);alert('Impossible de ranger ce document. Vérifiez le SQL des cases et réessayez.');return;}
  document.getElementById('folderDocumentPicker')?.classList.remove('show');render();await openFolder(f);
}

async function removeAssignment(doc){
  const did=String(doc.id),old=folderAssignments.find(x=>x.document_id===did);
  folderAssignments=folderAssignments.filter(x=>x.document_id!==did);
  write(ak(),folderAssignments);
  try{
    await api(ASSIGN_TABLE,{method:'DELETE',query:`user_id=eq.${encodeURIComponent(uid())}&document_id=eq.${encodeURIComponent(doc.id)}`,headers:{'Prefer':'return=minimal'}});
  }catch(e){
    if(old)folderAssignments.push(old);
    write(ak(),folderAssignments);
    console.error('[Cases] retrait',e);
    alert('Impossible de retirer ce document de sa case.');
    return;
  }
  document.getElementById('folderDocumentPicker')?.classList.remove('show');
  render();
  const current=folders.find(x=>old&&x.id===old.case_id);
  if(current) await openFolder(current);
}

function findDoc(id){for(const src of [documentsCourants,documentsRecentsCourants,MES_DOCUMENTS_PERSONNELS])if(Array.isArray(src)){const d=src.find(x=>String(x.id)===String(id));if(d)return d}return null}

async function recupererDocsDesCases(ids){
  const wanted=[...new Set((ids||[]).map(String).filter(Boolean))];
  if(!wanted.length)return [];
  const connus=new Map();
  wanted.forEach(id=>{const d=findDoc(id);if(d)connus.set(String(id),d)});
  const manquants=wanted.filter(id=>!connus.has(id));
  if(manquants.length){
    try{
      const raw=await api('Document',{query:`select=*&id=in.(${manquants.map(id=>id.replace(/[^0-9]/g,'')).filter(Boolean).join(',')})`});
      const docs=raw?JSON.parse(raw):[];
      (Array.isArray(docs)?docs:[]).forEach(d=>connus.set(String(d.id),d));
    }catch(e){console.warn('[Cases] métadonnées documents:',e)}
  }
  return wanted.map(id=>connus.get(id)||{id});
}

async function supprimerObjetR2Personnel(fichierUrl){
  const base=String(R2_PUBLIC_URL||'');const prefix=base.endsWith('/')?base:base+'/';
  const value=String(fichierUrl||'');
  if(!prefix||!value.startsWith(prefix))throw new Error('URL_STOCKAGE_PERSONNEL_INVALIDE');
  const key=value.slice(prefix.length).split('?')[0];
  if(!key)throw new Error('CLE_STOCKAGE_PERSONNEL_ABSENTE');
  const route=key.split('/').map(encodeURIComponent).join('/');
  const response=await fetch(R2_WORKER_URL+'/'+route,{method:'DELETE',headers:{Accept:'application/json'}});
  const result=await response.json().catch(()=>null);
  if(!response.ok||(result&&result.ok===false))throw new Error('SUPPRESSION_R2_HTTP_'+response.status);
  return true;
}

async function uploaderDocumentPrive(fichier,titre,caseId){
  if(!session?.id)throw new Error('SESSION_ABSENTE');if(!fichier)throw new Error('FICHIER_MANQUANT');
  const estPdf=fichier.type==='application/pdf'||/\.pdf$/i.test(fichier.name||'');if(!estPdf)throw new Error('FORMAT_INVALIDE');
  if(fichier.size>PRIVE_TAILLE_MAX)throw new Error('FICHIER_TROP_LOURD');
  const usage=await actualiserUtilisationStockage(true),remaining=Math.max(0,(usage.storage_limit_bytes||STORAGE_LIMIT_BYTES)-(usage.bytes_used||0));if(fichier.size>remaining)throw new Error('QUOTA_STOCKAGE_DEPASSE');
  const nomPropre='perso_'+uid()+'_'+Date.now()+'_'+String(fichier.name||'document.pdf').replace(/[^a-zA-Z0-9._-]/g,'_'),url=R2_PUBLIC_URL+'/'+nomPropre;
  // La base réserve les octets avant l'envoi R2 ; le trigger sérialise les dépôts de chaque compte.
  const raw=await api(PRIVATE_TABLE,{method:'POST',headers:{Prefer:'return=representation'},body:{user_id:uid(),case_id:caseId,titre:String(titre||fichier.name||'Document').trim().slice(0,150),fichier_url:url,taille_octets:fichier.size||0,type_fichier:fichier.type||'application/pdf'}});
  const rows=raw?JSON.parse(raw):[];if(!rows[0])throw new Error('ENREGISTREMENT_ECHEC');const created=rows[0];
  try{const up=await fetch(R2_WORKER_URL+'/'+nomPropre,{method:'PUT',headers:{'Content-Type':'application/pdf'},body:fichier});if(!up.ok)throw new Error('STOCKAGE_HTTP_'+up.status);}
  catch(error){try{await supprimerObjetR2Personnel(url);}catch(cleanupError){console.warn('[Cases] nettoyage R2 après échec du dépôt:',cleanupError);}try{await api(PRIVATE_TABLE,{method:'DELETE',query:'id=eq.'+encodeURIComponent(created.id)+'&user_id=eq.'+encodeURIComponent(uid()),headers:{Prefer:'return=minimal'}});}catch(cleanupError){console.error('[Cases] libération quota impossible:',cleanupError);}throw error;}
  const doc=normP([created])[0];privateDocs=[...privateDocs,doc];write(pk(),privateDocs);try{await actualiserUtilisationStockage(true);}catch(statsError){console.warn('[Stockage personnel] actualisation après dépôt:',statsError);storageUsageCache={documents_count:privateDocs.length,bytes_used:privateDocs.reduce((sum,item)=>sum+(Number(item.taille_octets)||0),0),storage_limit_bytes:STORAGE_LIMIT_BYTES};storageUsageAt=Date.now();storageUsageUserId=uid();actualiserAffichageStockage();}return doc;
}
async function supprimerDocumentPrive(doc){
  if(!confirm('Supprimer définitivement « '+doc.titre+' » ? Cette action est irréversible.'))return;
  try{
    // Supprimer l'objet R2 avant la ligne SQL : un échec de stockage ne libère
    // donc jamais artificiellement de quota. La suppression R2 est idempotente.
    await supprimerObjetR2Personnel(doc.fichier_url);
    await api(PRIVATE_TABLE,{method:'DELETE',query:'id=eq.'+encodeURIComponent(doc.id)+'&user_id=eq.'+encodeURIComponent(uid()),headers:{Prefer:'return=minimal'}});
  }catch(e){
    console.error('[Cases] suppression document privé',e);
    alert('La suppression n’a pas pu être confirmée complètement. L’entrée du document est conservée ; réessayez. Le quota ne sera libéré qu’après confirmation des deux opérations.');
    return;
  }
  privateDocs=privateDocs.filter(x=>x.id!==doc.id);write(pk(),privateDocs);
  render();
  await actualiserUtilisationStockage(true).catch(e=>console.warn('[Stockage personnel] après suppression:',e));
  const f=folders.find(x=>x.id===doc.case_id);
  if(f)await openFolder(f);else closeFolder();
}
function toggleUploadPanel(p,f){
  const panel=p.querySelector('#pfuPanel');if(!panel)return;
  if(!panel.hidden){panel.hidden=true;panel.innerHTML='';return}
  panel.hidden=false;
  const options=folders.map(x=>`<option value="${esc(x.id)}" ${x.id===f.id?'selected':''}>${esc(x.name)}</option>`).join('');
  panel.innerHTML=`<div class="personal-upload-card"><h4>Ajouter un document</h4><div class="personal-upload-row"><label for="pfuSection">Section</label><select id="pfuSection">${options}</select></div><div class="personal-upload-row"><label for="pfuTitre">Nom du document</label><input type="text" id="pfuTitre" maxlength="150" placeholder="Ex. Cours de mathématiques" autocomplete="off"></div><div class="personal-upload-row"><label for="pfuFichier">Fichier</label><input type="file" id="pfuFichier" accept="application/pdf"></div><small class="personal-upload-note">Format PDF uniquement, 100 Mo maximum par fichier. Votre quota personnel est de 1 Go.</small><div class="personal-storage-inline" id="pfuStorageSummary"><div><strong data-storage-inline-used>Calcul du stockage…</strong><small data-storage-inline-remaining>Vérification de l’espace disponible.</small></div><button type="button" data-storage-details>Détails</button></div><div class="personal-folder-message" id="pfuMsg"></div><div class="personal-upload-actions"><button type="button" id="pfuCancel">Annuler</button><button type="button" class="primary" id="pfuOk">Déposer</button></div></div>`;
  panel.querySelector('#pfuCancel').onclick=()=>{panel.hidden=true;panel.innerHTML=''};
  panel.querySelector('#pfuFichier').addEventListener('change',e=>{
    const t=panel.querySelector('#pfuTitre');if(t&&!t.value.trim()){const fn=e.target.files[0]?.name||'';t.value=fn.replace(/\.pdf$/i,'');}
    afficherResumeStockageImport(panel);
  });
  panel.querySelector('[data-storage-details]')?.addEventListener('click',ouvrirStockageModal);
  afficherResumeStockageImport(panel);
  panel.querySelector('#pfuOk').onclick=async()=>{
    const msg=panel.querySelector('#pfuMsg'),btn=panel.querySelector('#pfuOk');
    const caseId=panel.querySelector('#pfuSection').value;
    const titre=panel.querySelector('#pfuTitre').value.trim();
    const fichier=panel.querySelector('#pfuFichier').files[0];
    msg.className='personal-folder-message';msg.textContent='';
    if(!caseId){msg.className='personal-folder-message err';msg.textContent='Choisissez une section.';return}
    if(!titre){msg.className='personal-folder-message err';msg.textContent='Indiquez un nom pour ce document.';return}
    if(!fichier){msg.className='personal-folder-message err';msg.textContent='Sélectionnez un fichier PDF.';return}
    const estPdf=fichier.type==='application/pdf'||/\.pdf$/i.test(fichier.name||'');
    if(!estPdf){msg.className='personal-folder-message err';msg.textContent='Seul le format PDF est accepté.';return}
    if(fichier.size>PRIVE_TAILLE_MAX){msg.className='personal-folder-message err';msg.textContent='Ce fichier dépasse la taille maximale de 100 Mo.';return}
    btn.disabled=true;btn.textContent='Envoi en cours…';
    try{
      const doc=await uploaderDocumentPrive(fichier,titre,caseId);
      panel.hidden=true;panel.innerHTML='';
      render();
      const dest=folders.find(x=>x.id===doc.case_id)||f;
      await openFolder(dest);
      afficherConfirmationDepotStockage();
    }catch(e){
      console.error('[Cases] dépôt personnel',e);
      msg.className='personal-folder-message err';
      msg.textContent=e&&e.message==='FICHIER_TROP_LOURD'?'Ce fichier dépasse la taille maximale de 100 Mo.':e&&e.message==='FORMAT_INVALIDE'?'Seul le format PDF est accepté.':String(e?.message||'').includes('QUOTA_STOCKAGE_DEPASSE')?'Votre quota de 1 Go serait dépassé. Supprimez un document personnel ou choisissez un fichier plus léger.':'Impossible de déposer ce document pour le moment. Réessayez.';
      btn.disabled=false;btn.textContent='Déposer';
    }
  };
}
function folderChildren(parentId){return folders.filter(x=>(x.parent_id||null)===String(parentId)).sort((a,b)=>a.position-b.position)}
function folderBreadcrumb(f){const chain=[];let cur=f;const seen=new Set();while(cur&&!seen.has(cur.id)){chain.unshift(cur);seen.add(cur.id);cur=folders.find(x=>x.id===cur.parent_id)}return chain}

// Carte PDF d'une section : exactement la même carte que la bibliothèque et
// l'espace personnel (couverture → clic = ouvre le PDF ; bouton « 3 points »
// posé sur la couverture → ouvre le bloc de gestion ; fiche titre dessous).
// Les actions propres aux sections (retirer / supprimer) sont ajoutées au menu.
function carteDocumentCase(doc,opt){
  opt=opt||{};
  const r=document.createElement('article');
  r.className='doc-row aurore-personal-document-row';
  if(Number.isInteger(opt.index))r.dataset.documentIndex=String(opt.index);
  r._auroreDocument=doc;
  r.__auroreDocumentCouverture=doc;
  const titre=typeof obtenirTitreDocument==='function'?obtenirTitreDocument(doc):String(doc?.Titre||'Document');
  r.dataset.documentTitle=titre;
  r.innerHTML=`<div class="info"><div class="icon-wrap">${ICONS.file}</div><div class="doc-main-info"><div class="titre" title="${echapperHtmlPub(titre)}">${echapperHtmlPub(titre)}</div><div class="meta">${echapperHtmlPub(opt.meta||'')}</div>${tailleBadgeMarkup(doc.Fichier_url)}</div></div>`+boutonPlusCarteDocumentMarkup()+panneauActionsCarteDocumentMarkup(opt.telechargeable!==false);
  const panneau=r.querySelector(':scope > .doc-actions');
  if(panneau){
    // Sans fichier associé, ni lecture ni téléchargement n'ont de sens.
    if(!doc.Fichier_url)panneau.querySelectorAll('[data-lire],[data-telecharger-maintenant]').forEach(b=>b.remove());
    // Un document déposé directement dans la section n'existe pas dans la
    // bibliothèque : favoris, partage et signalement ne s'appliquent pas.
    if(opt.prive)panneau.querySelectorAll('[data-favori],[data-plus-tard],[data-case],[data-share-document],[data-share-whatsapp],[data-copy-document-link],[data-signaler]').forEach(b=>b.remove());
  }
  brancherActionsCarteDocument(r,doc);
  window.auroreAjouterBoutonTravauxDocument?.(r,doc);
  if(!opt.prive){try{if(typeof window.actualiserEtatActionsDocument==='function')window.actualiserEtatActionsDocument(r,doc)}catch(_){}}
  const ajouterAction=(attr,icone,libelle,fn,danger)=>{
    if(!panneau||typeof fn!=='function')return;
    const b=document.createElement('button');
    b.type='button';b.className='dl';b.setAttribute(attr,'1');b.setAttribute('role','menuitem');
    b.innerHTML=`<span class="share-icon">${icone}</span><span>${libelle}</span>`;
    if(danger)b.style.setProperty('color','var(--rouge)','important');
    b.addEventListener('click',()=>fn());
    panneau.appendChild(b);
  };
  ajouterAction('data-section-remove','⌫','Retirer de cette section',opt.retirer);
  ajouterAction('data-priv-delete','🗑','Supprimer définitivement',opt.supprimer,true);
  return r;
}
async function openFolder(f){
  const p=document.getElementById('personalCaseContent');if(!p)return;
  const a=folderAssignments.filter(x=>x.case_id===f.id);
  const pDocs=privateDocs.filter(x=>x.case_id===f.id);
  const total=a.length+pDocs.length;
  const dejaOuvert=document.getElementById('screen-personal-case')?.classList.contains('active');
  const children=folderChildren(f.id),crumb=folderBreadcrumb(f);
  p.innerHTML=`<div class="personal-section-detail-head"><div><span class="personal-section-kicker">Section personnelle</span><div class="personal-folder-breadcrumb">${crumb.map((x,i)=>`<button type="button" data-breadcrumb="${esc(x.id)}">${esc(x.name)}</button>${i<crumb.length-1?'':''}`).join('')}</div><h3>▱ ${esc(f.name)}</h3><p>${total} document${total!==1?'s':''} · ${children.length} sous-dossier${children.length!==1?'s':''}</p></div><div class="personal-section-detail-actions"><button type="button" data-section-subfolder class="personal-section-upload">＋ Sous-dossier</button><button type="button" data-section-upload class="personal-section-upload">＋ Ajouter un document</button><button type="button" data-section-share class="personal-section-share">Partager</button><button type="button" data-section-close class="personal-section-close">Retour</button></div></div><div id="pfuPanel" class="personal-upload-panel" hidden></div><div id="personalSubfolderGrid" class="personal-subfolder-grid"></div><div class="personal-section-detail-toolbar"><span>Vos documents</span><small>La même présentation que la bibliothèque Eneles</small></div><div id="pfdList" class="doc-list personal-section-doc-list"></div>`;
  p.querySelector('[data-section-share]')?.addEventListener('click',()=>window.aurorePartagerSection?.(f));
  // Délégation sur le conteneur : le bouton reste actif même après un
  // rerendu du contenu de la section personnelle.
  p.dataset.currentFolderId=String(f.id);
  if(!p.dataset.folderDelegationReady){p.dataset.folderDelegationReady='1';p.addEventListener('click',e=>{
    const subfolderButton=e.target.closest('[data-section-subfolder]');
    if(subfolderButton){e.preventDefault();e.stopPropagation();const current=folders.find(x=>String(x.id)===String(p.dataset.currentFolderId));if(current)dialog('create',null,current);return;}
    const breadcrumb=e.target.closest('[data-breadcrumb]');
    if(breadcrumb){const target=folders.find(x=>String(x.id)===String(breadcrumb.dataset.breadcrumb));if(target)openFolder(target);}
  });}
  p.querySelector('[data-section-close]')?.addEventListener('click',closeFolder);
  p.querySelector('[data-section-upload]')?.addEventListener('click',()=>toggleUploadPanel(p,f));
  if(!dejaOuvert) afficherEcran('screen-personal-case'); else window.scrollTo({top:0,behavior:'smooth'});
  const subgrid=p.querySelector('#personalSubfolderGrid');
  children.forEach(child=>{
    const count=folderAssignments.filter(a=>a.case_id===child.id).length+privateDocs.filter(x=>x.case_id===child.id).length;
    const card=document.createElement('article');card.className='personal-subfolder-card';card.dataset.folderId=child.id;
    card.innerHTML=`<div class="personal-folder-top"><div class="personal-folder-icon">▱</div><button type="button" class="personal-folder-menu" aria-label="Options">⋯</button></div><div class="personal-folder-name">${esc(child.name)}</div><div class="personal-folder-count">${count} document${count!==1?'s':''}</div>`;
    card.addEventListener('click',e=>{if(!e.target.closest('.personal-folder-menu'))openFolder(child)});
    card.querySelector('.personal-folder-menu').addEventListener('click',e=>{e.stopPropagation();folderMenu(child)});
    subgrid.appendChild(card);
  });
  if(!children.length)subgrid.innerHTML='<div class="personal-subfolder-empty">Aucun sous-dossier. Créez-en un avec « ＋ Sous-dossier ».</div>';
  const list=p.querySelector('#pfdList');  if(!total){
    list.innerHTML='<div class="doc-empty"><div class="icon-wrap">▱</div><h3>Cette section est vide</h3><p>Utilisez « Case » sur un document pour le ranger ici, ou ajoutez directement un document depuis votre appareil avec « ＋ Ajouter un document ».</p></div>';
  }else{
    list.innerHTML='<div class="personal-empty">Chargement des documents…</div>';
    let docs=[];
    if(a.length){try{docs=await recupererDocsDesCases(a.map(x=>x.document_id));}catch(e){list.innerHTML='<div class="doc-empty"><h3>Impossible de charger cette section</h3><p>Veuillez réessayer dans quelques instants.</p></div>';return}}
    list.innerHTML='';
    docs.forEach((d,i)=>{
      const lectureSeule=d.Telechargement_autorise===false;
      const contexte=[d.Niveau&&`Niveau : ${d.Niveau}`,d.Classe&&`Classe : ${d.Classe}`,d.Filiere&&`Filière : ${d.Filiere}`,d['Matière']&&`Matière : ${d['Matière']||d.Genre}`].filter(Boolean).join(' · ');
      const r=carteDocumentCase(d,{
        index:i,
        meta:(contexte||'Document de votre section')+(lectureSeule?' · Lecture seule':''),
        telechargeable:!lectureSeule,
        retirer:()=>removeAssignment(d)
      });
      list.appendChild(r);
      if(d.Fichier_url&&typeof appliquerCouvertureSiLivre==='function')appliquerCouvertureSiLivre(r,d);
    });
    pDocs.forEach(doc=>{
      const fauxDoc={id:'prive-'+doc.id,privateDocumentId:Number(doc.id),Titre:doc.titre,Fichier_url:doc.fichier_url,Telechargement_autorise:true};
      const r=carteDocumentCase(fauxDoc,{
        meta:'Votre document déposé directement',
        telechargeable:true,
        prive:true,
        supprimer:()=>supprimerDocumentPrive(doc)
      });
      list.appendChild(r);
      if(fauxDoc.Fichier_url&&typeof appliquerCouvertureSiLivre==='function')appliquerCouvertureSiLivre(r,fauxDoc);
    });
  }
}
function closeFolder(){
  if(history.state && history.state.aurasterNavigation) history.back();
  else afficherEcran('screen-profil');
}
window.ouvrirChoixCaseDocument=chooseDoc;window.chargerCasesPersonnelles=load;window.rendreCasesPersonnelles=render;
function init(){
  document.getElementById('personalFolderCreate')?.addEventListener('click',()=>dialog('create'));
  // L'authentification est restaurée de façon asynchrone après DOMContentLoaded.
  // Ne pas charger les cases avant que session soit disponible : sinon on tombe
  // sur le cache/local fallback et les cases semblent disparaître après reconnexion.
  let essais=0;
  const attendreSession=()=>{
    if(session?.id){ load(); return; }
    if(essais++<80) setTimeout(attendreSession,250);
  };
  attendreSession();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
window.addEventListener('load',()=>{
  let essais=0;
  const recharger=()=>{
    if(session?.id){ load(); return; }
    if(essais++<40) setTimeout(recharger,250);
  };
  recharger();
});
})();
