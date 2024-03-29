import { EventEmitter } from "events";
import { randomBytes } from "crypto";
import util from "util";
import Bluebird from "bluebird";
Bluebird.config({ cancellation: true });

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

export type TaskStatus = "pending" | "active" | "success" | "failed" | "cancelled";

export type TaskRequest<Data> = {
    id: string,
    data: Data,
};

type TaskReqData<T> = T extends TaskRequest<infer D> ? D : never;

export type TaskState<Data, Result> = {
    keepStale: number,
    concurrency: number,
    defaultActive: boolean,
    requestSources: string[], // "${module}/${requestState}"
    stale: string[],
    active: string[],
    task: {
        [key: string]: {
            updateTime: number,
            status: TaskStatus,
            data: Data,
            result?: Result,
        }
    },
};

type TaskStateData<T> = T extends TaskState<infer D, infer R> ? D : never;
type TaskStateResult<T> = T extends TaskState<infer D, infer R> ? R : never;
function isTaskstateValid(taskState: any): boolean {
    return !(taskState instanceof Object && ["keepStale", "concurrency", "defaultActive", "stale", "active", "task"].every(key => taskState.hasOwnProperty(key)));
}

function taskId(): string {
    return randomBytes(4).toString("hex");
}

export class Kasuri<StateMap extends ModuleStateMap> {
    store: ModuleStateStoreType<StateMap> = {} as any;
    module: ModuleMap<StateMap>;
    subscription = new EventEmitter();

    static now(): number {
        return Number(process.hrtime.bigint() / BigInt(1000000));
    }

