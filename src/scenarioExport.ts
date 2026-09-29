import type { LogicFlow } from './scenarioFlow.ts';
import type { Scenario } from './scenarios.ts';
import type { PayloadComparison } from './payloadCompare.ts';

interface ExportStep { name: string; stage: string; endpoint: string | null }

const esc = (text: string) => text.replace(/"/g, "'").replace(/[\n\r]+/g, ' ').replace(/[[\]{}()<>|]/g, ' ').slice(0, 90);

/** Mermaid flowchart of the logic flow; renders in GitHub, GitLab, Notion, Confluence, Obsidian. */
export function flowToMermaid(flow: LogicFlow): string {
  const ids = new Map(flow.nodes.map((node, index) => [node.id, `n${index}`]));
  const shape = (kind: string, text: string) => kind === 'decision' || kind === 'check' ? `{"${text}"}` : kind === 'start' || kind === 'end' ? `(["${text}"])` : `["${text}"]`;
  const lines = ['flowchart TD'];
  for (const node of flow.nodes) lines.push(`  ${ids.get(node.id)}${shape(node.kind, esc(node.title))}`);
  for (const edge of flow.edges) lines.push(`  ${ids.get(edge.source)} -->${edge.label ? `|${esc(edge.label)}|` : ''} ${ids.get(edge.target)}`);
  return lines.join('\n');
}

export function scenarioMarkdown({scenario, flow, steps, comparison, comparisonLabel, apiName}: {scenario: Scenario; flow: LogicFlow; steps: ExportStep[]; comparison: PayloadComparison | null; comparisonLabel: string; apiName: string}): string {
  const {operation} = scenario;
  const out: string[] = [];
  out.push(`# ${operation.name}`, '', `**${apiName}** · \`${operation.method} ${operation.path}\` · target entity: **${scenario.entity.name}**`, '');
  if (operation.description) out.push(operation.description.slice(0, 1200), '');
  out.push('## Logic flow', '', '```mermaid', flowToMermaid(flow), '```', '');
  out.push('## Build order', '', ...steps.map((step, index) => `${index + 1}. **${step.name}**  -  ${step.stage}${step.endpoint ? ` (\`${step.endpoint}\`)` : ''}`), '');
  if (scenario.cases.length) {
    out.push('## Cases', '');
    for (const item of scenario.cases) out.push(`- **${item.label}**: ${item.values.map(value => `\`${value.value}\`${value.rules.length ? ` (${value.rules.length} rule${value.rules.length > 1 ? 's' : ''})` : ''}`).join(', ')}`);
    out.push('');
  }
  const rules = scenario.rules.map(rule => ({text: rule.text, field: rule.field, appliesTo: rule.appliesTo.join(', ')}));
  if (rules.length) {
    out.push('## Rules', '', '| Source | Field | Applies to | Rule |', '| --- | --- | --- | --- |');
    for (const rule of rules) out.push(`| Spec | ${rule.field ? `\`${rule.field}\`` : ''} | ${rule.appliesTo || 'all'} | ${rule.text.replace(/\|/g, '\\|')} |`);
    out.push('');
  }
  out.push('## Minimal request', '', scenario.pathParams.length ? `Path parameters: ${scenario.pathParams.map(param => `\`{${param.name}}\``).join(', ')}` : '', '', '```json', JSON.stringify(scenario.payload, null, 2), '```', '');
  const groups = (['required', 'one-of', 'conditional'] as const).map(need => [need, scenario.fields.filter(item => item.need === need)] as const).filter(([, items]) => items.length);
  if (groups.length) {
    out.push('## Request fields', '');
    for (const [need, items] of groups) { out.push(`**${need === 'one-of' ? 'Choose one' : need[0].toUpperCase() + need.slice(1)}**`, '', ...items.slice(0, 80).map(item => `- \`${item.field.name}\` (${item.link ? `ID from ${item.link.name}` : item.field.type})${item.rules[0] ? `  -  ${item.rules[0].text}` : ''}`), ''); }
  }
  if (comparison) {
    out.push(`## Comparison with ${comparisonLabel}`, '', `Required fields covered: **${Math.round(comparison.coverage * 100)}%**`, '');
    if (comparison.missing.length) out.push('**Missing**', '', ...comparison.missing.map(item => `- \`${item.field.name}\`${item.link ? ` (ID from ${item.link.name})` : ''}`), '');
    if (comparison.matches.length) out.push('**Mapped**', '', '| Source field | API field | Match | Transform |', '| --- | --- | --- | --- |', ...comparison.matches.map(match => `| \`${match.source.path}\` | \`${match.target.field.name}\` | ${match.kind} | ${match.issues.join('; ')} |`), '');
    if (comparison.extra.length) out.push('**Not used by this endpoint**', '', comparison.extra.map(item => `\`${item.path}\``).join(', '), '');
  }
  if (scenario.response.length) out.push('## Response fields', '', scenario.response.slice(0, 60).map(field => `\`${field.name}\``).join(', '), '');
  return out.filter((line, index, all) => !(line === '' && all[index - 1] === '')).join('\n');
}
