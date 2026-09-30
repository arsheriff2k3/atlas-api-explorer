/** Encodes an object as application/x-www-form-urlencoded with bracket keys (a[b]=1, a[b][0]=1). */
export function formEncode(value, arrayStyle = 'suffix') {
  const pairs = [];
  const walk = (node, key) => {
    if (node === undefined) return;
    if (Array.isArray(node)) {
      node.forEach((item, index) => {
        if (item && typeof item === 'object' && !Array.isArray(item) && arrayStyle === 'suffix') for (const [child, childValue] of Object.entries(item)) walk(childValue, `${key}[${child}][${index}]`);
        else walk(item, `${key}[${index}]`);
      });
      return;
    }
    if (node && typeof node === 'object') { for (const [child, childValue] of Object.entries(node)) walk(childValue, key ? `${key}[${child}]` : child); return; }
    pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(node === null ? '' : String(node))}`);
  };
  walk(value, '');
  return pairs.join('&');
}
