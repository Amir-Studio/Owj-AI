const DAY=86400000;
const date=v=>{if(!v)return null;const d=new Date(v);return Number.isNaN(d.getTime())?null:d};
const avg=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
const round=n=>Math.round(n);
const uid=()=>globalThis.crypto?.randomUUID?.()??`owj-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,9)}`;

export function analyzeData(input,now=new Date()){
 const sessions=input.sessions.map((s,i)=>({id:String(s.id??i),subject:String(s.subject??'Unspecified'),minutes:Math.max(0,Number(s.actualMinutes??s.durationMinutes??s.minutes)||0),completed:s.completed!==false&&s.status!=='abandoned',date:date(s.startedAt??s.date??s.completedAt)})).filter(s=>s.date&&s.minutes>0&&s.date<=now);
 const recent=sessions.filter(s=>s.date>=new Date(now-DAY*7));
 const prev=sessions.filter(s=>s.date>=new Date(now-DAY*14)&&s.date<new Date(now-DAY*7));
 const map=new Map(); for(const s of sessions){const x=map.get(s.subject)??{subject:s.subject,totalMinutes:0,sessions:0,completed:0,last:0};x.totalMinutes+=s.minutes;x.sessions++;if(s.completed)x.completed++;x.last=Math.max(x.last,s.date.getTime());map.set(s.subject,x)}
 const subjects=[...map.values()].map(x=>({subject:x.subject,totalMinutes:round(x.totalMinutes),sessions:x.sessions,completedSessions:x.completed,averageMinutes:round(x.totalMinutes/x.sessions),lastStudiedAt:new Date(x.last).toISOString()})).sort((a,b)=>b.totalMinutes-a.totalMinutes);
 const plan=input.plans.reduce((a,p)=>a+(Number(p.plannedMinutes??p.durationMinutes)||0),0),actual=input.plans.reduce((a,p)=>a+(Number(p.actualMinutes)||0),0);
 return {subjects,overview:{totalSessions:sessions.length,completedSessions:sessions.filter(s=>s.completed).length,totalMinutes:round(sessions.reduce((a,s)=>a+s.minutes,0)),totalMinutes7d:round(recent.reduce((a,s)=>a+s.minutes,0)),totalMinutesPrevious7d:round(prev.reduce((a,s)=>a+s.minutes,0)),sessions7d:recent.length,activeDays7d:new Set(recent.map(s=>s.date.toISOString().slice(0,10))).size,completionRate:sessions.length?round(sessions.filter(s=>s.completed).length/sessions.length*100):0,averageSessionMinutes:round(avg(sessions.map(s=>s.minutes))),plannedVsActualPercent:plan>0?round(actual/plan*100):null}};
}

export function detectPatterns(input,data,memory={},now=new Date()){
 const sessions=input.sessions.map(s=>({...s,date:date(s.startedAt??s.date??s.completedAt),minutes:Number(s.actualMinutes??s.durationMinutes??s.minutes)||0})).filter(s=>s.date&&s.date<=now&&s.date>=new Date(now-DAY*30)&&s.minutes>0);
 const hours=new Map(),days=new Set();for(const s of sessions){hours.set(s.date.getHours(),(hours.get(s.date.getHours())??0)+s.minutes);days.add(s.date.toISOString().slice(0,10))}
 const preferredStudyHours=[...hours].sort((a,b)=>b[1]-a[1]).slice(0,3).map(([hour,minutes])=>({hour,minutes}));
 const consistencyScore=round(days.size/30*100),concentration=data.subjects.length>1?round(data.subjects[0].totalMinutes/Math.max(1,data.overview.totalMinutes)*100):data.subjects.length?100:0;
 const abandonedPlans=input.plans.filter(p=>p.status==='abandoned'||p.status==='missed').length;
 const signals=[];if(data.overview.totalSessions>=5&&data.overview.completionRate<60)signals.push({code:'LOW_COMPLETION',severity:'warning'});if(days.size>=3&&consistencyScore<25)signals.push({code:'LOW_CONSISTENCY',severity:'info'});if(data.subjects.length>1&&concentration>=65)signals.push({code:'SUBJECT_IMBALANCE',severity:'info'});if(abandonedPlans)signals.push({code:'ABANDONED_PLANS',severity:'warning'});
 const old=memory?.patterns?.consistencyScore;
 return {preferredStudyHours,activeDays30d:days.size,consistencyScore,consistencyChange:Number.isFinite(old)?consistencyScore-old:null,completionRate:data.overview.completionRate,subjectConcentrationPercent:concentration,abandonedPlans,signals};
}

