import {analyseText, fourMonthsAgo, normalizePlace, nzDate, qualify} from "./core.mjs";

function fakeReview(rating, daysAgo, text) {
  const date = new Date(Date.now() - daysAgo * 86_400_000);
  return {rating, date:date.toISOString(), localDate:nzDate(date), text, link:"", ...analyseText(text)};
}

export function makeDemoJob(id) {
  const plumbing = qualify(normalizePlace({
    place_id:"fictional-plumber", name:"Fictional Harbour Plumbing", city:"Christchurch",
    country_code:"NZ", phone:"FICTIONAL PHONE", full_address:"Christchurch, New Zealand", type:"Plumber"
  }), [
    fakeReview(1,12,"We requested a quote and heard nothing for two weeks."),
    fakeReview(2,37,"Our estimate came three weeks after the site visit."),
    fakeReview(1,61,"The staff member was rude and unfriendly.")
  ]);
  const shop = qualify(normalizePlace({
    place_id:"fictional-shop", name:"Fictional Southside Furniture", city:"Melbourne",
    country_code:"AU", phone:"FICTIONAL PHONE", full_address:"Melbourne, Australia", type:"Furniture store"
  }), [
    fakeReview(2,18,"The order was delayed and we received no update on delivery."),
    fakeReview(3,28,"The item arrived, but the packaging was torn.")
  ]);
  plumbing.analysisMethod="Fictional keyword example";
  shop.analysisMethod="Fictional keyword example";
  return {
    id, demo:true, cutoff:fourMonthsAgo(), phase:"Complete",
    progress:{discovered:2,scanned:2,skipped:0,reviewsFetched:5,candidates:1,semanticRuns:0},
    leads:[plumbing,shop],errors:[],stop:false,
    startedAt:new Date().toISOString(),finishedAt:new Date().toISOString(),
    limits:{maxPlaces:2,reviewsPerPlace:3,target:1},semanticEnabled:false
  };
}
