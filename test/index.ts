import { Kasuri, Introspection } from "../src/kasuri";
import State from "./state";
import FooModule from "./foo/module";
import BarModule from "./bar/module";

const foo = new FooModule();
const bar = new BarModule();
const kasuri = new Kasuri<typeof State>(State, { foo, bar });

setInterval(() => {
    bar.setState({ b: { x: Math.random(), y: Math.random() } });
}, 1000);

Introspection.server({
    kasuri,
    extension: {
        async echo(kasuri, input) {
            return input;
        },
    },
}).then(server => {
    console.log("Kasuri introspection server listening on port 3018");
});
