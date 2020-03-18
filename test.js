const EventEmitter = require("events");
const e = new EventEmitter();

e.on("event", () => setImmediate(() => console.log("event")));

e.emit("event");
console.log("foo");
e.emit("event");
