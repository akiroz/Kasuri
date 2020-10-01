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

export type ModuleStateStoreAttr<T> = {
    value: T;
    updateTime: number; // ms since epoch
};

type ModuleStateStoreType<StateMap extends ModuleStateMap> = {
    [M in keyof StateMap]: {
        [K in keyof StateMap[M]]: ModuleStateStoreAttr<StateMap[M][K]>;
    };
};

type ModuleMap<StateMap extends ModuleStateMap> = {
    [M in keyof StateMap]: Module<StateMap[M], StateMap>;
};

export class Kasuri<StateMap extends ModuleStateMap> {
    store: ModuleStateStoreType<StateMap> = {} as any;
    module: ModuleMap<StateMap>;
    subscription = new EventEmitter();

    constructor(stateMap: StateMap, moduleMap: ModuleMap<StateMap>) {
        this.module = moduleMap;
        Object.entries(stateMap).forEach(([module, defaultState]: [keyof StateMap, ModuleState]) => {
            this.store[module] = {} as any;
            Object.entries(defaultState).forEach(([key, defaultValue]) => {
                this.store[module][key] = {
                    value: defaultValue,
                    updateTime: 0,
                };
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

        const whiteList = process.env["KASURI_ENABLED_MODULES"];
        const enabledModules = whiteList && new Set(whiteList.split(","));
        const disabledModules = new Set((process.env["KASURI_DISABLED_MODULES"] || "").split(","));
        Object.entries(moduleMap).forEach(
            async ([module, moduleObj]: [keyof StateMap, Module<ModuleState, StateMap>]) => {
                try {
                    if (whiteList && !enabledModules.has(module as string)) {
                        this.setState(module, "status", "offline");
                        this.setState(module, "statusMessage", "Disabled");
                    } else if (disabledModules.has(module as string)) {
                        this.setState(module, "status", "offline");
                        this.setState(module, "statusMessage", "Disabled");
                    } else {
                        await moduleObj.init();
                    }
                } catch (err) {
                    this.setState(module, "status", "failure");
                    this.setState(
                        module,
                        "statusMessage",
                        "Init Error: " + (err instanceof Error) ? err.stack : String(err)
                    );
                }
            }
        );
    }

    setState<M extends keyof StateMap, K extends keyof StateMap[M]>(module: M, key: K, value: StateMap[M][K]) {
        const previous = this.store[module][key];
        const current = { value, updateTime: Date.now() };
        this.store[module][key] = current;
        setImmediate(() => {
            this.subscription.emit(`${module}.${key}`, { current, previous });
        });
    }

    getState<M extends keyof StateMap, K extends keyof StateMap[M]>(
        module: M,
        key: K,
        staleMs: number = null
    ): StateMap[M][K] {
        const { value, updateTime } = this.store[module][key];
        if (Number.isFinite(staleMs)) {
            return updateTime > Date.now() - staleMs ? value : undefined;
        }
        return value;
    }

    getUpdateTime<M extends keyof StateMap, K extends keyof StateMap[M]>(module: M, key: K): number {
        return this.store[module][key].updateTime;
    }

    subscribeState<M extends keyof StateMap, K extends keyof StateMap[M]>(
        module: M,
        key: K,
        listener: (
            current: ModuleStateStoreAttr<StateMap[M][K]>,
            previous: ModuleStateStoreAttr<StateMap[M][K]>
        ) => void,
        once = false
    ) {
        if (once) {
            this.subscription.once(`${module}.${key}`, ({ current, previous }) => listener(current, previous));
        } else {
            this.subscription.on(`${module}.${key}`, ({ current, previous }) => listener(current, previous));
        }
    }

    stateChange<M extends keyof StateMap, K extends keyof StateMap[M]>(
        module: M,
        key: K
    ): Promise<{
        current: ModuleStateStoreAttr<StateMap[M][K]>;
        previous: ModuleStateStoreAttr<StateMap[M][K]>;
    }> {
        return new Promise(rsov => {
            this.subscribeState(module, key, (current, previous) => rsov({ current, previous }), true);
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

    getUpdateTime<M extends keyof StateMap, K extends keyof StateMap[M]>(module: M, key: K): number {
        return this._kasuri.getUpdateTime(module, key);
    }

    subscribeState<M extends keyof StateMap, K extends keyof StateMap[M]>(
        module: M,
        key: K,
        listener: (
            current: ModuleStateStoreAttr<StateMap[M][K]>,
            previous: ModuleStateStoreAttr<StateMap[M][K]>
        ) => void
    ) {
        this._kasuri.subscribeState(module, key, listener);
    }

    stateChange<M extends keyof StateMap, K extends keyof StateMap[M]>(
        module: M,
        key: K
    ): Promise<{
        current: ModuleStateStoreAttr<StateMap[M][K]>;
        previous: ModuleStateStoreAttr<StateMap[M][K]>;
    }> {
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
