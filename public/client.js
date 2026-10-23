const $=id=>document.getElementById(id);let activeJobId=null,pollTimer=null,jobCache=null;
async function api(path,opts={}){const r=await fetch(path,{...opts,headers:{...(opts.body?{'Content-Type':'application/json'}:{}),...(opts.headers||{})}});const ct=r.headers.get('content-type')||'';if(!r.ok){if(ct.includes('text/csv'))throw Error('Export failed');const d=ct.includes('json')?await r.json():{error:'Request failed'};throw Error(d.error||'Request failed')}return ct.includes('application/json')?r.json():r}
function toast(msg){$('toast').textContent=msg;$('toast').classList.remove('hidden');setTimeout(()=>$('toast').classList.add('hidden'),3000)}
function showApp(on){$('loginView').classList.toggle('hidden',on);$('appView').classList.toggle('hidden',!on)}
async function boot(){try{const m=await api('/api/me');showApp(m.authenticated);if(m.authenticated){await loadSettings();await loadJobs()}}catch{showApp(false)}}
$('loginForm').addEventListener('submit',async e=>{e.preventDefault();$('loginError').textContent='';try{await api('/api/login',{method:'POST',body:JSON.stringify({password:$('password').value})});$('password').value='';showApp(true);await loadSettings();await loadJobs()}catch(err){$('loginError').textContent=err.message}});
$('logoutBtn').addEventListener('click',async()=>{await api('/api/logout',{method:'POST'});clearInterval(pollTimer);showApp(false);toast('Signed out')});
async function loadSettings(){const s=await api('/api/settings');$('keyStatus').textContent=s.hasOutscraperKey?'An API key is saved securely on the server. Enter a new key only if you want to replace it.':'No key saved yet. You can explore the fictional demo without one.'}
$('saveKeyBtn').addEventListener('click',async()=>{const key=$('apiKey').value.trim();if(!key){$('setupError').textContent='Paste your Outscraper key first. To remove a saved key, use the server administrator settings.';return}try{const r=await api('/api/settings/key',{method:'POST',body:JSON.stringify({apiKey:key})});$('apiKey').value='';$('keyStatus').textContent=r.hasOutscraperKey?'API key saved encrypted on the server.':'No key saved.';$('setupError').textContent='';toast('API key saved securely')}catch(e){$('setupError').textContent=e.message}});
$('refreshJobs').addEventListener('click',()=>loadJobs().catch(e=>toast(e.message)));
async function loadJobs(){const data=await api('/api/jobs');const host=$('jobsList');if(!data.jobs.length){host.innerHTML='<div class="empty-state"><div class="empty-icon">↗</div><strong>Your scan history will appear here</strong><p>Completed scans, progress and decisions stay available when you return.</p></div>';return}host.innerHTML=data.jobs.map(j=>`<button class="job-row ${j.id===activeJobId?'active':''}" data-job="${esc(j.id)}"><div class="job-row-top"><strong>${j.demo?'Fictional demo':'Scan · '+dateLabel(j.startedAt)}</strong><span class="job-tag">${esc(j.phase||'Unknown')}</span></div><p>${Number(j.leadCount)||0} lead records · ${Number(j.progress?.scanned)||0}/${Number(j.progress?.discovered)||0} businesses scanned</p></button>`).join('');host.querySelectorAll('[data-job]').forEach(b=>b.addEventListener('click',()=>openJob(b.dataset.job)))}
function dateLabel(v){if(!v)return 'Saved scan';const d=new Date(v);return Number.isNaN(d.getTime())?'Saved scan':d.toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}
function safeUrl(v){try{const u=new URL(String(v||''));return ['http:','https:'].includes(u.protocol)?u.href:''}catch{return ''}}
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
$('startBtn').addEventListener('click',async()=>{const countries=[...document.querySelectorAll('input[name="country"]:checked')].map(x=>x.value);if(!countries.length){$('setupError').textContent='Select at least one country.';return}const queries=$('queries').value.trim();$('setupError').textContent='';$('startBtn').disabled=true;$('startBtn').innerHTML='Starting scan…';try{const result=await api('/api/jobs',{method:'POST',body:JSON.stringify({countries,queries,maxPlaces:$('maxPlaces').value,reviewsPerPlace:$('reviewsPerPlace').value,target:$('target').value})});activeJobId=result.id;await openJob(activeJobId);await loadJobs();toast('Scan started')}catch(e){$('setupError').textContent=e.message}finally{$('startBtn').disabled=false;$('startBtn').innerHTML='Start scan <span>→</span>'}});
$('demoBtn').addEventListener('click',async()=>{try{const r=await api('/api/demo',{method:'POST',body:'{}'});await openJob(r.id);await loadJobs();toast('Fictional demo opened')}catch(e){$('setupError').textContent=e.message}});
async function openJob(id){activeJobId=id;clearInterval(pollTimer);$('resultsSection').classList.remove('hidden');$('resultTitle').textContent='Loading scan…';$('leadsList').innerHTML='<div class="empty-state compact">Loading saved results…</div>';await refreshJob();pollTimer=setInterval(async()=>{try{await refreshJob();await loadJobs()}catch{}},2500);$('resultsSection').scrollIntoView({behavior:'smooth',block:'start'})}
async function refreshJob(){if(!activeJobId)return;const j=await api('/api/jobs/'+activeJobId);jobCache=j;renderJob(j);if(['Complete','Failed','Stopped','Demo','Interrupted by app restart — start a new scan if needed'].includes(j.phase)){clearInterval(pollTimer);$('stopBtn').classList.add('hidden')}else $('stopBtn').classList.remove('hidden')}
function renderJob(j){const done=['Complete','Failed','Stopped'].includes(j.phase)||String(j.phase).startsWith('Interrupted');$('resultTitle').textContent=j.demo?'Fictional demo results':'Scan results';$('resultSubtitle').textContent=j.demo?'Fictional examples only — not real businesses or exportable leads':`Started ${dateLabel(j.startedAt)} · ${j.countries?.join(', ')||'Selected markets'}`;$('phase').textContent=j.phase||'Unknown';const p=j.progress||{},dis=Number(p.discovered)||0,scan=Number(p.scanned)||0;$('progressText').textContent=`${scan} of ${dis||'—'} businesses scanned`;const pct=done?100:dis?Math.min(96,Math.round(scan/dis*100)):Math.min(25,scan*5);$('progressBar').style.width=pct+'%';$('mDiscovered').textContent=dis;$('mScanned').textContent=scan;$('mReviews').textContent=Number(p.reviewsFetched)||0;$('mCandidates').textContent=Number(p.candidates)||0;$('stopBtn').classList.toggle('hidden',done||j.demo);$('exportBtn').disabled=!!j.demo;$('exportBtn').textContent=j.demo?'Demo cannot be exported':'Export approved CSV ↓';const filter=$('leadFilter').value,leads=(j.leads||[]).filter(l=>filter==='all'||l.status===filter);$('leadCount').textContent=`${leads.length} of ${(j.leads||[]).length} records`;const host=$('leadsList');if(!leads.length){host.innerHTML='<div class="empty-state compact">'+(j.phase==='Complete'?'No qualifying low-star review records were returned for this scan. Check scan notes below and verify your searches.':'Lead records will appear here as the scan progresses.')+'</div>'}else host.innerHTML=leads.map(leadCard).join('');host.querySelectorAll('[data-decision]').forEach(b=>b.addEventListener('click',()=>decide(b.dataset.id,b.dataset.decision)));const eb=$('errorsBox');eb.classList.toggle('hidden',!(j.errors||[]).length);$('errorsList').innerHTML=(j.errors||[]).map(e=>`<li><strong>${esc(e.business||'Scan')}</strong>: ${esc(e.error)}</li>`).join('')}
function leadCard(l){const status=String(l.status||'Needs review'),badge=status==='Approved'?'approved':status==='Rejected'?'rejected':status==='Candidate'?'candidate':'';const primary=(l.issues||[]).find(i=>i.theme===l.primaryTheme),evidence=(primary?.evidence||l.reviews||[]).slice(0,3);return `<article class="lead-card"><div class="lead-top"><div><h3 class="lead-name">${esc(l.name||'Unnamed business')}</h3><div class="lead-meta">${esc([l.category,l.city,l.country].filter(Boolean).join(' · '))}<br>${esc(l.phone||'No phone listed')}${safeUrl(l.website)?' · <a href="'+esc(safeUrl(l.website))+'" target="_blank" rel="noopener noreferrer">Website ↗</a>':''}</div></div><span class="badge ${badge}">${esc(status)}</span></div><div class="issue-line">Suggested issue: <strong>${esc(l.primaryTheme||'No clear repeatable process theme')}</strong> · ${Number(l.primaryCount)||0} supporting review(s)</div>${evidence.map(r=>`<div class="review-snippet">“${esc(r.text||'Review text unavailable')}”<br><span class="tiny">${esc(r.rating||'')}★ · ${esc(r.localDate||'Date unavailable')} ${r.link?'· <a href="'+esc(r.link)+'" target="_blank" rel="noopener noreferrer">Source review ↗</a>':''}</span></div>`).join('')}${(l.reasons||[]).length?`<div class="lead-reasons">Review notes: ${esc(l.reasons.join(' · '))}</div>`:''}<div class="lead-actions"><button class="approve" data-id="${esc(l.id)}" data-decision="Approved" ${l.status==='Approved'?'disabled':''}>✓ Approve</button><button data-id="${esc(l.id)}" data-decision="Needs review">Needs review</button><button class="reject" data-id="${esc(l.id)}" data-decision="Rejected" ${l.status==='Rejected'?'disabled':''}>Reject</button></div></article>`}
async function decide(id,status){try{await api('/api/jobs/'+activeJobId+'/decision',{method:'POST',body:JSON.stringify({id,status})});await refreshJob();await loadJobs();toast(status==='Approved'?'Lead approved':status==='Rejected'?'Lead rejected':'Marked for review')}catch(e){toast(e.message)}}
$('leadFilter').addEventListener('change',()=>jobCache&&renderJob(jobCache));$('stopBtn').addEventListener('click',async()=>{if(!activeJobId)return;try{await api('/api/jobs/'+activeJobId+'/stop',{method:'POST',body:'{}'});toast('Stop requested');await refreshJob()}catch(e){toast(e.message)}});$('exportBtn').addEventListener('click',async()=>{if(!activeJobId||jobCache?.demo)return;try{const r=await fetch('/api/jobs/'+activeJobId+'/export');if(!r.ok){const d=await r.json();throw Error(d.error||'Export failed')}const blob=await r.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='matala-approved-leads.csv';document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);toast('Approved CSV exported')}catch(e){toast(e.message)}});

