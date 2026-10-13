// Preserve native scrolling, pointer gestures and focused controls across snapshots.
function key(node: Node): string | null {
  if (!(node instanceof Element)) return null;
  if (node.id) return `id:${node.id}`;
  for (const attr of [
    "data-key",
    "data-static-key",
    "data-node",
    "data-scope",
    "data-tab",
    "data-action",
  ])
    if (node.hasAttribute(attr))
      return `${attr}:${node.getAttribute(attr)}:${node.getAttribute("data-id") ?? ""}`;
  return null;
}
function compatible(a: Node, b: Node): boolean {
  return (
    a.nodeType === b.nodeType &&
    a.nodeName === b.nodeName &&
    (!(a instanceof Element) ||
      !(b instanceof Element) ||
      a.namespaceURI === b.namespaceURI)
  );
}
function kind(node: Node): string {
  return `${node.nodeType}:${node.nodeName}:${node instanceof Element ? node.namespaceURI : ""}`;
}
function patch(current: Node, next: Node): void {
  const staticMatch =
    current instanceof Element &&
    next instanceof Element &&
    current.hasAttribute("data-static-key") &&
    current.getAttribute("data-static-key") ===
      next.getAttribute("data-static-key");
  if (current.isEqualNode(next)) return;
  if (!(current instanceof Element) || !(next instanceof Element)) {
    current.nodeValue = next.nodeValue;
    return;
  }
  for (const attr of Array.from(current.attributes))
    if (!next.hasAttribute(attr.name)) current.removeAttribute(attr.name);
  for (const attr of Array.from(next.attributes))
    if (current.getAttribute(attr.name) !== attr.value)
      current.setAttribute(attr.name, attr.value);
  // Matching keys are emitted only for immutable charts already in this DOM.
  if (!staticMatch) reconcile(current, next);
  if (current instanceof HTMLInputElement && next instanceof HTMLInputElement) {
    if (current.value !== next.value) current.value = next.value;
    if (current.checked !== next.checked) current.checked = next.checked;
  }
  if (
    current instanceof HTMLSelectElement &&
    next instanceof HTMLSelectElement &&
    current.value !== next.value
  )
    current.value = next.value;
}
function reconcile(parent: Node, next: Node): void {
  const unused = new Set(Array.from(parent.childNodes));
  const keyed = new Map<string, ChildNode>();
  const unkeyed = new Map<string, { nodes: ChildNode[]; index: number }>();
  for (const node of unused) {
    const id = key(node);
    if (id !== null) keyed.set(id, node);
    else {
      const type = kind(node);
      let queue = unkeyed.get(type);
      if (!queue) unkeyed.set(type, (queue = { nodes: [], index: 0 }));
      queue.nodes.push(node);
    }
  }
  let cursor = parent.firstChild;
  for (const desired of Array.from(next.childNodes)) {
    const id = key(desired);
    const queue = id ? undefined : unkeyed.get(kind(desired));
    let current = id ? keyed.get(id) : queue?.nodes[queue.index++];
    if (current && (!unused.has(current) || !compatible(current, desired)))
      current = undefined;
    if (current) {
      unused.delete(current);
      patch(current, desired);
    } else current = desired.cloneNode(true) as ChildNode;
    if (current !== cursor) parent.insertBefore(current, cursor);
    cursor = current.nextSibling;
  }
  for (const stale of unused) parent.removeChild(stale);
}
export function updateMarkup(root: Element, markup: string): void {
  const template = document.createElement("template");
  template.innerHTML = markup;
  reconcile(root, template.content);
}
