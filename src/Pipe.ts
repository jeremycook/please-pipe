export type SubscriptionToken = number;

type PipeArrayOrNever<T, TItem> = T extends Array<TItem> ? PipeArray<TItem> : never;
// type PipeArrayOrNever<T> = T extends Array<any> ? PipeArray<T[number]> : never;

// export interface Pipe<T> {
//     subscribe(listener: (source: Pipe<T>) => void): SubscriptionToken;

//     unsubscribe(token: SubscriptionToken): void;

//     /** Cleans up this pipe to never be used again. */
//     dispose(): void;

//     /** Returns a pipe that monitors specific members for changes. */
//     monitor(...monitoredPipes: ((value: T) => Pipe<any>)[]): Pipe<T>;

//     /** Combine one or more pipes. */
//     combineWith<T1>(t1: Pipe<T1>): Pipe<[Pipe<T>, Pipe<T1>]>;
//     combineWith<T1, T2>(t1: Pipe<T1>, t2: Pipe<T2>): Pipe<[Pipe<T>, Pipe<T1>, Pipe<T2>]>;
//     combineWith<T1, T2, T3>(t1: Pipe<T1>, t2: Pipe<T2>, t3: Pipe<T3>, ...rest: Pipe<any>[]): Pipe<[Pipe<T>, Pipe<T1>, Pipe<T2>, Pipe<T3>, ...Pipe<any>[]]>;

//     /** Project one pipe into different shape. */
//     project<TOut>(projection: (value: (T)) => TOut): Pipe<TOut>;
// }

export abstract class Pipe<T> implements Pipe<T> {
    private _index = 0;
    private _listeners: ((source: Pipe<T>) => void)[] = [];

    abstract get value(): T;

    protected notify(): void {
        for (const listener of this._listeners) {
            (listener as (source: Pipe<T>) => void)(this);
        }
    }

    subscribe(listener: (source: Pipe<T>) => void): SubscriptionToken {
        if (this._listeners.includes(listener)) {
            throw { message: 'The {listener} has already subscribed. Was this intentional?', listener };
        }

        const token = this._index++;
        this._listeners[token] = listener;
        return token;
    }

    unsubscribe(token: SubscriptionToken): void {
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
        return new CombinedPipe(this as Pipe<T>, ...rest);
    }

    project<TEnd>(projection: (value: T) => TEnd): Pipe<TEnd> {
        return new ProjectionPipe<T, TEnd>(this, projection);
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
    private _subscriptions: { [token: SubscriptionToken]: { unsubscribeParent: () => void, unsubscribeChildren: () => void } } = {};
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
        // Ensure the cache is cleared before notifying
        this._cached = false;
        super.notify();
    }

    subscribe(listener: (source: Pipe<TItem[]>) => void): SubscriptionToken {
        const thisToken = super.subscribe(listener);

        const parentToken = this._parent.subscribe(_ => {
            // When the parent changes that may mean that an item has been added or removed
            // so we need to update our predicate subscriptions.
            // We'll first unsubscribe, and then subscribe to items the parent has now.
            const parentTokenInfo = this._subscriptions[thisToken];
            parentTokenInfo.unsubscribeChildren();

            const unsubscribers = this._parent.value
                .map(item => this._predicate(item))
                .map(pipe => {
                    const subToken = pipe.subscribe(_ => this.notify());
                    return () => pipe.unsubscribe(subToken);
                });

            parentTokenInfo.unsubscribeChildren = () => unsubscribers.forEach(x => x());

            this.notify();
        });

        const unsubscribers = this._parent.value
            .map(item => this._predicate(item))
            .map(pipe => {
                const subToken = pipe.subscribe(_ => this.notify());
                return () => pipe.unsubscribe(subToken);
            });
        this._subscriptions[thisToken] = {
            unsubscribeParent: () => this._parent.unsubscribe(parentToken),
            unsubscribeChildren: () => unsubscribers.forEach(x => x()),
        };

        return thisToken;
    }

    unsubscribe(token: SubscriptionToken) {
        const subscriptionInfo = this._subscriptions[token];
        subscriptionInfo.unsubscribeChildren();
        subscriptionInfo.unsubscribeParent();
        super.unsubscribe(token);
    }
}

export class PipeArrayMap<TItemIn, TItem> extends Pipe<TItem[]> implements PipeArray<TItem> {
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
}

export class ProjectionPipe<TIn, T> extends Pipe<T> implements Pipe<T> {
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

export class CombinedPipe extends Pipe<Pipe<any>[]> implements Pipe<Pipe<any>[]> {
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

export class PipeMonitor<T> extends Pipe<T> implements Pipe<T> {
    private _tokens: { [token: SubscriptionToken]: { parentToken: SubscriptionToken, unsubscribers: (() => void)[] }; } = {};
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
            tokenInfo.unsubscribers = this._monitoredPipes
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
            unsubscribers: this._monitoredPipes
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

// Utilities

export namespace Pipe {
    export function open<T>(pipeOrValue: (T | Pipe<T>)): T {
        return pipeOrValue instanceof Pipe ? pipeOrValue.value : pipeOrValue;
    }
}
