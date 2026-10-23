import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {randomUUID,createHmac, timingSafeEqual, createCipheriv, createDecipheriv, randomBytes} from 'node:crypto';
import pg from 'pg';
import {flattenData,normalizePlace,normalizeReviews,qualify,fourMonthsAgo,csv,applySemanticIssues} from './core.mjs';
import {makeDemoJob} from './demo.mjs';

const {Pool}=pg, here=dirname(fileURLToPath(import.meta.url));
const port=Number(process.env.PORT||3000), isProd=process.env.NODE_ENV==='production';
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_SSL==='false'?false:{rejectUnauthorized:false},max:5});
const API='https://api.outscraper.cloud', MAX_RESPONSE=20_000_000, runningJobs=new Map();

const finderCache = new Map();
const finderUsage = new Map();
let osmLastRequest = 0;

const BUSINESS_TAGS = {
  plumber: ['craft=plumber'],
  electrician: ['craft=electrician'],
  dentist: ['amenity=dentist'],
  restaurant: ['amenity=restaurant'],
  cafe: ['amenity=cafe'],
  'auto repair': ['shop=car_repair'],
  furniture: ['shop=furniture'],
  'real estate': ['office=estate_agent'],
  hairdresser: ['shop=hairdresser'],
  gym: ['leisure=fitness_centre'],
  hotel: ['tourism=hotel'],
  retailer: ['shop'],
  professional: ['office'],
  trades: ['craft'],
};

