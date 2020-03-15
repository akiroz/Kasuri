import { Module } from "../../src/kasuri";
import StateMap from "../stateMap";
import ModuleState from "./state";

export default class extends Module<typeof ModuleState, typeof StateMap> {}
