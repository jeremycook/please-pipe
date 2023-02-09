export type ListenerToken = number;

type PipeArrayOrNever<T, TItem> = T extends Array<TItem> ? PipeArray<TItem> : never;

export abstract class Pipe<T> implements Pipe<T> {
    private _listenerIndex = 0;
    private _listeners: ((source: Pipe<T>) => void)[] = [];

    /** Returns this pipe's value. */
    abstract get value(): T;

    /** Notify listeners of. */
    protected notify(): void {
        for (const listener of this._listeners) {
            (listener as (source: Pipe<T>) => void)(this);
        }
    }

    /** Subscribes listener to notifications from this object. */
    subscribe(listener: (source: Pipe<T>) => void): ListenerToken {
        if (this._listeners.includes(listener)) {
            throw { message: 'The {listener} has already subscribed. Was this intentional?', listener };
        }

        const token = this._listenerIndex++;
        this._listeners[token] = listener;
        return token;
    }

    /** Unsubscribes a notification listener. */
    unsubscribe(listenerToken: ListenerToken): void {
        delete this._listeners[listenerToken];
    }

    /** Unsubscribes all notification listeners, and makes this object unusable. */
    dispose(): void {
        for (let i = 0; i < this._listenerIndex; i++) {
            this.unsubscribe(i);
        }
        this._listeners = undefined!;
    }

    monitor(...monitoredPipes: ((value: T) => Pipe<any>)[]): Pipe<T> {
        return new PipeMonitor<T>(this, ...monitoredPipes);
    }

    combineWith<T1>(t1: Pipe<T1>): Pipe<[Pipe<T>, Pipe<T1>]>;
    combineWith<T1, T2>(t1: Pipe<T1>, t2: Pipe<T2>): Pipe<[Pipe<T>, Pipe<T1>, Pipe<T2>]>;
    combineWith<T1, T2, T3>(t1: Pipe<T1>, t2: Pipe<T2>, t3: Pipe<T3>): Pipe<[Pipe<T>, Pipe<T1>, Pipe<T2>, Pipe<T3>]>;
    combineWith(...rest: Pipe<any>[]): any {
        return new PipeCombiner(this as Pipe<T>, ...rest);
    }

    project<TOut>(projection: (value: T) => TOut): Pipe<TOut> {
        return new PipeProjection<T, TOut>(this, projection);
    }

    // PipeArray members

    asArray<TItem>(this: PipeArrayOrNever<T, TItem>): PipeArray<TItem> {
        if (!Array.isArray(this.value)) {
            throw 'The value must be an array.';
        }
        return this;
    }

    group<TItem, TKey>(this: PipeArrayOrNever<T, TItem>, expression: (value: TItem) => Pipe<TKey>): PipeArrayGroup<TItem, TKey> {
        if (!Array.isArray(this.value)) {
            throw 'The value must be an array.';
        }
        return new PipeArrayGroup(this, expression);
    }

    map<TItemIn, TItemOut>(this: PipeArrayOrNever<T, TItemIn>, projection: (value: TItemIn) => TItemOut): PipeArray<TItemOut> {
        if (!Array.isArray(this.value)) {
            throw 'The value must be an array.';
        }
        return new PipeArrayMap(this, projection) as PipeArray<TItemOut>;
    }

    filter<TItem>(this: PipeArrayOrNever<T, TItem>, predicate: (value: TItem) => Pipe<boolean>): PipeArray<TItem> {
        if (!Array.isArray(this.value)) {
            throw 'The value must be an array.';
        }
        return new PipeArrayFilter(this, predicate) as PipeArray<TItem>;
    }

    [Symbol.iterator]<TItem>(this: PipeArrayOrNever<T, TItem>): IterableIterator<TItem> {
        if (!Array.isArray(this.value)) {
            throw 'The value must be an array.';
        }
        return this.value[Symbol.iterator]();
    }
}

export class State<T> extends Pipe<T> {
    private _oldValue: T;
    private _value: T;

    constructor(value: T) {
        super();
        this._oldValue = value;
        this._value = value;
    }

    get oldValue() {
        return this._oldValue;
    }

    get value() {
        return this._value;
    }
    set value(value: T) {
        if (this._value !== value) {
            this._oldValue = this._value;
            this._value = value;
            this.notify();
        }
    }
}

export interface PipeArray<TItem> extends Pipe<TItem[]> {
}

export class PipeArrayFilter<TItem> extends Pipe<TItem[]> implements PipeArray<TItem> {
    private _cached: boolean = false;
    private _cache?: TItem[] = undefined;
    private _parent: Pipe<TItem[]>;
    private _predicate: (value: TItem) => Pipe<boolean>;
    private _unsubscribeParent: () => void;
    private _unsubscribeChildren: { item: TItem, unsubscribe: (() => void) }[];

