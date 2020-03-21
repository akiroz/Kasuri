import { strict as assert } from "assert";
import { Server } from "http";
import axios from "axios";
import { Kasuri, Introspection } from "../src/kasuri";
import State from "./state";
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
let kasuri: Kasuri<typeof State>;

describe("module", () => {
    beforeEach(() => {
        foo = new FooModule();
        bar = new BarModule();
        kasuri = new Kasuri<typeof State>(State, { foo, bar });
    });

    it("can get/set state own state", async () => {
        foo.setState({ e: 1 });
        bar.setState({ b: { x: 1, y: 1 } });
        assert.equal(foo.getState("foo", "e"), 1);
        assert.deepEqual(bar.getState("bar", "b"), { x: 1, y: 1 });
    });

    it("can get others' state", async () => {
        foo.setState({ e: 1 });
        bar.setState({ b: { x: 1, y: 1 } });
        assert.equal(bar.getState("foo", "e"), 1);
        assert.deepEqual(foo.getState("bar", "b"), { x: 1, y: 1 });
    });

    it("can listen for state change", async () => {
        const [update] = await Promise.all([
            foo.stateChange("foo", "g"),
            nextCycle().then(() => foo.setState({ g: "update" })),
        ]);
        assert.equal(update, "update");
    });

    it("can get state last update time", async () => {
        let lastUpdate = foo.getLastUpdate("foo", "g");
        assert.equal(lastUpdate, 0);
        foo.setState({ g: "update" });
        lastUpdate = foo.getLastUpdate("foo", "g");
        assert.notEqual(lastUpdate, 0);
    });

    it("can subscribe to new/old state", async () => {
        const [[val, old]] = await Promise.all([
            new Promise<[string, string]>(r => foo.subscribeState("foo", "g", (val, old) => r([val, old]))),
            nextCycle().then(() => foo.setState({ g: "update" })),
        ]);
        assert.equal(old, "");
        assert.equal(val, "update");
    });

    it("can detect stale state", async () => {
        foo.setState({ g: "update" });
        assert.equal(foo.getState("foo", "g"), "update");
        await timeout(12);
        assert.equal(foo.getState("foo", "g", 100), "update");
        assert.equal(foo.getState("foo", "g", 10), undefined);
    });

    it("can swap state", async () => {
        foo.swapState("e", ({ value }) => value + 1);
        assert.equal(foo.getState("foo", "e"), 1);
    });
});

describe("kasuri", () => {
    beforeEach(() => {
        foo = new FooModule();
        bar = new BarModule();
        kasuri = new Kasuri<typeof State>(State, { foo, bar });
    });

    it("should init module on construct", async () => {
        await nextCycle();
        assert.equal(kasuri.getState("bar", "status"), "online");
    });

    it("should catch module init errors", async () => {
        await nextCycle();
        assert.equal(kasuri.getState("foo", "status"), "failure");
    });
});

describe("introspection", () => {
    let server: Server;
    const client = axios.create({
        method: "POST",
        baseURL: "http://localhost:3018",
    });

    before(async () => {
        foo = new FooModule();
        bar = new BarModule();
        kasuri = new Kasuri<typeof State>(State, { foo, bar });
        server = await Introspection.server({ kasuri, port: 3018 });
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
