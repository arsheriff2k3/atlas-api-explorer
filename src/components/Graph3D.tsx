import { useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph3D from 'react-force-graph-3d';
import type { ForceGraphMethods } from 'react-force-graph-3d';
import SpriteText from 'three-spritetext';
import { Group, Mesh, SphereGeometry, MeshStandardMaterial } from 'three';
import type { Entity, Dependency } from '../types';
import { entityColor } from '../types';

function compactName(entity:Entity){
 const raw=entity.rawName||entity.name;
 const role=/Request/i.test(raw)?'request':/Response/i.test(raw)?'response':'';
 const base=raw.replace(/^ExampleAPIResponse/i,'').replace(/(?:Public)?(?:API)?(?:Request|Response)(?:API)?(?:Entity|Model)?(?:\d+)?$/i,'').replace(/(?:Public)?(?:API)?Entity$/i,'').replace(/PublicAPI$/i,'');
 const words=(base||raw).replace(/([a-z])([A-Z])/g,'$1 $2').replace(/[_-]/g,' ').trim();
 return `${words}${role?` ${role}`:''}`.slice(0,38);
}
export default function Graph3D({entities,dependencies,ranks,selected,onSelect}:{entities:Entity[];dependencies:Dependency[];ranks:Map<string,number>;selected:string|null;onSelect:(id:string)=>void}){
 const wrapper=useRef<HTMLDivElement>(null);const [size,setSize]=useState({width:700,height:600});
 const graph=useRef<ForceGraphMethods>(undefined);
 const lastNodeClick=useRef<{id:string;time:number}|null>(null);
 useEffect(()=>{if(!wrapper.current)return;const observer=new ResizeObserver(([entry])=>setSize({width:entry.contentRect.width,height:entry.contentRect.height}));observer.observe(wrapper.current);return()=>observer.disconnect()},[]);
 const data=useMemo(()=>({nodes:entities.map(e=>({id:e.id,label:`${e.id===selected?'● ':''}${String(ranks.get(e.id)||0).padStart(2,'0')} · ${compactName(e)}`,fullName:e.name,color:entityColor(e).color,active:e.id===selected,val:Math.max(2,e.operationIds.length),entity:e})),links:dependencies.filter(d=>d.source!==d.target).map(d=>({source:d.source,target:d.target,label:d.field,inferred:d.status==='inferred'}))}),[entities,dependencies,ranks,selected]);
 useEffect(()=>{const timer=setTimeout(()=>graph.current?.zoomToFit(450,45),250);return()=>clearTimeout(timer)},[data,size.width,size.height]);
 return <div className="graph-3d" ref={wrapper}><ForceGraph3D ref={graph} width={size.width} height={size.height} graphData={data} backgroundColor="#f8f9fd" showNavInfo={false} nodeLabel="fullName" nodeColor="color" linkColor={()=>'#b5aecf'} linkOpacity={.55} linkWidth={.8} linkDirectionalArrowLength={3} linkDirectionalArrowRelPos={.8} linkDirectionalParticles={1} linkDirectionalParticleWidth={1} linkDirectionalParticleColor={()=>'#8462df'} nodeThreeObject={node=>{const group=new Group();const mesh=new Mesh(new SphereGeometry(node.active?5.2:3.6,24,24),new MeshStandardMaterial({color:node.color,roughness:.25,metalness:.12,emissive:node.active?node.color:'#000000',emissiveIntensity:node.active?.25:0}));group.add(mesh);const label=new SpriteText(node.label);label.color=node.active?'#5d3db5':'#3f3759';label.textHeight=node.active?3.7:3;label.position.y=node.active?-9:-7;label.backgroundColor='#f8f9fd';label.padding=1.3;label.borderRadius=2;group.add(label);return group;}} onNodeClick={node=>{const id=String(node.id);const now=Date.now();if(lastNodeClick.current?.id===id&&now-lastNodeClick.current.time<450){lastNodeClick.current=null;onSelect(id)}else lastNodeClick.current={id,time:now}}} onEngineStop={()=>graph.current?.zoomToFit(450,45)} onNodeDragEnd={()=>{lastNodeClick.current=null}} enableNodeDrag cooldownTicks={100}/><div className="three-caption"><span className="live-dot"/>3D CONSTELLATION<span>Double-click for details · Drag nodes to move · Drag background to orbit</span></div></div>
}
