import { strict as assert } from "assert";
import { Server } from "http";
import axios from "axios";
import { Kasuri, Introspection } from "../src/kasuri";
import StateMap from "./stateMap";
import FooModule from "./foo/module";
import BarModule from "./bar/module";

function nextCycle() {
    return new Promise(r => setImmediate(r));
}

function timeout(ms) {
    return new Promise(r => setTimeout(r, ms));
}

let foo: FooModule;
let bar: BarModule;
let kasuri: Kasuri<typeof StateMap>;

describe("module", () => {
    beforeEach(() => {
        foo = new FooModule();
        bar = new BarModule();
        kasuri = new Kasuri<typeof StateMap>(StateMap, { foo, bar });
    });

    it("can get/set state own state", async () => {
        foo.setState({ e: 1 });
        bar.setState({ b: { x: 1, y: 1 } });
        await nextCycle();
        assert.equal(foo.getState("foo", "e"), 1);
        assert.deepEqual(bar.getState("bar", "b"), { x: 1, y: 1 });
    });

    it("can get others' state", async () => {
        foo.setState({ e: 1 });
        bar.setState({ b: { x: 1, y: 1 } });
        await nextCycle();
        assert.equal(bar.getState("foo", "e"), 1);
        assert.deepEqual(foo.getState("bar", "b"), { x: 1, y: 1 });
    });

    it("can listen for state change", async () => {
        foo.setState({ g: "update" });
        const update = await foo.stateChange("foo", "g");
        assert.equal(update, "update");
    });

    it("can subscribe to new/old state", async () => {
        foo.setState({ g: "update" });
        const [val, old] = await new Promise(r => foo.subscribeState("foo", "g", (val, old) => r([val, old])));
        assert.equal(val, "update");
        assert.equal(old, "");
    });

    it("can detect stale state", async () => {
        foo.setState({ g: "update" });
        await nextCycle();
        assert.equal(foo.getState("foo", "g"), "update");
        await timeout(12);
        assert.equal(foo.getState("foo", "g", 100), "update");
        assert.equal(foo.getState("foo", "g", 10), undefined);
    });
});

describe("kasuri", () => {
    beforeEach(() => {
        foo = new FooModule();
        bar = new BarModule();
        kasuri = new Kasuri<typeof StateMap>(StateMap, { foo, bar });
    });

    it("should init module on construct", async () => {
        assert.equal(kasuri.getState("bar", "status"), "pending");
        assert.equal(kasuri.getState("foo", "status"), "pending");
        await nextCycle();
        assert.equal(kasuri.getState("bar", "status"), "online");
        assert.equal(kasuri.getState("foo", "status"), "offline");
        assert.equal(kasuri.getState("foo", "statusMessage"), "foo hardware not found");
    });
});

describe("introspection", () => {
    let server: Server;
    const client = axios.create({
        method: "POST",
        baseURL: "http://localhost:3000",
    });

    before(async () => {
        foo = new FooModule();
        bar = new BarModule();
        kasuri = new Kasuri<typeof StateMap>(StateMap, { foo, bar });
        server = await Introspection.server({ kasuri, port: 3000 });
    });

    after(() => {
        server.close();
    });

    it("can dump state", async () => {
        const { data: state } = await client.post("/dumpState");
        assert.equal(state.foo.e.value, 0);
    });

    it("can set state", async () => {
        await client.post("/setState", {
            module: "foo",
            update: { f: 1, g: false },
        });
        const { data: state } = await client.post("/dumpState");
        assert.equal(state.foo.f.value, 1);
        assert.equal(state.foo.g.value, false);
    });
});
