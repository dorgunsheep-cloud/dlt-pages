import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { combination, calculateBet, statistics, recommend, DEFAULT_SETTINGS, normalizeDraw, mergeDraws, replaceDraw, parseImport, auditDraws, prizeLevel, checkBet, drawSignature, normalizePlanBackup } from '../lib/engine.mjs';
const allDraws = JSON.parse(fs.readFileSync(new URL('../data/draws.json', import.meta.url)));
// Freeze the earlier 752-period sample so new official draws do not change regression expectations.
const draws = allDraws.filter(r => r.issue <= '26120');
const single = { mode: '单式', front: [1,2,3,4,5], back: [1,2], frontDan: [], backDan: [], addition: false, multiple: 1 };
test('组合数及投注金额边界', () => {
 assert.equal(combination(35,5)*combination(12,2),21425712);
 assert.equal(combination(4,5),0); assert.equal(combination(4,0),1);
 assert.equal(calculateBet(single).cost,2);
 assert.equal(calculateBet({...single,addition:true,multiple:99}).cost,297);
 assert.throws(()=>calculateBet({...single,multiple:0})); assert.throws(()=>calculateBet({...single,multiple:100}));
 const complex={...single,mode:'复式',front:[1,2,3,4,5,6],back:[1,2,3]};
 assert.equal(calculateBet(complex).units,18); assert.equal(calculateBet({...complex,addition:true,multiple:2}).cost,108);
 assert.equal(calculateBet({...single,mode:'复式',front:Array.from({length:35},(_,i)=>i+1),back:Array.from({length:12},(_,i)=>i+1)}).overLimit,true);
});
test('前区、后区、双区胆拖注数与互斥校验',()=>{
 const front={...single,mode:'前区胆拖',frontDan:[1,2],front:[3,4,5,6,7],back:[1,2]};
 assert.equal(calculateBet(front).units,10);
 const back={...single,mode:'后区胆拖',backDan:[1],back:[2,3,4]};
 assert.equal(calculateBet(back).units,3);
 assert.equal(calculateBet({...front,mode:'双区胆拖',backDan:[1],back:[2,3,4],addition:true,multiple:2}).cost,180);
 assert.throws(()=>calculateBet({...front,front:[1,3,4,5,6]}),/重复/);
 assert.throws(()=>calculateBet({...back,backDan:[1,2]}),/重复|1个胆码/);
 assert.throws(()=>calculateBet({...single,front:[1,1,3,4,5]}),/重复/);
 assert.throws(()=>calculateBet({...single,mode:'复式'}),/至少有一个区/);
});
test('官方数据752期完整可合并，导入去重且冲突原子拒绝',()=>{
 assert.equal(mergeDraws([],draws).draws.length,752);
 const r=mergeDraws(draws,draws.slice(-10));assert.equal(r.added,0);assert.equal(r.draws.length,752);
 const before=JSON.stringify(draws);assert.throws(()=>mergeDraws(draws,[{...draws[0],front:[1,2,3,4,5]}]),/冲突/);assert.equal(JSON.stringify(draws),before);
 assert.equal(auditDraws(draws).missing.length,0);
 const reduced=draws.filter(r=>r.issue!=='25010');assert(auditDraws(reduced).missing.includes('25010'));
});
test('CSV、官方JSON及备份兼容；日期与未来数据验证',()=>{
 const csv='\uFEFF期号,开奖日期,前区1,前区2,前区3,前区4,前区5,后区1,后区2\r\n26120,2026-10-21,01,06,10,15,32,03,04\r\n';
 assert.deepEqual(normalizeDraw(parseImport(csv,'file.csv')[0]).front,[1,6,10,15,32]);
 assert.equal(parseImport(JSON.stringify({draws}),'backup.json').length,752);
 assert.equal(parseImport(JSON.stringify({value:{list:[{lotteryDrawNum:'26120',lotteryDrawTime:'2026-10-21',lotteryDrawResult:'01 06 10 15 32 03 04'}]}}),'official.json').length,1);
 assert.throws(()=>normalizeDraw({...draws[0],date:'2021-02-30'}),/日期/);
 assert.throws(()=>normalizeDraw({...draws[0],date:'2022-01-01'}),/年份/);
 assert.throws(()=>normalizeDraw({...draws[0],date:'2099-01-01',issue:'99001'}),/未来/);
 assert.throws(()=>parseImport('hello','x.csv'));
 const fixed=replaceDraw(draws,{...draws[0],front:[1,2,3,4,5]});assert.equal(fixed.length,752);assert.notEqual(drawSignature(fixed),drawSignature(draws));
});
test('频次窗口、遗漏、权重与原始五注完全复现',()=>{
 const stats=statistics(draws,DEFAULT_SETTINGS);
 const n=stats.front.find(r=>r.number===26);assert.equal(n.longCount,25);assert.equal(n.shortCount,6);assert.equal(n.omission,2);
 assert.throws(()=>statistics(draws,{...DEFAULT_SETTINGS,allWeight:21}),/100/);
 const result=recommend(draws,{count:5,mode:'单式',addition:false,multiple:1});
 assert.deepEqual(result.bets.map(b=>[b.front,b.back]),[
  [[3,10,12,14,26],[7,9]],[[6,10,26,29,33],[4,9]],[[3,6,14,32,33],[4,7]],[[9,12,15,29,32],[1,12]],[[9,11,15,21,22],[1,8]]
 ]);
 const copy=JSON.stringify(draws);statistics(draws);assert.equal(JSON.stringify(draws),copy);
});
test('按需生成1—20注及五种玩法推荐均合法，不重复',()=>{
 for(let count=1;count<=20;count++){
  const bets=recommend(draws,{count,mode:'单式',addition:true,multiple:2}).bets;
  assert.equal(bets.length,count);assert.equal(new Set(bets.map(b=>JSON.stringify([b.front,b.back]))).size,count);
  bets.forEach(b=>assert.equal(calculateBet(b).cost,6));
 }
 for(const mode of ['复式','前区胆拖','后区胆拖','双区胆拖']){
  const bets=recommend(draws,{count:5,mode,frontSize:mode==='后区胆拖'?5:6,backSize:mode==='前区胆拖'?2:3,frontDanSize:2,addition:true,multiple:1}).bets;
  assert.equal(bets.length,5);bets.forEach(b=>assert.equal(calculateBet(b).overLimit,false));
 }
 assert.throws(()=>recommend(draws,{count:21,mode:'单式',addition:false,multiple:1}));
 assert.throws(()=>recommend(draws,{count:1,mode:'前区胆拖',frontSize:6,backSize:2,frontDanSize:0,addition:false,multiple:1}));
});
test('新旧奖级切换和单式命中',()=>{
 assert.equal(prizeLevel(5,0,'26013'),3);assert.equal(prizeLevel(5,0,'26014'),3);
 assert.equal(prizeLevel(4,2,'26013'),4);assert.equal(prizeLevel(4,2,'26014'),3);
 assert.equal(prizeLevel(3,2,'26013'),6);assert.equal(prizeLevel(3,2,'26014'),5);
 assert.equal(prizeLevel(0,2,'26014'),7);assert.equal(prizeLevel(1,1,'26014'),0);
 assert.deepEqual(checkBet(single,{...single,issue:'26120'}),{1:1});
});
test('方案备份可以恢复，并拒绝不完整或超额方案',()=>{
 const p={id:'test-plan',createdAt:'2026-10-22T06:00:00Z',target:'26121',basedIssue:'26120',basedCount:752,settings:DEFAULT_SETTINGS,bets:[single],origin:'自选投注',config:''};
 assert.deepEqual(normalizePlanBackup({plans:[p]}),[p]);
 assert.throws(()=>normalizePlanBackup({plans:[{...p,bets:[{...single,frontDan:undefined}]}]}));
 assert.throws(()=>normalizePlanBackup({plans:[{...p,target:'wrong'}]}));
});
function choose(ns,k){if(!k)return[[]];return ns.flatMap((n,i)=>choose(ns.slice(i+1),k-1).map(c=>[n,...c]));}
test('复式和双区胆拖中奖注数对照逐注枚举，避免重复计奖',()=>{
 const target={issue:'26120',front:[1,2,3,4,5],back:[1,2]};
 for(const bet of [{...single,mode:'复式',front:[1,2,3,4,5,6,7],back:[1,2,3,4],multiple:3},{...single,mode:'双区胆拖',frontDan:[1,9],front:[2,3,4,5,6,7],backDan:[3],back:[1,2,4],multiple:2}]){
  const naive={};for(const f of choose(bet.front,5-bet.frontDan.length))for(const b of choose(bet.back,2-bet.backDan.length)){
   const fh=[...bet.frontDan,...f].filter(n=>target.front.includes(n)).length,bh=[...bet.backDan,...b].filter(n=>target.back.includes(n)).length;
   const level=prizeLevel(fh,bh,target.issue);if(level)naive[level]=(naive[level]??0)+bet.multiple;
  }assert.deepEqual(checkBet(bet,target),naive);
 }
});
