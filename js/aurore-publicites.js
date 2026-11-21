  let PUBLICITES_ADMIN = [];
  let APERCU_PUBLICITE_URLS = [];

  function grouperPublicitesAdmin(ads){
    const map=new Map();
    (Array.isArray(ads)?ads:[]).forEach(ad=>{
      const id=String(ad.carousel_id||('solo-'+ad.id));
      if(!map.has(id))map.set(id,{carousel_id:id,slides:[]});
      map.get(id).slides.push(ad);
    });
    return Array.from(map.values()).map(g=>{
      g.slides.sort((a,b)=>(Number(a.slide_order)||0)-(Number(b.slide_order)||0)||Number(a.id)-Number(b.id));
      g.first=g.slides[0];
      g.active=g.slides.length>0&&g.slides.every(x=>x.active===true);
      return g;
    }).sort((a,b)=>String(b.first?.updated_at||'').localeCompare(String(a.first?.updated_at||'')));
  }

  async function chargerPublicitesAdmin(){
    const list=document.getElementById('pubAdminList');
    if(!list)return;
    list.innerHTML='<div class="pub-admin-empty">Chargement des campagnes…</div>';
    try{
      const res=await fetch(`${SUPABASE_URL}/rest/v1/${PUB_TABLE}?select=*&order=updated_at.desc,slide_order.asc`,{headers:headersAdmin()});
      if(!res.ok)throw new Error('Impossible de charger les publicités (HTTP '+res.status+'). '+await res.text().catch(()=> ''));
      PUBLICITES_ADMIN=await res.json();
      rendreListeAdminPublicites(PUBLICITES_ADMIN);
      const tabCount=document.getElementById('tabCountPubs');
      if(tabCount)tabCount.textContent=String(grouperPublicitesAdmin(PUBLICITES_ADMIN).length);
    }catch(e){
      list.innerHTML=`<div class="pub-admin-empty">${echapperHtmlPub(messageErreurPublicite(e,'liste admin'))}</div>`;
    }
  }

  function rendreListeAdminPublicites(ads){
    const list=document.getElementById('pubAdminList');
    if(!list)return;
    const groupes=grouperPublicitesAdmin(ads);
    if(!groupes.length){list.innerHTML='<div class="pub-admin-empty">Aucune campagne publicitaire pour le moment.</div>';return;}
    list.innerHTML='';
    groupes.forEach(group=>{
      const first=group.first||{};
      const title=first.alt_text||'Campagne sans titre';
      const preview=group.slides.slice(0,4).map((slide,i)=>
        `<img class="pub-admin-carousel-thumb" src="${echapperHtmlPub(slide.image_url||'')}" alt="Diapositive ${i+1}" loading="lazy" decoding="async">`
      ).join('');
      const more=group.slides.length>4?`<span class="pub-admin-carousel-more">+${group.slides.length-4}</span>`:'';
      const item=document.createElement('article');
      item.className='pub-admin-item pub-admin-carousel-item';
      item.innerHTML=`
        <div class="pub-admin-carousel-preview">${preview}${more}</div>
        <div class="pub-admin-item-body">
          <div class="pub-admin-item-title">${echapperHtmlPub(title)}</div>
          <div class="pub-admin-item-desc">${group.slides.length} image(s) · ${group.slides.length>1?'Carrousel':'Publicité simple'}</div>
          ${first.description?`<div class="pub-admin-item-desc">${echapperHtmlPub(first.description)}</div>`:''}
          <div class="pub-admin-item-status ${group.active?'on':'off'}">${group.active?'● Campagne active':'○ Campagne désactivée'}</div>
        </div>
        <div class="pub-admin-item-actions">
          <button type="button" data-action="edit">Modifier la série</button>
          <button type="button" data-action="toggle">${group.active?'Désactiver':'Activer'}</button>
          <button type="button" class="danger" data-action="delete">Supprimer la série</button>
        </div>`;
      item.querySelector('[data-action="edit"]').addEventListener('click',()=>commencerModificationPublicite(group));
      item.querySelector('[data-action="toggle"]').addEventListener('click',()=>basculerActivationPublicite(group));
      item.querySelector('[data-action="delete"]').addEventListener('click',()=>supprimerPublicite(group));
      list.appendChild(item);
    });
  }

  function commencerModificationPublicite(group){
    const first=group.first||group.slides?.[0]||{};
    document.getElementById('adminPromoEditId').value=String(group.carousel_id||first.carousel_id||'');
    document.getElementById('adminPromoAltInput').value=first.alt_text||'';
    document.getElementById('adminPromoLinkInput').value=first.link_url||'';
    const descInput=document.getElementById('adminPromoDescInput');
    if(descInput)descInput.value=first.description||'';
    const preview=document.getElementById('adminPromoPreview');
    preview.innerHTML=`<div class="pub-admin-preview-grid">${(group.slides||[]).map((slide,i)=>
      `<figure data-slide-id="${echapperHtmlPub(slide.id)}">
        <img src="${echapperHtmlPub(slide.image_url||'')}" alt="Diapositive ${i+1}" loading="lazy" decoding="async">
        <figcaption>${i+1}</figcaption>
        <button type="button" class="pub-admin-slide-remove" data-remove-slide="${echapperHtmlPub(slide.id)}" aria-label="Retirer la diapositive ${i+1}">Retirer</button>
      </figure>`
    ).join('')}</div>`;
    preview.querySelectorAll('[data-remove-slide]').forEach(button=>{
      const slide=group.slides.find(item=>String(item.id)===button.dataset.removeSlide);
      if(slide)button.addEventListener('click',()=>retirerDiapositivePublicite(group,slide));
    });
    const note=document.getElementById('adminPromoFileNote');
    if(note)note.textContent='Sélectionnez d’autres images pour les ajouter à cette série ; les images existantes seront conservées.';
    document.getElementById('adminPromoSave').textContent='Enregistrer la série';
    document.getElementById('adminPromoCancelEdit').style.display='inline-flex';
    document.getElementById('adminPromoMsg').textContent='';
    document.querySelector('.admin-promo-manager')?.scrollIntoView({behavior:'smooth',block:'start'});
  }

  async function retirerDiapositivePublicite(group,slide){
    const remaining=(group.slides||[]).length-1;
    const question=remaining===0
      ? 'Cette diapositive est la dernière de la campagne. La retirer supprimera toute la campagne. Continuer ?'
      : 'Retirer cette diapositive du carrousel ?';
    if(!confirm(question))return;
    const msg=document.getElementById('adminPromoMsg');
    try{
      const res=await fetch(`${SUPABASE_URL}/rest/v1/${PUB_TABLE}?id=eq.${encodeURIComponent(slide.id)}`,{
        method:'DELETE',headers:headersAdmin()
      });
      if(!res.ok)throw new Error('Impossible de retirer cette diapositive (HTTP '+res.status+'). '+await res.text().catch(()=> ''));
      await chargerPublicitesAdmin();
      const updated=grouperPublicitesAdmin(PUBLICITES_ADMIN).find(item=>String(item.carousel_id)===String(group.carousel_id));
      if(updated)commencerModificationPublicite(updated);
      else annulerModificationPublicite();
      await chargerAnnoncesActives();
      if(msg){msg.textContent=remaining===0?'La campagne a été supprimée.':'La diapositive a été retirée du carrousel.';msg.className='form-msg ok';}
    }catch(e){if(msg){msg.textContent=messageErreurPublicite(e,'retrait diapositive');msg.className='form-msg err';}}
  }

  function annulerModificationPublicite(){
    document.getElementById('adminPromoEditId').value='';
    document.getElementById('adminPromoAltInput').value='';
    document.getElementById('adminPromoLinkInput').value='';
    const descInput=document.getElementById('adminPromoDescInput');
    if(descInput)descInput.value='';
    const fileInput=document.getElementById('adminPromoFile');
    if(fileInput)fileInput.value='';
    const note=document.getElementById('adminPromoFileNote');
    if(note)note.textContent='Vous pouvez sélectionner plusieurs images pour créer un carrousel.';
    document.getElementById('adminPromoPreview').innerHTML='<span>Aucune image sélectionnée.</span>';
    document.getElementById('adminPromoSave').textContent='Créer la campagne';
    document.getElementById('adminPromoCancelEdit').style.display='none';
    document.getElementById('adminPromoMsg').textContent='';
  }

  function nouvelIdCarousel(){
    if(globalThis.crypto?.randomUUID)return globalThis.crypto.randomUUID();
    const bytes=new Uint8Array(16);
    if(globalThis.crypto?.getRandomValues)globalThis.crypto.getRandomValues(bytes);
    else for(let i=0;i<bytes.length;i++)bytes[i]=Math.floor(Math.random()*256);
    bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
    return [...bytes].map((b,i)=>([4,6,8,10].includes(i)?'-':'')+b.toString(16).padStart(2,'0')).join('');
  }

  async function televerserImagePublicitaire(file,index){
    const safeName=String(file.name||'image').replace(/[^a-zA-Z0-9._-]/g,'_');
    const name='hesed_pub_'+Date.now()+'_'+index+'_'+safeName;
    const up=await fetch(`${R2_WORKER_URL}/${name}`,{method:'PUT',headers:{'Content-Type':file.type},body:file});
    const body=await up.text().catch(()=> '');
    if(!up.ok)throw new Error('Le stockage a refusé « '+file.name+' » (HTTP '+up.status+'). '+body);
    return `${R2_PUBLIC_URL}/${name}`;
  }

  async function enregistrerPublicite(){
    const editId=document.getElementById('adminPromoEditId')?.value||null;
    const files=Array.from(document.getElementById('adminPromoFile')?.files||[]);
    const altText=document.getElementById('adminPromoAltInput')?.value.trim()||'';
    const rawLink=document.getElementById('adminPromoLinkInput')?.value.trim()||'';
    const description=document.getElementById('adminPromoDescInput')?.value.trim()||null;
    const msg=document.getElementById('adminPromoMsg');
    const btn=document.getElementById('adminPromoSave');
    const url=rawLink?(()=>{try{const u=new URL(rawLink);return ['http:','https:'].includes(u.protocol)?u.href:null;}catch(_){return null;}})():null;

    if(!editId&&!files.length){msg.textContent='Sélectionnez au moins une image pour créer une campagne.';msg.className='form-msg err';return;}
    if(files.length>10){msg.textContent='Vous pouvez ajouter au maximum 10 images à la fois.';msg.className='form-msg err';return;}
    if(files.some(f=>!['image/png','image/jpeg','image/webp','image/gif'].includes(f.type))){msg.textContent='Format non pris en charge. Utilisez PNG, JPEG, WEBP ou GIF.';msg.className='form-msg err';return;}
    if(files.some(f=>f.size>8*1024*1024)){msg.textContent='Chaque image doit faire au maximum 8 Mo.';msg.className='form-msg err';return;}
    if(rawLink&&!url){msg.textContent='Le lien doit être une adresse web commençant par https:// ou http://.';msg.className='form-msg err';return;}
    if(!altText){msg.textContent='Veuillez renseigner un titre pour la campagne.';msg.className='form-msg err';return;}

    btn.disabled=true;
    const oldText=btn.textContent;
    btn.textContent='Enregistrement…';
    msg.textContent=files.length?'Téléversement des images en cours…':'Mise à jour de la campagne…';
    msg.className='form-msg';
    let messageSucces='';
    try{
      if(!session||session.role!=='admin')throw new Error('Cette action est réservée à l’administration.');
      const now=new Date().toISOString();
      const carouselId=editId||nouvelIdCarousel();
      const groupe=PUBLICITES_ADMIN.filter(a=>String(a.carousel_id||('solo-'+a.id))===String(carouselId));
      const uploaded=[];
      for(let i=0;i<files.length;i++){
        uploaded.push(await televerserImagePublicitaire(files[i],i+1));
      }

      if(editId){
        const patch={alt_text:altText,link_url:url,description,updated_at:now};
        const update=await fetch(`${SUPABASE_URL}/rest/v1/${PUB_TABLE}?carousel_id=eq.${encodeURIComponent(carouselId)}`,{
          method:'PATCH',headers:{...headersAdmin(),'Content-Type':'application/json','Prefer':'return=minimal'},
          body:JSON.stringify(patch)
        });
        if(!update.ok)throw new Error('Impossible de modifier cette série (HTTP '+update.status+'). '+await update.text().catch(()=> ''));

        if(uploaded.length){
          const nextOrder=groupe.reduce((max,a)=>Math.max(max,Number(a.slide_order)||0),-1)+1;
          const active=groupe.length?groupe.every(a=>a.active===true):true;
          const rows=uploaded.map((imageUrl,i)=>({
            carousel_id:carouselId,slide_order:nextOrder+i,image_url:imageUrl,
            alt_text:altText,link_url:url,description,active,updated_at:now
          }));
          const add=await fetch(`${SUPABASE_URL}/rest/v1/${PUB_TABLE}`,{
            method:'POST',headers:{...headersAdmin(),'Content-Type':'application/json','Prefer':'return=minimal'},
            body:JSON.stringify(rows)
          });
          if(!add.ok)throw new Error('La série a été mise à jour, mais les nouvelles images n’ont pas toutes été ajoutées (HTTP '+add.status+'). '+await add.text().catch(()=> ''));
        }
        messageSucces=uploaded.length?'La série a été mise à jour et les nouvelles images ont été ajoutées.':'La série a été mise à jour.';
      }else{
        const rows=uploaded.map((imageUrl,i)=>({
          carousel_id:carouselId,slide_order:i,image_url:imageUrl,
          alt_text:altText,link_url:url,description,active:true,updated_at:now
        }));
        const add=await fetch(`${SUPABASE_URL}/rest/v1/${PUB_TABLE}`,{
          method:'POST',headers:{...headersAdmin(),'Content-Type':'application/json','Prefer':'return=minimal'},
          body:JSON.stringify(rows)
        });
        if(!add.ok)throw new Error('Impossible de créer cette campagne (HTTP '+add.status+'). '+await add.text().catch(()=> ''));
        messageSucces=files.length>1?'Le carrousel a été créé avec '+files.length+' diapositives.':'La publicité a été créée.';
      }
      annulerModificationPublicite();
      await chargerPublicitesAdmin();
      await chargerAnnoncesActives();
      msg.textContent=messageSucces;
      msg.className='form-msg ok';
    }catch(e){
      msg.textContent=messageErreurPublicite(e,'enregistrement');
      msg.className='form-msg err';
    }finally{
      btn.disabled=false;
      btn.textContent=document.getElementById('adminPromoEditId')?.value? 'Enregistrer la série' : oldText==='Enregistrer la série'?'Créer la campagne':'Créer la campagne';
    }
  }

  async function basculerActivationPublicite(group){
    const msg=document.getElementById('adminPromoMsg');
    try{
      const id=group.carousel_id;
      const active=!group.active;
      const res=await fetch(`${SUPABASE_URL}/rest/v1/${PUB_TABLE}?carousel_id=eq.${encodeURIComponent(id)}`,{
        method:'PATCH',headers:{...headersAdmin(),'Content-Type':'application/json','Prefer':'return=minimal'},
        body:JSON.stringify({active,updated_at:new Date().toISOString()})
      });
      if(!res.ok)throw new Error('Échec de la mise à jour (HTTP '+res.status+'). '+await res.text().catch(()=> ''));
      await chargerPublicitesAdmin();
      await chargerAnnoncesActives();
    }catch(e){if(msg){msg.textContent=messageErreurPublicite(e,'activation');msg.className='form-msg err';}}
  }

  async function supprimerPublicite(group){
    const count=group.slides?.length||1;
    if(!confirm('Supprimer cette campagne et ses '+count+' image(s) ? Cette action est définitive.'))return;
    const msg=document.getElementById('adminPromoMsg');
    try{
      const res=await fetch(`${SUPABASE_URL}/rest/v1/${PUB_TABLE}?carousel_id=eq.${encodeURIComponent(group.carousel_id)}`,{
        method:'DELETE',headers:headersAdmin()
      });
      if(!res.ok)throw new Error('Échec de la suppression (HTTP '+res.status+'). '+await res.text().catch(()=> ''));
      await chargerPublicitesAdmin();
      await chargerAnnoncesActives();
    }catch(e){if(msg){msg.textContent=messageErreurPublicite(e,'suppression');msg.className='form-msg err';}}
  }

  document.getElementById('adminPromoFile')?.addEventListener('change',function(){
    const files=Array.from(this.files||[]);
    const preview=document.getElementById('adminPromoPreview');
    const note=document.getElementById('adminPromoFileNote');
    APERCU_PUBLICITE_URLS.forEach(url=>URL.revokeObjectURL(url));
    APERCU_PUBLICITE_URLS=[];
    if(!files.length)return;
    if(files.length>10){if(note)note.textContent='Maximum 10 images par ajout.';this.value='';return;}
    const existing=preview.querySelector('.pub-admin-preview-grid')?.innerHTML||'';
    const selected=files.map((file,i)=>{
      const url=URL.createObjectURL(file);APERCU_PUBLICITE_URLS.push(url);
      return `<figure><img src="${url}" alt="Nouvelle image ${i+1}"><figcaption>+${i+1}</figcaption></figure>`;
    }).join('');
    preview.innerHTML=`<div class="pub-admin-preview-grid">${existing}${selected}</div>`;
    if(note)note.textContent=files.length+' nouvelle(s) image(s) prête(s) à être ajoutée(s).';
  });
