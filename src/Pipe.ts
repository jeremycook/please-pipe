
type PipeListener<T> = (origin: Pipe<T>) => void;

export interface Pipe<T> {
    /** Returns the pipe's current value. */
    get value(): T;

    /** Subscribe to this pipe. Returns an unsubscribe token. */
    subscribe(listener: PipeListener<T>): SubscriptionToken;

    /** Unsubscribe with a token a call to subscribe returned. */
    unsubscribe(token: SubscriptionToken): void;

    /** Unsubscribes listeners. Do not use a disposed object. The behavior of a disposed object is undefined. */
    dispose(): void;

    combineWith<T1>(t1: Pipe<T1>): Pipe<[Pipe<T>, Pipe<T1>]>;
    combineWith<T1, T2>(t1: Pipe<T1>, t2: Pipe<T2>): Pipe<[Pipe<T>, Pipe<T1>, Pipe<T2>]>;
    combineWith<T1, T2, T3>(t1: Pipe<T1>, t2: Pipe<T2>, t3: Pipe<T3>): Pipe<[Pipe<T>, Pipe<T1>, Pipe<T2>, Pipe<T3>]>;

    project<TEnd>(projection: (value: T) => TEnd): Pipe<TEnd>;
}

interface PipeBase<T> extends Pipe<T> {
}

export type SubscriptionToken = number;

abstract class PipeBase<T> implements Pipe<T> {
    private _index = 0;
    private _listeners: ((source: Pipe<T>) => void)[] = [];

    constructor() {
    }

    abstract get value(): T;

    protected notify() {
        for (const listener of Object.values(this._listeners)) {
            (listener as (source: Pipe<T>) => void)(this);
        }
    }

    subscribe(listener: (source: Pipe<T>) => void): SubscriptionToken {
        const token = this._index++;
        this._listeners[token] = listener;
        return token;
    }

    unsubscribe(token: SubscriptionToken) {
        delete this._listeners[token];
    }

    dispose() {
        for (let i = 0; i < this._index; i++) {
            this.unsubscribe(i);
        }
        this._listeners = undefined!;
    }

    observe(...captures: ((value: T) => Pipe<any>)[]): Pipe<T> {
        return new ObservingPipe<T>(this, ...captures);
    }

    combineWith<T1>(t1: Pipe<T1>): Pipe<[Pipe<T>, Pipe<T1>]>;
    combineWith<T1, T2>(t1: Pipe<T1>, t2: Pipe<T2>): Pipe<[Pipe<T>, Pipe<T1>, Pipe<T2>]>;
    combineWith<T1, T2, T3>(t1: Pipe<T1>, t2: Pipe<T2>, t3: Pipe<T3>): Pipe<[Pipe<T>, Pipe<T1>, Pipe<T2>, Pipe<T3>]>;
    combineWith(...rest: Pipe<any>[]): Pipe<[Pipe<T>, ...Pipe<any>[]]> {
        return new CombinedPipe(this, ...rest) as any;
    }

    project<TEnd>(projection: (value: T) => TEnd): Pipe<TEnd> {
        return new ProjectionPipe<T, TEnd>(this, projection);
    }
}

export const PipeConstructor = PipeBase;

export class State<T> extends PipeBase<T> implements Pipe<T> {
    private _oldValue: T;
    private _value: T;

    constructor(value: T) {
        super();
        this._oldValue = value;
        this._value = value;
    }

    combineWith<T1>(t1: Pipe<T1>): Pipe<[Pipe<T>, Pipe<T1>]>;
    combineWith<T1, T2>(t1: Pipe<T1>, t2: Pipe<T2>): Pipe<[Pipe<T>, Pipe<T1>, Pipe<T2>]>;
    combineWith<T1, T2, T3>(t1: Pipe<T1>, t2: Pipe<T2>, t3: Pipe<T3>): Pipe<[Pipe<T>, Pipe<T1>, Pipe<T2>, Pipe<T3>]>;
    combineWith(...rest: Pipe<any>[]): Pipe<[Pipe<T>, ...Pipe<any>[]]> {
        return new CombinedPipe(this, ...rest) as any;
    }