export function predictStudyTrend(data,memory={}){
 const current=data.overview.totalMinutes7d,previous=data.overview.totalMinutesPrevious7d,snaps=(memory.snapshots??[]).slice(-4).map(s=>Number(s.totalMinutes7d)).filter(Number.isFinite),baseline=snaps.length?avg(snaps):previous;
 const reference=baseline||previous;const direction=reference===0?'insufficient_data':current>reference*1.08?'increasing':current<reference*.92?'decreasing':'stable';
 return {direction,currentWeekMinutes:current,previousWeekMinutes:previous,changePercent:previous?round((current-previous)/previous*100):null,estimatedNextWeekMinutes:round(current*(direction==='increasing'?1.03:direction==='decreasing'?.97:1)),confidence:Math.min(.85,.2+data.overview.sessions7d*.025+snaps.length*.08),note:'برآورد آماری ساده است و پیش‌بینی قطعی محسوب نمی‌شود.'};
}

export function rankPriorities(input,data,patterns,now=new Date()){
 const bySubject=new Map(data.subjects.map(s=>[s.subject,s])),items=[];
 for(const exam of input.exams){const d=date(exam.date??exam.examDate);if(!d||d<now)continue;const subject=String(exam.subject??'General'),daysLeft=Math.max(0,Math.ceil((d-now)/DAY)),studied=bySubject.get(subject)?.totalMinutes??0,gap=Math.max(0,100-Math.min(100,studied/Math.max(60,Number(exam.targetMinutes)||300)*100)),score=round(Math.max(0,100-daysLeft*4)*.65+gap*.35);items.push({id:String(exam.id??'exam-'+subject),type:'exam',subject,title:exam.title??'آزمون '+subject,daysLeft,score,priority:score>=75?'critical':score>=50?'high':score>=25?'medium':'low',reason:`${daysLeft} روز تا آزمون باقی مانده؛ آمادگی تخمینی از زمان مطالعه ثبت‌شده محاسبه شده است.`})}
 for(const s of data.subjects){const share=s.totalMinutes/Math.max(1,data.overview.totalMinutes);if(data.subjects.length>1&&share<.12){const score=round(35+(.12-share)*200);items.push({id:'subject-'+s.subject,type:'subject_gap',subject:s.subject,title:'مرور '+s.subject,score,priority:score>=50?'high':'medium',reason:'سهم این درس از زمان مطالعه ثبت‌شده نسبتاً پایین است.'})}}
 if(patterns.signals.some(s=>s.code==='LOW_COMPLETION'))items.push({id:'habit-completion',type:'habit',title:'واقع‌بینانه‌تر کردن برنامه',score:65,priority:'high',reason:'نرخ تکمیل جلسات پایین است؛ حجم برنامه نیاز به بازبینی دارد.'});return items.sort((a,b)=>b.score-a.score);
}

export function proposeAdaptivePlan(input,data,priorities,patterns,now=new Date()){
 const available=Math.max(30,Number(input.profile.dailyAvailableMinutes)||240),factor=patterns.completionRate>=85?1:patterns.completionRate>=65?.9:.75,capacity=Math.round(available*.8*factor),ordered=[...new Set([...priorities.filter(x=>x.subject).map(x=>x.subject),...data.subjects.map(x=>x.subject),...(input.profile.subjects??[]).map(String)])].slice(0,4);
 if(!ordered.length)return{status:'insufficient_data',recommendedDailyMinutes:capacity,blocks:[],rationale:'برای پیشنهاد برنامه، ابتدا درس‌ها و چند جلسه مطالعه ثبت شود.'};
 const block=Math.max(25,Math.min(90,Math.round(capacity/ordered.length/5)*5));let remaining=capacity;
 const blocks=ordered.map((subject,i)=>{const minutes=Math.min(remaining,i===0?Math.round(block*1.2):block);remaining-=minutes;return{subject,suggestedMinutes:Math.max(0,minutes),reason:priorities.some(p=>p.subject===subject)?'این درس در اولویت تحلیل است.':'برای حفظ تعادل مطالعاتی پیشنهاد شده است.'}}).filter(x=>x.suggestedMinutes>0);
 return{status:'proposal',createdAt:now.toISOString(),recommendedDailyMinutes:capacity,blocks,rationale:'پیشنهاد قابل ویرایش است و برنامه ذخیره‌شده بدون تأیید کاربر تغییر نمی‌کند.'};
}

