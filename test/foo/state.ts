import { Module, TaskRequest } from "../../src/kasuri";

export default {
    ...Module.defaultState,
    e: 0,
    f: 0,
    g: "",
    h: false,
    additionReq: null as TaskRequest<[number, number]>
};
