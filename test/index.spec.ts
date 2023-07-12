import { strict as assert } from "assert";
import { Server } from "http";
import axios from "axios";
import { Kasuri, Introspection, ModuleStateStoreAttr } from "../src/kasuri";
import State from "./state";
import FooModule from "./foo/module";
import BarModule from "./bar/module";

function nextCycle() {
    return new Promise((r) => setImmediate(r));
}

function timeout(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

let foo: FooModule;
let bar: BarModule;
let kasuri: Kasuri<typeof State>;

describe("module", () => {
    beforeEach(() => {
        foo = new FooModule();
        bar = new BarModule();
        const newState = JSON.parse(JSON.stringify(State));
        kasuri = new Kasuri<typeof State>(newState, { foo, bar });
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

    it("can cancel state change promise", async () => {
        // Make sure nodejs doesn't print listener leak warning
        for(let i = 0; i < kasuri.subscription.getMaxListeners() + 1; i++) {
            const p = foo.stateChange("foo", "g");
            p.cancel();
            await nextCycle();
        }
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
            new Promise<[ModuleStateStoreAttr<string>, ModuleStateStoreAttr<string>]>((r) =>
                foo.subscribeState("foo", "g", (val, old) => r([val, old]))
            ),
            nextCycle().then(() => foo.setState({ g: "update" })),
        ]);
        assert.equal(old.value, "");
        assert.equal(val.value, "update");
    });

    it("should call listener multiple times", async () => {
        const changes: any[] = [];
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
            new Promise<[ModuleStateStoreAttr<string>, ModuleStateStoreAttr<string>]>((r) =>
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
        const newState = JSON.parse(JSON.stringify(State));
        kasuri = new Kasuri<typeof State>(newState, { foo, bar });
    });

    it("should init module on construct", async () => {
        await nextCycle();
        assert.equal(kasuri.getState("bar", "status"), "online");
    });

    it("should catch module init errors", async () => {
        await nextCycle();
        assert.equal(kasuri.getState("foo", "status"), "failure");
    });

    it("can subscribe to state update", async () => {
        await nextCycle();
        await nextCycle();
        const [[mod, key, val]] = await Promise.all([
            new Promise<[string, string, ModuleStateStoreAttr<string>]>((r) =>
                kasuri.subscribe((mod, key, val) => (key === "g") && r([mod, key, val]))
            ),
            nextCycle().then(() => foo.setState({ g: "update" })),
        ]);
        assert.equal(mod, "foo");
        assert.equal(key, "g");
        assert.equal(val.value, "update");
    });
});

describe("task", () => {
    beforeEach(() => {
        foo = new FooModule();
        bar = new BarModule();
        const newState = JSON.parse(JSON.stringify(State));
        kasuri = new Kasuri<typeof State>(newState, { foo, bar });
    });

    it("should request task", async () => {
        foo.submitTask("additionReq", "bar", "additionTask", [2, 3]);
        const taskReq = foo.getState("foo", "additionReq");
        assert.equal(typeof taskReq.id, "string");
        assert.deepEqual(taskReq.data, [2, 3]);
    });

    it("should set correct task state", async () => {
        foo.submitTask("additionReq", "bar", "additionTask", [2, 3], "0");
        const taskState = foo.getState("bar", "additionTask");
        await nextCycle();
        const taskState2 = foo.getState("bar", "additionTask");
        assert.equal(taskState2.task["0"].status, "success");
        assert.deepEqual(taskState.task["0"].data, [2, 3]);
        assert.equal(taskState2.task["0"].result, 5);

    });

    it("should receive task result", async () => {
        const result = await foo.submitTask("additionReq", "bar", "additionTask", [2, 3]);
        assert.equal(result, 5);
    });

    it("should prune old task state", async () => {
        foo.submitTask("additionReq", "bar", "additionTask", [2, 3], "1");
        foo.submitTask("additionReq", "bar", "additionTask", [2, 3], "2");
        foo.submitTask("additionReq", "bar", "additionTask", [2, 3], "3");
        foo.submitTask("additionReq", "bar", "additionTask", [2, 3], "4");
        foo.submitTask("additionReq", "bar", "additionTask", [2, 3], "5");
        foo.submitTask("additionReq", "bar", "additionTask", [2, 3], "6");
        await nextCycle();
        const taskState = foo.getState("bar", "additionTask");
        assert.equal(taskState.stale.length, 5);
        assert.equal(taskState.task["0"], undefined);
    });

    it("should enter pending", async function () {
        this.timeout(10000);
        foo.submitTask("defaultPendingReq", "bar", "defaultPendingTask", 1, "1");
        await nextCycle();
        const taskState = foo.getState("bar", "defaultPendingTask");
        assert.equal(taskState.task["1"].status, "pending");
    })
});

describe("introspection", () => {
    let server: Server;
    const client = axios.create({
        method: "POST",
        baseURL: "http://127.0.0.1:3018",
    });

    before(async () => {
        foo = new FooModule();
        bar = new BarModule();
        const newState = JSON.parse(JSON.stringify(State));
        kasuri = new Kasuri<typeof State>(newState, { foo, bar });
        server = await Introspection.server({
            kasuri,
            port: 3018,
            extension: {
                async echo(kasuri, input) {
                    return input;
                },
            },
            basicAuth: "a:",
        });
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

    it("can call extensions", async () => {
        const input = Buffer.from([1, 2, 3]);
        const { data } = await client.post("/call/echo", input, { responseType: "arraybuffer" });
        assert.deepEqual(data, input);
    });

    it("rejects unknown extensions", async () => {
        try {
            await client.post("/call/non-existent");
        } catch (err) {
            assert.equal(err.response.status, 400);
        }
    });
});
