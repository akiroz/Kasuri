import { Module } from "../../src/kasuri";
import State from "../state";

export default class extends Module<typeof State["bar"], typeof State> {
    async init() {
        this.setState({ status: "online" });
    }
}
