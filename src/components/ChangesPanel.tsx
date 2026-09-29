'use client';
import { History, X } from 'lucide-react';
import type { AnalysisChanges } from '../analysisDiff';
import { changeCount } from '../analysisDiff';

function Group({title,added,removed}:{title:string;added:string[];removed:string[]}){
 if(!added.length&&!removed.length)return null;
 return <div className="changes-group"><h4>{title}</h4>{added.map(item=><p key={`+${item}`} className="added">+ {item}</p>)}{removed.map(item=><p key={`-${item}`} className="removed">− {item}</p>)}</div>;
}

export default function ChangesPanel({changes,onClose}:{changes:AnalysisChanges;onClose:()=>void}){
 const total=changeCount(changes);
 return <aside className="changes-panel" role="dialog" aria-label="What changed since the last run">
  <div className="ask-heading"><span><History size={17}/>What changed</span><button className="icon-button" aria-label="Close" onClick={onClose}><X size={17}/></button></div>
  <p className="small muted">Compared with the run from {new Date(changes.comparedWith).toLocaleString()}. {total?`${total} change${total>1?'s':''}.`:'No changes: the API documentation is the same.'}</p>
  <Group title="ENTITIES" added={changes.entities.added} removed={changes.entities.removed}/>
  <Group title="ENDPOINTS" added={changes.endpoints.added} removed={changes.endpoints.removed}/>
  {changes.endpoints.changed.length>0&&<div className="changes-group"><h4>CHANGED REQUEST FIELDS</h4>{changes.endpoints.changed.map(item=><div key={item.endpoint} className="changes-endpoint"><code>{item.endpoint}</code>{item.newlyRequired.map(field=><p key={`r${field}`} className="removed">now required: {field}</p>)}{item.addedFields.map(field=><p key={`a${field}`} className="added">+ {field}</p>)}{item.removedFields.map(field=><p key={`d${field}`} className="removed">− {field}</p>)}</div>)}</div>}
  <Group title="LINKS" added={changes.links.added} removed={changes.links.removed}/>
 </aside>;
}