async function osmFetch(url, options = {}) {
  // Stay below the public Nominatim service's one-request-per-second limit.
  const wait = Math.max(0, 1100 - (Date.now() - osmLastRequest));
  if (wait) await new Promise(resolve => setTimeout(resolve, wait));
  osmLastRequest = Date.now();

  const response = await fetch(url, {
    ...options,
    headers: {
      'User-Agent': 'MatalaBusinessFinder/0.1 (user-triggered search)',
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(25000),
  });

  if (!response.ok) {
    throw Error(`OpenStreetMap service returned HTTP ${response.status}. Please try again later.`);
  }
  return response.json();
}

function csvCell(value) {
  return '"' + String(value ?? '').replaceAll('"', '""').replace(/^[=+@\\-\\t\\r]/, "'$&") + '"';
}
const COUNTRIES={NZ:['Plumbers, Christchurch, New Zealand','Property managers, Auckland, New Zealand','Appliance repair, Wellington, New Zealand'],AU:['Dental clinics, Sydney, Australia','Auto repair shops, Melbourne, Australia','Furniture stores, Brisbane, Australia'],US:['Plumbers, Austin, Texas, United States','HVAC contractors, Dallas, Texas, United States','Appliance repair, Phoenix, Arizona, United States']};
const ALL_QUERIES=[...COUNTRIES.NZ,...COUNTRIES.AU,...COUNTRIES.US];
const b64=x=>Buffer.from(x).toString('base64url');
function json(res,status,data){const s=JSON.stringify(data);res.writeHead(status,{'content-type':'application/json; charset=utf-8','content-length':Buffer.byteLength(s),'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'});res.end(s)}
async function readBody(req){let raw='';for await(const c of req){raw+=c;if(raw.length>100_000)throw Error('Request too large')}return JSON.parse(raw||'{}')}
function safeError(e){return String(e?.message||e).replace(/\b[A-Za-z0-9_-]{32,}\b/g,'[redacted]').slice(0,260)}
function sessionCookie(value,maxAge=60*60*24*7){return `mrs_session=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isProd?'; Secure':''}`}
function sign(id){return `${id}.${createHmac('sha256',process.env.SESSION_SECRET).update(id).digest('base64url')}`}
function validToken(t){if(!t||!process.env.SESSION_SECRET)return null;const [id,sig]=t.split('.');if(!id||!sig)return null;const expected=createHmac('sha256',process.env.SESSION_SECRET).update(id).digest();let got;try{got=Buffer.from(sig,'base64url')}catch{return null}return got.length===expected.length&&timingSafeEqual(got,expected)?id:null}
function encrypt(value){const key=Buffer.from(process.env.KEY_ENCRYPTION_SECRET||'','base64');if(key.length!==32)throw Error('Server key encryption is not configured');const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv);const data=Buffer.concat([c.update(value,'utf8'),c.final()]);return [iv.toString('base64'),c.getAuthTag().toString('base64'),data.toString('base64')].join(':')}
function decrypt(value){if(!value)return '';const [iv,tag,data]=value.split(':');const d=createDecipheriv('aes-256-gcm',Buffer.from(process.env.KEY_ENCRYPTION_SECRET,'base64'),Buffer.from(iv,'base64'));d.setAuthTag(Buffer.from(tag,'base64'));return Buffer.concat([d.update(Buffer.from(data,'base64')),d.final()]).toString('utf8')}
async function init(){await pool.query(`CREATE TABLE IF NOT EXISTS app_sessions(id text PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL); CREATE TABLE IF NOT EXISTS app_settings(id text PRIMARY KEY, encrypted_outscraper_key text, updated_at timestamptz NOT NULL DEFAULT now()); CREATE TABLE IF NOT EXISTS scan_jobs(id text PRIMARY KEY, payload jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());`);await pool.query("UPDATE scan_jobs SET payload=jsonb_set(payload,'{phase}','\"Interrupted by app restart — start a new scan if needed\"'::jsonb), updated_at=now() WHERE payload->>'phase' NOT IN ('Complete','Failed','Stopped','Demo') AND payload->>'demo' IS DISTINCT FROM 'true'");await pool.query('DELETE FROM app_sessions WHERE expires_at < now()')}
async function auth(req,res){const raw=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('mrs_session='))?.slice(12);const id=validToken(raw);if(!id)return null;const r=await pool.query('SELECT id FROM app_sessions WHERE id=$1 AND expires_at>now()', [id]);return r.rowCount?r.rows[0].id:null}
async function requireAuth(req,res){const id=await auth(req,res);if(!id)json(res,401,{error:'Please sign in to continue.'});return id}
async function saveJob(job){await pool.query('INSERT INTO scan_jobs(id,payload,updated_at) VALUES($1,$2::jsonb,now()) ON CONFLICT(id) DO UPDATE SET payload=EXCLUDED.payload,updated_at=now()',[job.id,JSON.stringify({...job,cutoff:job.cutoff instanceof Date?job.cutoff.toISOString():job.cutoff})])}
async function loadJob(id){const r=await pool.query('SELECT payload FROM scan_jobs WHERE id=$1',[id]);if(!r.rowCount)return null;const j=r.rows[0].payload;j.cutoff=new Date(j.cutoff);return j}
async function provider(path,key,params={}){const u=new URL(API+path);for(const [k,v] of Object.entries(params))if(v!==undefined&&v!=='')u.searchParams.set(k,String(v));const response=await fetch(u,{headers:{'X-API-KEY':key},signal:AbortSignal.timeout(120000)});if(!response.ok)throw Error('Outscraper HTTP '+response.status+(response.status===402?' (check account billing/credits)':''));const text=await response.text();if(text.length>MAX_RESPONSE)throw Error('Provider response too large; reduce batch size');const out=text?JSON.parse(text):{};if(out.error||/^fail/i.test(out.status||''))throw Error('Outscraper reported a failed request');return out}
async function providerJob(path,key,params){const first=await provider(path,key,{...params,async:true});if(first.status==='Success'||first.data)return first;if(!first.id)throw Error('Outscraper did not return a request ID');for(let i=0;i<90;i++){await new Promise(r=>setTimeout(r,4000));const result=await provider('/requests/'+encodeURIComponent(first.id),key);if(result.status==='Success'||result.data)return result;if(/fail/i.test(result.status||''))throw Error('Outscraper task failed')}throw Error('Provider task still pending after six minutes. Check Outscraper before retrying.')}
async function semanticIssues(reviews,key){const schema={type:'object',additionalProperties:false,properties:{issues:{type:'array',items:{type:'object',additionalProperties:false,properties:{label:{type:'string'},process_fit:{type:'boolean'},review_indices:{type:'array',items:{type:'integer'}}},required:['label','process_fit','review_indices']}}},required:['issues']};const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',signal:AbortSignal.timeout(45000),headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({model:'gpt-4.1-mini',store:false,input:[{role:'system',content:'Classify only supplied review texts. Identify repeatable operational/process problems. Do not invent facts. Mark process_fit false for purely interpersonal subjective complaints.'},{role:'user',content:JSON.stringify(reviews.map((x,i)=>({index:i,text:x.text})))}],text:{format:{type:'json_schema',name:'review_issues',strict:true,schema}}})});if(!r.ok)throw Error('Semantic classifier HTTP '+r.status);const data=await r.json(),out=data.output?.flatMap(x=>x.content||[]).find(x=>x.type==='output_text')?.text;if(!out)throw Error('No structured AI response');return JSON.parse(out).issues}
function dedupe(rows){const seen=new Set();return rows.filter(p=>{const k=p.place_id||p.google_id||[p.name,p.full_address].join('|');if(!k||seen.has(k))return false;seen.add(k);return true})}
async function run(job,key,aiKey,options){const {queries,maxPlaces,reviewsPerPlace,target}=options;try{job.phase='Discovering businesses';await saveJob(job);const raw=[];for(const q of queries){if(job.stop)break;const n=Math.min(100,Math.ceil(maxPlaces/queries.length),maxPlaces-raw.length);if(n<=0)break;const result=await providerJob('/google-maps-search',key,{query:q,limit:n,dropDuplicates:true});raw.push(...flattenData(result.data));job.progress.discovered=dedupe(raw).length;await saveJob(job)}const places=dedupe(raw).slice(0,maxPlaces);job.phase='Reading recent reviews';await saveJob(job);for(const p of places){if(job.stop||job.progress.candidates>=target)break;const place=normalizePlace(p);const country=place.country;const wanted=options.countries||['NZ','AU','US'];if(country&&!wanted.includes(country)){job.progress.skipped++;continue}const query=place.placeId||place.googleId||[place.name,place.address].filter(Boolean).join(', ');if(!query){job.progress.skipped++;continue}try{const result=await providerJob('/google-maps-reviews',key,{query,limit:1,reviewsLimit:reviewsPerPlace,cutoff:Math.floor((job.cutoff.getTime()-86400000)/1000),ignoreEmpty:true,source:'google'});const all=flattenData(result.data),found=all.find(x=>(x.place_id&&x.place_id===place.placeId)||(x.google_id&&x.google_id===place.googleId))||all[0];if(!found){job.progress.skipped++;continue}const merged=normalizePlace({...p,...found});if(merged.country&&!wanted.includes(merged.country)){job.progress.skipped++;job.progress.scanned++;continue}let rows=normalizeReviews(found,job.cutoff),method='Keyword suggestion';if(aiKey&&rows.length){try{rows=applySemanticIssues(rows,await semanticIssues(rows,aiKey));job.progress.semanticRuns++;method='AI suggestion'}catch(e){job.errors.push({business:place.name,error:'AI step: '+safeError(e)+'; keyword fallback used'})}}job.progress.reviewsFetched+=(found.reviews_data||[]).length;const lead=qualify({...place,...merged},rows,(found.reviews_data||[]).length>=reviewsPerPlace);lead.analysisMethod=method;if(rows.length){job.leads.push(lead);if(lead.status==='Candidate')job.progress.candidates++}}catch(e){job.errors.push({business:place.name||query,error:safeError(e)})}job.progress.scanned++;await saveJob(job)}job.phase=job.stop?'Stopped':'Complete'}catch(e){job.phase='Failed';job.errors.push({business:'Batch',error:safeError(e)})}finally{job.finishedAt=new Date().toISOString();await saveJob(job).catch(()=>{})}}
async function route(req,res){const u=new URL(req.url,'http://localhost');
 if(req.method==='GET'&&u.pathname==='/health')return json(res,200,{ok:true});
 if(req.method==='GET'&&u.pathname==='/'){const html=await readFile(join(here,'public','index.html'));res.writeHead(200,{'content-type':'text/html; charset=utf-8','content-security-policy':"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'",'cache-control':'no-store','x-frame-options':'DENY'});return res.end(html)}
 if(req.method==='GET'&&u.pathname==='/client.js'){res.writeHead(200,{'content-type':'text/javascript; charset=utf-8','cache-control':'no-store'});return res.end(await readFile(join(here,'public','client.js')))}
 if(req.method==='GET'&&u.pathname==='/style.css'){res.writeHead(200,{'content-type':'text/css; charset=utf-8','cache-control':'no-store'});return res.end(await readFile(join(here,'public','style.css')))}
 if(req.method==='POST'&&u.pathname==='/api/login'){const input=await readBody(req),pw=String(input.password||''),configured=String(process.env.APP_PASSWORD||'');if(!configured)return json(res,503,{error:'App access is not configured by the administrator yet.'});const a=Buffer.from(pw),b=Buffer.from(configured);if(a.length!==b.length||!timingSafeEqual(a,b))return json(res,401,{error:'Incorrect password.'});const id=randomUUID();await pool.query('INSERT INTO app_sessions(id,expires_at) VALUES($1,now()+interval \'7 days\')',[id]);res.setHeader('Set-Cookie',sessionCookie(sign(id)));return json(res,200,{ok:true})}
 if(req.method==='POST'&&u.pathname==='/api/logout'){const sid=await auth(req,res);if(sid)await pool.query('DELETE FROM app_sessions WHERE id=$1',[sid]);res.setHeader('Set-Cookie',sessionCookie('',0));return json(res,200,{ok:true})}
 if(req.method==='GET'&&u.pathname==='/api/me'){const sid=await auth(req,res);return json(res,200,{authenticated:!!sid})}
 const sid=await requireAuth(req,res);if(!sid)return;

 if (req.method === 'POST' && u.pathname === '/api/business-finder') {
  const input = await readBody(req);
  const category = String(input.category || '').trim().toLowerCase();
  const city = String(input.city || '').trim();
  const country = String(input.country || '').trim().toUpperCase();
  const countryName = { AU: 'Australia', NZ: 'New Zealand', US: 'United States' }[country];

  if (!BUSINESS_TAGS[category]) return json(res, 400, { error: 'Choose a supported business category.' });
  if (!city || city.length > 100 || /[<>\n\r]/.test(city)) return json(res, 400, { error: 'Enter a valid city.' });
  if (!countryName) return json(res, 400, { error: 'Choose Australia, New Zealand, or the United States.' });

  const now = Date.now();
  const recent = (finderUsage.get(sid) || []).filter(t => now - t < 60000);
  if (recent.length >= 5) return json(res, 429, { error: 'Search limit reached. Wait a minute and try again.' });

  const cacheKey = `${country}|${category}|${city.toLowerCase()}`;
  const cached = finderCache.get(cacheKey);
  if (cached && now - cached.time < 6 * 60 * 60 * 1000) return json(res, 200, { ...cached.data, cached: true });
  finderUsage.set(sid, recent.concat(now));

  try {
    const categoryTerms = {
      plumber: 'plumber',
      plumbers: 'plumber',
      restaurant: 'restaurant',
      restaurants: 'restaurant',
      dentist: 'dentist',
      dentists: 'dentist',
      cafe: 'cafe',
      cafes: 'cafe',
      hotel: 'hotel',
      hotels: 'hotel',
      electrician: 'electrician',
      electricians: 'electrician',
      bakery: 'bakery',
      bakeries: 'bakery',
      lawyer: 'lawyer',
      lawyers: 'lawyer',
      gym: 'gym',
      gyms: 'gym',
      salon: 'hairdresser beauty salon',
      'beauty salon': 'beauty salon',
      mechanic: 'car repair mechanic',
      mechanics: 'car repair mechanic'
    };
    const term = categoryTerms[category] || category.replace(/[_-]+/g, ' ');
    const query = `${term} ${city} ${countryName}`;
    const photonUrl = new URL('https://photon.komoot.io/api/');
    photonUrl.searchParams.set('q', query);
    photonUrl.searchParams.set('limit', '30');
    photonUrl.searchParams.set('lang', 'en');

    const response = await fetch(photonUrl, {
      headers: { 'User-Agent': 'MatalaBusinessFinder/0.1' },
      signal: AbortSignal.timeout(20000)
    });
    if (!response.ok) throw Error(`Free business search returned HTTP ${response.status}. Please try again later.`);

    const payload = await response.json();
    const seen = new Set();

    // Prefer places whose OpenStreetMap tags match the selected category.
    // Keep an explicit allow-list so text matches alone don't qualify suppliers.
    const categoryRules = {
      plumber: [['craft', 'plumber']],
      electrician: [['craft', 'electrician']],
      dentist: [['amenity', 'dentist']],
      restaurant: [['amenity', 'restaurant']],
      cafe: [['amenity', 'cafe']],
      'auto repair': [['shop', 'car_repair']],
      furniture: [['shop', 'furniture']],
      'real estate': [['office', 'estate_agent']],
      hairdresser: [['shop', 'hairdresser']],
      gym: [['leisure', 'fitness_centre'], ['leisure', 'sports_centre']],
      hotel: [['tourism', 'hotel']],
      retailer: [['shop', 'yes']],
      professional: [['office', 'yes']],
      trades: [['craft', 'yes']]
    };

    const rules = categoryRules[category] || [];
    const features = payload.features || [];
    const taggedMatches = features.filter(feature => {
      const p = feature.properties || {};
      return rules.some(([key, value]) =>
        String(p.osm_key || '').toLowerCase() === key &&
        String(p.osm_value || '').toLowerCase() === value
      );
    });

    // If Photon has category-tagged results, prioritize those.
    // If not, retain its text matches rather than returning an empty list.
    const selectedFeatures = taggedMatches.length ? taggedMatches : features;
    const results = selectedFeatures.map((feature, index) => {
      const p = feature.properties || {};
      const coords = feature.geometry?.coordinates || [];
      const name = String(p.name || '').trim();
      const tags = [p.osm_key, p.osm_value, p.type].filter(Boolean).join(' ').toLowerCase();
      const address = [
        p.housenumber && p.street ? `${p.housenumber} ${p.street}` : p.street,
        p.district || p.suburb,
        p.city || p.town || p.village,
        p.state,
        p.postcode,
        countryName
      ].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', ');
      const id = p.osm_type && p.osm_id ? `${p.osm_type}/${p.osm_id}` : `${name.toLowerCase()}|${address.toLowerCase()}`;

      return {
        id: id || `photon-${index}`,
        name,
        category: tags || category,
        address,
        phone: String(
          p.phone || p['contact:phone'] || p.telephone || ''
        ).trim(),
        website: String(
          p.website || p['contact:website'] || p.url || ''
        ).trim(),
        googleMapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([name, address].filter(Boolean).join(', '))}`,
        lat: Number(coords[1]) || null,
        lon: Number(coords[0]) || null,
        rating: null,
        reviews: null,
        source: 'OpenStreetMap'
      };
    }).filter(p => {
      if (!p.name || seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    }).slice(0, 20);

    const data = {
      results, category, city, country, source: 'Photon / OpenStreetMap', cached: false,
      message: results.length
        ? 'Free OpenStreetMap-based listings. Ratings, review counts, phone numbers, and websites may be unavailable.'
        : 'No matching named places found. Try a more specific category or nearby city.'
    };
    finderCache.set(cacheKey, { time: now, data });
    return json(res, 200, data);
  } catch (error) {
    return json(res, 502, { error: safeError(error) || 'Free business search is unavailable. No paid provider was used.' });
  }
}

  if(req.method==='GET'&&u.pathname==='/api/settings'){const r=await pool.query('SELECT encrypted_outscraper_key FROM app_settings WHERE id=$1',['workspace']);return json(res,200,{hasOutscraperKey:!!r.rows[0]?.encrypted_outscraper_key})}
 if(req.method==='POST'&&u.pathname==='/api/settings/key'){const input=await readBody(req),key=String(input.apiKey||'').trim();if(key.length>500)return json(res,400,{error:'API key is too long.'});if(key){const enc=encrypt(key);await pool.query('INSERT INTO app_settings(id,encrypted_outscraper_key) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET encrypted_outscraper_key=EXCLUDED.encrypted_outscraper_key,updated_at=now()',['workspace',enc])}else{await pool.query('INSERT INTO app_settings(id,encrypted_outscraper_key) VALUES($1,NULL) ON CONFLICT(id) DO UPDATE SET encrypted_outscraper_key=NULL,updated_at=now()',['workspace'])}return json(res,200,{ok:true,hasOutscraperKey:!!key})}
 if(req.method==='POST'&&u.pathname==='/api/demo'){const j=makeDemoJob(randomUUID());j.phase='Complete';await saveJob(j);return json(res,201,{id:j.id})}
 if(req.method==='POST'&&u.pathname==='/api/jobs'){if (process.env.LIVE_SCANS_ENABLED !== 'true') {
  return json(res, 403, {
    error: 'Live scans are disabled until spending safeguards are configured.'
  });
}const maxPlaces=Math.min(5,Math.max(1,Number(input.maxPlaces)||5)),
reviewsPerPlace=Math.min(10,Math.max(5,Number(input.reviewsPerPlace)||10)),
target=Math.min(3,Math.max(1,Number(input.target)||3)),aiKey=String(process.env.OPENAI_API_KEY||'').trim();const id=randomUUID(),job={id,phase:'Queued',cutoff:fourMonthsAgo(),progress:{discovered:0,scanned:0,skipped:0,reviewsFetched:0,candidates:0,semanticRuns:0},leads:[],errors:[],stop:false,startedAt:new Date().toISOString(),finishedAt:null,limits:{maxPlaces,reviewsPerPlace,target},countries,queries};await saveJob(job);res.writeHead(202,{'content-type':'application/json'});res.end(JSON.stringify({id}));runningJobs.set(id,job);void run(job,key,aiKey,{queries,maxPlaces,reviewsPerPlace,target,countries}).finally(()=>runningJobs.delete(id));return}
 if(req.method==='GET'&&u.pathname==='/api/jobs'){const r=await pool.query('SELECT id,payload,updated_at FROM scan_jobs ORDER BY updated_at DESC LIMIT 100');return json(res,200,{jobs:r.rows.map(x=>({id:x.id,phase:x.payload.phase,startedAt:x.payload.startedAt,finishedAt:x.payload.finishedAt,progress:x.payload.progress,leadCount:(x.payload.leads||[]).length,demo:!!x.payload.demo,updatedAt:x.updated_at}))})}
 const m=u.pathname.match(/^\/api\/jobs\/([a-f0-9-]+)(?:\/(stop|decision|export))?$/);if(m){const job=await loadJob(m[1]);if(!job)return json(res,404,{error:'Scan not found.'});if(req.method==='GET'&&!m[2])return json(res,200,{...job,stop:undefined});if(req.method==='POST'&&m[2]==='stop'){const active=runningJobs.get(job.id);if(active){active.stop=true;await saveJob(active)}else{job.stop=true;await saveJob(job)}return json(res,200,{ok:true})}if(req.method==='POST'&&m[2]==='decision'){const input=await readBody(req),lead=job.leads.find(x=>x.id===input.id);if(!lead||!['Approved','Rejected','Needs review'].includes(input.status))return json(res,400,{error:'Invalid lead decision.'});if(job.demo&&input.status==='Approved')return json(res,400,{error:'Demo records are fictional and cannot be approved for export.'});lead.status=input.status;lead.checked=true;if(typeof input.primaryTheme==='string'&&input.primaryTheme.trim())lead.primaryTheme=input.primaryTheme.trim().slice(0,100);await saveJob(job);return json(res,200,{ok:true})}if(req.method==='GET'&&m[2]==='export'){if(job.demo)return json(res,400,{error:'Demo data cannot be exported as leads.'});const selected=job.leads.filter(x=>x.status==='Approved'&&x.checked);res.writeHead(200,{'content-type':'text/csv; charset=utf-8','content-disposition':'attachment; filename="matala-approved-leads.csv"','cache-control':'no-store'});return res.end('\uFEFF'+csv(selected))}}
 return json(res,404,{error:'Not found'})}
const server=http.createServer(async(req,res)=>{try{await route(req,res)}catch(e){console.error(safeError(e));if(!res.headersSent)json(res,500,{error:safeError(e)});else res.end()}});
if(!process.env.DATABASE_URL||!process.env.APP_PASSWORD||!process.env.SESSION_SECRET||!process.env.KEY_ENCRYPTION_SECRET){console.error('Missing required environment: DATABASE_URL, APP_PASSWORD, SESSION_SECRET, KEY_ENCRYPTION_SECRET');process.exit(1)}
init().then(()=>server.listen(port,'0.0.0.0',()=>console.log('Matala Review Signals listening on '+port))).catch(e=>{console.error('Startup failed:',safeError(e));process.exit(1)});
