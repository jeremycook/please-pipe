import { Pipe, PipeConstructor } from '../../../src/Pipe';

type Elemental = string | number | Node;

const appendPipe = function (parent: ParentNode, pipe: Pipe<string | number | Node>) {
    const start = document.createComment('');
    parent.append(start);

    const end = document.createComment('');
    start.after(end);

    const pipeValue = pipe.value;
    if (pipeValue instanceof PipeConstructor) {
        // First render
        const node = n(pipeValue.value);
        start.after(node);

        // Rerendering
        const map = pipe.map(n);
        map.subscribe(pn => {
            for (let next = start.nextSibling; next && next != end; next = start.nextSibling) {
                next.dispatchEvent(new CustomEvent('dispose', { detail: { currentTarget: next! } }));
                next.remove();
            }
            start.after(pn.value);
        });
        // Clean up will parent is removed
        parent.addEventListener('dispose', _ => map.dispose());
    }
    else {
        // First render
        const node = n(pipeValue);
        start.after(node);

        // Rerendering
        const map = pipe.map(n);
        map.subscribe(pn => {
            for (let next = start.nextSibling; next && next != end; next = start.nextSibling) {
                next.dispatchEvent(new CustomEvent('dispose', { detail: { currentTarget: next! } }));
                next.remove();
            }
            start.after(pn.value);
        });
        // Clean up will parent is removed
        parent.addEventListener('dispose', _ => map.dispose());
    }

    return start;
}

export function appendNode(parent: ParentNode, child: Promise<Elemental> | Pipe<Elemental> | (() => (Elemental | Promise<Elemental>)) | Elemental) {
    if (child instanceof Promise) {
        const placeholder = document.createComment('');
        parent.append(placeholder);
        child.then(promiseResult => placeholder.replaceWith(n(promiseResult)));
    }
    else if (child instanceof PipeConstructor) {
        appendPipe(parent, child);
    }
    else if (typeof child === 'function') {
        const result = child();
        appendNode(parent, result);
    }
    else {
        const node = n(child as Elemental);
        parent.append(node);
    }
}

export function h<TagName extends keyof HTMLElementTagNameMap>(
    tagName: TagName,
    ...children: (string | number | Node | Pipe<Elemental> | Promise<Elemental> | (() => (Elemental | Promise<Elemental>)))[]): HTMLElementTagNameMap[TagName] {
    const parent = document.createElement(tagName);

    for (const child of children) {
        appendNode(parent, child);
    }

    return parent;
}

export function n(value: string | number | Node) {
    if (value instanceof Node) {
        return value;
    }
    else switch (typeof value) {
        case 'string':
            return document.createTextNode(value);
        case 'number':
            return document.createTextNode(value.toString());
        default:
            throw { message: 'Converting {value} into a Node is not supported.', value, typeof: typeof value };
    }
}
