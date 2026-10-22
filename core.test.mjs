import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizePlace,analyseText,qualify,csv} from '../core.mjs';
test('normalizes US place country',()=>{assert.equal(normalizePlace({name:'Example HVAC',country_code:'US',full_address:'Austin, Texas, United States'}).country,'US')});
test('normalizes Australian and New Zealand place country',()=>{assert.equal(normalizePlace({country_code:'AU'}).country,'AU');assert.equal(normalizePlace({full_address:'Auckland, New Zealand'}).country,'NZ')});
test('groups operational issue text',()=>{const a=analyseText('We requested a quote and nobody replied for two weeks.');assert.ok(a.themes.includes('Quoting & estimates'));assert.ok(a.themes.includes('Response & follow-up'))});
test('CSV escapes spreadsheet formula prefixes',()=>{const out=csv([{name:'=HYPERLINK("x")',issues:[],reviews:[],status:'Approved'}]);assert.match(out,/'=HYPERLINK/)});
test('qualifies repeated operational evidence for human review',()=>{const reviews=[{themes:['Booking & scheduling'],humanOnly:false,specific:true,text:'Appointment was missed for weeks',rating:1,date:'2026-09-01',localDate:'2026-09-01',link:'https://www.google.com/maps/review/1'},{themes:['Booking & scheduling'],humanOnly:false,specific:true,text:'Booking was rescheduled twice without notice',rating:2,date:'2026-09-02',localDate:'2026-09-02',link:'https://www.google.com/maps/review/2'}];const lead=qualify({name:'Example',phone:'123'},reviews);assert.equal(lead.status,'Candidate');assert.equal(lead.primaryCount,2)});
