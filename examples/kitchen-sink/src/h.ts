import { Pipe, PipeConstructor } from '../../../src/Pipe';

export type BaseNode =
    | string
    | Node
    | Pipe<BaseNode>
    | Promise<BaseNode>
    | (() => BaseNode);

export type BuildableElement<T extends Element> =
    | ((builder: ElementBuilder<T>) => (ElementBuilder<T> | BaseNode));

export type HAttributeValue =
    | boolean
    | number
    | string
    | EventListenerOrEventListenerObject;

export type HAttributes =
    | { [k: string]: HAttributeValue };

let commentNumber = 1;

function appendPipe(parent: ParentNode, pipe: Pipe<BaseNode>) {
    const commentNum = commentNumber++;

    const begin = document.createComment('appendPipe-' + commentNum);
    parent.append(begin);

    const end = document.createComment('appendPipe-' + commentNum);
    begin.after(end);

    const pipeValue = pipe.value;
    if (pipeValue instanceof Promise) {
        // First rendering of a Pipe-Promise
        pipeValue.then(basicNode => {
            const result = f(basicNode);
            if (begin.nextSibling === end) begin.after(result);
        });
    }
    else if (pipeValue instanceof PipeConstructor) {
        // First rendering of a Pipe-Pipe
        const result = f(pipeValue);
        if (begin.nextSibling === end) begin.after(result);
    }
    else {
        // First render of a Pipe-BasicNode
        const result = f(pipeValue);
        begin.after(result);
    }

    // Rerendering
    const token = pipeRerenderer(pipe, begin, end);

    // Cleanup when parent is removed
    parent.addEventListener('dispose', _ => pipe.unsubscribe(token));

    return begin;
}

function pipeRerenderer(pipe: Pipe<BaseNode>, begin: Comment, end: Comment) {
    return pipe.subscribe(innerPipe => {
        const source = innerPipe.value;

        if (source instanceof Promise) {
            source.then((basicNode: BaseNode) => {
                const fragment = f(basicNode);
                for (let next = begin.nextSibling; next && next != end; next = begin.nextSibling) {
                    next.dispatchEvent(new CustomEvent('dispose', { detail: { currentTarget: next! } }));
                    next.remove();
                }
                begin.after(fragment);
            });
        }
        else if (source instanceof PipeConstructor) {
            // Rerendering
            const value = source.value as BaseNode;
            const fragment = f(value);
            for (let next = begin.nextSibling; next && next != end; next = begin.nextSibling) {
                next.dispatchEvent(new CustomEvent('dispose', { detail: { currentTarget: next! } }));
                next.remove();
            }
            begin.after(fragment);
        }
        else {
            const value = source as string | Node | (() => BaseNode);
            const fragment = f(value);
            for (let next = begin.nextSibling; next && next != end; next = begin.nextSibling) {
                next.dispatchEvent(new CustomEvent('dispose', { detail: { currentTarget: next! } }));
                next.remove();
            }
            begin.after(fragment);
        }
    });
}

export function appendNode(parent: ParentNode, child: BaseNode) {
    if (child instanceof Promise) {
        const placeholder = document.createComment('appendNode-placeholder');
        parent.append(placeholder);
        child.then(promiseResult => {
            const fragment = f(promiseResult);
            placeholder.replaceWith(fragment)
        });
    }
    else if (child instanceof PipeConstructor) {
        appendPipe(parent, child);
    }
    else switch (typeof child) {
        case 'function':
            const result = child();
            appendNode(parent, result);
            break;
        default:
            parent.append(child as string | Node);
            break;
    }
}

function setAttributes(element: Element, attributes: HAttributes) {
    const tagName = element.tagName;

    for (const [name, value] of Object.entries(attributes)) {

        switch (typeof value) {
            case 'string':
                element.setAttribute(name, value);
                break;

            case 'number':
                element.setAttribute(name, value.toString());
                break;

            case 'boolean':
                if (value)
                    element.setAttribute(name, '');
                else
                    element.removeAttribute(name);
                break;

            case 'function':
                if (name.startsWith('on')) {
                    element.addEventListener(
                        name.substring(2, 3).toLowerCase() + name.substring(3),
                        value);
                    break;
                }
                throw { message: 'Unsupported attribute type. Function attributes must start with "on".', tagName, name, value, typeof: typeof value };

            default:
                throw { message: 'Unsupported attribute type.', tagName, name, value, typeof: typeof value };
        }
    }
}

export class ElementBuilder<T extends Element> {
    constructor(
        public element: T) {
    }

    append(...children: (Node | Promise<Node>)[]) {
        for (const child of children.flat()) {
            appendNode(this.element, child);
        }
        return this;
    }

    set(attributes: HAttributes): this;
    set(name: string, value: HAttributeValue): this;
    set(nameOrAttributes: string | HAttributes, value?: HAttributeValue) {
        if (typeof nameOrAttributes === 'string') {
            if (typeof value !== 'undefined') {
                setAttributes(this.element, { [nameOrAttributes]: value });
            }
        }
        else {
            setAttributes(this.element, nameOrAttributes);
        }
        return this;
    }
}

export function h<TagName extends keyof HTMLElementTagNameMap>(
    tagName: TagName | string,
    ...children: (
        | BaseNode
        | BuildableElement<HTMLElementTagNameMap[TagName]>
    )[])
    : HTMLElementTagNameMap[TagName];

export function h(
    tagName: string,
    ...children: (
        | BaseNode
        | BuildableElement<Element>
    )[])
    : HTMLElement {

    let className: string[];
    [tagName, ...className] = tagName.split('.');
    if (!tagName) tagName = 'div';

    const parent = document.createElement(tagName);

    if (className) parent.className = className.join(' ');

    let editor;
    for (const child of children) {
        switch (typeof child) {
            case 'function':
                editor ??= new ElementBuilder(parent);
                const result = child(editor);
                if (!(result instanceof ElementBuilder)) {
                    appendNode(parent, result);
                }
                break;
            default:
                appendNode(parent, child);
                break;
        }
    }

    return parent;
}

/** Create a document node. */
export function n(value: string | Node) {
    if (value instanceof Node) {
        return value;
    }
    else switch (typeof value) {
        case 'string':
            return document.createTextNode(value);
        default:
            throw { message: 'Converting {value} into a Node is not supported.', value, typeof: typeof value };
    }
}

/** Create a document fragment. */
export function f(...children: BaseNode[]): DocumentFragment {
    const parent = document.createDocumentFragment();

    for (const child of children) {
        appendNode(parent, child);
    }

    return parent;
}

const svgNS = 'http://www.w3.org/2000/svg';

/** Create an SVG element. */
export function svg<TagName extends keyof SVGElementTagNameMap>(
    tagName: TagName,
    ...children: (SVGElement | Pipe<SVGElement> | Promise<SVGElement> | (() => (SVGElement | Promise<SVGElement>)))[]): SVGElementTagNameMap[TagName] {
    const parent = document.createElementNS(svgNS, tagName);

    for (const child of children) {
        appendNode(parent, child);
    }

    return parent;
}
