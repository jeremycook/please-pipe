
export interface Pipe<T> {
    get value(): T;
    subscribe(listener: (source: Pipe<T>) => void): number;
    unsubscribe(token: number): void;
    dispose(): void;
}

export abstract class PipeBase<T> implements Pipe<T> {
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

    subscribe(listener: (source: Pipe<T>) => void) {
        const token = this._index++;
        this._listeners[token] = listener;
        return token;
    }

    unsubscribe(token: number) {
        delete this._listeners[token];
    }

    /** Unsubscribes listeners, and causing future calls the throw. */
    dispose() {
        for (let i = 0; i < this._index; i++) {
            this.unsubscribe(i);
        }
        this._listeners = undefined!;
    }
}
export interface PipeBase<T> extends Pipe<T> { }
export class State<T> extends PipeBase<T> implements Pipe<T> {
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
class MappedPipe<TStart, TEnd> extends PipeBase<TEnd> implements Pipe<TEnd> {
    private _cached: boolean = false;
    private _cache?: TEnd;
    private _tokens: { [token: number]: number; } = {};
    private _parent: Pipe<TStart>;
    private _projection: (value: TStart) => TEnd;

    constructor(
        parent: Pipe<TStart>,
        projection: (value: TStart) => TEnd
    ) {
        super();
        this._parent = parent;
        this._projection = projection;
    }

    get value(): TEnd {

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

    subscribe(subscription: (source: Pipe<TEnd>) => void) {
        const token = super.subscribe(subscription);
        const parentToken = this._parent.subscribe(_ => this.notify());

        this._tokens[token] = parentToken;

        return token;
    }

    unsubscribe(token: number) {
        const parentToken = this._tokens[token];

        this._parent.unsubscribe(parentToken);
        super.unsubscribe(token);
    }
}
export class CombinedPipe extends PipeBase<Pipe<any>[]> implements Pipe<Pipe<any>[]> {
    private _cached: boolean = false;
    private _cache?: any[];
    private _dependencyTokens: { [token: number]: number[]; } = {};
    private _dependencies: Pipe<any>[];

    constructor(
        ...dependencies: Pipe<any>[]
    ) {
        super();
        this._dependencies = dependencies;
    }

    get value(): any[] {

        if (!this._cached) {
            this._cache = this._dependencies;
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
        const token = super.subscribe(listener);

        const depTokens = new Array(this._dependencies.length);
        for (let i = 0; i < this._dependencies.length; i++) {
            const dep = this._dependencies[i];
            const depToken = dep.subscribe(_ => this.notify());
            depTokens[i] = depToken;
        }
        this._dependencyTokens[token] = depTokens;

        return token;
    }

    unsubscribe(token: number) {
        const depTokens = this._dependencyTokens[token];
        for (let i = 0; i < this._dependencies.length; i++) {
            const dep = this._dependencies[i];
            const depToken = depTokens[token];
            dep.unsubscribe(depToken);
        }

        super.unsubscribe(token);
    }
}

export interface Pipe<T> {
    combineWith(this: Pipe<any>, ...additaionalDependencies: Pipe<any>[]): Pipe<Pipe<any>[]>;
    map<TEnd>(this: Pipe<T>, projection: (value: T) => TEnd): Pipe<TEnd>;
}
PipeBase.prototype.combineWith = function <T>(this: Pipe<T>, ...additaionalDependencies: Pipe<any>[]): Pipe<Pipe<any>[]> {
    return new CombinedPipe(this, ...additaionalDependencies);
};
PipeBase.prototype.map = function <T, TEnd>(this: Pipe<T>, projection: (value: T) => TEnd): Pipe<TEnd> {
    return new MappedPipe<T, TEnd>(this, projection);
};
