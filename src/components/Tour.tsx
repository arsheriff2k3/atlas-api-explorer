'use client';
import { useEffect, useLayoutEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, X } from 'lucide-react';

export const TOUR_KEY='atlas-tour-done';
const STEPS=[
 {selector:'.project-nav',title:'Your projects',text:'Every analysis is saved to your account. Switch projects here; each opens exactly where you left it.'},
 {selector:'.tab-buttons',title:'Views of the same API',text:'The dependency map, ID lineage, endpoints, and scenarios all read the same saved analysis.'},
 {selector:'.graph-filters',title:'Needs and Used by',text:'Select an entity, then trace everything it needs to be created, or everything that uses it.'},
 {selector:'.tab-buttons [data-tab="scenarios"]',title:'Scenarios',text:'One endpoint at a time: build order, if/else logic flow, rules, the minimal request, and a comparison with your own payload.'},
];

export default function Tour({onClose}:{onClose:()=>void}){
 const [index,setIndex]=useState(0);const [box,setBox]=useState<DOMRect|null>(null);
 const step=STEPS[index];
 useLayoutEffect(()=>{
  const element=document.querySelector(step.selector);
  if(!element){setBox(null);return}
  element.scrollIntoView({block:'nearest',behavior:'smooth'});
  const update=()=>setBox(element.getBoundingClientRect());update();
  window.addEventListener('resize',update);window.addEventListener('scroll',update,true);
  return()=>{window.removeEventListener('resize',update);window.removeEventListener('scroll',update,true)};
 },[step.selector]);
 const finish=()=>{try{localStorage.setItem(TOUR_KEY,'1')}catch{}onClose()};
 useEffect(()=>{const onKey=(event:KeyboardEvent)=>{if(event.key==='Escape')finish();if(event.key==='ArrowRight')setIndex(i=>Math.min(STEPS.length-1,i+1));if(event.key==='ArrowLeft')setIndex(i=>Math.max(0,i-1))};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey)});
 const top=box?Math.min(window.innerHeight-190,box.bottom+12):window.innerHeight/2-90;
 const left=box?Math.max(12,Math.min(window.innerWidth-332,box.left)):window.innerWidth/2-160;
 return <div className="tour" role="dialog" aria-modal="true" aria-labelledby="tour-title">
  {box&&<div className="tour-spotlight" style={{top:box.top-6,left:box.left-6,width:box.width+12,height:box.height+12}}/>}
  <div className="tour-card" style={{top,left}}>
   <div className="tour-card-head"><small>{index+1} / {STEPS.length}</small><button className="icon-button" aria-label="Close tour" onClick={finish}><X size={14}/></button></div>
   <h3 id="tour-title">{step.title}</h3><p>{step.text}</p>
   <div className="tour-card-actions"><button className="outline-button" onClick={()=>setIndex(index-1)} disabled={index===0}><ArrowLeft size={13}/>Back</button>{index<STEPS.length-1?<button className="primary-button" onClick={()=>setIndex(index+1)} autoFocus>Next<ArrowRight size={13}/></button>:<button className="primary-button" onClick={finish} autoFocus>Start exploring</button>}</div>
  </div>
 </div>;
}
