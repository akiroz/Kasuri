## Kasuri

## !!!!! Work-In-Progress !!!!!

An opinionated, type-safe, reactive, module state management framework designed
for complex embedded systems with a huge varity of I/O and stateful components.

Inspired by modern reactive UI frameworks and memory-driven computing.

### Concept

![](concept.png)

The system consists of a "State Fabric" and compute logic split into multiple "Modules".

Every Module has its own state that lives inside the State Fabric and could only modify its own state.

At the same time, each Module can read or subscribe to changes of all state in the whole system.

System state is managed in 2 nested levels: modules and module-state. Subscriptions listens to changes on the module-state level, although each module-state can be arbitrarily nested.

```
system: {
    module1: {
        state1: 123
    },
    module2: {
        state1: "foo",
        state2: { x:0, y:0, z:0 }
    }
}
```

### Project Structuring

The following project layout is recommended:

```
┣ index.ts      Entrypoint
┣ stateMap.ts   Exports an object mapping module name to the default state of all modules
┣ module1
┃ ┣ state.ts    Exports an object containing the default state of module1
┃ ┗ module.ts   Exports a Module class that implements module1 logic
...
```

A sample project could be found in the `test/` directory.