    constructor(
        parent: PipeArray<TItem>,
        predicate: (value: TItem) => Pipe<boolean>
    ) {
        super();
        this._parent = parent;
        this._predicate = predicate;

        const parentToken = this._parent.subscribe(_ => {
            // If the parent changed then items may have been added or removed
            // so we need to update our subscriptions.

            // Determine added and removed items.
            const removedSubs = this._unsubscribeChildren
                .filter(sub => !this._parent.value.some(item => item === sub.item));
            removedSubs.forEach(sub => {
                sub.unsubscribe();
                const i = this._unsubscribeChildren.indexOf(sub);
                this._unsubscribeChildren.splice(i, 1);
            });

            const addedItems = this._parent.value
                .filter(item => !this._unsubscribeChildren.some(sub => sub.item === item));
            const addedSubs = addedItems.map(item => {
                const pipe = this._predicate(item);
                const itemToken = pipe.subscribe(_ => this.notify());
                return { item, unsubscribe: pipe.unsubscribe.bind(pipe, itemToken) };
            });
            this._unsubscribeChildren = [...this._unsubscribeChildren, ...addedSubs];

            this.notify();
        });
        this._unsubscribeParent = () => this._parent.unsubscribe(parentToken);

        this._unsubscribeChildren = this._parent.value.map(item => {
            const pipe = this._predicate(item);
            const itemToken = pipe.subscribe(_ => this.notify());
            return { item, unsubscribe: pipe.unsubscribe.bind(pipe, itemToken) };
        });
    }

    get value() {
        if (!this._cached) {
            this._cache = this._parent.value.filter(x => this._predicate(x).value)
            this._cached = true;
        }

        return this._cache!;
    }

    protected notify() {
        // Invalidate the cache before notifying
        this._cached = false;
        super.notify();
    }

    dispose(): void {
        super.dispose();
        this._unsubscribeParent();
        this._unsubscribeParent = undefined!;
        this._unsubscribeChildren.forEach(x => x.unsubscribe());
        this._unsubscribeChildren = undefined!;
        this._cache = undefined;
        this._parent = undefined!;
        this._predicate = undefined!;
    }
}

export class PipeArrayGroup<TItem, TKey> extends Pipe<[TKey, TItem[]][]> implements PipeArray<[TKey, TItem[]]> {
    private _cached: boolean = false;
    private _cache?: [TKey, TItem[]][];
    private _parent: Pipe<TItem[]>;
    private _expression: (value: TItem) => Pipe<TKey>;
    private _unsubscribeParent: () => void;
    private _unsubscribeChildren: { item: TItem, unsubscribe: (() => void) }[];

    constructor(
        parent: PipeArray<TItem>,
        expression: (value: TItem) => Pipe<TKey>
    ) {
        super();
        this._parent = parent;
        this._expression = expression;

        const parentToken = this._parent.subscribe(_ => {
            // If the parent changed then items may have been added or removed
            // so we need to update our subscriptions.

            // Determine added and removed items.
            const removedSubs = this._unsubscribeChildren
                .filter(sub => !this._parent.value.some(item => item === sub.item));
            removedSubs.forEach(sub => {
                sub.unsubscribe();
                const i = this._unsubscribeChildren.indexOf(sub);
                this._unsubscribeChildren.splice(i, 1);
            });

            const addedItems = this._parent.value
                .filter(item => !this._unsubscribeChildren.some(sub => sub.item === item));
            const addedSubs = addedItems.map(item => {
                const pipe = this._expression(item);
                const itemToken = pipe.subscribe(_ => this.notify());
                return { item, unsubscribe: pipe.unsubscribe.bind(pipe, itemToken) };
            });
            this._unsubscribeChildren = [...this._unsubscribeChildren, ...addedSubs];

            this.notify();
        });
        this._unsubscribeParent = () => this._parent.unsubscribe(parentToken);

        this._unsubscribeChildren = this._parent.value.map(item => {
            const pipe = this._expression(item);
            const itemToken = pipe.subscribe(_ => this.notify());
            return { item, unsubscribe: pipe.unsubscribe.bind(pipe, itemToken) };
        });
    }

    get value() {
        if (!this._cached) {
            const cache = [];
            for (const item of groupBy(this._parent.value, x => this._expression(x).value)) {
                cache.push(item);
            }
            this._cache = cache;
            this._cached = true;
        }
        return this._cache!;
    }

    protected notify() {
        // Invalidate the cache before notifying
        this._cached = false;
        super.notify();
    }

    dispose(): void {
        super.dispose();
        this._unsubscribeParent();
        this._unsubscribeParent = undefined!;
        this._unsubscribeChildren.forEach(x => x.unsubscribe());
        this._unsubscribeChildren = undefined!;
        this._cache = undefined;
        this._parent = undefined!;
        this._expression = undefined!;
    }
}

