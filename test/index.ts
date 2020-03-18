import { Kasuri, Introspection } from "../src/kasuri";
import StateMap from "./stateMap";
import FooModule from "./foo/module";
import BarModule from "./bar/module";

const foo = new FooModule();
const bar = new BarModule();
const kasuri = new Kasuri<typeof StateMap>(StateMap, { foo, bar });
Introspection.server({ kasuri }).then(server => {
    console.log("Kasuri introspection server listening on port 3018");
});
