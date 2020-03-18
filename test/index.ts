import assert from "assert";
import { Kasuri } from "../src/kasuri";
import StateMap from "./stateMap";
import FooModule from "./foo/module";
import BarModule from "./bar/module";

describe("kasuri", () => {
    it("should init module on construct", () => {
        const kasuri = new Kasuri<typeof StateMap>(StateMap, {
            foo: new FooModule(),
            bar: new BarModule(),
        });
        assert(kasuri.getState("bar", "status") === "online");
    });
});
