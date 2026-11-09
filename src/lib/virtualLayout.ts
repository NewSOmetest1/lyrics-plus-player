/**
 * Layout offset in the document, ignoring transforms and scrolling. Using
 * getBoundingClientRect here would drift whenever a page transition applies a
 * scale/translate to an ancestor.
 */
export function documentOffsetTop(element: HTMLElement): number {
  let top = 0;
  let node: HTMLElement | null = element;
  while (node) {
    top += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  return top;
}
