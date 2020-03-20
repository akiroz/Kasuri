import { Module } from "../../src/kasuri";
import State from "../state";

export default class extends Module<typeof State["foo"], typeof State> {
    async init() {
        this.setState({
            status: "offline",
            statusMessage: "foo hardware not found",
        });
    }
}
