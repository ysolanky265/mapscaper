export const THEMES = [
  ["Quoting & estimates", /\b(quot(?:e|es|ing|ation)|estimat(?:e|es|ing)|pricing proposal|no price|price breakdown)\b/i],
  ["Booking & scheduling", /\b(book(?:ing|ed)?|schedul(?:e|ing)|appointment|reservation|reschedul|calendar|slot)\b/i],
  ["Response & follow-up", /\b(no response|never (?:heard|called)|didn.t (?:call|reply)|follow.?up|unanswered|ignored|couldn.t reach|contacted|respond|reply|replied)\b/i],
  ["Delays & timeliness", /\b(late|delay(?:ed)?|wait(?:ed|ing)?|overdue|deadline|on time|never showed|no.show|weeks? later)\b/i],
  ["Order & fulfilment", /\b(order|deliver(?:y|ed)?|dispatch|shipment|parcel|fulfil|pickup|pick.up|click.and.collect|missing item)\b/i],
  ["Stock & availability", /\b(stock|inventory|out of stock|unavailable|sold out|back.?order|supply shortage)\b/i],
  ["Billing & payments", /\b(invoice|bill(?:ing|ed)?|charg(?:e|ed|ing)|payment|overcharg|deposit|receipt|refund)\b/i],
  ["Handoffs & coordination", /\b(hand.?off|passed (?:around|on)|different (?:person|department)|miscommunicat|office|team didn.t know|lost (?:paperwork|file|details))\b/i],
  ["Service execution", /\b(unfinished|incomplete|job not done|wrong (?:job|item|address|order)|rework|had to come back|mistake|error)\b/i],
  ["Returns & claims", /\b(return|warranty|claim|exchange|replacement|repair request)\b/i],
  ["Information & visibility", /\b(no update|status|track(?:ing)?|couldn.t tell|didn.t know|confus(?:ed|ing)|information missing|not informed)\b/i],
  ["Access & support", /\b(portal|login|website|app|system|support ticket|helpline|queue|phone line)\b/i]
];
const HUMAN_ONLY = /\b(rude|arrogant|unfriendly|bad attitude|impolite|unprofessional|racist|swore|shouted|yelled)\b/i;
const KEYWORDS = /\b(quote|estimate|book|schedule|appointment|order|deliver|invoice|billing|refund|payment|stock|inventory|follow.?up|response|delay|handoff|communication|system|process|tracking|repair|warranty)\b/i;

export function nzDate(value) {
  return new Intl.DateTimeFormat("en-CA",{timeZone:"Pacific/Auckland",year:"numeric",month:"2-digit",day:"2-digit"}).format(value);
}
export function fourMonthsAgo(now = new Date()) {
  const local = nzDate(now);
  const d = new Date(local+"T00:00:00Z");
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 4);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export function flattenData(value) {
  if (Array.isArray(value)) return value.flatMap(flattenData);
  if (value && typeof value === "object" && Array.isArray(value.data)) return flattenData(value.data);
  return value && typeof value === "object" ? [value] : [];
}

