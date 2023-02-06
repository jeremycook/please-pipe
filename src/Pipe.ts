export type UnsubscribeToken = number;

type PipeArrayOrNever<T, TItem> = T extends Array<TItem> ? PipeArray<TItem> : never;

export abstract class Pipe<T> implements Pipe<T> {
    private _index = 0;
    private _listeners: ((source: Pipe<T>) => void)[] = [];

    abstract get value(): T;

    protected notify(): void {
        for (const listener of this._listeners) {
            (listener as (source: Pipe<T>) => void)(this);
        }
    }

    subscribe(listener: (source: Pipe<T>) => void): UnsubscribeToken {
        if (this._listeners.includes(listener)) {
            throw { message: 'The {listener} has already subscribed. Was this intentional?', listener };
        }

        const token = this._index++;
        this._listeners[token] = listener;
        return token;
    }

    unsubscribe(token: UnsubscribeToken): void {
        delete this._listeners[token];
    }

    dispose(): void {
        for (let i = 0; i < this._index; i++) {
            this.unsubscribe(i);
        }
        this._listeners = undefined!;
    }

    monitor(...monitoredPipes: ((value: T) => Pipe<any>)[]): Pipe<T> {
        return new PipeMonitor<T>(this, ...monitoredPipes);
    }

    combineWith<T1>(t1: Pipe<T1>): Pipe<[Pipe<T>, Pipe<T1>, ...Pipe<any>[]]>;
    combineWith<T1, T2>(t1: Pipe<T1>, t2: Pipe<T2>): Pipe<[Pipe<T>, Pipe<T1>, Pipe<T2>]>;
    combineWith<T1, T2, T3>(t1: Pipe<T1>, t2: Pipe<T2>, t3: Pipe<T3>, ...rest: Pipe<any>[]): Pipe<[Pipe<T>, Pipe<T1>, Pipe<T2>, Pipe<T3>]>;
    combineWith(...rest: Pipe<any>[]): any {
        return new PipeCombiner(this as Pipe<T>, ...rest);
    }

    project<TEnd>(projection: (value: T) => TEnd): Pipe<TEnd> {
        return new PipeProjection<T, TEnd>(this, projection);
    }

    // PipeArray members

    asArray<TItem>(this: PipeArrayOrNever<T, TItem>): PipeArray<TItem> {
        if (!Array.isArray(this.value)) {
            throw 'The value must be an array.';
        }
        return this;
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
    private _subscriptions: { [token: UnsubscribeToken]: { unsubscribeParent: () => void, unsubscribeChildren: (() => void)[] } } = {};
    private _parent: Pipe<TItem[]>;
    private _predicate: (value: TItem) => Pipe<boolean>;

    constructor(
        parent: PipeArray<TItem>,
        predicate: (value: TItem) => Pipe<boolean>
    ) {
        super();
        this._parent = parent;
        this._predicate = predicate;
    }

    get value() {
        if (!this._cached) {
            this._cache = this._parent.value.filter(x => this._predicate(x).value === true)
            this._cached = true;
        }

        return this._cache!;
    }

    protected notify() {
        // Reset cache before notifying
        this._cached = false;
        super.notify();
    }

    subscribe(listener: (source: Pipe<TItem[]>) => void): UnsubscribeToken {
        const thisToken = super.subscribe(listener);

        const parentToken = this._parent.subscribe(_ => {
            // Refresh subscriptions: If the parent changes its
            // items may have been added or removed so we need
            // to update our predicate subscriptions.
            const subscription = this._subscriptions[thisToken];
            subscription.unsubscribeChildren.forEach(x => x());
            subscription.unsubscribeChildren = this._parent.value.map(item => {
                const pipe = this._predicate(item);
                const subToken = pipe.subscribe(_ => this.notify());
                return pipe.unsubscribe.bind(pipe, subToken);
            });

            this.notify();
        });

        this._subscriptions[thisToken] = {
            unsubscribeParent: () => this._parent.unsubscribe(parentToken),
            unsubscribeChildren: this._parent.value.map(item => {
                const pipe = this._predicate(item);
                const subToken = pipe.subscribe(_ => this.notify());
                return pipe.unsubscribe.bind(pipe, subToken);
            }),
        };

        return thisToken;
    }

    unsubscribe(token: UnsubscribeToken) {
        const sub = this._subscriptions[token];
        sub.unsubscribeChildren.forEach(x => x());
        sub.unsubscribeParent();
        super.unsubscribe(token);
    }
}

export class PipeArrayMap<TItemIn, TItemOut> extends Pipe<TItemOut[]> implements PipeArray<TItemOut> {
    private _cached: boolean = false;
    private _cache?: TItemOut[] = undefined;
    private _subscriptions: { [token: UnsubscribeToken]: { unsubscribeParent: () => void } } = {};
    private _parent: Pipe<TItemIn[]>;
    private _projection: (value: TItemIn) => TItemOut;

