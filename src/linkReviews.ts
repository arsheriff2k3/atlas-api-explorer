import type { Analysis, Dependency } from './types';

export type LinkVerdict = 'confirmed' | 'rejected';
// Entity IDs are derived from the source host and resource path, so this key is
// stable across re-runs of the same project.
export const linkKey = (link: Pick<Dependency, 'source' | 'target' | 'field'>) => `${link.source}|${link.target}|${link.field}`;

/** Applies the user's link reviews: confirmed links count as documented, rejected ones leave every view. */
export function applyLinkReviews(analysis: Analysis, reviews: Record<string, LinkVerdict>): {analysis: Analysis; rejected: Dependency[]} {
  if (!Object.keys(reviews).length) return {analysis, rejected: []};
  const rejected: Dependency[] = [];
  const dependencies: Dependency[] = [];
  for (const link of analysis.dependencies) {
    const verdict = reviews[linkKey(link)];
    if (verdict === 'rejected') { rejected.push(link); continue; }
    dependencies.push(verdict === 'confirmed' ? {...link, status: 'documented', review: 'confirmed', extraction: link.status === 'documented' ? link.extraction : 'Confirmed by you'} : link);
  }
  return {analysis: {...analysis, dependencies}, rejected};
}
