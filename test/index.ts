import { Kasuri } from "../src/kasuri";
import StateMap from "./stateMap";
import FooModule from "./foo/module";
import BarModule from "./bar/module";

const k = new Kasuri<typeof StateMap>(StateMap, {
  foo: new FooModule(),
  bar: new BarModule()
});