    constructor(stateMap: StateMap, moduleMap: ModuleMap<StateMap>) {
        this.module = moduleMap;
        this.subscription.setMaxListeners(100);
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
            moduleObj.on("getSelf", (cb) => cb(module));
            moduleObj.on("setState", (update) => {
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
        Object.keys(moduleMap).forEach((module: string) => {
            if ((whiteList && !enabledModules.has(module)) || disabledModules.has(module)) {
                this.setState(module, "status", "offline");
                this.setState(module, "statusMessage", "Disabled");
            }
        });
        // Begin module initialization
        Object.entries(moduleMap).forEach(
            async ([module, moduleObj]: [keyof StateMap, Module<ModuleState, StateMap>]) => {
                try {
                    if (this.getState(module, "status") !== "offline") {
                        await moduleObj.init();
                    }
                } catch (err) {
                    this.setState(module, "status", "failure");
                    this.setState(
                        module,
                        "statusMessage",
                        `Init Error: ${util.inspect(err)}`
                    );
                }
            }
        );
    }

    setState<M extends keyof StateMap, K extends keyof StateMap[M]>(module: M, key: K, value: StateMap[M][K]) {
        const previous = this.store[module][key];
        const current = { value, updateTime: Kasuri.now() };
        this.store[module][key] = current;
        setImmediate(() => {
            this.subscription.emit(`${module as string}.${key as string}`, { current, previous });
            this.subscription.emit("update", { module, key, current, previous });
        });
    }

    getState<M extends keyof StateMap, K extends keyof StateMap[M]>(
        module: M,
        key: K,
        staleMs: number = null
    ): StateMap[M][K] {
        const { value, updateTime } = this.store[module][key];
        if (Number.isFinite(staleMs)) {
            return updateTime > Kasuri.now() - staleMs ? value : undefined;
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
    ): () => void {
        const k = `${module as string}.${key as string}`;
        const h = ({ current, previous }) => listener(current, previous);
        if (once) this.subscription.once(k, h);
        else this.subscription.on(k, h);
        return () => this.subscription.removeListener(k, h);
    }

    stateChange<M extends keyof StateMap, K extends keyof StateMap[M]>(
        module: M,
        key: K
    ): Bluebird<{
        current: ModuleStateStoreAttr<StateMap[M][K]>;
        previous: ModuleStateStoreAttr<StateMap[M][K]>;
    }> {
        return new Bluebird((rsov, rjct, onCancel) => {
            onCancel(this.subscribeState(module, key, (current, previous) => rsov({ current, previous }), true));
        });
    }

    subscribe<M extends keyof StateMap>(listener: (
        module: M,
        key: string,
        current: ModuleStateStoreAttr<any>,
        previous: ModuleStateStoreAttr<any>
    ) => void) {
        this.subscription.on("update", ({ module, key, current, previous }) => listener(module, key, current, previous));
    }
}

export class Module<State extends ModuleState, StateMap extends ModuleStateMap> extends EventEmitter {

    static defaultState: ModuleState = {
        status: "pending",
        statusMessage: "",
    };

    static taskState<Data, Result>(config: {
        keepStale?: number,
        concurrency?: number,
        defaultActive?: boolean,
    } = {}): TaskState<Data, Result> {
        return {
            keepStale: config.keepStale || 5,
            concurrency: config.concurrency || Number.MAX_SAFE_INTEGER,
            defaultActive: (typeof config.defaultActive === "boolean")? config.defaultActive : true,
            requestSources: [],
            stale: [],
            active: [],
            task: {},
        };
    }

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
    ): Bluebird<{
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

    async submitTask<
        R extends keyof State,
        M extends keyof StateMap,
        S extends keyof StateMap[M],
        Data extends TaskReqData<State[R]>,
        Data2 extends TaskStateData<StateMap[M][S]>,
        Result extends TaskStateResult<StateMap[M][S]>
    >(req: R, mod: M, stateKey: S, data: Data, id: string = taskId()): Promise<Result> {
        this.setState({ [req]: { id, data } } as any);
        const selfModule = await new Promise<M>(r => this.emit("getSelf", r));
        const taskState = this.getState(mod, stateKey) as TaskState<Data2, Result>;
        if(!taskState.requestSources.includes(`${selfModule as string}/${req as string}`)) throw Error("not handled");
        while (true) {
            const taskState = (await this.stateChange(mod, stateKey)).current.value as TaskState<Data2, Result>;
            if (isTaskstateValid(taskState)) {
                console.warn(`Invalid task state: ${stateKey as string}, ${taskState}`);
            } else {
                const { task } = taskState;
                if (task[id] && task[id].status === "cancelled") throw Error("cancelled");
                if (task[id] && task[id].status === "failed") throw task[id].result;
                if (task[id] && task[id].status === "success") return task[id].result;
            }
        }
    }

    handleTask<
        M extends keyof StateMap,
        R extends keyof StateMap[M],
        S extends keyof State,
        Data extends TaskReqData<StateMap[M][R]>,
        Result extends TaskStateResult<State[S]>
    >(
        mod: M,
        req: R,
        stateKey: S,
        handler: (data: Data, id: string) => Promise<Result>,
        cleanup?: (data: Data, id: string) => any
    ) {
        this.swapState(stateKey, (({ value: taskState }: ModuleStateStoreAttr<TaskState<Data, Result>>) => {
            const reqSource = `${mod as string}/${req as string}`;
            if(taskState.requestSources.includes(reqSource)) {
                console.log(`[Kasuri] Duplicate handler for ${stateKey as string}(${reqSource})`);
            } else {
                taskState.requestSources.push(reqSource);
            }
            return taskState;
        }) as any);
        this.subscribeState(mod, req, (async ({ value }: ModuleStateStoreAttr<TaskRequest<Data>>) => {
            if (!value || !value.hasOwnProperty("id") || !value.hasOwnProperty("data")) {
                console.log(`[Kasuri] Invalid task request: [${mod as string}:${req as string}] ${value}`);
                return;
            };
            const { id, data } = value;
            this.swapState(stateKey, (({ value: taskState }: ModuleStateStoreAttr<TaskState<Data, Result>>) => {
                if (isTaskstateValid(taskState)) {
                    console.warn(`[Kasuri] Invalid task state: ${stateKey as string}, ${taskState}`);
                    return taskState;
                };
                taskState.task[id] = {
                    updateTime: Kasuri.now(),
                    status: taskState.defaultActive ? "active" : "pending",
                    data,
                };
                taskState.active.push(id);
                while (taskState.active.length > taskState.concurrency) {
                    const oldest = taskState.active.shift();
                    taskState.task[oldest].status = "cancelled";
                    taskState.task[oldest].updateTime = Kasuri.now();
                    taskState.stale.push(oldest);
                    while (taskState.stale.length > Math.max(0, taskState.keepStale)) {
                        delete taskState.task[taskState.stale.shift()];
                    }
                    if (cleanup) cleanup(taskState.task[oldest].data, id);
                }
                return taskState;
            }) as any);
            try {
                const result = await handler(data, id);
                this.swapState(stateKey, (({ value: taskState }: ModuleStateStoreAttr<TaskState<Data, Result>>) => {
                    if (isTaskstateValid(taskState)) {
                        console.warn(`[Kasuri] Invalid task state: ${stateKey as string}, ${taskState}`);
                        return taskState;
                    };
                    taskState.task[id] = { updateTime: Kasuri.now(), status: "success", data, result };
                    taskState.active = taskState.active.filter(task => task !== id);
                    taskState.stale.push(id);
                    while (taskState.stale.length > Math.max(0, taskState.keepStale)) {
                        delete taskState.task[taskState.stale.shift()];
                    }
                    return taskState;
                }) as any);
            } catch (err) {
                this.swapState(stateKey, (({ value: taskState }: ModuleStateStoreAttr<TaskState<Data, Result>>) => {
                    if (isTaskstateValid(taskState)) {
                        console.warn(`[Kasuri] Invalid task state: ${stateKey as string}, ${taskState}`);
                        return taskState;
                    };
                    taskState.task[id] = {
                        updateTime: Kasuri.now(), status: "failed", data,
                        result: err instanceof Error ? err.message : err,
                    };
                    taskState.active = taskState.active.filter(task => task !== id);
                    taskState.stale.push(id);
                    while (taskState.stale.length > Math.max(0, taskState.keepStale)) {
                        delete taskState.task[taskState.stale.shift()];
                    }
                    return taskState;
                }) as any);
            }
        }) as any);
    }

    async init() {
        // Override
    }
}
