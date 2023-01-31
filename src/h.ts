import { Pipe, PipeBase } from "./Pipe";

type Elemental = string | number | Node;
const appendElementalPipe = function (parent: ParentNode, elementalPipe: Pipe<Elemental>) {
    const start = document.createComment('');
    parent.append(start);

    const end = document.createComment('');
    start.after(end);

    const elementalValue = elementalPipe.value;
    if (elementalValue instanceof PipeBase) {
        // First render
        const node = n(elementalValue.value);
        start.after(node);

        // Rerendering
        const map = elementalPipe.map(n);
        map.subscribe(pn => {
            for (let next = start.nextSibling; next && next != end; next = start.nextSibling) {
                next.dispatchEvent(new CustomEvent('removing', { detail: { currentTarget: next! } }));
                next.remove();
            }
            start.after(pn.value);
        });
        // Clean up will parent is removed
        parent.addEventListener('removing', _ => map.dispose());
    }
    else {
        // First render
        const node = n(elementalValue);
        start.after(node);

        // Rerendering
        const map = elementalPipe.map(n);
        map.subscribe(pn => {
            for (let next = start.nextSibling; next && next != end; next = start.nextSibling) {
                next.dispatchEvent(new CustomEvent('removing', { detail: { currentTarget: next! } }));
                next.remove();
            }
            start.after(pn.value);
        });
        // Clean up will parent is removed
        parent.addEventListener('removing', _ => map.dispose());
    }

    return start;
};
export function appendNode(parent: ParentNode, value: Promise<Elemental> | PipeBase<Elemental> | (() => (Elemental | Promise<Elemental>)) | Elemental) {
    if (value instanceof Promise) {
        const placeholder = document.createComment('');
        parent.append(placeholder);
        value.then(promiseResult => placeholder.replaceWith(n(promiseResult)));
    }
    else if (value instanceof PipeBase) {
        appendElementalPipe(parent, value);
    }
    else if (typeof value === 'function') {
        const result = value();
        appendNode(parent, result);
    }
    else {
        const node = n(value);
        parent.append(node);
    }
}
export function h<TagName extends keyof HTMLElementTagNameMap>(
    tagName: TagName,
    ...children: (Elemental | Pipe<Elemental> | Promise<Elemental> | (() => (Elemental | Promise<Elemental>)))[]): HTMLElementTagNameMap[TagName] {
    const parent = document.createElement(tagName);

    for (const child of children) {
        appendNode(parent, child as PipeBase<Elemental>);
    }

    return parent;
}
export function n(value: Elemental) {
    if (value instanceof Node) {
        return value;
    }
    else
        switch (typeof value) {
            case 'string':
                return document.createTextNode(value);
            case 'number':
                return document.createTextNode(value.toString());
            default:
                throw { message: 'Converting {value} into a Node is not supported.', value, typeof: typeof value };
        }
}
