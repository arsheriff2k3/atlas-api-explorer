import type { Analysis } from './types';

// The slice of an analysis sent with an Ask Atlas question: the entities most
// related to the question, their links and endpoints. Built in the browser so any
// opened map (fresh or saved) can be asked about, without the server keeping it.
export function askContext(analysis: Analysis, question: string) {
  const words = question.toLowerCase().split(/\W+/).filter(word => word.length > 2);
  const rank = (value: unknown) => { const text = JSON.stringify(value).toLowerCase(); return words.reduce((total, word) => total + Number(text.includes(word)), 0); };
  const trimFields = <T extends {fields?: unknown[]; inputs?: unknown[]; outputs?: unknown[]}>(item: T) => ({...item, ...(item.fields ? {fields: item.fields.slice(0, 40)} : {}), ...(item.inputs ? {inputs: item.inputs.slice(0, 50)} : {}), ...(item.outputs ? {outputs: item.outputs.slice(0, 30)} : {})});
  const entities = [...analysis.entities].map(entity => ({entity, score: rank({name: entity.name, description: entity.description, fields: entity.fields.map(field => field.name)})})).sort((a, b) => b.score - a.score).slice(0, 18).map(item => trimFields(item.entity));
  const ids = new Set(entities.map(entity => entity.id));
  const operations = analysis.operations.filter(operation => operation.entityIds.some(id => ids.has(id))).map(operation => ({operation, score: rank({name: operation.name, path: operation.path})})).sort((a, b) => b.score - a.score).slice(0, 25).map(item => trimFields(item.operation));
  return {name: analysis.name, urls: analysis.urls, entities, dependencies: analysis.dependencies.filter(link => ids.has(link.source) || ids.has(link.target)).slice(0, 65), operations, patterns: analysis.patterns.slice(0, 20), coverage: analysis.coverage};
}
