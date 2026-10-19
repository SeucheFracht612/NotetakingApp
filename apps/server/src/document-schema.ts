import { LibraryError } from './library.js';

/** A bounded, semantic ProseMirror/Tiptap subset. No HTML or arbitrary attrs. */
export interface RichDoc { type: 'doc'; content: unknown[] }
export const EMPTY_DOCUMENT: RichDoc = { type: 'doc', content: [{ type: 'paragraph' }] };
const MAX_BYTES = 100_000;
const MAX_NODES = 2000;
const MAX_DEPTH = 16;
const MAX_TEXT = 80_000;
const markTypes = new Set(['bold', 'italic', 'underline', 'strike', 'code']);
const blockTypes = new Set([
  'paragraph','heading','bulletList','orderedList','listItem','blockquote','codeBlock','horizontalRule'
]);
type JsonObject = Record<string, unknown>;

function invalid(message: string): never {
  throw new LibraryError(400, 'Invalid document: ' + message);
}
function shape(value: unknown, keys: string[], required: string[]): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return invalid('expected an object');
  const obj = value as JsonObject;
  if (Object.keys(obj).some(key => !keys.includes(key)) || required.some(key => !(key in obj))) {
    return invalid('unexpected or missing fields');
  }
  return obj;
}
function validateMarks(input: unknown): void {
  if (!Array.isArray(input) || input.length > 5) return invalid('invalid text marks');
  const seen = new Set<string>();
  for (const item of input) {
    const mark = shape(item, ['type'], ['type']);
    if (typeof mark.type !== 'string' || !markTypes.has(mark.type) || seen.has(mark.type)) {
      return invalid('unsupported or repeated mark');
    }
    seen.add(mark.type);
  }
}

/** Validate before serialization; do not trust client-provided ProseMirror JSON. */
export function validateDocument(input: unknown): RichDoc {
  const encoded = JSON.stringify(input);
  if (encoded === undefined || Buffer.byteLength(encoded, 'utf8') > MAX_BYTES) {
    return invalid('document exceeds 100 KB or cannot be serialized');
  }
  const root = shape(input, ['type','content'], ['type','content']);
  if (root.type !== 'doc' || !Array.isArray(root.content)) return invalid('expected a document');
  let nodeCount = 0;
  let textLength = 0;
  function check(nodeInput: unknown, parent: string, depth: number): void {
    if (++nodeCount > MAX_NODES || depth > MAX_DEPTH) return invalid('document is too complex');
    const node = shape(nodeInput, ['type','attrs','content','text','marks'], ['type']);
    const type = node.type;
    if (typeof type !== 'string') return invalid('missing node type');
    if (type === 'text') {
      if (!['paragraph','heading','codeBlock'].includes(parent)) return invalid('text is not allowed here');
      if (typeof node.text !== 'string' || !node.text.length || node.content !== undefined ||
          node.attrs !== undefined || node.text.includes('\u0000')) return invalid('invalid text');
      textLength += node.text.length;
      if (textLength > MAX_TEXT) return invalid('text exceeds 80,000 characters');
      if (node.marks !== undefined) {
        if (parent === 'codeBlock') return invalid('code blocks cannot contain text marks');
        validateMarks(node.marks);
      }
      return;
    }
    if (type === 'hardBreak') {
      if (!['paragraph','heading'].includes(parent) || node.attrs !== undefined ||
          node.content !== undefined || node.text !== undefined || node.marks !== undefined) {
        return invalid('invalid hard break');
      }
      return;
    }
    if (!blockTypes.has(type) || node.text !== undefined || node.marks !== undefined) {
      return invalid('unsupported node');
    }
    const attrs = node.attrs === undefined ? undefined : shape(node.attrs,
      type === 'heading' ? ['level'] : type === 'orderedList' ? ['start'] : [], []);
    if (type === 'heading') {
      if (attrs?.level !== 1 && attrs?.level !== 2 && attrs?.level !== 3) {
        return invalid('heading level must be 1, 2 or 3');
      }
    } else if (type === 'orderedList') {
      if (attrs?.start !== undefined &&
          (!Number.isSafeInteger(attrs.start) || (attrs.start as number) < 1 || (attrs.start as number) > 1000000)) {
        return invalid('invalid list start');
      }
    } else if (attrs !== undefined && Object.keys(attrs).length) {
      return invalid('unsupported attributes');
    }

    const isInline = type === 'paragraph' || type === 'heading' || type === 'codeBlock';
    const isList = type === 'orderedList' || type === 'bulletList';
    const canBeRoot = ['paragraph','heading','orderedList','bulletList','blockquote','codeBlock','horizontalRule'].includes(type);
    if (parent === 'doc' || parent === 'blockquote') {
      if (!canBeRoot) return invalid('invalid block placement');
    } else if (parent === 'bulletList' || parent === 'orderedList') {
      if (type !== 'listItem') return invalid('lists require list items');
    } else if (parent === 'listItem') {
      if (!['paragraph','bulletList','orderedList'].includes(type)) return invalid('invalid list item');
    } else {
      return invalid('invalid nesting');
    }
    if (type === 'horizontalRule') {
      if (node.content !== undefined) return invalid('rule cannot contain children');
      return;
    }
    if (node.content !== undefined && !Array.isArray(node.content)) return invalid('invalid content array');
    const children = (node.content ?? []) as unknown[];
    if (children.length > MAX_NODES) return invalid('too many children');
    if (isList && children.length === 0) return invalid('empty list');
    if (type === 'listItem' && children.length === 0) return invalid('empty list item');
    if (type === 'listItem') {
      const first = shape(children[0], ['type','content','attrs','marks','text'], ['type']);
      if (first.type !== 'paragraph') return invalid('list item must start with a paragraph');
    }
    for (const child of children) {
      if (isInline) {
        const inline = shape(child, ['type','attrs','content','text','marks'], ['type']);
        if (inline.type !== 'text' && (inline.type !== 'hardBreak' || type === 'codeBlock')) {
          return invalid('invalid inline node');
        }
      }
      check(child, type, depth + 1);
    }
  }
  for (const node of root.content) check(node, 'doc', 1);
  return input as RichDoc;
}
