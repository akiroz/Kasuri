import { strict as assert } from "assert";
import { Server } from "http";
import axios from "axios";
import { Kasuri, Introspection, ModuleStateStoreAttr } from "../src/kasuri";
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
        const [{ current }] = await Promise.all([
            foo.stateChange("foo", "g"),
            nextCycle().then(() => foo.setState({ g: "update" })),
        ]);
        assert.equal(current.value, "update");
    });

    it("can get state last update time", async () => {
        let updateTime = foo.getUpdateTime("foo", "g");
        assert.equal(updateTime, 0);
        foo.setState({ g: "update" });
        updateTime = foo.getUpdateTime("foo", "g");
        assert.notEqual(updateTime, 0);
    });

    it("can subscribe to new/old state", async () => {
        const [[val, old]] = await Promise.all([
            new Promise<[ModuleStateStoreAttr<string>, ModuleStateStoreAttr<string>]>(r =>
                foo.subscribeState("foo", "g", (val, old) => r([val, old]))
            ),
            nextCycle().then(() => foo.setState({ g: "update" })),
        ]);
        assert.equal(old.value, "");
        assert.equal(val.value, "update");
    });

    it("should call listener multiple times", async () => {
        const changes = [];
        foo.subscribeState("foo", "e", ({ value }, { value: old }) => changes.push({ value, old }));
        foo.swapState("e", ({ value }) => value + 1);
        foo.swapState("e", ({ value }) => value + 1);
        await nextCycle();
        assert.equal(changes.length, 2);
        assert.deepEqual(changes[0], { value: 1, old: 0 });
        assert.deepEqual(changes[1], { value: 2, old: 1 });
    });

    it("can get update time in subscription", async () => {
        foo.setState({ g: "update" });
        await nextCycle();
        const [[val, old]] = await Promise.all([
            new Promise<[ModuleStateStoreAttr<string>, ModuleStateStoreAttr<string>]>(r =>
                foo.subscribeState("foo", "g", (val, old) => r([val, old]))
            ),
            timeout(12).then(() => foo.setState({ g: "update" })),
        ]);
        const delay = Date.now() - val.updateTime;
        assert(delay < 10, `Delay: ${delay} not < 10`);
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