    project<TEnd>(projection: (value: T) => TEnd): Pipe<TEnd> {
        return new ProjectionPipe<T, TEnd>(this, projection);
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

export interface PipeCollection<TItem> extends Pipe<TItem[]> {
    filter(predicate: (value: TItem) => Pipe<boolean>): PipeCollection<TItem>;
    map<TItemProjection>(projection: (item: TItem) => TItemProjection): PipeCollection<TItemProjection>;
    [Symbol.iterator](): IterableIterator<TItem>;
}

export class StateCollection<TItem> extends State<TItem[]> implements PipeCollection<TItem> {
    constructor(value: TItem[] = []) {
        super(value);
    }

    filter(predicate: (value: TItem) => Pipe<boolean>): PipeCollection<TItem> {
        return new FilteredPipeCollection<TItem>(this, predicate);
    }

    map<TItemProjection>(projection: (item: TItem) => TItemProjection): PipeCollection<TItemProjection> {
        return new MappedPipeCollection<TItem, TItemProjection>(this, projection);
    }

    [Symbol.iterator](): IterableIterator<TItem> {
        return this.value[Symbol.iterator]();
    }
}

export class FilteredPipeCollection<TItem> extends PipeBase<TItem[]> implements PipeCollection<TItem> {
    private _cached: boolean = false;
    private _cache?: TItem[] = undefined;
    private _tokens: { [token: SubscriptionToken]: { parentToken: SubscriptionToken, unsubscribers: (() => void)[] } } = {};
    private _parent: Pipe<TItem[]>;
    private _predicate: (value: TItem) => Pipe<boolean>;

    constructor(
        parent: PipeCollection<TItem>,
        predicate: (value: TItem) => Pipe<boolean>
    ) {
        super();
        this._parent = parent;
        this._predicate = predicate;
    }

    map<TNewItem>(projection: (item: TItem) => TNewItem): PipeCollection<TNewItem> {
        return new MappedPipeCollection<TItem, TNewItem>(this, projection);
    }

    filter(predicate: (value: TItem) => Pipe<boolean>): PipeCollection<TItem> {
        return new FilteredPipeCollection<TItem>(this, predicate);
    }

    get value() {

        if (!this._cached) {
            this._cache = this._parent.value.filter(x => this._predicate(x).value);
            this._cached = true;
        }

        return this._cache!;
    }

    protected notify() {
        // Ensure the cache is cleared before notifying
        this._cached = false;
        super.notify();
    }

    subscribe(listener: (source: Pipe<TItem[]>) => void): SubscriptionToken {
        const token = super.subscribe(listener);

        const parentToken = this._parent.subscribe(_ => {

            // When the parent changes that may mean that an item has been added or removed
            // so we need to update our predicate subscriptions.
            // We'll first unsubscribe, and then subscribe to items the parent has now.
            const parentTokenInfo = this._tokens[token];
            parentTokenInfo.unsubscribers.forEach(unsubscribe => unsubscribe());
            parentTokenInfo.unsubscribers = this._parent.value
                .map(x => this._predicate(x))
                .map(x => {
                    const subToken = x.subscribe(_ => this.notify());
                    return () => x.unsubscribe(subToken);
                });

            this.notify();
        });

        this._tokens[token] = {
            parentToken,
            unsubscribers: this._parent.value
                .map(x => this._predicate(x))
                .map(x => {
                    const subToken = x.subscribe(_ => this.notify());
                    return () => x.unsubscribe(subToken);
                }),
        };

        return token;
    }

    unsubscribe(token: SubscriptionToken) {
        const parentToken = this._tokens[token];
        parentToken.unsubscribers.forEach(unsubscribe => unsubscribe());
        this._parent.unsubscribe(parentToken.parentToken);

        super.unsubscribe(token);
    }

    [Symbol.iterator](): IterableIterator<TItem> {
        return this.value[Symbol.iterator]();
    }
}

export class MappedPipeCollection<TItemIn, TItem> extends PipeBase<TItem[]> implements PipeCollection<TItem> {
    private _cached: boolean = false;
    private _cache?: TItem[] = undefined;
    private _subscriptionInfo: { [token: SubscriptionToken]: { unsubscribe: () => void } } = {};
    private _parent: Pipe<TItemIn[]>;
    private _projection: (value: TItemIn) => TItem;

    constructor(
        parent: Pipe<TItemIn[]>,
        projection: (item: TItemIn) => TItem
    ) {
        super();
        this._parent = parent;
        this._projection = projection;
    }

    map<TItemProjection>(projection: (item: TItem) => TItemProjection): PipeCollection<TItemProjection> {
        return new MappedPipeCollection<TItem, TItemProjection>(this, projection);
    }

    filter(predicate: (value: TItem) => Pipe<boolean>): PipeCollection<TItem> {
        return new FilteredPipeCollection<TItem>(this, predicate);
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

    subscribe(listener: (source: Pipe<TItem[]>) => void): SubscriptionToken {
        const thisToken = super.subscribe(listener);

        const parentToken = this._parent.subscribe(_ => this.notify());
        this._subscriptionInfo[thisToken] = { unsubscribe: () => this._parent.unsubscribe(parentToken) };

        return thisToken;
    }

    unsubscribe(token: SubscriptionToken) {
        const info = this._subscriptionInfo[token];
        info.unsubscribe();

        super.unsubscribe(token);
    }

    [Symbol.iterator](): IterableIterator<TItem> {
        return this.value[Symbol.iterator]();
    }
}

export class ProjectionPipe<TIn, T> extends PipeBase<T> implements Pipe<T> {
    private _cached: boolean = false;
    private _cache?: T;
    private _tokens: { [token: SubscriptionToken]: SubscriptionToken; } = {};
    private _parent: Pipe<TIn>;
    private _projection: (value: TIn) => T;

    constructor(
        parent: Pipe<TIn>,
        projection: (value: TIn) => T
    ) {
        super();
        this._parent = parent;
        this._projection = projection;
    }

    get value(): T {
        if (!this._cached) {
            this._cache = this._projection(this._parent.value);
            this._cached = true;
        }

        return this._cache!;
    }

    protected notify() {
        // Ensure the cache is cleared before notifying
        this._cached = false;
        super.notify();
    }

    subscribe(subscription: (source: Pipe<T>) => void) {
        const token = super.subscribe(subscription);
        const parentToken = this._parent.subscribe(_ => this.notify());

        this._tokens[token] = parentToken;

        return token;
    }

    unsubscribe(token: SubscriptionToken) {
        const parentToken = this._tokens[token];

        this._parent.unsubscribe(parentToken);
        super.unsubscribe(token);
    }
}

export class CombinedPipe extends PipeBase<Pipe<any>[]> implements Pipe<Pipe<any>[]> {
    private _cached: boolean = false;
    private _cache?: any[];
    private _subscriptionInfo: { [token: SubscriptionToken]: { unsubscribeAll: () => void } } = {};
    private _pipes: Pipe<any>[];

    constructor(
        ...pipes: Pipe<any>[]
    ) {
        super();
        this._pipes = pipes;
    }

    get value(): any[] {
        if (!this._cached) {
            this._cache = this._pipes;
            this._cached = true;
        }

        return this._cache!;
    }

    protected notify() {
        // Ensure the cache is cleared before notifying
        this._cached = false;
        super.notify();
    }

    subscribe(listener: (source: Pipe<Pipe<unknown>[]>) => void) {
        const thisToken = super.subscribe(listener);

        const unsubscriberCalls = this._pipes
            .map(p => {
                const token = p.subscribe(_ => this.notify());
                return () => p.unsubscribe(token);
            });
        this._subscriptionInfo[thisToken] = {
            unsubscribeAll: () => unsubscriberCalls.forEach(x => x()),
        };

        return thisToken;
    }

    unsubscribe(token: SubscriptionToken) {
        const info = this._subscriptionInfo[token];
        info.unsubscribeAll();

        super.unsubscribe(token);
    }
}

export class ObservingPipe<T> extends PipeBase<T> implements Pipe<T> {
    private _tokens: { [token: SubscriptionToken]: { parentToken: SubscriptionToken, unsubscribers: (() => void)[] }; } = {};
    private _parent: Pipe<T>;
    private _captures: ((value: T) => Pipe<any>)[];

    constructor(
        parent: Pipe<T>,
        ...captures: ((value: T) => Pipe<any>)[]
    ) {
        super();
        this._parent = parent;
        this._captures = captures;
    }

    get value() {
        return this._parent.value;
    }

    protected notify() {
        super.notify();
    }

    subscribe(listener: (source: Pipe<T>) => void): SubscriptionToken {
        const token = super.subscribe(listener);

        const parentToken = this._parent.subscribe(parentPipe => {
            // When the parent changes that may mean that an item or member has been added or removed
            // so we need to update our predicate subscriptions.
            // Unsubscribe and resubscribe to items the parent has now.
            const tokenInfo = this._tokens[token];
            tokenInfo.unsubscribers.forEach(unsubscribe => unsubscribe());
            tokenInfo.unsubscribers = this._captures
                .map(capture => capture(parentPipe.value))
                .map(x => {
                    const subToken = x.subscribe(_ => this.notify());
                    return () => x.unsubscribe(subToken);
                });

            // Notify listeners.
            this.notify();
        });

        this._tokens[token] = {
            parentToken,
            unsubscribers: this._captures
                .map(capture => capture(this._parent.value))
                .map(x => {
                    const subToken = x.subscribe(_ => this.notify());
                    return () => x.unsubscribe(subToken);
                }),
        };

        return token;
    }

    unsubscribe(token: SubscriptionToken) {
        const parentToken = this._tokens[token];
        this._parent.unsubscribe(parentToken.parentToken);
        parentToken.unsubscribers.forEach(unsubscribe => unsubscribe());

        super.unsubscribe(token);
    }
}
