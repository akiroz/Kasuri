import { Module } from "../../src/kasuri";

export default {
    ...Module.defaultState,
    a: [1, 2, 3, 5],
    b: { x: 0, y: 0 },
    c: true,
    d: 0,
    additionTask: Module.taskState<[number, number], number>(),
    defaultPendingTask: Module.taskState<number, number>({ defaultActive: false })
};
