import { EventEmitter } from "events";
import * as _Introspection from "./introspectionServer";

export const Introspection = _Introspection;

export type ModuleState = {
    status: "pending" | "online" | "offline" | "failure";
    statusMessage: string;
};

export type ModuleStateMap = {
    [module: string]: ModuleState;
};

type ModuleStateStoreAttr<T> = {
    value: T;
    lastUpdate: number; // ms since epoch
};

type ModuleStateStoreType<StateMap extends ModuleStateMap> = {
    [M in keyof StateMap]: {
        [K in keyof StateMap[M]]: ModuleStateStoreAttr<StateMap[M][K]>;
    };
};

type ModuleMap<StateMap extends ModuleStateMap> = {
    [M in keyof StateMap]: Module<StateMap[M], StateMap>;
};

type SubscriptionStore<StateMap extends ModuleStateMap> = {
    [M in keyof StateMap]: {
        [K in keyof StateMap[M]]: Map<
            number,
            {
                handler: (value: StateMap[M][K], old: StateMap[M][K], updateTime: number) => void;
                once?: boolean;
            }
        >;
    };
};

export class Kasuri<StateMap extends ModuleStateMap> {
    store: ModuleStateStoreType<StateMap> = {} as any;
    subscription: SubscriptionStore<StateMap> = {} as any;

    constructor(stateMap: StateMap, moduleMap: ModuleMap<StateMap>) {
        Object.entries(stateMap).forEach(([module, defaultState]: [keyof StateMap, ModuleState]) => {
            this.store[module] = {} as any;
            this.subscription[module] = {} as any;
            Object.entries(defaultState).forEach(([key, defaultValue]) => {
                this.store[module][key] = {
                    value: defaultValue,
                    lastUpdate: 0,
                };
                this.subscription[module][key] = new Map();
            });
        });
        Object.entries(moduleMap).forEach(([module, moduleObj]: [keyof StateMap, Module<ModuleState, StateMap>]) => {
            moduleObj._kasuri = this;
            moduleObj.on("setState", update => {
                Object.entries(update).forEach(([key, value]) => {
                    this.setState(module, key as any, value);
                });
            });
            moduleObj.on("swapState", ([key, swap]) => {
                const entry = this.store[module][key];
                this.setState(module, key, swap(entry));
            });
        });
        Object.entries(moduleMap).forEach(
            async ([module, moduleObj]: [keyof StateMap, Module<ModuleState, StateMap>]) => {
                try {
                    await moduleObj.init();
                } catch (err) {
                    this.setState(module, "status", "failure");
                    this.setState(module, "statusMessage", "Init Error: " + String(err));
                }
            }
        );
    }

    setState<M extends keyof StateMap, K extends keyof StateMap[M]>(module: M, key: K, value: StateMap[M][K]) {
        const old = this.store[module][key];
        const updateTime = Date.now();
        this.store[module][key] = { value, lastUpdate: updateTime };
        setImmediate(() => {
            const subMap = this.subscription[module][key];
            subMap.forEach(({ handler, once }, id) => {
                handler(value, old.value, updateTime);
                if (once) subMap.delete(id);
            });
        });
    }

    getState<M extends keyof StateMap, K extends keyof StateMap[M]>(
        module: M,
        key: K,
        staleMs: number = null
    ): StateMap[M][K] {
        const { value, lastUpdate } = this.store[module][key];
        if (Number.isFinite(staleMs)) {
            return lastUpdate > Date.now() - staleMs ? value : undefined;
        }
        return value;
    }

    getLastUpdate<M extends keyof StateMap, K extends keyof StateMap[M]>(module: M, key: K): number {
        return this.store[module][key].lastUpdate;
    }

    subscribeState<M extends keyof StateMap, K extends keyof StateMap[M]>(
        module: M,
        key: K,
        listener: (value: StateMap[M][K], old: StateMap[M][K], updateTime: number) => void,
        once = false
    ) {
        const subMap = this.subscription[module][key];
        const maxKey = Math.max(...subMap.keys());
        subMap.set(maxKey + 1, {
            handler: listener,
            once,
        });
    }

    stateChange<M extends keyof StateMap, K extends keyof StateMap[M]>(module: M, key: K): Promise<StateMap[M][K]> {
        return new Promise(r => {
            this.subscribeState(module, key, r, true);
        });
    }
}

export class Module<State extends ModuleState, StateMap extends ModuleStateMap> extends EventEmitter {
    static defaultState: ModuleState = {
        status: "pending",
        statusMessage: "",
    };
    _kasuri: Kasuri<StateMap>;

    getState<M extends keyof StateMap, K extends keyof StateMap[M]>(
        module: M,
        key: K,
        staleMs: number = null
    ): StateMap[M][K] {
        return this._kasuri.getState(module, key, staleMs);
    }

    getLastUpdate<M extends keyof StateMap, K extends keyof StateMap[M]>(module: M, key: K): number {
        return this._kasuri.getLastUpdate(module, key);
    }

    subscribeState<M extends keyof StateMap, K extends keyof StateMap[M]>(
        module: M,
        key: K,
        listener: (value: StateMap[M][K], old: StateMap[M][K], updateTime: number) => void
    ) {
        this._kasuri.subscribeState(module, key, listener);
    }

    stateChange<M extends keyof StateMap, K extends keyof StateMap[M]>(module: M, key: K): Promise<StateMap[M][K]> {
        return this._kasuri.stateChange(module, key);
    }

    setState(update: Partial<State>) {
        this.emit("setState", update);
    }

    swapState<K extends keyof State>(key: K, swap: (entry: ModuleStateStoreAttr<State[K]>) => State[K]) {
        this.emit("swapState", [key, swap]);
    }

    async init() {
        // Override
    }
}
