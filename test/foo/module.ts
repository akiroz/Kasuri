import { Module } from "../../src/kasuri";
import State from "../state";

export default class extends Module<typeof State["foo"], typeof State> {
    async init() {
        throw new Error("foo hardware not found");
    }
}