// Matala Business Finder: separate OSM discovery results, never mixed with review-qualified leads.
let finderRows = [];
function installBusinessFinder() {
  const app = $('appView');
  if (!app || $('matalaBusinessFinder')) return;
  const layout = app.querySelector('.layout');
  const panel = document.createElement('section');
  panel.id = 'matalaBusinessFinder';
  panel.className = 'panel business-finder-panel';
  panel.innerHTML = `
    <div class="finder-heading">
      <div><p class="eyebrow">GOOGLE MAPS BUSINESS DISCOVERY</p><h2>Business Finder</h2></div>
      <p class="finder-intro">Discover public business listings in Australia, New Zealand, and the United States. These are not review-qualified leads.</p>
    </div>
    <div class="finder-controls">
      <label class="field"><span>Business category</span><select id="finderCategory">
        <option value="plumber">Plumber</option><option value="electrician">Electrician</option>
        <option value="dentist">Dentist</option><option value="restaurant">Restaurant</option>
        <option value="cafe">Cafe</option><option value="auto repair">Auto repair</option>
        <option value="furniture">Furniture store</option><option value="real estate">Real estate agency</option>
        <option value="hairdresser">Hairdresser</option><option value="gym">Gym / fitness centre</option>
        <option value="hotel">Hotel</option><option value="retailer">Retailer</option>
        <option value="professional">Professional office</option><option value="trades">Trades business</option>
      </select></label>
      <label class="field"><span>City</span><input id="finderCity" maxlength="100" placeholder="e.g. Melbourne" autocomplete="address-level2"></label>
      <label class="field"><span>Country</span><select id="finderCountry"><option value="AU">Australia</option><option value="NZ">New Zealand</option><option value="US">United States</option></select></label> <button id="finderSearchBtn" class="primary" type="button">Find businesses →</button>
    </div>
    <p id="finderError" class="finder-error" role="status" aria-live="polite"></p>
    <div id="finderSummary" class="finder-summary" aria-live="polite"></div>
    <div id="finderResults" class="finder-results"><div class="empty-state compact"><strong>Your discoveries will appear here</strong><p>Choose a category and city to start a small search.</p></div></div>
    <div class="finder-footer"><span>Business data via Google Maps / Outscraper</span><button id="finderExportBtn" class="secondary" type="button" disabled>Export businesses CSV ↓</button></div>
  `;
  if (layout) layout.insertAdjacentElement('beforebegin', panel);
  else app.prepend(panel);
  $('finderSearchBtn').addEventListener('click', searchBusinesses);
  $('finderExportBtn').addEventListener('click', exportBusinesses);
  $('finderCity').addEventListener('keydown', e => { if (e.key === 'Enter') searchBusinesses(); });
}
async function searchBusinesses() {
  const city = $('finderCity').value.trim();
  const category = $('finderCategory').value;
  const country = $('finderCountry').value;
  $('finderError').textContent = '';
  $('finderSummary').textContent = '';
  if (!city) { $('finderError').textContent = 'Enter a city to search.'; $('finderCity').focus(); return; }
  const btn = $('finderSearchBtn');
  btn.disabled = true; btn.textContent = 'Searching…';
  $('finderResults').innerHTML = '<div class="empty-state compact">Searching Google Maps listings. This may take a minute or two.</div>';
  try {
    const data = await api('/api/business-finder', {method:'POST', body:JSON.stringify({city, category, country})});
    finderRows = Array.isArray(data.results) ? data.results : [];
    renderFinderResults(data);
  } catch (e) {
    finderRows = [];
    $('finderResults').innerHTML = '<div class="empty-state compact">Search could not be completed. Try again later.</div>';
    $('finderError').textContent = e.message || 'Business search failed.';
    $('finderExportBtn').disabled = true;
  } finally {
    btn.disabled = false; btn.textContent = 'Find businesses →';
  }
}
function renderFinderResults(data) {
  const host = $('finderResults');
  $('finderSummary').textContent = `${finderRows.length} named listing${finderRows.length === 1 ? '' : 's'} found${data.cached ? ' · cached result' : ''}.`;
  $('finderExportBtn').disabled = !finderRows.length;
  if (!finderRows.length) {
    host.innerHTML = `<div class="empty-state compact">${esc(data.message || 'No named listings found. Try another nearby city or category.')}</div>`;
    return;
  }
  host.innerHTML = finderRows.map((r, i) => {
    const website = safeUrl(r.website);
    const mapsUrl = safeUrl(r.googleMapsUrl);
    const contact = [r.phone ? esc(r.phone) : '', website ? `<a href="${esc(website)}" target="_blank" rel="noopener noreferrer">Website ↗</a>` : ''].filter(Boolean).join(' · ');
    return `<article class="finder-card"><div class="finder-card-top"><div><h3>${esc(r.name || 'Unnamed business')}</h3><p>${esc(r.category || data.category || 'Business')} · ${esc(r.address || 'Address not listed')}</p>${contact ? `<div class="finder-contact">${contact}</div>` : '<div class="finder-contact">No phone or website listed</div>'}</div><span class="finder-number">${i+1}</span></div>${mapsUrl ? `<a class="finder-source" href="${esc(mapsUrl)}" target="_blank" rel="noopener noreferrer">Google Maps listing ↗</a>` : ''}</article>`;
  }).join('');
}
function exportBusinesses() {
  if (!finderRows.length) return;
  const columns = ['name','category','address','phone','website','googleMapsUrl','lat','lon','rating','reviews'];
  const cell = value => {
    let v = String(value ?? '');
    if (/^[=+@\-\t\r]/.test(v)) v = "'" + v;
    return '"' + v.replaceAll('"','""') + '"';
  };
  const csv = '\uFEFF' + [columns.join(','), ...finderRows.map(r => columns.map(k => cell(r[k])).join(','))].join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], {type:'text/csv;charset=utf-8;'}));
  const a = document.createElement('a'); a.href = url;
  a.download = `matala-businesses-${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  toast('Business listings CSV exported');
}

installBusinessFinder();
boot();