function dateOf(r) {
  const ts = Number(r.review_timestamp);
  if (Number.isFinite(ts) && ts > 1_000_000_000) return new Date(ts * 1000);
  const raw = r.review_datetime_utc || r.date || r.publishTime;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function analyseText(text) {
  const themes = THEMES.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
  return {
    themes,
    humanOnly: HUMAN_ONLY.test(text) && !KEYWORDS.test(text),
    specific: text.trim().length >= 35
  };
}

export function normalizePlace(place) {
  const countryCode = String(place.country_code || "").toUpperCase();
  const address = String(place.full_address || place.address || "");
  return {
    id: String(place.place_id || place.google_id || place.cid || [place.name, address].join("|")),
    name: String(place.name || place.business_name || ""),
    address, city: String(place.city || ""),
    country: ({NZ:"NZ",NZL:"NZ",AU:"AU",AUS:"AU",US:"US",USA:"US"}[countryCode] || (/(new zealand|\bnz\b)/i.test(address) ? "NZ" : /(australia|\bau\b)/i.test(address) ? "AU" : /(united states|\busa\b|\busa\s*$)/i.test(address) ? "US" : "")),
    phone: String(place.phone || ""),
    website: String(place.site || place.website || ""),
    category: String(place.type || place.category || ""),
    googleId: String(place.google_id || ""),
    placeId: String(place.place_id || ""),
    locationLink: String(place.location_link || place.reviews_link || "")
  };
}

export function normalizeReviews(place, cutoff = fourMonthsAgo()) {
  const seen = new Set();
  const rows = [];
  for (const r of place.reviews_data || []) {
    const rating = Number(r.review_rating ?? r.rating);
    const date = dateOf(r);
    const text = String(r.review_text || r.text || "").trim();
    const link = String(r.review_link || r.googleMapsUri || "");
    if (!Number.isInteger(rating) || rating < 1 || rating > 3 || !date || nzDate(date) < cutoff.toISOString().slice(0,10) || date > new Date() || !text || !/^https:\/\/(?:www\.)?(?:google\.com|maps\.google\.com)\//i.test(link)) continue;
    const key = String(r.review_id || link);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({rating, date: date.toISOString(), localDate:nzDate(date), text, link, ...analyseText(text)});
  }
  return rows.sort((a,b) => b.date.localeCompare(a.date));
}

export function qualify(place, reviews, coverageLimited = false) {
  const groups = new Map();
  for (const r of reviews) {
    if (r.humanOnly) continue;
    for (const theme of r.themes) {
      if (!groups.has(theme)) groups.set(theme, []);
      groups.get(theme).push(r);
    }
  }
  const issues = [...groups].map(([theme, evidence]) => ({
    theme, count: evidence.length, evidence
  })).sort((a,b) => b.count - a.count || b.evidence.filter(x=>x.specific).length - a.evidence.filter(x=>x.specific).length);
  const primary = issues[0] || null;
  const reasons = [];
  if (!place.phone) reasons.push("No phone number");
  if (!reviews.length) reasons.push("No dated, linked 1–3 star review with text");
  if (!primary) reasons.push("No clear process theme; needs a human read");
  if (primary && primary.count < 2) reasons.push("Only one review supports the leading theme");
  if (coverageLimited) reasons.push("Review cap reached; coverage may be incomplete");
  return {
    ...place, reviews, issues, primaryTheme: primary?.theme || "",
    primaryCount: primary?.count || 0,
    status: place.phone && primary?.count >= 2 && !coverageLimited ? "Candidate" : "Needs review",
    reasons,
    checked: false
  };
}

export function applySemanticIssues(reviews, proposed) {
  if (!Array.isArray(proposed)) return reviews;
  const themesByIndex = reviews.map(()=>[]);
  for (const issue of proposed) {
    const label = String(issue?.label || "").trim().slice(0,80);
    if (!label || issue?.process_fit !== true || !Array.isArray(issue.review_indices)) continue;
    for (const index of issue.review_indices) {
      if (Number.isInteger(index) && index >= 0 && index < reviews.length && !themesByIndex[index].includes(label)) themesByIndex[index].push(label);
    }
  }
  return reviews.map((review,i)=>({...review,themes:themesByIndex[i],humanOnly:!themesByIndex[i].length}));
}

export function csv(rows) {
  const columns = ["business","city","country","category","phone","website","address","primary_issue","supporting_reviews","primary_review_texts","primary_review_ratings","primary_review_dates","primary_review_links","other_issues","all_review_links","analysis_method","qualification","checked"];
  const esc = v => '"' + String(v ?? "").replaceAll('"','""').replace(/^[=+@\-\t\r]/, "'$&") + '"';
  return [columns.join(","), ...rows.map(lead => {
    const primary = lead.issues.find(x=>x.theme===lead.primaryTheme)?.evidence || lead.issues[0]?.evidence || [];
    return [
    lead.name,lead.city,lead.country,lead.category,lead.phone,lead.website,lead.address,
    lead.primaryTheme,primary.length,
    primary.map(x=>x.text).join(" | "),primary.map(x=>x.rating).join(" | "),
    primary.map(x=>x.localDate).join(" | "),primary.map(x=>x.link).join(" | "),
    lead.issues.filter(x=>x.theme!==lead.primaryTheme).map(x=>x.theme + " (" + x.count + ")").join("; "),
    lead.reviews.map(x=>x.link).join(" | "),lead.analysisMethod || "Keyword suggestion",lead.status,lead.checked
  ].map(esc).join(",")})].join("\r\n");
}
