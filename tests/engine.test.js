import test from 'node:test';
import assert from 'node:assert/strict';
import {createOwjAI,analyzeData,detectPatterns,rankPriorities} from '../src/index.js';
const now=new Date('2026-11-09T12:00:00Z');
const input={userId:'u1',now:now.toISOString(),profile:{dailyAvailableMinutes:240,subjects:['Math','Physics']},sessions:[{id:'1',subject:'Math',actualMinutes:60,startedAt:'2026-11-08T08:00:00Z'},{id:'2',subject:'Physics',actualMinutes:30,startedAt:'2026-11-07T17:00:00Z',completed:false},{id:'3',subject:'Math',actualMinutes:45,startedAt:'2026-11-05T08:30:00Z'}],plans:[{status:'missed'}],exams:[{subject:'Physics',date:'2026-11-15',targetMinutes:300}]};
test('aggregates session totals and completion',()=>{const d=analyzeData(input,now);assert.equal(d.overview.totalSessions,3);assert.equal(d.overview.totalMinutes,135);assert.equal(d.overview.completionRate,67)});
test('detects patterns and exam priority',()=>{const d=analyzeData(input,now),p=detectPatterns(input,d,{},now);assert.equal(p.abandonedPlans,1);assert.ok(rankPriorities(input,d,p,now).some(x=>x.type==='exam'))});
test('engine persists per-user memory and produces proposal',async()=>{const ai=createOwjAI({clock:()=>now});const r=await ai.analyze(input);assert.ok(r.planProposal);assert.ok(Array.isArray(r.recommendations));assert.equal((await ai.getMemory('u1')).lastAnalysisId,r.id);assert.equal(await ai.getMemory('u2'),null)});
test('requires user ID and supports clearing memory',async()=>{const ai=createOwjAI();await assert.rejects(()=>ai.analyze({sessions:[]}),/userId/);await ai.analyze(input);await ai.clearMemory('u1');assert.equal(await ai.getMemory('u1'),null)});
