'use client';
import { useMemo, useState } from 'react';
import { ReactFlow, Background, BackgroundVariant, Controls, Handle, MarkerType, Position, ReactFlowProvider } from '@xyflow/react';
import type { Edge, Node, NodeProps } from '@xyflow/react';
import dagre from '@dagrejs/dagre';
import { CheckCircle2, CircleHelp, GitFork, Play, PlusCircle, Send, Sparkles } from 'lucide-react';
import type { FlowNode, LogicFlow } from '../scenarioFlow';
import '@xyflow/react/dist/style.css';

const WIDTH=230;
const ICONS={start:Play,check:CircleHelp,create:PlusCircle,decision:GitFork,branch:CheckCircle2,end:Send};
const height=(node:FlowNode)=>44+Math.min(4,node.lines.length)*15+(node.lines.some(line=>line.length>40)?14:0);

function FlowBox({data}:NodeProps<Node<{node:FlowNode;active:boolean}>>){
 const {node,active}=data;const Icon=ICONS[node.kind];
 return <div className={`flow-box ${node.kind} ${active?'active':''}`} style={{width:WIDTH}}>
  <Handle type="target" position={Position.Top}/>
  <div className="flow-box-title"><Icon size={13}/><strong>{node.title}</strong>{node.source==='ai'&&<Sparkles size={11} aria-label="From the AI rule check"/>}</div>
  {node.lines.slice(0,4).map((line,index)=><p key={index}>{line}</p>)}
  <Handle type="source" position={Position.Bottom}/>
 </div>;
}
const nodeTypes={box:FlowBox};

function Inner({flow,onSelect,selected}:{flow:LogicFlow;onSelect:(id:string)=>void;selected:string|null}){
 const {nodes,edges}=useMemo(()=>{
  const graph=new dagre.graphlib.Graph().setDefaultEdgeLabel(()=>({}));
  graph.setGraph({rankdir:'TB',nodesep:28,ranksep:46,marginx:20,marginy:20});
  for(const node of flow.nodes)graph.setNode(node.id,{width:WIDTH,height:height(node)});
  for(const edge of flow.edges)graph.setEdge(edge.source,edge.target);
  dagre.layout(graph);
  const nodes:Node[]=flow.nodes.map(node=>{const point=graph.node(node.id);return {id:node.id,type:'box',ariaLabel:`${node.kind}: ${node.title}`,position:{x:point.x-WIDTH/2,y:point.y-height(node)/2},data:{node,active:node.id===selected},draggable:false}});
  const edges:Edge[]=flow.edges.map(edge=>({id:edge.id,source:edge.source,target:edge.target,label:edge.label,type:'smoothstep',className:`flow-edge ${edge.kind||''}`,labelBgPadding:[5,2],labelBgBorderRadius:4,markerEnd:{type:MarkerType.ArrowClosed,width:14,height:14}}));
  return {nodes,edges};
 },[flow,selected]);
 return <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodeClick={(_,node)=>onSelect(node.id)} onKeyDown={event=>{if(event.key!=='Enter'&&event.key!==' ')return;const id=(event.target as HTMLElement).closest('.react-flow__node')?.getAttribute('data-id');if(id){event.preventDefault();onSelect(id)}}} aria-label="Scenario logic flow. Tab to a step, press Enter for its explanation." fitView fitViewOptions={{padding:.12,maxZoom:1}} minZoom={.25} nodesConnectable={false} proOptions={{hideAttribution:true}}>
  <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="#e4e1ef"/><Controls showInteractive={false}/>
 </ReactFlow>;
}

export default function LogicFlowView({flow,explain}:{flow:LogicFlow;explain:(node:FlowNode)=>React.ReactNode}){
 const [selected,setSelected]=useState<string|null>(null);
 const node=flow.nodes.find(item=>item.id===selected)||null;
 const decisions=flow.nodes.filter(item=>item.kind==='decision').length;
 return <div className="logic-flow">
  <div className="logic-flow-legend"><span className="check">Prerequisite check</span><span className="create">Create first</span><span className="decision">Decision</span><span className="branch">Branch outcome</span><span className="muted">{decisions?`${decisions} decision${decisions>1?'s':''}`:'No decisions found in the specification. Run the AI rule check for the business logic.'}</span></div>
  <div className="logic-flow-canvas" style={{height:Math.min(760,Math.max(360,flow.nodes.length*62))}}><ReactFlowProvider><Inner flow={flow} onSelect={setSelected} selected={selected}/></ReactFlowProvider></div>
  {node?<div className="logic-flow-detail"><strong>{node.title}</strong>{node.lines.map((line,index)=><p key={index}>{line}</p>)}{explain(node)}</div>:<p className="small muted">Click any box to see its explanation.</p>}
 </div>;
}