export function buildRecommendations(data,patterns,trend,priorities,proposal){
 const out=[],add=(type,priority,title,reason,action)=>out.push({id:type+'-'+(out.length+1),type,priority,title,reason,action});
 if(!data.overview.totalSessions)add('getting_started','medium','ثبت اولین جلسه','هنوز داده‌ای برای تحلیل وجود ندارد.','یک جلسه مطالعه در اوج ثبت کن.');
 else{if(data.overview.completionRate<60&&data.overview.totalSessions>=5)add('planning','high','کمی از حجم برنامه کم کن','نرخ تکمیل جلسات پایین است.','چند روز برنامه سبک‌تر و قابل اجرا را امتحان کن.');if(trend.direction==='decreasing')add('trend','medium','روند مطالعه را بررسی کن','زمان مطالعه هفته اخیر کاهش داشته است.','علت تغییر را بررسی کن و فوراً حجم را افزایش نده.');if(patterns.signals.some(s=>s.code==='SUBJECT_IMBALANCE'))add('balance','medium','تعادل درس‌ها را بررسی کن','زمان مطالعه بین درس‌ها نامتوازن است.','با توجه به آزمون‌ها و تسلط، زمان درس‌ها را بازبینی کن.');}
 for(const p of priorities.slice(0,3))add('priority',p.priority,p.title,p.reason,'این مورد را در برنامه بعدی بررسی کن.');if(proposal.status==='proposal')add('plan_proposal','low','پیشنهاد برنامه آماده است',proposal.rationale,'پیشنهاد را بررسی و در صورت تمایل تأیید یا ویرایش کن.');return out;
}

export function createOwjAI({storage,clock=()=>new Date()}={}){
 const memoryStore=storage??(async()=>{const m=new Map();return{get:async k=>m.get(k)??null,set:async(k,v)=>m.set(k,v),remove:async k=>m.delete(k)}})();
 const assert=id=>{if(typeof id!=='string'||!id.trim())throw new TypeError('input.userId is required')};
 async function getMemory(userId){assert(userId);return memoryStore.get(userId)}
 async function clearMemory(userId){assert(userId);return memoryStore.remove(userId)}
 async function analyze(raw){if(!raw||typeof raw!=='object')throw new TypeError('analyze expects an object');assert(raw.userId);for(const k of ['sessions','plans','exams'])if(raw[k]!=null&&!Array.isArray(raw[k]))throw new TypeError(k+' must be an array');const input={...raw,profile:raw.profile??{},sessions:raw.sessions??[],plans:raw.plans??[],exams:raw.exams??[]},now=raw.now?date(raw.now):clock();if(!now)throw new TypeError('now must be a valid date');const old=await memoryStore.get(raw.userId),data=analyzeData(input,now),patterns=detectPatterns(input,data,old,now),trend=predictStudyTrend(data,old),priorities=rankPriorities(input,data,patterns,now),planProposal=proposeAdaptivePlan(input,data,priorities,patterns,now),recommendations=buildRecommendations(data,patterns,trend,priorities,planProposal);
 const result={id:uid(),engineVersion:'0.1.0',createdAt:now.toISOString(),userId:raw.userId,overview:data.overview,subjects:data.subjects,patterns,trend,priorities,planProposal,recommendations,confidence:Math.min(1,Math.round((data.overview.totalSessions/20*.55+(old?.snapshots?.length ? .25 : 0)+(data.subjects.length ? .2 : 0))*100)/100)};
 const snapshots=[...(old?.snapshots??[]),{createdAt:result.createdAt,totalMinutes7d:data.overview.totalMinutes7d,sessions7d:data.overview.sessions7d,completionRate:data.overview.completionRate}].slice(-12);
 const subjectMemory=Object.fromEntries(data.subjects.map(s=>[s.subject,{totalMinutes:s.totalMinutes,sessions:s.sessions,lastStudiedAt:s.lastStudiedAt,averageMinutes:s.averageMinutes}]));
 await memoryStore.set(raw.userId,{schemaVersion:1,engineVersion:'0.1.0',updatedAt:result.createdAt,snapshots,subjects:subjectMemory,patterns:{preferredStudyHours:patterns.preferredStudyHours,consistencyScore:patterns.consistencyScore,completionRate:patterns.completionRate},importantInsights:recommendations.filter(r=>['high','critical'].includes(r.priority)).slice(0,8).map(({type,title,reason})=>({type,title,reason,createdAt:result.createdAt})),lastAnalysisId:result.id});return result;
 }
 return Object.freeze({analyze,getMemory,clearMemory,version:'0.1.0'});
}
