import { useCallback, useEffect, useMemo, useState } from 'react';
import { ReactFlow, Background, BackgroundVariant, Controls, MiniMap, Handle, Position, MarkerType, useNodesState, useReactFlow, ReactFlowProvider, Panel } from '@xyflow/react';
import type { Node, NodeProps } from '@xyflow/react';
import dagre from '@dagrejs/dagre';
import { Box, KeyRound, Maximize2, Scan, Workflow, Layers3, MousePointer2 } from 'lucide-react';
import type { Entity, Dependency } from '../types';
import { entityColor } from '../types';
import '@xyflow/react/dist/style.css';

type ResourceNode=Node<{entity:Entity;connections:number;dimmed:boolean;active:boolean;rank:number},'resource'>;
function EntityNode({data}:NodeProps<ResourceNode>){
 const {entity,connections,dimmed,active,rank}=data;const color=entityColor(entity);
 const fields=entity.fields.filter(f=>/(id$|Id$|\[\]\.item_price_id)/.test(f.name)).slice(0,2);
 return <div className={`entity-node ${active?'active':''} ${dimmed?'dimmed':''}`} style={{'--node-color':color.color,'--node-soft':color.soft} as React.CSSProperties}>
  <Handle type="target" position={Position.Left}/><div className="node-heading"><span className="node-rank">{String(rank).padStart(2,'0')}</span><span className="node-icon"><Box size={16}/></span><strong>{entity.name}</strong><span className="node-menu">···</span></div>
  <div className="node-fields">{fields.length?fields.map(f=><div key={f.name}><KeyRound size={10}/><span>{f.name.replace('subscription_items[].','')}</span><small>{f.type==='string'?'str':f.type}</small></div>):<div><Layers3 size={11}/><span>{entity.fields.length} schema fields</span></div>}</div>
  <div className="node-footer"><span>{entity.operationIds.length} endpoints</span><span><Workflow size={10}/>{connections}</span></div><Handle type="source" position={Position.Right}/>
 </div>
}
const nodeTypes={resource:EntityNode};
const examplePositions:Record<string,{x:number;y:number}>={'item':{x:35,y:5},'item-price':{x:290,y:5},'customer':{x:35,y:230},'subscription':{x:290,y:230},'invoice':{x:555,y:230},'payment-source':{x:35,y:460},'transaction':{x:290,y:460},'credit-note':{x:810,y:230},'event':{x:555,y:5}};
function InnerGraph({entities,dependencies,ranks,selected,onSelect,onEdgeSelect,focus,fitKey,trace=false,overview=false}:{entities:Entity[];dependencies:Dependency[];ranks:Map<string,number>;selected:string|null;onSelect:(id:string)=>void;onEdgeSelect:(d:Dependency)=>void;focus:boolean;fitKey:number;trace?:boolean;overview?:boolean}){
 const {fitView}=useReactFlow();const [layoutKey,setLayoutKey]=useState(0);
 const connected=useMemo(()=>new Set(dependencies.filter(d=>d.source===selected||d.target===selected).flatMap(d=>[d.source,d.target])),[dependencies,selected]);
 const laidOut=useMemo(()=>{
  const graph=new dagre.graphlib.Graph().setDefaultEdgeLabel(()=>({}));graph.setGraph({rankdir:'LR',nodesep:65,ranksep:115,marginx:35,marginy:35});
  entities.forEach(e=>graph.setNode(e.id,{width:202,height:134}));
  dependencies.filter(d=>d.source!==d.target).forEach(d=>graph.setEdge(d.source,d.target));dagre.layout(graph);
  const columns=Math.max(2,Math.ceil(Math.sqrt(entities.length)));
  return entities.map((e,index)=>({id:e.id,type:'resource' as const,ariaLabel:`${ranks.get(e.id)?`${ranks.get(e.id)}. `:''}${e.name}, ${e.fields.length} fields`,position:overview&&layoutKey===0?{x:(index%columns)*255,y:Math.floor(index/columns)*185}:!trace&&examplePositions[e.id]&&layoutKey===0?examplePositions[e.id]:{x:graph.node(e.id).x-101,y:graph.node(e.id).y-67},data:{entity:e,rank:ranks.get(e.id)||0,connections:dependencies.filter(d=>d.source===e.id||d.target===e.id).length,dimmed:focus&&!!selected&&!connected.has(e.id)&&selected!==e.id,active:selected===e.id}}));
 },[entities,dependencies,ranks,layoutKey,focus,selected,connected,trace,overview]);
 const [nodes,setNodes,onNodesChange]=useNodesState<ResourceNode>(laidOut);
 useEffect(()=>{setNodes(laidOut)},[laidOut,setNodes]);
 useEffect(()=>{const timer=setTimeout(()=>fitView({padding:.16,duration:450,minZoom:.48,maxZoom:1.12}),120);return()=>clearTimeout(timer)},[entities.length,layoutKey,fitKey,fitView]);
 const edges=useMemo(()=>{
  const used=new Set<string>();return dependencies.filter(d=>d.source!==d.target).filter(d=>{const key=d.source+'>'+d.target;if(used.has(key))return false;used.add(key);return true}).map(d=>{
   const highlight=selected===d.source||selected===d.target;
   return {id:d.id,source:d.source,target:d.target,type:'default',label:d.type==='schema'?'schema reference':d.field.split('.').at(-1),animated:highlight,style:{stroke:highlight?'#9884da':'#d0d2dd',strokeWidth:highlight?1.8:1.3,strokeDasharray:d.status==='inferred'?'5 5':undefined,opacity:focus&&!highlight?.3:1},labelStyle:{fill:highlight?'#7c6ba9':'#9695a4',fontSize:10,fontFamily:'var(--mono)'},labelBgStyle:{fill:'#fafbfe',fillOpacity:.95},labelBgPadding:[6,4] as [number,number],labelBgBorderRadius:4,markerEnd:{type:MarkerType.ArrowClosed,color:highlight?'#9884da':'#c9cbd6',width:16,height:16}};
  });
 },[dependencies,selected,focus]);
 const onFit=useCallback(()=>fitView({duration:500,padding:.16,minZoom:.48,maxZoom:1.12}),[fitView]);
 return <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onNodeDoubleClick={(_,node)=>onSelect(node.id)} onKeyDown={event=>{if(event.key!=='Enter'&&event.key!==' ')return;const id=(event.target as HTMLElement).closest('.react-flow__node')?.getAttribute('data-id');if(id){event.preventDefault();onSelect(id)}}} aria-label="API entity map. Tab to an entity, press Enter for details." onEdgeClick={(_,edge)=>{const d=dependencies.find(d=>d.id===edge.id);if(d)onEdgeSelect(d)}} nodesConnectable={false} nodesDraggable zoomOnDoubleClick={false} minZoom={.08} maxZoom={1.8} fitView fitViewOptions={{padding:.16,minZoom:.48,maxZoom:1.12}} elevateNodesOnSelect onlyRenderVisibleElements>
  <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#d8dbe6"/><Controls showInteractive={false}/><MiniMap position="bottom-right" nodeColor={n=>entityColor((n.data as ResourceNode['data']).entity).color} maskColor="rgba(248,249,253,.75)" pannable zoomable/>
  <Panel position="top-left"><span className="canvas-caption"><span className="live-dot"/>LIVE EXPLORER <span className="caption-line"/> {entities.length} entities in view</span></Panel>
  <Panel position="top-right"><div className="canvas-actions"><button title="Auto layout" aria-label="Auto layout" onClick={()=>setLayoutKey(k=>k+1)}><Scan size={16}/></button><button title="Fit graph" aria-label="Fit graph" onClick={onFit}><Maximize2 size={16}/></button></div></Panel>
  <Panel position="bottom-center"><span className="canvas-tip"><MousePointer2 size={12}/>Double-click for details · Drag entities to move · Scroll to zoom</span></Panel>
 </ReactFlow>
}
export default function Graph(props:Parameters<typeof InnerGraph>[0]){return <ReactFlowProvider><InnerGraph {...props}/></ReactFlowProvider>}
