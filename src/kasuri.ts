import { EventEmitter } from "events";
import { throws } from "assert";

type ModuleState = {
  status: "pending" | "online" | "offline" | "failure";
  statusMessage: string;
};

type ModuleStateMap = {
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
        handler: (value: StateMap[M][K], old: StateMap[M][K]) => void;
        once?: boolean;
      }
    >;
  };
};

export class Kasuri<StateMap extends ModuleStateMap> {
  store: ModuleStateStoreType<StateMap>;
  subscription: SubscriptionStore<StateMap>;

  constructor(stateMap: StateMap, moduleMap: ModuleMap<StateMap>) {
    Object.entries(stateMap).forEach(
      ([module, defaultState]: [keyof StateMap, ModuleState]) => {
        this.store[module] = {} as any;
        this.subscription[module] = {} as any;
        Object.entries(defaultState).forEach(([key, defaultValue]) => {
          this.store[module][key] = {
            value: defaultValue,
            lastUpdate: 0
          };
          this.subscription[module][key] = new Map();
        });
      }
    );
    Object.entries(moduleMap).forEach(
      ([module, moduleObj]: [
        keyof StateMap,
        Module<ModuleState, StateMap>
      ]) => {
        moduleObj._kasuri = this;
        moduleObj.on("setState", update => {
          Object.entries(update).forEach(([key, value]) => {
            this.setState(module, key as any, value);
          });
        });
      }
    );
    Object.entries(moduleMap).forEach(
      ([module, moduleObj]: [
        keyof StateMap,
        Module<ModuleState, StateMap>
      ]) => {
        moduleObj.init();
      }
    );
  }

  setState<M extends keyof StateMap, K extends keyof StateMap[M]>(
    module: M,
    key: K,
    value: StateMap[M][K]
  ) {
    const old = this.store[module][key];
    this.store[module][key] = { value, lastUpdate: Date.now() };
    const subMap = this.subscription[module][key];
    subMap.forEach(({ handler, once }, id) => {
      handler(value, old.value);
      if (once) subMap.delete(id);
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

  subscribeState<M extends keyof StateMap, K extends keyof StateMap[M]>(
    module: M,
    key: K,
    listener: (value: StateMap[M][K], old: StateMap[M][K]) => void,
    once = false
  ) {
    const subMap = this.subscription[module][key];
    const maxKey = Math.max(...subMap.keys());
    subMap.set(maxKey + 1, {
      handler: listener,
      once
    });
  }

  stateChange<M extends keyof StateMap, K extends keyof StateMap[M]>(
    module: M,
    key: K
  ): Promise<StateMap[M][K]> {
    return new Promise(r => {
      this.subscribeState(module, key, r, true);
    });
  }
}

export class Module<
  State extends ModuleState,
  StateMap extends ModuleStateMap
> extends EventEmitter {
  static defaultState: ModuleState = {
    status: "pending",
    statusMessage: ""
  };
  _kasuri: Kasuri<StateMap>;

  getState<M extends keyof StateMap, K extends keyof StateMap[M]>(
    module: M,
    key: K,
    staleMs: number = null
  ): StateMap[M][K] {
    return this._kasuri.getState(module, key, staleMs);
  }

  subscribeState<M extends keyof StateMap, K extends keyof StateMap[M]>(
    module: M,
    key: K,
    listener: (value: StateMap[M][K], old: StateMap[M][K]) => void
  ) {
    this._kasuri.subscribeState(module, key, listener);
  }

  stateChange<M extends keyof StateMap, K extends keyof StateMap[M]>(
    module: M,
    key: K
  ): Promise<StateMap[M][K]> {
    return this._kasuri.stateChange(module, key);
  }

  setState(update: Partial<State>) {
    this.emit("setState", update);
  }

  async init() {
    // Override
  }
}