function groupBy<TItem, TKey>(
    array: TItem[],
    keyGetter: (item: TItem) => TKey): Map<TKey, TItem[]> {

    const map = new Map<TKey, TItem[]>();
    array.forEach((item) => {
        const key = keyGetter(item);
        const collection = map.get(key);
        if (!collection) map.set(key, [item]);
        else collection.push(item);
    });
    return map;
}

export class PipeArrayMap<TItemIn, TItemOut> extends Pipe<TItemOut[]> implements PipeArray<TItemOut> {
    private _cached: boolean = false;
    private _cache?: TItemOut[] = undefined;
    private _parent: Pipe<TItemIn[]>;
    private _projection: (value: TItemIn) => TItemOut;
    private _unsubscribeParent: () => void;

    constructor(
        parent: Pipe<TItemIn[]>,
        projection: (item: TItemIn) => TItemOut
    ) {
        super();
        this._parent = parent;
        this._projection = projection;

        const parentToken = this._parent.subscribe(_ => this.notify());
        this._unsubscribeParent = this._parent.unsubscribe.bind(this._parent, parentToken);
    }

    get value() {
        if (!this._cached) {
            this._cache = this._parent.value.map(this._projection);
            this._cached = true;
        }
        return this._cache!;
    }

    protected notify() {
        // Invalidate cache before notifying
        this._cached = false;
        super.notify();
    }

    dispose(): void {
        super.dispose();
        this._unsubscribeParent();
        this._unsubscribeParent = undefined!;
        this._cache = undefined;
        this._parent = undefined!;
        this._projection = undefined!;
    }
}

export class PipeProjection<TIn, TOut> extends Pipe<TOut> implements Pipe<TOut> {
    private _cached: boolean = false;
    private _cache?: TOut;
    private _parent: Pipe<TIn>;
    private _projection: (value: TIn) => TOut;
    private _unsubscribeParent: () => void;

    constructor(
        parent: Pipe<TIn>,
        projection: (value: TIn) => TOut
    ) {
        super();
        this._parent = parent;
        this._projection = projection;

        const parentToken = this._parent.subscribe(_ => this.notify());
        this._unsubscribeParent = this._parent.unsubscribe.bind(this._parent, parentToken);
    }

    get value(): TOut {
        if (!this._cached) {
            this._cache = this._projection(this._parent.value);
            this._cached = true;
        }

        return this._cache!;
    }

    protected notify() {
        // Invalidate cache before notifying
        this._cached = false;
        super.notify();
    }

    dispose(): void {
        super.dispose();
        this._unsubscribeParent();
        this._unsubscribeParent = undefined!;
        this._cache = undefined;
        this._parent = undefined!;
        this._projection = undefined!;
    }
}

export class PipeCombiner extends Pipe<Pipe<any>[]> implements Pipe<Pipe<any>[]> {
    private _unsubscribePipes: (() => void)[];
    private _pipes: Pipe<any>[];

    constructor(
        ...pipes: Pipe<any>[]
    ) {
        super();
        this._pipes = pipes;

        this._unsubscribePipes = this._pipes.map(pipe => {
            const token = pipe.subscribe(_ => this.notify());
            return pipe.unsubscribe.bind(pipe, token);
        });
    }

    get value(): any[] {
        return this._pipes;
    }

    dispose(): void {
        super.dispose();
        this._unsubscribePipes.forEach(x => x());
        this._unsubscribePipes = undefined!;
    }
}

export class PipeMonitor<T> extends Pipe<T> implements Pipe<T> {
    private _parent: Pipe<T>;
    private _pipeExpressions: ((value: T) => Pipe<any>)[];
    private _unsubscribeParent: () => void;
    private _unsubscribeChildren: (() => void)[];

    constructor(
        parent: Pipe<T>,
        ...monitoredPipes: ((value: T) => Pipe<any>)[]
    ) {
        super();
        this._parent = parent;
        this._pipeExpressions = monitoredPipes;

        const parentToken = this._parent.subscribe(_ => this.notify());
        this._unsubscribeParent = this._parent.unsubscribe.bind(this._parent, parentToken);
        this._unsubscribeChildren = this._pipeExpressions.map(pipeSelector => {
            const monitoredPipe = pipeSelector(this._parent.value);
            const token = monitoredPipe.subscribe(_ => this.notify());
            return monitoredPipe.unsubscribe.bind(monitoredPipe, token);
        });
    }

    get value() {
        return this._parent.value;
    }

    dispose(): void {
        super.dispose();
        this._unsubscribeParent();
        this._unsubscribeParent = undefined!;
        this._unsubscribeChildren.forEach(x => x());
        this._unsubscribeChildren = undefined!;
    }
}