    constructor(
        parent: Pipe<TItemIn[]>,
        projection: (item: TItemIn) => TItemOut
    ) {
        super();
        this._parent = parent;
        this._projection = projection;
    }

    get value() {
        if (!this._cached) {
            this._cache = this._parent.value.map(this._projection);
            this._cached = true;
        }
        return this._cache!;
    }

    protected notify() {
        // Reset cache before notifying
        this._cached = false;
        super.notify();
    }

    subscribe(listener: (source: Pipe<TItemOut[]>) => void): UnsubscribeToken {
        const thisToken = super.subscribe(listener);

        const parentToken = this._parent.subscribe(_ => this.notify());
        this._subscriptions[thisToken] = {
            unsubscribeParent: this._parent.unsubscribe.bind(this._parent, parentToken),
        };

        return thisToken;
    }

    unsubscribe(token: UnsubscribeToken) {
        const sub = this._subscriptions[token];
        sub.unsubscribeParent();
        super.unsubscribe(token);
    }
}

export class PipeProjection<TIn, TOut> extends Pipe<TOut> implements Pipe<TOut> {
    private _cached: boolean = false;
    private _cache?: TOut;
    private _subscriptions: { [token: UnsubscribeToken]: { unsubscribeParent: () => void } } = {};
    private _parent: Pipe<TIn>;
    private _projection: (value: TIn) => TOut;

    constructor(
        parent: Pipe<TIn>,
        projection: (value: TIn) => TOut
    ) {
        super();
        this._parent = parent;
        this._projection = projection;
    }

    get value(): TOut {
        if (!this._cached) {
            this._cache = this._projection(this._parent.value);
            this._cached = true;
        }

        return this._cache!;
    }

    protected notify() {
        // Reset cache before notifying
        this._cached = false;
        super.notify();
    }

    subscribe(subscription: (source: Pipe<TOut>) => void) {
        const thisToken = super.subscribe(subscription);
        const parentToken = this._parent.subscribe(_ => this.notify());

        this._subscriptions[thisToken] = {
            unsubscribeParent: this._parent.unsubscribe.bind(this._parent, parentToken),
        };

        return thisToken;
    }

    unsubscribe(token: UnsubscribeToken) {
        const sub = this._subscriptions[token];
        sub.unsubscribeParent();
        super.unsubscribe(token);
    }
}

export class PipeCombiner extends Pipe<Pipe<any>[]> implements Pipe<Pipe<any>[]> {
    private _subscriptions: { [token: UnsubscribeToken]: { unsubscribePipes: (() => void)[] } } = {};
    private _pipes: Pipe<any>[];

    constructor(
        ...pipes: Pipe<any>[]
    ) {
        super();
        this._pipes = pipes;
    }

    get value(): any[] {
        return this._pipes;
    }

    subscribe(listener: (source: Pipe<Pipe<unknown>[]>) => void) {
        const thisToken = super.subscribe(listener);

        this._subscriptions[thisToken] = {
            unsubscribePipes: this._pipes.map(pipe => {
                const token = pipe.subscribe(_ => this.notify());
                return pipe.unsubscribe.bind(pipe, token);
            }),
        };

        return thisToken;
    }

    unsubscribe(token: UnsubscribeToken) {
        const sub = this._subscriptions[token];
        sub.unsubscribePipes.forEach(x => x());
        super.unsubscribe(token);
    }
}

export class PipeMonitor<T> extends Pipe<T> implements Pipe<T> {
    private _subscriptions: { [token: UnsubscribeToken]: { unsubscribeParent: () => void, unsubscribeChildren: (() => void)[] }; } = {};
    private _parent: Pipe<T>;
    private _monitoredPipes: ((value: T) => Pipe<any>)[];

    constructor(
        parent: Pipe<T>,
        ...monitoredPipes: ((value: T) => Pipe<any>)[]
    ) {
        super();
        this._parent = parent;
        this._monitoredPipes = monitoredPipes;
    }

    get value() {
        return this._parent.value;
    }

    subscribe(listener: (source: Pipe<T>) => void): UnsubscribeToken {
        const token = super.subscribe(listener);

        const parentToken = this._parent.subscribe(_ => this.notify());

        this._subscriptions[token] = {
            unsubscribeParent: this._parent.unsubscribe.bind(this._parent, parentToken),
            unsubscribeChildren: this._monitoredPipes.map(pipeSelector => {
                const monitoredPipe = pipeSelector(this._parent.value);
                const token = monitoredPipe.subscribe(_ => this.notify());
                return monitoredPipe.unsubscribe.bind(monitoredPipe, token);
            }),
        };

        return token;
    }

    unsubscribe(token: UnsubscribeToken) {
        const sub = this._subscriptions[token];
        sub.unsubscribeChildren.forEach(x => x());
        sub.unsubscribeParent();
        super.unsubscribe(token);
    }
}
